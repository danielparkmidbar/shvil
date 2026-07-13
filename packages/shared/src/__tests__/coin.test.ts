import { describe, expect, it } from 'vitest';
import { generateKeyPair, signerFromKeyPair, addressFromPublicKey, type Signer } from '../crypto';
import { PendingWalkLedger } from '../ledger';
import { buildWalkSegmentProof, verifyWalkSegmentProof } from '../proof';
import {
  acknowledgeTransfer,
  buildGrant,
  createTransfer,
  currentOwnerAddress,
  mintGrantCoin,
  mintWalkCoin,
  splitCoin,
  verifyCoin,
  verifyGrant,
} from '../coin';
import type { Coin } from '../types';
import { T0, walkKm } from './helpers';

const alice = signerFromKeyPair(generateKeyPair());
const bob = signerFromKeyPair(generateKeyPair());
const carol = signerFromKeyPair(generateKeyPair());

function mintCoinFor(memberId: string, signer: Signer, km = 17.3): Coin {
  const ledger = new PendingWalkLedger({ memberId });
  const end = walkKm(ledger, km);
  const draft = ledger.settleOnSpend(end)!;
  return mintWalkCoin(buildWalkSegmentProof(draft, signer));
}

describe('계보 검증 — WalkSegmentProof (지시서 2.2, 2.3)', () => {
  it('정상 민팅 코인은 로컬 검증을 통과한다', () => {
    const coin = mintCoinFor('m-alice', alice);
    expect(coin.amountDshv).toBe(173); // 17.3km → 17.3 SHV (173 dSHV)
    expect(coin.memberId).toBe('m-alice');
    expect(verifyCoin(coin).valid).toBe(true);
  });

  it('증명에는 좌표·경로가 없다 — 코스 ID와 거리·걸음·날짜뿐 (위치 비저장)', () => {
    const coin = mintCoinFor('m-alice', alice);
    if (coin.provenance.kind !== 'WALK') throw new Error('unexpected');
    const keys = Object.keys(coin.provenance.proof);
    for (const k of keys) {
      expect(k).not.toMatch(/lat|lon|lng|coord|geo|track|path|route/i);
    }
    expect(coin.provenance.proof.courseIds).toEqual(['shvil-israel']);
  });

  it('금액 변조 → ID·금액 불일치로 거부', () => {
    const coin = mintCoinFor('m-alice', alice);
    const forged = { ...coin, amountDshv: coin.amountDshv + 1000 };
    const verdict = verifyCoin(forged);
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons).toContain('AMOUNT_MISMATCH');
  });

  it('증명 내용 변조(거리 부풀리기) → 서명 불일치로 거부', () => {
    const coin = mintCoinFor('m-alice', alice);
    if (coin.provenance.kind !== 'WALK') throw new Error('unexpected');
    const forgedProof = { ...coin.provenance.proof, distanceM: 999_999 };
    const forged: Coin = { ...coin, provenance: { kind: 'WALK', proof: forgedProof } };
    const verdict = verifyCoin(forged);
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons).toContain('BAD_PROOF_SIGNATURE');
    expect(verifyWalkSegmentProof(forgedProof)).toBe(false);
  });

  it('타인 키로 서명된 증명(키 없는 위조) → 거부', () => {
    const coin = mintCoinFor('m-alice', alice);
    if (coin.provenance.kind !== 'WALK') throw new Error('unexpected');
    // 공격자가 자기 키로 서명만 바꿔치기
    const forgedProof = { ...coin.provenance.proof, devicePublicKey: carol.publicKeyHex };
    const forged: Coin = { ...coin, provenance: { kind: 'WALK', proof: forgedProof } };
    expect(verifyCoin(forged).valid).toBe(false);
  });

  it('일자별 내역 합계 ≠ 총액인 증명은 거부 (인간 한계 검증 입력의 무결성)', () => {
    const coin = mintCoinFor('m-alice', alice);
    if (coin.provenance.kind !== 'WALK') throw new Error('unexpected');
    const forgedProof = {
      ...coin.provenance.proof,
      dailyBreakdown: [{ date: '2026-07-01', amountDshv: 1 }],
    };
    expect(verifyWalkSegmentProof(forgedProof)).toBe(false);
  });

  it('앱 무결성 필수 모드: 회원 증서 없는 코인은 거부 (지시서 3장 1항, 보안 감사 C-2)', () => {
    // 증서 상세 검증은 membership.test.ts. 여기서는 verifyCoin 게이팅만 확인.
    const coin = mintCoinFor('m-alice', alice);
    expect(verifyCoin(coin, { requireIntegrityToken: true }).reasons).toContain('MISSING_INTEGRITY_TOKEN');
  });
});

