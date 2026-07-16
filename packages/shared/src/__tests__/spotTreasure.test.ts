/**
 * 스팟 보물 (M12) — 순수 함수 단위 테스트.
 *
 * 확인:
 *  - 총량 보존 불변식: 발행 총액 ≤ 예치 총액 (슬롯 수 = floor(예치/1인당)).
 *  - 예치(소각) 증명 검증: 진짜 코인 + 리저브 소각 + 사업자 소유.
 *  - 명세 형식 검사.
 */
import { describe, expect, it } from 'vitest';
import { generateKeyPair, signerFromKeyPair } from '../crypto';
import { PendingWalkLedger } from '../ledger';
import { buildWalkSegmentProof } from '../proof';
import { acknowledgeTransfer, createTransfer, mintWalkCoin } from '../coin';
import {
  SPOT_PER_CLAIM_MAX_DSHV,
  isValidSpotTreasureSpec,
  spotConservationHolds,
  spotHasRemaining,
  spotRemainingSlots,
  spotTotalSlots,
  verifySpotDeposit,
  type SpotTreasureSpec,
} from '../spotTreasure';
import { T0, walkKm } from './helpers';

const sponsor = signerFromKeyPair(generateKeyPair());
const reserve = signerFromKeyPair(generateKeyPair());
const other = signerFromKeyPair(generateKeyPair());

function mintCoin(memberId: string, km = 5): ReturnType<typeof mintWalkCoin> {
  const ledger = new PendingWalkLedger({ memberId });
  const end = walkKm(ledger, km);
  return mintWalkCoin(buildWalkSegmentProof(ledger.settleOnSpend(end)!, sponsor));
}

/** 사업자가 리저브로 소각(미완결 이전)한 예치 코인. */
function depositCoin(km = 5) {
  return createTransfer(mintCoin('SHV-100000', km), sponsor, reserve.publicKeyHex, T0 + 1000);
}

describe('선착순 회계 — 총량 보존 불변식', () => {
  it('슬롯 총수 = floor(예치총액 / 1인당 양)', () => {
    expect(spotTotalSlots(500, 50)).toBe(10);
    expect(spotTotalSlots(475, 50)).toBe(9); // 나머지 25는 소각된 채 남는다 (기부분)
    expect(spotTotalSlots(0, 50)).toBe(0); // 미충전 → 슬롯 없음
    expect(spotTotalSlots(40, 0)).toBe(0); // 1인당 0 방어
  });

  it('남은 슬롯 = 총 슬롯 − 발행 수 (음수 바닥)', () => {
    expect(spotRemainingSlots(500, 50, 3)).toBe(7);
    expect(spotRemainingSlots(500, 50, 10)).toBe(0);
    expect(spotRemainingSlots(500, 50, 99)).toBe(0);
  });

  it('잔여 > 0일 때만 코인 지급 가능하다', () => {
    expect(spotHasRemaining(100, 50, 1)).toBe(true);
    expect(spotHasRemaining(100, 50, 2)).toBe(false); // 소진
    expect(spotHasRemaining(0, 50, 0)).toBe(false); // 미충전
  });

  it('★불변식: 어떤 발행 수에서도 (발행 총액 ≤ 예치 총액)이 성립한다', () => {
    // 슬롯을 다 발행해도, 그 이상을 시도해도 보존이 깨지지 않는 범위를 고정한다.
    for (const deposit of [0, 40, 50, 475, 500, 1234]) {
      for (const perClaim of [1, 10, 50, 400]) {
        const slots = spotTotalSlots(deposit, perClaim);
        // 슬롯 수까지 발행: 불변식 참.
        expect(spotConservationHolds(deposit, perClaim, slots)).toBe(true);
        // 슬롯을 넘겨 발행 시도: 불변식이 깨진다(=서버가 이 지점을 막아야 함을 증명).
        if (deposit >= perClaim) {
          expect(spotConservationHolds(deposit, perClaim, slots + 1)).toBe(false);
        }
      }
    }
  });
});

