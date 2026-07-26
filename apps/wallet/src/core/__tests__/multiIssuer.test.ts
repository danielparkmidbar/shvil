/**
 * ★제2 발행자 — 지갑 경로에서 두 발행자의 코인이 동시에 통과하는가.
 *
 * > 다니엘 쌤 2026-07-26: **"다른 사람이 다른 방식의 코인 생성기를 만들어도 된다.
 * >  그가 같은 코드 체계의 코인을 생산한다면 — 달러 인쇄기를 다른 누군가가 만들어도
 * >  된다."**
 *
 * `server/test/multiIssuer.test.ts`가 **진짜 서버 두 대**로 같은 것을 확인한다면, 이
 * 파일은 **지갑이 실제로 쓰는 경로**(`mergeTrustedKeyInfos` → `foldTrustedKeys` →
 * `verifyCoin`)를 그대로 통과시켜 확인한다. 재현 실험에서 실패했던 바로 그 경로다:
 *
 * | 예전 결과 | 지금 |
 * |---|---|
 * | A 먼저 → B 코인 `UNKNOWN_MEMBERSHIP_ROOT` / `UNTRUSTED_ISSUER` | 둘 다 valid |
 * | B 먼저 → A 코인 전멸 | 둘 다 valid |
 * | 4개 중 2개만 생존 | **4개 전부 생존** |
 * | B가 A의 회원번호를 사칭한 코인이 valid | 거부 |
 */
import { describe, expect, it } from 'vitest';
import {
  PendingWalkLedger,
  buildGrant,
  buildMembershipCertificate,
  buildWalkSegmentProof,
  deriveKeyId,
  generateKeyPair,
  mintGrantCoin,
  mintWalkCoin,
  signerFromKeyPair,
  verifyCoin,
  type Coin,
  type MembershipCertificate,
  type Signer,
  type WalkSample,
} from '@shvil/shared';
import { foldTrustedKeys, mergeTrustedKeyInfos, type KeyInfoLike } from '../trustedKeys';

const T0 = Date.parse('2026-07-01T06:00:00Z');

/** 한 발행자 = 루트 키 + 발행(엔젤 보너스) 키. 오픈소스 서버를 세운 사람과 같은 모양. */
function makeIssuer(memberId: string) {
  const root = signerFromKeyPair(generateKeyPair());
  const promo = signerFromKeyPair(generateKeyPair());
  const device = signerFromKeyPair(generateKeyPair());
  const rootKeyId = deriveKeyId('MEMBERSHIP_ROOT', root.publicKeyHex);
  const promoKeyId = deriveKeyId('ANGEL_BONUS', promo.publicKeyHex);
  const cert = buildMembershipCertificate(
    {
      memberId,
      devicePublicKey: device.publicKeyHex,
      integrity: 'VERIFIED',
      issuedAt: T0,
      expiresAt: T0 + 30 * 24 * 3600_000,
      issuerKeyId: rootKeyId,
    },
    root,
  );
  return {
    memberId,
    device,
    cert,
    rootKeyId,
    promoKeyId,
    promo,
    /** 이 발행자가 `/keys`로 게시하는 목록. */
    keys: [
      { keyId: rootKeyId, publicKey: root.publicKeyHex, purpose: 'MEMBERSHIP_ROOT' },
      { keyId: promoKeyId, publicKey: promo.publicKeyHex, purpose: 'ANGEL_BONUS' },
    ] as KeyInfoLike[],
  };
}

type Issuer = ReturnType<typeof makeIssuer>;

function walkCoin(memberId: string, device: Signer, cert: MembershipCertificate): Coin {
  const ledger = new PendingWalkLedger({ memberId });
  let t = cert.issuedAt + 3600_000; // 증서 발급 뒤에 걷는다(민팅 창 안)
  for (let i = 0; i < 50; i++) {
    const sample: WalkSample = {
      durationS: 72,
      distanceM: 100,
      steps: 140,
      tier: 'ON_COURSE',
      timestamp: t,
      courseId: 'shvil-israel',
    };
    ledger.recordSample(sample);
    t += 72_000;
  }
  return mintWalkCoin(buildWalkSegmentProof(ledger.settleOnSpend(t)!, device, { membership: cert }));
}