describe('이전 체인 — 무승인 양측 서명 거래 (지시서 2.3)', () => {
  it('지불 서명 + 수령 확인 서명으로 거래가 완결된다', () => {
    let coin = mintCoinFor('m-alice', alice);
    coin = createTransfer(coin, alice, bob.publicKeyHex, T0 + 1000);
    coin = acknowledgeTransfer(coin, bob);
    expect(verifyCoin(coin).valid).toBe(true);
    expect(currentOwnerAddress(coin)).toBe(addressFromPublicKey(bob.publicKeyHex));
  });

  it('여러 홉을 거쳐도 계보(회원 번호·생성 증명)는 불변', () => {
    let coin = mintCoinFor('m-alice', alice);
    coin = acknowledgeTransfer(createTransfer(coin, alice, bob.publicKeyHex, T0 + 1000), bob);
    coin = acknowledgeTransfer(createTransfer(coin, bob, carol.publicKeyHex, T0 + 2000), carol);
    expect(verifyCoin(coin).valid).toBe(true);
    expect(coin.memberId).toBe('m-alice'); // 생성자 회원 번호 영구 각인
    expect(currentOwnerAddress(coin)).toBe(addressFromPublicKey(carol.publicKeyHex));
  });

  it('소유자가 아닌 자의 이전 시도는 불가', () => {
    const coin = mintCoinFor('m-alice', alice);
    expect(() => createTransfer(coin, carol, bob.publicKeyHex, T0)).toThrow(/not the current owner/);
  });

  it('수령 확인 없는 이전은 미완결로 표시된다 (QR 왕복 중간 상태)', () => {
    let coin = mintCoinFor('m-alice', alice);
    coin = createTransfer(coin, alice, bob.publicKeyHex, T0 + 1000);
    expect(verifyCoin(coin).reasons).toContain('INCOMPLETE_TRANSFER');
    expect(verifyCoin(coin, { allowPendingLastLink: true }).valid).toBe(true);
  });

  it('이전 링크 서명 위조 → 거부', () => {
    let coin = mintCoinFor('m-alice', alice);
    coin = acknowledgeTransfer(createTransfer(coin, alice, bob.publicKeyHex, T0 + 1000), bob);
    const link = coin.transferChain[0]!;
    const forged: Coin = { ...coin, transferChain: [{ ...link, to: addressFromPublicKey(carol.publicKeyHex), toPublicKey: carol.publicKeyHex }] };
    const verdict = verifyCoin(forged);
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons).toContain('BAD_TRANSFER_SIGNATURE');
  });

  it('체인 중간 삭제·재정렬 → 체인 해시 불일치로 거부', () => {
    let coin = mintCoinFor('m-alice', alice);
    coin = acknowledgeTransfer(createTransfer(coin, alice, bob.publicKeyHex, T0 + 1000), bob);
    coin = acknowledgeTransfer(createTransfer(coin, bob, carol.publicKeyHex, T0 + 2000), carol);
    const truncated: Coin = { ...coin, transferChain: [coin.transferChain[1]!] };
    expect(verifyCoin(truncated).valid).toBe(false);
  });
});