describe('verifySpotDeposit — 예치(소각) 증명 검증', () => {
  const check = { sponsorPublicKey: sponsor.publicKeyHex, reservePublicKey: reserve.publicKeyHex };

  it('사업자가 리저브로 소각한 진짜 코인을 통과시킨다', () => {
    const coin = depositCoin(5);
    const v = verifySpotDeposit(coin, check);
    expect(v.valid).toBe(true);
    expect(v.amountDshv).toBe(coin.amountDshv);
    expect(v.reasons).toEqual([]);
  });

  it('리저브가 아닌 곳으로 이전한 코인은 거부한다 (NOT_COMMITTED_TO_RESERVE)', () => {
    const coin = createTransfer(mintCoin('SHV-100000'), sponsor, other.publicKeyHex, T0 + 1000);
    const v = verifySpotDeposit(coin, check);
    expect(v.valid).toBe(false);
    expect(v.reasons).toContain('NOT_COMMITTED_TO_RESERVE');
  });

  it('사업자 소유가 아닌 코인은 거부한다 (NOT_SPONSOR_OWNED)', () => {
    // other가 자기 코인을 리저브로 소각 — 이 사업자(sponsor)의 예치로 인정 불가.
    const otherLedger = new PendingWalkLedger({ memberId: 'SHV-200000' });
    const end = walkKm(otherLedger, 5);
    const otherCoin = mintWalkCoin(buildWalkSegmentProof(otherLedger.settleOnSpend(end)!, other));
    const coin = createTransfer(otherCoin, other, reserve.publicKeyHex, T0 + 1000);
    const v = verifySpotDeposit(coin, check);
    expect(v.valid).toBe(false);
    expect(v.reasons).toContain('NOT_SPONSOR_OWNED');
  });

  it('소각 서명이 없는(미완결 이전 없는) 코인은 거부한다 (PENDING_COMMIT_MISSING)', () => {
    const coin = mintCoin('SHV-100000'); // 이전 체인 없음
    const v = verifySpotDeposit(coin, check);
    expect(v.valid).toBe(false);
    expect(v.reasons).toContain('PENDING_COMMIT_MISSING');
  });

  it('리저브가 확인 서명해 완결된 코인은 예치로 인정하지 않는다 (미완결 소각만)', () => {
    // 리저브는 절대 확인하지 않지만, 방어적으로: 완결된 링크는 PENDING이 아니므로 거부.
    const coin = acknowledgeTransfer(depositCoin(5), reserve);
    const v = verifySpotDeposit(coin, check);
    expect(v.valid).toBe(false);
    expect(v.reasons).toContain('PENDING_COMMIT_MISSING');
  });

  it('위조 코인은 INVALID_COIN으로 거부한다', () => {
    const coin = depositCoin(5);
    const forged = { ...coin, amountDshv: coin.amountDshv + 1000 };
    const v = verifySpotDeposit(forged, check);
    expect(v.valid).toBe(false);
    expect(v.reasons).toContain('INVALID_COIN');
  });
});

describe('isValidSpotTreasureSpec', () => {
  const valid: SpotTreasureSpec = {
    spotId: 'spot-galilee-cafe',
    regionId: 'israel-national',
    sponsorMemberId: 'SHV-100000',
    displayName: '갈릴리 카페',
    location: { lat: 33.23, lon: 35.65 },
    perClaimDshv: 30,
    validFrom: 1,
    validUntil: 2,
  };

  it('정상 명세를 통과시킨다', () => {
    expect(isValidSpotTreasureSpec(valid)).toBe(true);
    expect(isValidSpotTreasureSpec({ ...valid, perClaimDshv: SPOT_PER_CLAIM_MAX_DSHV })).toBe(true);
  });

  it('형식 위반을 거부한다', () => {
    expect(isValidSpotTreasureSpec({ ...valid, spotId: 'X Y' })).toBe(false);
    expect(isValidSpotTreasureSpec({ ...valid, displayName: '   ' })).toBe(false);
    expect(isValidSpotTreasureSpec({ ...valid, perClaimDshv: 0 })).toBe(false);
    expect(isValidSpotTreasureSpec({ ...valid, perClaimDshv: SPOT_PER_CLAIM_MAX_DSHV + 1 })).toBe(false);
    expect(isValidSpotTreasureSpec({ ...valid, location: { lat: Number.NaN, lon: 1 } })).toBe(false);
    expect(isValidSpotTreasureSpec({ ...valid, validUntil: 0 })).toBe(false);
    expect(isValidSpotTreasureSpec({ ...valid, sponsorMemberId: '' })).toBe(false);
  });
});
