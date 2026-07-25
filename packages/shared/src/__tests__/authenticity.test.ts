/**
 * 위폐 감지기 (M16) — 다니엘 쌤 2026-07-26:
 * "프로그램을 통해 코인을 복제하면 각각의 코인 형성 간의 시간 거리를 부여할 수 없다."
 *
 * 공격 모델: 위조자는 **자기 기기 키로 서명하므로 서명은 유효하다.** 이 테스트의
 * 위조 코인들은 전부 verifyCoin을 통과하는 상태에서 물리 검사에만 걸려야 한다 —
 * 그것이 이 감지기의 존재 이유다.
 *
 * ★가장 중요한 불변식: 통계 신호는 몇 개가 쌓여도 FORGED가 되지 않는다.
 *   정직한 사람을 위폐범으로 지목하는 것이 위조를 놓치는 것보다 나쁘다(제3조).
 */
import { describe, expect, it } from 'vitest';
import { generateKeyPair, signerFromKeyPair, type Signer } from '../crypto';
import { PendingWalkLedger, type SettlementDraft } from '../ledger';
import { buildWalkSegmentProof } from '../proof';
import { acknowledgeTransfer, createTransfer, mintWalkCoin, splitCoin, verifyCoin } from '../coin';
import { checkAuthenticity, checkCoinAuthenticity } from '../authenticity';
import { hashObject } from '../crypto';
import type { Coin } from '../types';
import { makeSample, T0, walkKm } from './helpers';

const alice = signerFromKeyPair(generateKeyPair());
const bob = signerFromKeyPair(generateKeyPair());
const NOW = Date.parse('2026-07-26T12:00:00Z');

/** 정상 걷기 코인 — 원장을 실제로 통과시킨다. */
function honestCoin(memberId: string, signer: Signer, km = 17.3, startAt = T0): Coin {
  const ledger = new PendingWalkLedger({ memberId });
  const end = walkKm(ledger, km, {}, startAt);
  const draft = ledger.settleOnSpend(end)!;
  return mintWalkCoin(buildWalkSegmentProof(draft, signer));
}

/**
 * 위조 코인 — 변조 앱처럼 원장을 우회해 초안을 직접 쓰고 자기 키로 서명한다.
 * 서명·ID·일자합 전부 유효하다. 물리만 거짓이다.
 */
function forgedCoin(fields: Partial<SettlementDraft>, signer: Signer = alice): Coin {
  const amountDshv = fields.amountDshv ?? 100;
  const draft: SettlementDraft = {
    memberId: 'm-forger',
    settlement: 'MANUAL',
    startedAt: T0,
    settledAt: T0 + 2 * 3600_000,
    distanceM: 10_000,
    stepCount: 14_000,
    courseIds: ['shvil-israel'],
    amountDshv,
    dailyBreakdown: [{ date: '2026-07-01', amountDshv }],
    sensorSummaryHash: hashObject({ seed: Math.random() }),
    ...fields,
  };
  return mintWalkCoin(buildWalkSegmentProof(draft, signer));
}

describe('전제 확인 — 위조 코인도 서명 검증은 통과한다', () => {
  it('변조 앱이 만든 코인은 verifyCoin으로 잡히지 않는다 (그래서 이 감지기가 필요하다)', () => {
    const forged = forgedCoin({ distanceM: 100_000, settledAt: T0 + 20 * 60_000, amountDshv: 400 });
    expect(verifyCoin(forged).valid).toBe(true); // 서명은 완벽하다
    const report = checkCoinAuthenticity(forged, { now: NOW });
    expect(report.verdict).toBe('FORGED'); // 물리가 거짓임을 잡는다
  });
});