describe('코인 분할 (잔돈) — 계보 상속', () => {
  it('분할 합계 = 부모 금액이면 자식들은 유효하고 계보를 상속한다', () => {
    const coin = mintCoinFor('m-alice', alice); // 173 dSHV
    const [pay, change] = splitCoin(coin, alice, [100, 73], T0 + 1000);
    expect(verifyCoin(pay!).valid).toBe(true);
    expect(verifyCoin(change!).valid).toBe(true);
    expect(pay!.memberId).toBe('m-alice');
    expect(pay!.amountDshv + change!.amountDshv).toBe(coin.amountDshv);
  });

  it('부모 금액을 초과·미달하는 분할은 불가', () => {
    const coin = mintCoinFor('m-alice', alice);
    expect(() => splitCoin(coin, alice, [100, 100], T0)).toThrow(/sum to the parent/);
    expect(() => splitCoin(coin, alice, [100, 50], T0)).toThrow(/sum to the parent/);
  });

  it('자식 금액 변조 → 분할 기록과 불일치로 거부', () => {
    const coin = mintCoinFor('m-alice', alice);
    const [pay] = splitCoin(coin, alice, [100, 73], T0);
    const forged = { ...pay!, amountDshv: 170 };
    const verdict = verifyCoin(forged);
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons).toContain('AMOUNT_MISMATCH');
  });

  it('소유자가 아닌 자는 분할할 수 없다', () => {
    const coin = mintCoinFor('m-alice', alice);
    expect(() => splitCoin(coin, carol, [100, 73], T0)).toThrow(/not the current owner/);
  });
});

describe('발행 승인서(GRANT) 계보 — 엔젤 보너스·클레임·격려 코인 (지시서 2.4~2.6)', () => {
  const promoKey = signerFromKeyPair(generateKeyPair());
  const trusted = { 'promo-2026-q3': promoKey.publicKeyHex };

  function angelBonusCoin() {
    const grant = buildGrant(
      {
        kind: 'ANGEL_BONUS',
        memberId: 'm-angel',
        amountDshv: 200,
        reference: 'registration',
        recipientPublicKey: bob.publicKeyHex,
        issuerKeyId: 'promo-2026-q3',
        issuedAt: T0,
      },
      promoKey,
    );
    return mintGrantCoin(grant);
  }

  it('신뢰 발행 키의 승인서로 민팅된 코인은 유효하다', () => {
    const coin = angelBonusCoin();
    expect(verifyCoin(coin, { trustedIssuerKeys: trusted }).valid).toBe(true);
    expect(currentOwnerAddress(coin)).toBe(addressFromPublicKey(bob.publicKeyHex));
  });

  it('신뢰 목록에 없는 발행 키 → 거부 (프로모션 키는 기간·수량 한정)', () => {
    const coin = angelBonusCoin();
    const verdict = verifyCoin(coin, { trustedIssuerKeys: {} });
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons).toContain('UNTRUSTED_ISSUER');
  });

  it('승인서 금액 변조 → 서명 불일치로 거부', () => {
    const coin = angelBonusCoin();
    if (coin.provenance.kind !== 'GRANT') throw new Error('unexpected');
    const forged: Coin = {
      ...coin,
      amountDshv: 9_999,
      provenance: { kind: 'GRANT', grant: { ...coin.provenance.grant, amountDshv: 9_999 } },
    };
    const verdict = verifyCoin(forged, { trustedIssuerKeys: trusted });
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons).toContain('BAD_GRANT_SIGNATURE');
  });

  it('발행 키 유출 방어: kind별 상한 초과 grant는 서명이 유효해도 거부 (보안 감사 H-2)', () => {
    // 유출된 발행 키로 정당하게 서명했지만 상한(엔젤 보너스 300)을 넘긴 grant
    const grant = buildGrant(
      {
        kind: 'ANGEL_BONUS',
        memberId: 'm-angel',
        amountDshv: 100_000,
        reference: 'leaked',
        recipientPublicKey: bob.publicKeyHex,
        issuerKeyId: 'promo-2026-q3',
        issuedAt: T0,
      },
      promoKey,
    );
    expect(verifyGrant(grant)).toBe(false);
    const verdict = verifyCoin(mintGrantCoin(grant), { trustedIssuerKeys: trusted });
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons).toContain('BAD_GRANT_SIGNATURE');
  });
});
