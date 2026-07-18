/**
 * 검증 실적 기여 후보 고르기 (C 안 A — trustService.pickWalkCreditCandidates).
 *
 * 서버가 최종 관문(verifyCoin + 소유·SELF 검사)이지만, 지갑도 보낼 것만 보낸다:
 * 남이 만든 걷기 코인 중 **내가 지금 보유한** 것만. 자기 코인·GRANT 계보·남의
 * 보유분은 어차피 서버가 배제하므로 트래픽을 아낀다.
 */
import { describe, expect, it } from 'vitest';
import {
  PendingWalkLedger,
  acceptPayment,
  addressFromPublicKey,
  buildCharge,
  buildGrant,
  buildPayment,
  buildWalkSegmentProof,
  generateKeyPair,
  mintGrantCoin,
  mintWalkCoin,
  signerFromKeyPair,
  type Coin,
  type Signer,
  type WalkSample,
} from '@shvil/shared';
import { pickWalkCreditCandidates } from '../trustFormat';

const T0 = Date.parse('2026-07-12T06:00:00Z');

interface Who {
  memberId: string;
  signer: Signer;
  address: string;
}

function makeWho(memberId: string): Who {
  const signer = signerFromKeyPair(generateKeyPair());
  return { memberId, signer, address: addressFromPublicKey(signer.publicKeyHex) };
}

function mintWalk(who: Who, dshv: number, startAt = T0): Coin {
  const ledger = new PendingWalkLedger({ memberId: who.memberId });
  let t = startAt;
  for (let i = 0; i < dshv; i++) {
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
  return mintWalkCoin(buildWalkSegmentProof(ledger.settleOnSpend(t)!, who.signer));
}

function payTo(coin: Coin, payer: Who, payee: Who, chargeId: string): Coin {
  const charge = buildCharge(
    { chargeId, angelMemberId: payee.memberId, amountDshv: coin.amountDshv, createdAt: Date.now() },
    payee.signer,
  );
  const payment = buildPayment(charge, [coin], payer.memberId, payer.signer, Date.now());
  return acceptPayment(charge, payment, payee.signer).coins[0]!;
}

const me = makeWho('SHV-100001');
const walker = makeWho('SHV-100002');
const stranger = makeWho('SHV-100003');

describe('pickWalkCreditCandidates', () => {
  it('내가 보유한 남의 걷기 코인은 후보다', () => {
    const received = payTo(mintWalk(walker, 50), walker, me, 'chg-1');
    const picked = pickWalkCreditCandidates([received], me.memberId, me.address);
    expect(picked).toHaveLength(1);
    expect(picked[0]!.memberId).toBe(walker.memberId);
  });

  it('내가 만든 코인은 제외한다 (자기 실적 불가)', () => {
    const mine = mintWalk(me, 50);
    expect(pickWalkCreditCandidates([mine], me.memberId, me.address)).toHaveLength(0);
  });

  it('내가 보유하지 않은 코인은 제외한다 (실보유분만)', () => {
    // walker가 stranger에게 지불한 코인 — 나는 소유자가 아니다.
    const toStranger = payTo(mintWalk(walker, 50), walker, stranger, 'chg-2');
    expect(pickWalkCreditCandidates([toStranger], me.memberId, me.address)).toHaveLength(0);
  });

  it('GRANT 계보 코인은 제외한다 (걸음이 아니다)', () => {
    // 생산자는 walker, 수령(기저 소유)은 나 — 이전 없이도 "내가 보유한 남의 코인"이
    // 되므로, 걷기 계보만 걸러내는지 순수하게 확인할 수 있다.
    const issuer = signerFromKeyPair(generateKeyPair());
    const grant = buildGrant(
      {
        kind: 'ANGEL_BONUS',
        memberId: walker.memberId,
        amountDshv: 200,
        reference: 'angel-registration',
        recipientPublicKey: me.signer.publicKeyHex,
        issuerKeyId: 'promo-angel-2026',
        issuedAt: Date.now(),
      },
      issuer,
    );
    const bonus = mintGrantCoin(grant);
    expect(bonus.memberId).toBe(walker.memberId);
    expect(pickWalkCreditCandidates([bonus], me.memberId, me.address)).toHaveLength(0);
  });

  // 코인 120개 민팅·서명이라 무겁다 — 병렬 전체 실행에서 기본 5초를 넘길 수 있어 타임아웃 명시.
  it('상한(100)을 넘겨 보내지 않는다', { timeout: 30_000 }, () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      payTo(mintWalk(walker, 1, T0 + i * 86_400_000), walker, me, `chg-bulk-${i}`),
    );
    expect(pickWalkCreditCandidates(many, me.memberId, me.address)).toHaveLength(100);
  });
});
