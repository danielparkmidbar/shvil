/**
 * 실물 쉬빌 이스라엘 — 정직한 하이커가 손해 보는 경계 조건 (적대검증 2).
 *
 * 6. 정확도 게이트(maxAccuracyM=50)가 창을 통째로 없애는가
 * 7. 실제 순례 속도(2.5~3 km/h)에서 창 경계 누락이 얼마나 커지는가
 * 8. 회랑 여유 예산 — 트레일 위에서 몇 m 벗어나면 떨어지는가
 */
import { describe, expect, it } from 'vitest';
import { PendingWalkLedger, SHVIL_ISRAEL, BUNDANG_BULGOKSAN_SAMPLE } from '@shvil/shared';
import { CorridorEngine, DEFAULT_CORRIDOR_PARAMS, type GpsFix } from '../corridorEngine';
import { log, pct, rawTrail, resample, simulateWalk } from './simHarness';

/**
 * 무거운 시뮬레이션 — 기본 테스트 실행에서는 건너뛴다 (전 구간 1,080 km 재현에 수 분).
 * 실행: SHVIL_HEAVY_SIM=1 npx vitest run src/walk/__tests__/<파일>
 */
const HEAVY = process.env['SHVIL_HEAVY_SIM'] === '1';
const heavy = describe.runIf(HEAVY);


const COURSES = [SHVIL_ISRAEL, BUNDANG_BULGOKSAN_SAMPLE];

/** 원장 총액(SHV). */
function mint(samples: Parameters<PendingWalkLedger['recordSample']>[0][]): {
  shv: number;
  rejected: Record<string, number>;
} {
  const ledger = new PendingWalkLedger({ memberId: 'edge', tzOffsetMinutes: 0 });
  const rejected: Record<string, number> = {};
  for (const s of samples) {
    const v = ledger.recordSample(s);
    if (!v.accepted) rejected[v.reason ?? '?'] = (rejected[v.reason ?? '?'] ?? 0) + 1;
  }
  const d = ledger.settleManual(Date.now());
  return { shv: (d?.amountDshv ?? 0) / 10, rejected };
}

heavy('6. 정확도 게이트 — 협곡·도시에서 창이 통째로 사라지는가', () => {
  it('6-A 모든 픽스 accuracy=55 m (>50) → 창이 아예 생기지 않는다', async () => {
    const path = rawTrail().slice(0, 400);
    const good = await simulateWalk(COURSES, path, { accuracyM: 45 });
    const bad = await simulateWalk(COURSES, path, { accuracyM: 55 });
    log(
      `6-A accuracy 45 m: 창 ${good.windows} / 방출거리 ${(good.measuredMeters / 1000).toFixed(2)} km → ${mint(good.samples).shv} SHV\n` +
        `6-A accuracy 55 m: 창 ${bad.windows} / 방출거리 ${(bad.measuredMeters / 1000).toFixed(2)} km → ${mint(bad.samples).shv} SHV ` +
        `(maxAccuracyM=${DEFAULT_CORRIDOR_PARAMS.maxAccuracyM} 이므로 전 픽스 폐기)`,
    );
    expect(good.windows).toBeGreaterThan(0);
    expect(bad.windows).toBe(0);
    expect(mint(bad.samples).shv).toBe(0);
  }, 300_000);

  it('6-B 창의 일부 픽스만 정확도 미달 — 거리가 얼마나 남는가', () => {
    // 12픽스 창에서 앞뒤 k개를 정확도 미달로 만들었을 때 남는 distanceM.
    const path = rawTrail().slice(0, 200);
    const w = resample(path, 5);
    const rows: string[] = [];
    for (const dropped of [0, 3, 6, 9, 10]) {
      const engine = new CorridorEngine(COURSES, []);
      let emitted = 0;
      let windows = 0;
      for (let base = 0; base + 12 <= 240; base += 12) {
        for (let k = 0; k < 12; k++) {
          const p = w.points[base + k]!;
          const fix: GpsFix = {
            lat: p.lat,
            lon: p.lon,
            timestamp: base * 5_000 + k * 5_000,
            // 창 앞쪽 dropped 개를 정확도 미달로.
            accuracy: k < dropped ? 60 : 20,
          };
          engine.addFix(fix);
        }
        engine.addSteps(80);
        const s = engine.closeWindow();
        if (s) {
          emitted += s.distanceM;
          windows++;
        }
      }
      rows.push(
        `   폐기 ${String(dropped).padStart(2)}/12 → 창 ${windows}개 / 방출 ${emitted} m ` +
          `(온전할 때 ${20 * 55} m 기준 ${((emitted / (20 * 55)) * 100).toFixed(0)}%)`,
      );
    }
    log(`6-B 정확도 미달 픽스 개수별 인정 거리 (minFixesPerWindow=${DEFAULT_CORRIDOR_PARAMS.minFixesPerWindow})\n` + rows.join('\n'));
    expect(true).toBe(true);
  }, 300_000);
});

