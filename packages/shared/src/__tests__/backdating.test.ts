/**
 * 백데이팅 구멍 수리 (M16-A) — 2026-07-26.
 *
 * ── 무엇을 재현하고 무엇을 막았나 ─────────────────────────────────────
 * 재현: 변조 앱이 `startedAt`을 3년 전으로 밀고 `distanceM`을 그에 맞춰 키우면
 * **43,800 SHV** 코인 한 장이 findings 0건으로 AUTHENTIC을 받았다. 10년이면 146,000 SHV.
 * 백데이팅이 방어를 뚫는 게 아니라 **무력화**한다는 것이 핵심이었다 — 창을 늘릴수록
 * 평균 속도(0.417 km/h)와 케이던스(9.26 spm)가 오히려 더 안전해 보인다.
 *
 * 막은 방법: 비율이 아니라 **절대량**을 건다.
 *   WINDOW_TOO_LONG · BREAKDOWN_TOO_MANY · PROOF_CAP.
 *
 * ★이 파일에서 가장 중요한 테스트는 위조 차단이 아니라 **60일 종주자 통과**다.
 *   상한을 거는 순간 정직한 종주자를 위폐범으로 만들 위험이 생기기 때문이다(제3조).
 */
import { describe, expect, it } from 'vitest';
import { generateKeyPair, hashObject, signerFromKeyPair, type Signer } from '../crypto';
import { PendingWalkLedger, type SettlementDraft } from '../ledger';
import { buildWalkSegmentProof } from '../proof';
import { mintWalkCoin, splitCoin, verifyCoin } from '../coin';
import {
  MAX_SEGMENT_SPAN_DAYS,
  MAX_SEGMENT_SPAN_MS,
  checkAuthenticity,
  checkCoinAuthenticity,
  maxProofAmountDshv,
} from '../authenticity';
import { DEFAULT_HUMAN_LIMIT_PROFILE } from '../params';
import type { Coin } from '../types';
import { walkKm } from './helpers';

const alice = signerFromKeyPair(generateKeyPair());
const NOW = Date.parse('2026-07-26T12:00:00Z');
const DAY = 86_400_000;
/** 하루의 시작으로 맞춘 NOW — 경계 테스트에서 역일 계산을 예측 가능하게 만든다. */
const NOW_DAY0 = Math.floor(NOW / DAY) * DAY;

function dayStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 변조 앱 흉내 — 원장을 거치지 않고 초안을 손으로 지어 자기 키로 서명한다. */
function forge(fields: Partial<SettlementDraft>, signer: Signer = alice): Coin {
  const draft: SettlementDraft = {
    memberId: 'm-forger',
    settlement: 'MANUAL',
    startedAt: NOW - 2 * 3600_000,
    settledAt: NOW,
    distanceM: 10_000,
    stepCount: 14_000,
    courseIds: ['shvil-israel'],
    amountDshv: 100,
    dailyBreakdown: [{ date: dayStr(NOW), amountDshv: 100 }],
    sensorSummaryHash: hashObject({ seed: Math.random() }),
    ...fields,
  };
  return mintWalkCoin(buildWalkSegmentProof(draft, signer));
}

/**
 * 원본 공격 그대로: N일을 과거로 밀고 하루 400 dSHV씩. 거리는 발행액에 맞춰
 * 25 m/dSHV로 키운다(MINT_RATE 경계를 정확히 스치도록 — 재현 리포트와 동일).
 */
function backdatedCoin(days: number): Coin {
  const perDay = 400;
  const amountDshv = days * perDay;
  const settledAt = NOW;
  const startedAt = settledAt - days * DAY;
  return forge({
    startedAt,
    settledAt,
    distanceM: amountDshv * 25,
    stepCount: Math.round((amountDshv * 25) / 0.75),
    amountDshv,
    dailyBreakdown: Array.from({ length: days }, (_, i) => ({
      date: dayStr(startedAt + (i + 1) * DAY),
      amountDshv: perDay,
    })),
  });
}

