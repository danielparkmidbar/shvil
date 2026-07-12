import { describe, expect, it } from 'vitest';
import { generateKeyPair, signerFromKeyPair, type Signer } from '../crypto.js';
import { buildWalkSegmentProof } from '../proof.js';
import { mintWalkCoin, splitCoin } from '../coin.js';
import { checkHumanLimits } from '../humanLimits.js';
import type { SettlementDraft } from '../ledger.js';
import type { Coin } from '../types.js';
import { T0 } from './helpers.js';

const walker = signerFromKeyPair(generateKeyPair());

function coinWithBreakdown(
  memberId: string,
  breakdown: { date: string; amountDshv: number }[],
  signer: Signer = walker,
  salt = 0,
): Coin {
  const total = breakdown.reduce((a, b) => a + b.amountDshv, 0);
  const draft: SettlementDraft = {
    memberId,
    settlement: 'SPEND',
    startedAt: T0 + salt,
    settledAt: T0 + salt + 3_600_000,
    distanceM: total * 100,
    stepCount: total * 140,
    courseIds: ['shvil-israel'],
    amountDshv: total,
    dailyBreakdown: breakdown,
    sensorSummaryHash: `hash-${salt}`,
  };
  return mintWalkCoin(buildWalkSegmentProof(draft, signer));
}

describe('인간 한계 프로파일 검증 — 무한 복제의 구조적 차단 (지시서 3장)', () => {
  it('하루 합계가 상한(40 SHV) 이내면 통과', () => {
    const known = coinWithBreakdown('m-1', [{ date: '2026-07-01', amountDshv: 300 }], walker, 1);
    const candidate = coinWithBreakdown('m-1', [{ date: '2026-07-01', amountDshv: 100 }], walker, 2);
    expect(checkHumanLimits(candidate, [known]).ok).toBe(true);
  });

  it('같은 회원 번호로 같은 날 40 SHV 초과 → 즉시 거부', () => {
    const known = coinWithBreakdown('m-1', [{ date: '2026-07-01', amountDshv: 300 }], walker, 1);
    const candidate = coinWithBreakdown('m-1', [{ date: '2026-07-01', amountDshv: 200 }], walker, 2);
    const verdict = checkHumanLimits(candidate, [known]);
    expect(verdict.ok).toBe(false);
    expect(verdict.violations[0]).toMatchObject({ kind: 'DAILY', date: '2026-07-01', totalDshv: 500 });
  });

  it('주간 상한: 7일 창 합계가 프로파일 한계를 넘으면 거부', () => {
    const profile = { dailyMaxDshv: 400, weeklyMaxDshv: 1_000 };
    const known = [
      coinWithBreakdown('m-1', [{ date: '2026-07-01', amountDshv: 400 }], walker, 1),
      coinWithBreakdown('m-1', [{ date: '2026-07-02', amountDshv: 400 }], walker, 2),
    ];
    const candidate = coinWithBreakdown('m-1', [{ date: '2026-07-03', amountDshv: 400 }], walker, 3);
    const verdict = checkHumanLimits(candidate, known, profile);
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.some((v) => v.kind === 'WEEKLY' && v.totalDshv === 1_200)).toBe(true);
  });

  it('분할 형제 코인들은 같은 걷기 증명을 이중 계상하지 않는다', () => {
    const parent = coinWithBreakdown('m-1', [{ date: '2026-07-01', amountDshv: 400 }], walker, 1);
    const [a, b] = splitCoin(parent, walker, [250, 150], T0 + 10_000);
    // a와 b 모두 400 dSHV짜리 증명을 품지만, 실제 걷기는 한 번뿐
    expect(checkHumanLimits(a!, [b!, parent]).ok).toBe(true);
  });

  it('다른 회원의 코인은 합산 대상이 아니다', () => {
    const other = signerFromKeyPair(generateKeyPair());
    const known = coinWithBreakdown('m-2', [{ date: '2026-07-01', amountDshv: 400 }], other, 1);
    const candidate = coinWithBreakdown('m-1', [{ date: '2026-07-01', amountDshv: 400 }], walker, 2);
    expect(checkHumanLimits(candidate, [known]).ok).toBe(true);
  });
});
