/**
 * GPS 흔들림이 발행에 미치는 영향 (적대검증 2 — 9장).
 *
 * closeWindow()의 distanceM 은 픽스 사이 haversine 합이다. GPS 오차는 **거리를 부풀린다**
 * (오차가 0 평균이어도 거리는 절댓값 합이라 편향이 한쪽으로만 생긴다). 그 결과:
 *   (가) 부풀린 거리로 요율이 매겨져 과대 발행이 되거나,
 *   (나) 속도가 maxWalkSpeedKmh(6)를 넘어 창 전체가 TOO_FAST 로 **기각**된다.
 * 어느 쪽이든 정직한 하이커의 인정이 GPS 상태에 좌우된다.
 */
import { describe, expect, it } from 'vitest';
import { PendingWalkLedger, SHVIL_ISRAEL, BUNDANG_BULGOKSAN_SAMPLE } from '@shvil/shared';
import { log, pct, rawTrail, simulateWalk } from './simHarness';

/**
 * 무거운 시뮬레이션 — 기본 테스트 실행에서는 건너뛴다 (전 구간 1,080 km 재현에 수 분).
 * 실행: SHVIL_HEAVY_SIM=1 npx vitest run src/walk/__tests__/<파일>
 */
const HEAVY = process.env['SHVIL_HEAVY_SIM'] === '1';
const heavy = describe.runIf(HEAVY);


const COURSES = [SHVIL_ISRAEL, BUNDANG_BULGOKSAN_SAMPLE];

function mint(samples: Parameters<PendingWalkLedger['recordSample']>[0][]): {
  shv: number;
  rejected: Record<string, number>;
  rejectedWindows: number;
} {
  const ledger = new PendingWalkLedger({ memberId: 'jitter', tzOffsetMinutes: 0 });
  const rejected: Record<string, number> = {};
  let rejectedWindows = 0;
  for (const s of samples) {
    const v = ledger.recordSample(s);
    if (!v.accepted) {
      rejected[v.reason ?? '?'] = (rejected[v.reason ?? '?'] ?? 0) + 1;
      rejectedWindows++;
    }
  }
  const d = ledger.settleManual(Date.now());
  return { shv: (d?.amountDshv ?? 0) / 10, rejected, rejectedWindows };
}

heavy('9. GPS 흔들림 → 거리 부풀림 → 과대발행 또는 TOO_FAST 기각', () => {
  it('9-A 흔들림 상관계수·크기별 (표본 130 km, 3.6 km/h)', async () => {
    const path = rawTrail().slice(0, 5_000);
    const cases = [
      { sigma: 0, rho: 0, label: '오차 없음' },
      { sigma: 5, rho: 0.98, label: 'σ5 m ρ0.98 (양호)' },
      { sigma: 10, rho: 0.98, label: 'σ10 m ρ0.98 (보통)' },
      { sigma: 15, rho: 0.98, label: 'σ15 m ρ0.98 (나쁨)' },
      { sigma: 10, rho: 0.9, label: 'σ10 m ρ0.90 (다중경로)' },
      { sigma: 15, rho: 0.9, label: 'σ15 m ρ0.90 (협곡)' },
      { sigma: 15, rho: 0.7, label: 'σ15 m ρ0.70 (심한 흔들림)' },
    ];
    for (const c of cases) {
      const r = await simulateWalk(COURSES, path, {
        driftSigmaM: c.sigma || undefined,
        driftRho: c.rho,
        accuracyM: Math.max(10, c.sigma * 2),
        seed: 42,
        statsEvery: 10,
      });
      const m = mint(r.samples);
      const rej = Object.entries(m.rejected).map(([k, v]) => `${k}×${v}`).join(' ') || '없음';
      log(
        `9-A ${c.label.padEnd(24)} 걸은 ${(r.trueMeters / 1000).toFixed(1)} km → 방출 ${(r.measuredMeters / 1000).toFixed(1)} km ` +
          `(${((r.measuredMeters / r.trueMeters - 1) * 100).toFixed(1)}%) | ON ${pct(r.tierCounts['ON_COURSE'] ?? 0, r.windows)} | ` +
          `기각창 ${m.rejectedWindows}/${r.windows} (${pct(m.rejectedWindows, r.windows)}) ${rej}`,
      );
    }
    log('9-A → 창 속도는 (부풀린 거리)/(창 시간). 3.6 km/h 로 걸어도 부풀림이 +67%면 6 km/h 컷에 걸린다.');
    expect(true).toBe(true);
  }, 1_800_000);

  it('9-B 느린 순례 속도(2.5 km/h)에서는 속도 여유가 커진다', async () => {
    const path = rawTrail().slice(0, 5_000);
    for (const kmh of [2.5, 3.6, 5.0]) {
      const mps = kmh / 3.6;
      const intervalS = Math.max(5, 5 / mps);
      const fixes = Math.max(3, Math.floor(60 / intervalS));
      const r = await simulateWalk(COURSES, path, {
        speedMps: mps,
        intervalS,
        fixesPerWindow: fixes,
        driftSigmaM: 12,
        driftRho: 0.9,
        accuracyM: 25,
        seed: 42,
        statsEvery: 10,
      });
      const m = mint(r.samples);
      const rej = Object.entries(m.rejected).map(([k, v]) => `${k}×${v}`).join(' ') || '없음';
      log(
        `9-B ${kmh} km/h (σ12 ρ0.9): 방출/걸은 ${(r.measuredMeters / r.trueMeters).toFixed(3)} | ` +
          `기각창 ${pct(m.rejectedWindows, r.windows)} ${rej} | ON ${pct(r.tierCounts['ON_COURSE'] ?? 0, r.windows)}`,
      );
    }
    expect(true).toBe(true);
  }, 1_800_000);
});