describe('★백데이팅 — 재현했던 공격이 이제 차단된다', () => {
  it('3년(1095일) 백데이팅 43,800 SHV → FORGED (예전에는 findings 0건 AUTHENTIC이었다)', () => {
    const coin = backdatedCoin(1095);
    // 전제: 서명은 여전히 완벽하다. 물리·시간만으로 잡아야 한다.
    expect(verifyCoin(coin).valid).toBe(true);
    expect(coin.amountDshv).toBe(438_000);

    const report = checkCoinAuthenticity(coin, { now: NOW });
    expect(report.coreVerdict).toBe('FORGED');
    const checks = report.coreFindings.map((f) => f.check);
    expect(checks).toContain('WINDOW_TOO_LONG');
    expect(checks).toContain('PROOF_CAP');
    // BREAKDOWN_TOO_MANY는 여기서 **일부러 걸리지 않는다**: 이 위조는 1095일 창에
    // 1095줄을 넣어 내부적으로는 앞뒤가 맞는다. 그 검사는 "짧은 창에 많은 줄"이라는
    // 다른 수법을 잡는 것이다. 걸리지도 않을 검사를 걸렸다고 적지 않는다(제3조).
    expect(checks).not.toContain('BREAKDOWN_TOO_MANY');
  });

  it('10년(3650일) 백데이팅 146,000 SHV → FORGED', () => {
    const report = checkCoinAuthenticity(backdatedCoin(3650), { now: NOW });
    expect(report.coreVerdict).toBe('FORGED');
    expect(report.coreFindings.map((f) => f.check)).toContain('WINDOW_TOO_LONG');
  });

  // 재현(A-5)과 같은 100장 분할. 자식마다 부모 계보를 재귀 검증하고 부모 증명의
  // 일자별 내역이 1,095줄이라 느리다 — 충실한 재현을 위해 넉넉한 시간을 준다.
  it('100장으로 분할해 지갑 전체로 올려도 FORGED (분할 dedup을 이용한 우회 차단)', () => {
    const coin = backdatedCoin(1095);
    const amounts = Array.from({ length: 100 }, () => coin.amountDshv / 100);
    const children = splitCoin(coin, alice, amounts, NOW - 1000);
    const report = checkAuthenticity(children, { now: NOW });
    expect(report.proofCount).toBe(1); // 형제는 여전히 증명 하나로 셈한다
    expect(report.coreVerdict).toBe('FORGED');
  }, 60_000);

  it('MINT_RATE의 +1 관용은 이 공격과 무관했다 — 발행액이 상한보다 1 낮았다', () => {
    // 재현 리포트의 숫자를 코드로 고정한다: 거리 10,950,000 m → 상한 438,001,
    // 발행액 438,000. 즉 +1이 없었어도 `438000 > 438000`은 거짓이라 통과했다.
    // 관용을 없애도 이 공격은 못 잡고 정직한 코인만 걸린다 → 유지가 옳다.
    const coin = backdatedCoin(1095);
    const proof = coin.provenance.kind === 'WALK' ? coin.provenance.proof : null;
    expect(proof).not.toBeNull();
    expect(proof!.distanceM).toBe(10_950_000);
    expect(Math.floor(proof!.distanceM / 25)).toBe(proof!.amountDshv); // 관용 없이도 동률
    expect(checkCoinAuthenticity(coin, { now: NOW }).coreFindings.map((f) => f.check)).not.toContain('MINT_RATE');
  });
});

describe('★정직한 사용자 오탐 방지 — 여기가 진짜 시험대다 (제3조)', () => {
  it('이스라엘 트레일 60일 종주자(하루 20km, 실제 원장 통과)는 AUTHENTIC', () => {
    const start = NOW - 61 * DAY;
    const ledger = new PendingWalkLedger({ memberId: 'm-thru-hiker' });
    let last = start;
    for (let d = 0; d < 60; d++) {
      last = walkKm(ledger, 20, {}, start + d * DAY);
    }
    const draft = ledger.settleOnSpend(last)!;
    expect(draft.dailyBreakdown.length).toBe(60); // 60일치 내역
    const coin = mintWalkCoin(buildWalkSegmentProof(draft, alice));

    const report = checkCoinAuthenticity(coin, { now: NOW });
    expect(report.coreFindings).toEqual([]);
    expect(report.coreVerdict).toBe('AUTHENTIC');
    expect(coin.amountDshv).toBe(12_000); // 1,200 SHV — 절대 상한 36,000 dSHV 안쪽
  });

  it(`창이 정확히 ${MAX_SEGMENT_SPAN_DAYS}일이면 통과하고, 1 ms만 넘으면 FORGED`, () => {
    const atLimit = forge({
      startedAt: NOW - MAX_SEGMENT_SPAN_MS,
      settledAt: NOW,
      dailyBreakdown: [{ date: dayStr(NOW), amountDshv: 100 }],
    });
    const overLimit = forge({
      startedAt: NOW - MAX_SEGMENT_SPAN_MS - 1,
      settledAt: NOW,
      dailyBreakdown: [{ date: dayStr(NOW), amountDshv: 100 }],
    });
    expect(checkCoinAuthenticity(atLimit, { now: NOW }).coreFindings.map((f) => f.check)).not.toContain(
      'WINDOW_TOO_LONG',
    );
    expect(checkCoinAuthenticity(overLimit, { now: NOW }).coreFindings.map((f) => f.check)).toContain(
      'WINDOW_TOO_LONG',
    );
  });

  it('하루 걷고 하루 쉰 사람(내역 30일 · 창 60일)은 통과한다 — 개수 상한은 날짜 수이지 강제 출석부가 아니다', () => {
    const startedAt = NOW - 60 * DAY;
    const coin = forge({
      startedAt,
      settledAt: NOW,
      distanceM: 300_000,
      stepCount: 400_000,
      amountDshv: 3000,
      dailyBreakdown: Array.from({ length: 30 }, (_, i) => ({
        date: dayStr(startedAt + i * 2 * DAY),
        amountDshv: 100,
      })),
    });
    const report = checkCoinAuthenticity(coin, { now: NOW });
    expect(report.coreFindings).toEqual([]);
    expect(report.coreVerdict).toBe('AUTHENTIC');
  });
});