describe('결정적 검사 — 코인 한 장 안의 물리', () => {
  it('정상 코인은 AUTHENTIC', () => {
    const report = checkCoinAuthenticity(honestCoin('m-alice', alice), { now: NOW });
    expect(report.findings.filter((f) => f.severity === 'FATAL')).toEqual([]);
    expect(report.verdict).toBe('AUTHENTIC');
    expect(report.serials[0]).toMatch(/^SHV-/);
  });

  it('시간이 뒤집힌 걷기 → TIME_WINDOW', () => {
    const forged = forgedCoin({ startedAt: T0, settledAt: T0 - 1000 });
    const report = checkCoinAuthenticity(forged, { now: NOW });
    expect(report.verdict).toBe('FORGED');
    expect(report.findings.map((f) => f.check)).toContain('TIME_WINDOW');
  });

  it('미래에 정산된 걷기 → TIME_WINDOW (시계 조작 상한 우회)', () => {
    const forged = forgedCoin({
      startedAt: NOW + 5 * 86_400_000,
      settledAt: NOW + 5 * 86_400_000 + 3600_000,
      dailyBreakdown: [{ date: '2026-07-31', amountDshv: 100 }],
    });
    const report = checkCoinAuthenticity(forged, { now: NOW });
    expect(report.verdict).toBe('FORGED');
    expect(report.findings.map((f) => f.check)).toContain('TIME_WINDOW');
  });

  it('100km를 20분에 → SPEED_LIMIT', () => {
    const forged = forgedCoin({ distanceM: 100_000, settledAt: T0 + 20 * 60_000, stepCount: 140_000, amountDshv: 400 });
    const report = checkCoinAuthenticity(forged, { now: NOW });
    expect(report.verdict).toBe('FORGED');
    expect(report.findings.map((f) => f.check)).toContain('SPEED_LIMIT');
  });

  it('걸음 수 부풀리기(보폭 0.1m) → STRIDE', () => {
    // 1km에 10,000걸음: 90분이면 속도·케이던스는 정상 대역이지만 보폭이 무너진다.
    const forged = forgedCoin({ distanceM: 1000, stepCount: 10_000, settledAt: T0 + 90 * 60_000, amountDshv: 10, dailyBreakdown: [{ date: '2026-07-01', amountDshv: 10 }] });
    const report = checkCoinAuthenticity(forged, { now: NOW });
    expect(report.verdict).toBe('FORGED');
    expect(report.findings.map((f) => f.check)).toContain('STRIDE');
  });

  it('기계적 반복(분당 186걸음 평균) → CADENCE', () => {
    // 보폭은 정상(0.71m)이지만 1시간 평균 케이던스가 인간 상한을 넘는다.
    const forged = forgedCoin({ distanceM: 8000, stepCount: 11_200, settledAt: T0 + 3600_000, amountDshv: 80, dailyBreakdown: [{ date: '2026-07-01', amountDshv: 80 }] });
    const report = checkCoinAuthenticity(forged, { now: NOW });
    expect(report.verdict).toBe('FORGED');
    expect(report.findings.map((f) => f.check)).toContain('CADENCE');
  });

  it('★거리에서 나올 수 없는 발행액 → MINT_RATE (스팟 무제한 발행구가 걸리는 지점)', () => {
    // 10km로 500 SHV — 최고 난이도 ×4.0을 다 쳐줘도 401 dSHV가 상한이다.
    const forged = forgedCoin({
      distanceM: 10_000,
      amountDshv: 5000,
      settledAt: T0 + 20 * 86_400_000,
      stepCount: 14_000,
      dailyBreakdown: Array.from({ length: 20 }, (_, i) => ({
        date: `2026-07-${String(i + 1).padStart(2, '0')}`,
        amountDshv: 250,
      })),
    });
    const report = checkCoinAuthenticity(forged, { now: NOW });
    expect(report.verdict).toBe('FORGED');
    expect(report.findings.map((f) => f.check)).toContain('MINT_RATE');
  });

  it('하루 40 SHV 초과 → DAILY_CAP', () => {
    const forged = forgedCoin({
      distanceM: 60_000,
      settledAt: T0 + 20 * 3600_000,
      stepCount: 84_000,
      amountDshv: 600,
      dailyBreakdown: [{ date: '2026-07-01', amountDshv: 600 }],
    });
    const report = checkCoinAuthenticity(forged, { now: NOW });
    expect(report.verdict).toBe('FORGED');
    expect(report.findings.map((f) => f.check)).toContain('DAILY_CAP');
  });

  it('걷지 않은 날짜의 발행 귀속 → BREAKDOWN_DATES', () => {
    const forged = forgedCoin({ dailyBreakdown: [{ date: '2026-09-15', amountDshv: 100 }] });
    const report = checkCoinAuthenticity(forged, { now: NOW });
    expect(report.verdict).toBe('FORGED');
    expect(report.findings.map((f) => f.check)).toContain('BREAKDOWN_DATES');
  });

  it('자전거 코인(걸음 0)은 보폭·케이던스 검사를 하지 않는다 — 억울한 위폐범 없음', () => {
    const ledger = new PendingWalkLedger({ memberId: 'm-rider' });
    let t = T0;
    for (let i = 0; i < 100; i++) {
      ledger.recordSample(makeSample({ mode: 'BIKE', steps: 0, distanceM: 400, durationS: 72, timestamp: t }));
      t += 72_000;
    }
    const draft = ledger.settleOnSpend(t)!;
    const coin = mintWalkCoin(buildWalkSegmentProof(draft, alice));
    expect(coin.provenance.kind === 'WALK' && coin.provenance.proof.stepCount).toBe(0);
    const report = checkCoinAuthenticity(coin, { now: NOW });
    expect(report.verdict).toBe('AUTHENTIC');
  });
});