heavy('7. 실제 순례 속도에서의 창 경계 누락', () => {
  it('7-A 2.5 / 3 / 3.6 / 5 km/h — 걸은 거리 대비 방출 거리', async () => {
    const path = rawTrail().slice(0, 3_000);
    // walkService: timeInterval 5s, distanceInterval 5m → 픽스 간격 = max(5s, 5m/속도)
    const cases = [
      { kmh: 2.5, label: '2.5 km/h (무거운 배낭)' },
      { kmh: 3.0, label: '3.0 km/h (일반 종주)' },
      { kmh: 3.6, label: '3.6 km/h (빠른 걸음)' },
      { kmh: 5.0, label: '5.0 km/h (평지 속보)' },
    ];
    for (const c of cases) {
      const mps = c.kmh / 3.6;
      const intervalS = Math.max(5, 5 / mps);
      const fixes = Math.max(3, Math.floor(60 / intervalS));
      const r = await simulateWalk(COURSES, path, {
        speedMps: mps,
        intervalS,
        fixesPerWindow: fixes,
        statsEvery: 20,
      });
      const shv = mint(r.samples).shv;
      log(
        `7-A ${c.label.padEnd(22)} 픽스간격 ${intervalS.toFixed(2)}s · 창 ${fixes}픽스 | ` +
          `걸은 ${(r.trueMeters / 1000).toFixed(2)} km → 방출 ${(r.measuredMeters / 1000).toFixed(2)} km ` +
          `(누락 ${((1 - r.measuredMeters / r.trueMeters) * 100).toFixed(2)}%) → ${shv.toFixed(1)} SHV | ` +
          `ON ${pct(r.tierCounts['ON_COURSE'] ?? 0, r.windows)}`,
      );
    }
    log('7-A → 누락률 ≈ 픽스간격 / 60초. 느리게 걸을수록 손해가 커진다.');
    expect(true).toBe(true);
  }, 900_000);
});

heavy('8. 회랑 여유 예산 — 트레일 위에서 몇 m 벗어나면 떨어지는가', () => {
  it('8-A 진짜 길 + 횡방향 0~60 m 를 5 m 씩', async () => {
    const path = rawTrail().slice(0, 6_000); // 약 155 km 표본
    const rows: string[] = [];
    for (const off of [0, 10, 20, 25, 30, 35, 40, 45, 50, 55, 60]) {
      const r = await simulateWalk(COURSES, path, { lateralM: off, statsEvery: 10 });
      const on = r.tierCounts['ON_COURSE'] ?? 0;
      rows.push(
        `   +${String(off).padStart(2)} m → ON_COURSE ${pct(on, r.windows)} ` +
          `(회랑밖 픽스 ${(r.distStats.outsideRatio * 100).toFixed(1)}%) → ${mint(r.samples).shv.toFixed(0)} SHV`,
      );
    }
    log('8-A 횡방향 이탈별 인정률 (표본 155 km)\n' + rows.join('\n'));
    expect(true).toBe(true);
  }, 1_800_000);
});