function grantCoin(issuer: Issuer): Coin {
  return mintGrantCoin(
    buildGrant(
      {
        kind: 'ANGEL_BONUS',
        memberId: issuer.memberId,
        amountDshv: 200,
        reference: 'angel-registration',
        recipientPublicKey: issuer.device.publicKeyHex,
        issuerKeyId: issuer.promoKeyId,
        issuedAt: T0,
      },
      issuer.promo,
    ),
  );
}

const A = makeIssuer('SHV-100001'); // 원조 발행자 (다니엘 쌤)
const B = makeIssuer('SHV-200001'); // 제2 발행자

const coins = {
  aWalk: walkCoin(A.memberId, A.device, A.cert),
  aGrant: grantCoin(A),
  bWalk: walkCoin(B.memberId, B.device, B.cert),
  bGrant: grantCoin(B),
};

/** 지갑이 실제로 하는 일: 캐시 병합 → 접기 → 검증. */
function verifyAll(cache: KeyInfoLike[]): Record<keyof typeof coins, boolean> {
  const trustedRootKeys = foldTrustedKeys(cache, true);
  const trustedIssuerKeys = foldTrustedKeys(cache, false);
  const check = (coin: Coin) => verifyCoin(coin, { trustedRootKeys, trustedIssuerKeys }).valid;
  return {
    aWalk: check(coins.aWalk),
    aGrant: check(coins.aGrant),
    bWalk: check(coins.bWalk),
    bGrant: check(coins.bGrant),
  };
}

describe('★두 발행자 공존 — 방침의 코드 증명', () => {
  it('A를 먼저 만난 지갑에 B를 더해도 네 코인이 전부 통과한다', () => {
    let cache = mergeTrustedKeyInfos<KeyInfoLike>([], A.keys);
    cache = mergeTrustedKeyInfos(cache, B.keys);
    expect(verifyAll(cache)).toEqual({ aWalk: true, aGrant: true, bWalk: true, bGrant: true });
  });

  it('B를 먼저 만난 지갑에 A를 더해도 결과가 같다 (순서가 화폐를 정하지 않는다)', () => {
    let cache = mergeTrustedKeyInfos<KeyInfoLike>([], B.keys);
    cache = mergeTrustedKeyInfos(cache, A.keys);
    expect(verifyAll(cache)).toEqual({ aWalk: true, aGrant: true, bWalk: true, bGrant: true });
  });

  it('★생존 수: 4개 중 4개 (재현 실험에서는 어느 순서든 2개였다)', () => {
    const cache = mergeTrustedKeyInfos<KeyInfoLike>(A.keys, B.keys);
    expect(Object.values(verifyAll(cache)).filter(Boolean)).toHaveLength(4);
    // 슬롯이 겹치지 않는다 = 루트 2개·발행 키 2개가 각자 자리에 있다.
    expect(Object.keys(foldTrustedKeys(cache, true))).toHaveLength(2);
    expect(Object.keys(foldTrustedKeys(cache, false))).toHaveLength(2);
  });

  it('B를 신뢰하지 않기로 한 지갑에서는 B 코인만 통과하지 못한다 (A는 멀쩡하다)', () => {
    // ★"누구를 신뢰하는가"는 이 작업의 범위가 아니다(규격 9.4 — 커뮤니티의 문제).
    //   여기서 확인하는 것은 "신뢰하지 않기로 한 쪽을 거부해도 신뢰하는 쪽이 함께
    //   죽지는 않는다"는 것뿐이다.
    const cache = mergeTrustedKeyInfos<KeyInfoLike>([], A.keys);
    expect(verifyAll(cache)).toEqual({ aWalk: true, aGrant: true, bWalk: false, bGrant: false });
  });

  it('★사칭: B가 A의 회원 번호로 찍은 코인은 A만 신뢰하는 지갑에서 거부된다', () => {
    const impostor = makeIssuer('SHV-100001'); // A와 **같은 회원 번호**를 주장
    const fake = walkCoin(impostor.memberId, impostor.device, impostor.cert);
    const cache = mergeTrustedKeyInfos<KeyInfoLike>([], A.keys);
    const trustedRootKeys = foldTrustedKeys(cache, true);
    expect(verifyCoin(fake, { trustedRootKeys }).valid).toBe(false);
    // 같은 지갑에서 진짜 A의 코인은 통과한다 — 예전에는 이 둘이 정확히 뒤바뀌었다.
    expect(verifyCoin(coins.aWalk, { trustedRootKeys }).valid).toBe(true);
  });
});