describe('★시간 거리 검사 — 코인들 사이 (다니엘 쌤의 핵심 통찰)', () => {
  it('같은 회원의 걷기 창이 겹친다 → WINDOW_OVERLAP (원장이 둘 = 복제)', () => {
    const a = forgedCoin({ startedAt: T0, settledAt: T0 + 4 * 3600_000, distanceM: 15_000, stepCount: 21_000, amountDshv: 150, dailyBreakdown: [{ date: '2026-07-01', amountDshv: 150 }] });
    const b = forgedCoin({ startedAt: T0 + 2 * 3600_000, settledAt: T0 + 6 * 3600_000, distanceM: 15_000, stepCount: 21_100, amountDshv: 150, dailyBreakdown: [{ date: '2026-07-01', amountDshv: 150 }] });
    const report = checkAuthenticity([a, b], { now: NOW });
    expect(report.verdict).toBe('FORGED');
    expect(report.findings.map((f) => f.check)).toContain('WINDOW_OVERLAP');
  });

  it('복제 프로그램이 찍어낸 코인들: 총 거리에 필요한 시간 > 흐른 시간 → TIME_BUDGET', () => {
    // 같은 1시간 창을 공유하는 클론 5장, 각 30km 주장 — 코인은 복제해도 시간은 복제 못 한다.
    const clones = Array.from({ length: 5 }, (_, i) =>
      forgedCoin({
        startedAt: T0,
        settledAt: T0 + 3600_000,
        distanceM: 30_000,
        stepCount: 42_000 + i, // 해시를 다르게 — 각각 "다른 코인"이다
        amountDshv: 300,
        dailyBreakdown: [{ date: '2026-07-01', amountDshv: 300 }],
      }),
    );
    const report = checkAuthenticity(clones, { now: NOW });
    expect(report.verdict).toBe('FORGED');
    expect(report.findings.map((f) => f.check)).toContain('TIME_BUDGET');
  });

  it('서로 다른 회원의 창 겹침은 정상이다 (각자 걷는다)', () => {
    const a = honestCoin('m-alice', alice, 10, T0);
    const b = honestCoin('m-bob', bob, 10, T0); // 같은 시각, 다른 사람
    const report = checkAuthenticity([a, b], { now: NOW });
    expect(report.verdict).toBe('AUTHENTIC');
  });

  it('같은 회원의 순차적 걷기(안 겹침)는 정상이다', () => {
    const a = honestCoin('m-alice', alice, 10, T0);
    const b = honestCoin('m-alice', alice, 12, T0 + 86_400_000); // 다음 날
    const report = checkAuthenticity([a, b], { now: NOW });
    expect(report.verdict).toBe('AUTHENTIC');
  });

  it('센서 요약까지 복사한 클론(같은 회원) → SENSOR_DUPLICATE (FATAL)', () => {
    const shared = hashObject({ sensors: 'copied' });
    const a = forgedCoin({ startedAt: T0, settledAt: T0 + 3600_000, distanceM: 4000, stepCount: 5600, amountDshv: 40, dailyBreakdown: [{ date: '2026-07-01', amountDshv: 40 }], sensorSummaryHash: shared });
    const b = forgedCoin({ startedAt: T0 + 2 * 3600_000, settledAt: T0 + 3 * 3600_000, distanceM: 4000, stepCount: 5600, amountDshv: 40, dailyBreakdown: [{ date: '2026-07-01', amountDshv: 40 }], sensorSummaryHash: shared });
    const report = checkAuthenticity([a, b], { now: NOW });
    expect(report.verdict).toBe('FORGED');
    expect(report.findings.map((f) => f.check)).toContain('SENSOR_DUPLICATE');
  });

  it('다른 회원 간 센서 요약 일치는 정황(SIGNAL)일 뿐 — 함께 걸었을 수 있다', () => {
    const a = honestCoin('m-alice', alice, 10, T0);
    const b = honestCoin('m-bob', bob, 10, T0); // 테스트 조건상 요약이 완전히 같아진다
    const report = checkAuthenticity([a, b], { now: NOW });
    expect(report.findings.some((f) => f.severity === 'FATAL')).toBe(false);
  });

  it('같은 코인이 서로 다른 이전 상태로 두 번 → COIN_DUPLICATE (이중 지불)', () => {
    const coin = honestCoin('m-alice', alice);
    const sent = acknowledgeTransfer(createTransfer(coin, alice, bob.publicKeyHex, NOW - 1000), bob);
    const report = checkAuthenticity([coin, sent], { now: NOW });
    expect(report.verdict).toBe('FORGED');
    expect(report.findings.map((f) => f.check)).toContain('COIN_DUPLICATE');
  });

  it('분할 형제는 같은 뿌리 증명을 공유한다 — 겹침으로 오판하지 않는다 (dedup)', () => {
    const coin = honestCoin('m-alice', alice, 20);
    const [c1, c2] = splitCoin(coin, alice, [50, coin.amountDshv - 50], NOW - 1000);
    const report = checkAuthenticity([c1!, c2!], { now: NOW });
    expect(report.verdict).toBe('AUTHENTIC');
    expect(report.proofCount).toBe(1); // 형제 둘 = 증명 하나
  });
});