describe('BREAKDOWN_TOO_MANY — 걷지 않은 날 수만큼 발행 항목이 있을 수 없다', () => {
  it('2시간 창에 30줄의 일자별 내역 → FORGED (같은 날짜 반복도 함께 걸린다)', () => {
    const coin = forge({
      startedAt: NOW - 2 * 3600_000,
      settledAt: NOW,
      amountDshv: 300,
      dailyBreakdown: Array.from({ length: 30 }, () => ({ date: dayStr(NOW), amountDshv: 10 })),
    });
    const report = checkCoinAuthenticity(coin, { now: NOW });
    expect(report.coreVerdict).toBe('FORGED');
    expect(report.coreFindings.map((f) => f.check)).toContain('BREAKDOWN_TOO_MANY');
  });
});

describe('DAILY_CAP — 같은 날짜를 여러 줄로 쪼개 상한을 우회할 수 없다', () => {
  it('하루 400 dSHV를 10줄로 쪼개 4,000 dSHV → FORGED (예전에는 줄 단위로만 봐서 통과했다)', () => {
    const startedAt = NOW - 3 * DAY;
    const coin = forge({
      startedAt,
      settledAt: NOW,
      distanceM: 100_000,
      stepCount: 133_000,
      amountDshv: 4000,
      dailyBreakdown: Array.from({ length: 10 }, () => ({ date: dayStr(NOW), amountDshv: 400 })),
    });
    const report = checkCoinAuthenticity(coin, { now: NOW });
    expect(report.coreVerdict).toBe('FORGED');
    expect(report.coreFindings.map((f) => f.check)).toContain('DAILY_CAP');
  });

  it('하루 정확히 400 dSHV(한 줄)는 여전히 통과한다', () => {
    const coin = forge({
      startedAt: NOW - 12 * 3600_000,
      settledAt: NOW,
      distanceM: 40_000,
      stepCount: 53_000,
      amountDshv: 400,
      dailyBreakdown: [{ date: dayStr(NOW), amountDshv: 400 }],
    });
    expect(checkCoinAuthenticity(coin, { now: NOW }).coreFindings).toEqual([]);
  });
});

describe('PROOF_CAP — 증명 한 건의 절대 발행 상한', () => {
  it(`상한은 ${MAX_SEGMENT_SPAN_DAYS}일 × 하루 상한이다`, () => {
    expect(maxProofAmountDshv(DEFAULT_HUMAN_LIMIT_PROFILE)).toBe(36_000);
  });

  it('창·일자수는 합법인데 총액만 상한을 넘는 코인 → PROOF_CAP 단독으로 걸린다', () => {
    // 창을 정확히 90일(역일 경계 정렬)로 잡으면 허용 날짜는 93일(±1일 관용 포함).
    const startedAt = NOW_DAY0 - 90 * DAY;
    const settledAt = NOW_DAY0;
    const rows = 93;
    const amountDshv = rows * 400; // 37,200 > 36,000
    const coin = forge({
      startedAt,
      settledAt,
      distanceM: amountDshv * 25 + 1000,
      stepCount: Math.round((amountDshv * 25) / 0.75),
      amountDshv,
      dailyBreakdown: Array.from({ length: rows }, (_, i) => ({
        date: dayStr(startedAt - DAY + i * DAY),
        amountDshv: 400,
      })),
    });
    const report = checkCoinAuthenticity(coin, { now: NOW });
    const checks = report.coreFindings.map((f) => f.check);
    expect(checks).toContain('PROOF_CAP');
    expect(checks).not.toContain('WINDOW_TOO_LONG');
    expect(checks).not.toContain('BREAKDOWN_TOO_MANY');
    expect(checks).not.toContain('DAILY_CAP');
    expect(report.coreVerdict).toBe('FORGED');
  });
});
