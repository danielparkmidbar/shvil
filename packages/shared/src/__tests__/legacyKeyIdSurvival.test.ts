/**
 * ★옛 이름이 박힌 화폐는 죽지 않는다 — 이름 해소 (규격 9.2 I-2·I-3, 2026-07-26).
 *
 * 다니엘 쌤 원칙:
 * > "새 방지 시스템이 나온다고 옛 화폐가 가짜가 되지는 않는다."
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 * 2026-07-26 이전에 발급된 증서·GRANT 안에는 `membership-root-2026` 같은 **하드코딩된
 * 이름**이 서명 대상으로 박혀 있다. 고칠 수 없다. 그런데 그 이름은 모든 배포가 같이
 * 쓰던 이름이라, 신뢰 목록(`Record<keyId, publicKey>`)에서 **한 칸을 두고 다툰다.**
 * 적대검증이 재현한 것:
 *  · 그 칸을 남이 선점하면 원조의 옛 코인이 전량 죽는다(되돌릴 방법이 없다).
 *  · 이력이 빈 배포를 업그레이드하면 그 칸이 아예 비어 옛 코인이 전량 죽는다.
 *
 * ── 고침: 이름이 아니라 공개키로 판정한다 ────────────────────────────
 * 증서·GRANT는 서명 검증에 쓸 **공개키를 스스로 들고 다닌다.** 그러니 옛 이름을 만나면
 * 그 공개키를 용도별로 다시 유도해 신뢰 목록에서 찾으면 된다. 이름은 조회 색인일 뿐
 * 권위가 아니다 → **옛 이름 칸을 누가 차지하든 옛 화폐가 죽지 않는다.**
 *
 * 이 파일은 그 계약을 코인 단위로 고정한다.
 */
import { describe, expect, it } from 'vitest';
import { generateKeyPair, signerFromKeyPair } from '../crypto';
import { PendingWalkLedger } from '../ledger';
import { buildWalkSegmentProof } from '../proof';
import { buildMembershipCertificate } from '../membership';
import { buildGrant, mintGrantCoin, mintWalkCoin, verifyCoin } from '../coin';
import { deriveKeyId } from '../keyId';
import { walkKm } from './helpers';

const DAY = 86_400_000;
const ISSUED_AT = Date.parse('2026-05-10T09:00:00Z');
const MINT_AT = ISSUED_AT + 5 * DAY;

/** 원조 발행자(A)와, 나중에 나타난 다른 발행자(B). 각자 자기 키 재료를 갖는다. */
const rootA = signerFromKeyPair(generateKeyPair());
const rootB = signerFromKeyPair(generateKeyPair());
const promoA = signerFromKeyPair(generateKeyPair());
const device = signerFromKeyPair(generateKeyPair());

/** 유도 이름만 담긴 신뢰 목록 — 옛 이름은 한 칸도 없다(업그레이드된 배포의 `/keys`). */
const rootsDerivedOnly = { [deriveKeyId('MEMBERSHIP_ROOT', rootA.publicKeyHex)]: rootA.publicKeyHex };
const issuersDerivedOnly = { [deriveKeyId('ANGEL_BONUS', promoA.publicKeyHex)]: promoA.publicKeyHex };

/** 2026-07-26 이전에 발급된 증서 — 이름이 하드코딩된 옛 이름이다. */
function oldCert(issuer = rootA) {
  return buildMembershipCertificate(
    {
      memberId: 'SHV-100001',
      devicePublicKey: device.publicKeyHex,
      integrity: 'VERIFIED',
      issuedAt: ISSUED_AT,
      expiresAt: ISSUED_AT + 30 * DAY,
      issuerKeyId: 'membership-root-2026',
    },
    issuer,
  );
}

function oldWalkCoin(issuer = rootA) {
  const ledger = new PendingWalkLedger({ memberId: 'SHV-100001' });
  const last = walkKm(ledger, 5, {}, MINT_AT - 50 * 72_000);
  const draft = ledger.settleOnSpend(last)!;
  return mintWalkCoin(
    buildWalkSegmentProof(draft, device, { appIntegrityToken: 'play-integrity', membership: oldCert(issuer) }),
  );
}

/** 옛 이름으로 발행된 엔젤 보너스 GRANT 코인. */
function oldGrantCoin(issuer = promoA) {
  return mintGrantCoin(
    buildGrant(
      {
        kind: 'ANGEL_BONUS',
        memberId: 'SHV-100001',
        amountDshv: 200,
        reference: '엔젤 등록',
        recipientPublicKey: device.publicKeyHex,
        issuerKeyId: 'promo-angel-2026',
        issuedAt: ISSUED_AT,
      },
      issuer,
    ),
  );
}