describe('통계 검사 — 정황은 결코 위조 판정이 되지 않는다', () => {
  /** 기계처럼 균일한 코인 N장 — 간격·값·시각 전부 규칙적 (물리 위반은 없음). */
  function uniformCoins(n: number): Coin[] {
    return Array.from({ length: n }, (_, i) =>
      forgedCoin({
        startedAt: T0 + i * 3600_000,
        settledAt: T0 + i * 3600_000 + 1800_000,
        distanceM: 2000,
        stepCount: 2800,
        amountDshv: 20,
        dailyBreakdown: [{ date: '2026-07-01', amountDshv: 20 }],
        sensorSummaryHash: hashObject({ i }),
      }),
    );
  }

  it('★기계적 균일성은 신호가 여럿 겹쳐도 SUSPECT까지만 — FORGED가 아니다', () => {
    const report = checkAuthenticity(uniformCoins(8), { now: NOW });
    expect(report.verdict).toBe('SUSPECT');
    expect(report.findings.some((f) => f.severity === 'FATAL')).toBe(false);
    const checks = report.findings.map((f) => f.check);
    expect(checks).toContain('INTERVAL_UNIFORMITY');
    expect(checks).toContain('VALUE_UNIFORMITY');
    expect(report.statisticsApplied).toBe(true);
  });

  it('표본이 적으면(5장 미만) 통계 검사를 하지 않는다 — 우연을 정황으로 삼지 않는다', () => {
    const report = checkAuthenticity(uniformCoins(3), { now: NOW });
    expect(report.statisticsApplied).toBe(false);
    expect(report.verdict).toBe('AUTHENTIC');
  });

  it('사람다운 들쭉날쭉함(간격·거리 다양)은 신호를 만들지 않는다', () => {
    // 간격·거리·걸음이 제각각 + 밀리초 지터 — 사람의 기록.
    const gaps = [3.1, 7.4, 26.0, 11.2, 49.5, 5.8, 31.9];
    const kms = [4.2, 11.7, 2.9, 17.3, 8.1, 22.6, 6.4, 13.8];
    let t = T0;
    const coins: Coin[] = [];
    for (let i = 0; i < 8; i++) {
      coins.push(honestCoin('m-alice', alice, kms[i]!, t + (i * 137) % 1000));
      t += (gaps[i] ?? 20) * 3600_000 + kms[i]! * 12 * 60_000 + i * 251;
    }
    const report = checkAuthenticity(coins, { now: NOW });
    expect(report.verdict).toBe('AUTHENTIC');
    expect(report.statisticsApplied).toBe(true);
  });
});

describe('리포트의 정직화 (제3조)', () => {
  it('빈 제출 → INCONCLUSIVE', () => {
    expect(checkAuthenticity([], { now: NOW }).verdict).toBe('INCONCLUSIVE');
  });

  it('코인 1장 검사에는 "지갑 전체를 올리면 정확해진다"는 안내가 남는다', () => {
    const report = checkCoinAuthenticity(honestCoin('m-alice', alice), { now: NOW });
    expect(report.notes.join(' ')).toContain('2장 이상');
  });

  it('AUTHENTIC 요약은 "진짜 증명"이 아니라 "모순 없음"이라고 말한다', () => {
    const report = checkCoinAuthenticity(honestCoin('m-alice', alice), { now: NOW });
    expect(report.summary).toContain('진짜임을 증명한 것은 아닙니다');
  });

  it('리포트에 좌표류 정보가 없다 (제10조)', () => {
    const report = checkAuthenticity([honestCoin('m-alice', alice)], { now: NOW });
    expect(JSON.stringify(report)).not.toMatch(/"(lat|lon|lng|coords?|geo)":/i);
  });
});