describe('★옛 이름이 목록에 없어도 옛 코인이 검증된다 (배포 순서와 무관)', () => {
  it('옛 증서를 단 WALK 코인 — 유도 이름만 있는 목록에서 유효', () => {
    expect(verifyCoin(oldWalkCoin(), { trustedRootKeys: rootsDerivedOnly, requireIntegrityToken: true })).toEqual({
      valid: true,
      reasons: [],
    });
  });

  it('옛 이름으로 발행된 GRANT 코인 — 유도 이름만 있는 목록에서 유효', () => {
    expect(verifyCoin(oldGrantCoin(), { trustedIssuerKeys: issuersDerivedOnly })).toEqual({
      valid: true,
      reasons: [],
    });
  });

  it('옛 이름을 병기한 목록에서도 그대로 유효하다 (업그레이드 전 지갑의 캐시)', () => {
    const both = { ...rootsDerivedOnly, 'membership-root-2026': rootA.publicKeyHex };
    expect(verifyCoin(oldWalkCoin(), { trustedRootKeys: both, requireIntegrityToken: true }).valid).toBe(true);
  });
});

describe('★옛 이름 칸을 남이 차지해도 원조의 옛 화폐가 죽지 않는다 (선점 무력화)', () => {
  /** 공격자/제2 발행자가 `membership-root-2026`을 자기 공개키로 주장해 둔 지갑. */
  const squatted = {
    ...rootsDerivedOnly,
    'membership-root-2026': rootB.publicKeyHex,
    [deriveKeyId('MEMBERSHIP_ROOT', rootB.publicKeyHex)]: rootB.publicKeyHex,
  };

  it('원조(A)가 옛 이름으로 발급한 증서의 코인이 그대로 유효하다', () => {
    // 적대검증 재현에서는 여기가 UNKNOWN_MEMBERSHIP_ROOT였고 되돌릴 방법이 없었다.
    expect(verifyCoin(oldWalkCoin(rootA), { trustedRootKeys: squatted, requireIntegrityToken: true })).toEqual({
      valid: true,
      reasons: [],
    });
  });

  it('두 발행자의 옛 이름 코인이 한 지갑에서 동시에 유효할 수 있다 — 칸 다툼이 없다', () => {
    expect(verifyCoin(oldWalkCoin(rootB), { trustedRootKeys: squatted, requireIntegrityToken: true }).valid).toBe(true);
    expect(verifyCoin(oldWalkCoin(rootA), { trustedRootKeys: squatted, requireIntegrityToken: true }).valid).toBe(true);
  });
});

describe('이름 해소가 신뢰를 넓히지 않는다', () => {
  it('신뢰하지 않는 키가 옛 이름을 달아도 거부된다', () => {
    const verdict = verifyCoin(oldWalkCoin(rootB), {
      trustedRootKeys: rootsDerivedOnly, // A만 신뢰하는 지갑
      requireIntegrityToken: true,
    });
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons).toContain('UNKNOWN_MEMBERSHIP_ROOT');
  });

  it('옛 이름은 용도를 넘지 못한다 — 루트 키로 GRANT를 발행할 수 없다', () => {
    const grant = mintGrantCoin(
      buildGrant(
        {
          kind: 'ANGEL_BONUS',
          memberId: 'SHV-100001',
          amountDshv: 200,
          reference: '루트 키로 찍은 보너스',
          recipientPublicKey: device.publicKeyHex,
          issuerKeyId: 'promo-angel-2026',
          issuedAt: ISSUED_AT,
        },
        rootA,
      ),
    );
    const trusted = { ...issuersDerivedOnly, ...rootsDerivedOnly }; // 루트까지 섞어 줘도
    expect(verifyCoin(grant, { trustedIssuerKeys: trusted }).reasons).toContain('UNTRUSTED_ISSUER');
  });

  it('서명이 틀린 옛 이름 증서는 그대로 거부된다 (해소는 서명을 대신하지 않는다)', () => {
    const forged = { ...oldWalkCoin(rootA) };
    const p = forged.provenance as { kind: 'WALK'; proof: { membership: { signature: string } } };
    p.proof.membership.signature = 'ff'.repeat(64);
    expect(verifyCoin(forged, { trustedRootKeys: rootsDerivedOnly, requireIntegrityToken: true }).valid).toBe(false);
  });
});
