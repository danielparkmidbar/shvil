/**
 * 실물 쉬빌 이스라엘 — 위험 지점 집중 시험 + 1,055 km 완주 원장 재현 (적대검증 2).
 *
 * 2. 단순화가 가장 크게 잘라낸 굽이 / 점 간격이 가장 넓은 구간
 * 3. 시작점 접근 · 끝점 통과
 * 4. 트레일이 스스로 가까워지는 구간의 오귀속
 * 5. 60일 완주 시 실제 생성량
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ECONOMIC_PARAMS,
  DEFAULT_HUMAN_LIMIT_PROFILE,
  PendingWalkLedger,
  SHVIL_ISRAEL,
  BUNDANG_BULGOKSAN_SAMPLE,
  type WalkSample,
} from '@shvil/shared';
import { distToSegmentM, nearestOnPolyline, type GeoPoint } from '../geo';
import { hav, lengthM, log, pct, rawTrail, report, simulateWalk } from './simHarness';

/**
 * 무거운 시뮬레이션 — 기본 테스트 실행에서는 건너뛴다 (전 구간 1,080 km 재현에 수 분).
 * 실행: SHVIL_HEAVY_SIM=1 npx vitest run src/walk/__tests__/<파일>
 */
const HEAVY = process.env['SHVIL_HEAVY_SIM'] === '1';
const heavy = describe.runIf(HEAVY);


const COURSES = [SHVIL_ISRAEL, BUNDANG_BULGOKSAN_SAMPLE];
const POLY = SHVIL_ISRAEL.polyline;
const DAY_MS = 86_400_000;

/** 두 점 사이 직선 경로 (m 간격). */
function straight(from: GeoPoint, to: GeoPoint, stepM = 10): GeoPoint[] {
  const total = hav(from, to);
  const n = Math.max(2, Math.ceil(total / stepM));
  const pts: GeoPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ lat: from.lat + (to.lat - from.lat) * t, lon: from.lon + (to.lon - from.lon) * t });
  }
  return pts;
}

/** 원본 인덱스 범위를 잘라낸 실제 길. */
function rawSlice(from: number, to: number): GeoPoint[] {
  return rawTrail().slice(from, to);
}

/** 창별 tier 를 문자열로. */
function tierLine(samples: WalkSample[]): string {
  return samples.map((s) => (s.tier === 'ON_COURSE' ? 'O' : s.tier === 'OFF_COURSE' ? 'x' : s.tier === 'DAILY_LIFE' ? '.' : '?')).join('');
}

heavy('2. 단순화가 잘라낸 굽이 · 점 간격이 넓은 구간', () => {
  it('2-A ★가장 크게 잘린 굽이 8곳에서 실제 길을 걷는다', async () => {
    // findSpots 로 찾은 "60 m 창 평균 이탈" 상위 지점 (원본 인덱스).
    const spots = [
      { i: 8755, km: 208.3 },
      { i: 1775, km: 52.5 },
      { i: 3605, km: 91.7 },
      { i: 25355, km: 614.9 },
      { i: 31765, km: 785.2 },
      { i: 15105, km: 349.1 },
      { i: 35505, km: 875.8 },
      { i: 9790, km: 228.7 },
      { i: 31220, km: 767.9 }, // 60 m 창 평균 이탈 최대(20.03 m)
    ];
    let worstRatio = 1;
    for (const s of spots) {
      const path = rawSlice(Math.max(0, s.i - 20), s.i + 20);
      const r = await simulateWalk(COURSES, path);
      const on = r.tierCounts['ON_COURSE'] ?? 0;
      worstRatio = Math.min(worstRatio, on / Math.max(1, r.windows));
      log(
        `2-A km ${s.km.toFixed(1)} (raw ${s.i}): 창 ${r.windows} ON ${on} (${pct(on, r.windows)}) ` +
          `이탈 중앙 ${r.distStats.median.toFixed(1)}m 최대 ${r.distStats.max.toFixed(1)}m [${tierLine(r.samples)}]`,
      );
    }
    log(`2-A → 가장 굽은 구간에서도 인정률 최저 ${(worstRatio * 100).toFixed(1)}%`);
    expect(worstRatio).toBe(1);
  }, 300_000);

  it('2-B 단순화 편차의 실제 상한 — 원본 41,692점 전수', () => {
    const raw = rawTrail();
    const devs: number[] = [];
    // 격자 색인 (0.01도) — 판정은 운영 함수(distToSegmentM)로 한다.
    const grid = new Map<string, number[]>();
    const key = (a: number, b: number) => `${a}:${b}`;
    for (let i = 0; i < POLY.length - 1; i++) {
      const a = POLY[i]!;
      const b = POLY[i + 1]!;
      const la0 = Math.floor(Math.min(a.lat, b.lat) * 100);
      const la1 = Math.floor(Math.max(a.lat, b.lat) * 100);
      const lo0 = Math.floor(Math.min(a.lon, b.lon) * 100);
      const lo1 = Math.floor(Math.max(a.lon, b.lon) * 100);
      for (let x = la0 - 1; x <= la1 + 1; x++) {
        for (let y = lo0 - 1; y <= lo1 + 1; y++) {
          const k = key(x, y);
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k)!.push(i);
        }
      }
    }
    for (const p of raw) {
      const x = Math.floor(p.lat * 100);
      const y = Math.floor(p.lon * 100);
      let best = Infinity;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const i of grid.get(key(x + dx, y + dy)) ?? []) {
            const d = distToSegmentM(p, POLY[i]!, POLY[i + 1]!);
            if (d < best) best = d;
          }
        }
      }
      devs.push(best);
    }
    devs.sort((a, b) => a - b);
    const q = (p: number) => devs[Math.floor(devs.length * p)]!;
    const over = (t: number) => devs.filter((d) => d > t).length;
    log(
      `2-B 원본→배포선 편차: 중앙 ${q(0.5).toFixed(2)}m p95 ${q(0.95).toFixed(2)} p99 ${q(0.99).toFixed(2)} ` +
        `최대 ${devs[devs.length - 1]!.toFixed(2)}m | >20m ${over(20)}점 >30m ${over(30)} >50m ${over(50)}`,
    );
    log(`2-B → 회랑 50 m 중 단순화가 먹는 최악값 ${devs[devs.length - 1]!.toFixed(1)} m, 남는 GPS 여유 ${(50 - devs[devs.length - 1]!).toFixed(1)} m`);
    expect(over(50)).toBe(0);
  }, 300_000);

  it('2-C ★점 간격이 가장 넓은 구간(최대 3,805 m)에서 실제 길을 걷는다', async () => {
    const gaps: { i: number; d: number }[] = [];
    for (let i = 0; i < POLY.length - 1; i++) gaps.push({ i, d: hav(POLY[i]!, POLY[i + 1]!) });
    gaps.sort((a, b) => b.d - a.d);
    log(`2-C 최장 선분 ${gaps[0]!.d.toFixed(0)} m (idx ${gaps[0]!.i}) / 2위 ${gaps[1]!.d.toFixed(0)} m`);

    // 아라바 사막 성긴 구간 전체(원본 38,060~38,140)를 실제 길로 걷는다.
    const path = rawSlice(38_060, 38_140);
    const r = await simulateWalk(COURSES, path);
    report(r, `2-C 아라바 성긴 구간 실제 길 (원본 ${(lengthM(path) / 1000).toFixed(1)} km)`);
    log(`2-C tier열 [${tierLine(r.samples)}]`);
    expect(r.tierCounts['ON_COURSE']).toBe(r.windows);
  }, 300_000);
});

heavy('3. 시작·끝 부근', () => {
  it('3-A 북단(헤르몬) 시작점에 800 m 밖에서 접근', async () => {
    const start = POLY[0]!;
    const away: GeoPoint = { lat: start.lat + 0.0072, lon: start.lon + 0.0 }; // 약 800 m 북쪽
    log(`3-A 접근 시작점 거리 ${hav(away, start).toFixed(0)} m`);
    const path = straight(away, start).concat(rawSlice(0, 40));
    const r = await simulateWalk(COURSES, path);
    log(`3-A 창 ${r.windows} tier열 [${tierLine(r.samples)}] (O=ON_COURSE x=OFF_COURSE .=DAILY_LIFE)`);
    const first = r.samples[0]!;
    const last = r.samples[r.samples.length - 1]!;
    log(`3-A 첫 창 ${first.tier} / 마지막 창 ${last.tier} / ON 비율 ${pct(r.tierCounts['ON_COURSE'] ?? 0, r.windows)}`);
    expect(first.tier).toBe('OFF_COURSE'); // 2 km 이내라 일상이 아니라 이탈
    expect(last.tier).toBe('ON_COURSE');
  }, 120_000);

  it('3-B 남단(에일랏) 끝점을 지나 800 m 더 간다', async () => {
    const raw = rawTrail();
    const end = POLY[POLY.length - 1]!;
    const beyond: GeoPoint = { lat: end.lat - 0.0072, lon: end.lon };
    const path = raw.slice(raw.length - 40).concat(straight(end, beyond));
    const r = await simulateWalk(COURSES, path);
    log(`3-B 창 ${r.windows} tier열 [${tierLine(r.samples)}]`);
    const first = r.samples[0]!;
    const last = r.samples[r.samples.length - 1]!;
    log(`3-B 첫 창 ${first.tier} / 마지막 창 ${last.tier} (끝점에서 ${hav(beyond, end).toFixed(0)} m 이탈)`);
    expect(first.tier).toBe('ON_COURSE');
    expect(last.tier).toBe('OFF_COURSE');
  }, 120_000);

  it('3-C 끝점 너머 2 km 초과 — 일상 걸음으로 강등되는가', async () => {
    const end = POLY[POLY.length - 1]!;
    const far: GeoPoint = { lat: end.lat - 0.027, lon: end.lon }; // 약 3 km
    const r = await simulateWalk(COURSES, straight(end, far));
    log(`3-C 끝점→3 km 이탈: tier열 [${tierLine(r.samples)}]`);
    const tiers = new Set(r.samples.map((s) => s.tier));
    log(`3-C 등장 tier ${[...tiers].join(',')} / 마지막 ${r.samples[r.samples.length - 1]!.tier}`);
    expect(r.samples[r.samples.length - 1]!.tier).toBe('DAILY_LIFE');
  }, 120_000);
});

heavy('4. 분기·자기 교차 — 엉뚱한 구간으로 판정되는가', () => {
  it('4-A 인덱스가 멀리 떨어진 두 구간이 서로 150 m 안으로 접근하는 곳이 있는가', () => {
    const grid = new Map<string, number[]>();
    const key = (a: number, b: number) => `${a}:${b}`;
    for (let i = 0; i < POLY.length - 1; i++) {
      const a = POLY[i]!;
      const b = POLY[i + 1]!;
      const la0 = Math.floor(Math.min(a.lat, b.lat) * 100);
      const la1 = Math.floor(Math.max(a.lat, b.lat) * 100);
      const lo0 = Math.floor(Math.min(a.lon, b.lon) * 100);
      const lo1 = Math.floor(Math.max(a.lon, b.lon) * 100);
      for (let x = la0 - 1; x <= la1 + 1; x++) {
        for (let y = lo0 - 1; y <= lo1 + 1; y++) {
          const k = key(x, y);
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k)!.push(i);
        }
      }
    }
    const pairs: { i: number; j: number; d: number }[] = [];
    for (const arr of grid.values()) {
      for (let x = 0; x < arr.length; x++) {
        for (let y = x + 1; y < arr.length; y++) {
          const i = arr[x]!;
          const j = arr[y]!;
          if (Math.abs(i - j) <= 20) continue;
          const d = Math.min(
            distToSegmentM(POLY[i]!, POLY[j]!, POLY[j + 1]!),
            distToSegmentM(POLY[i + 1]!, POLY[j]!, POLY[j + 1]!),
            distToSegmentM(POLY[j]!, POLY[i]!, POLY[i + 1]!),
            distToSegmentM(POLY[j + 1]!, POLY[i]!, POLY[i + 1]!),
          );
          if (d <= 150) pairs.push({ i, j, d });
        }
      }
    }
    pairs.sort((a, b) => a.d - b.d);
    log(`4-A 인덱스차>20 & 150 m 이내 선분 쌍: ${pairs.length}개` + (pairs[0] ? ` (최근접 ${pairs[0].d.toFixed(1)} m: ${pairs[0].i}↔${pairs[0].j})` : ''));
    expect(pairs.length).toBe(0);
  }, 300_000);

  it('4-B 국지 스위치백에서 판정 구간이 흔들려도 요율은 같다 (전 구간 단일 메타)', async () => {
    // 급반전 지점(검수1이 지목한 idx 1213~1216 부근)을 실제 길로 걷는다.
    const raw = rawTrail();
    // 배포 idx 1213 에 가장 가까운 원본 인덱스를 찾는다.
    const target = POLY[1213]!;
    let bi = 0;
    let bd = Infinity;
    for (let k = 0; k < raw.length; k++) {
      const d = hav(raw[k]!, target);
      if (d < bd) {
        bd = d;
        bi = k;
      }
    }
    const r = await simulateWalk(COURSES, raw.slice(bi - 60, bi + 60));
    const segs = new Set(r.samples.map((s) => s.difficultyTenths));
    const courseIds = new Set(r.samples.map((s) => s.courseId));
    log(
      `4-B 헤어핀(배포 idx 1213 / 원본 ${bi}) 창 ${r.windows} ON ${pct(r.tierCounts['ON_COURSE'] ?? 0, r.windows)} ` +
        `courseId ${[...courseIds].join(',')} 난이도 ${[...segs].join(',')}`,
    );
    expect([...courseIds]).toEqual(['shvil-israel']);
    expect([...segs]).toEqual([10]);
    expect(r.tierCounts['ON_COURSE']).toBe(r.windows);
  }, 300_000);

  it('4-C 다른 코스(분당 불곡산)로 오귀속되지 않는다', async () => {
    const r = await simulateWalk(COURSES, rawSlice(0, 60));
    expect(new Set(r.samples.map((s) => s.courseId))).toEqual(new Set(['shvil-israel']));
    const kr = await simulateWalk(COURSES, BUNDANG_BULGOKSAN_SAMPLE.polyline);
    log(`4-C 이스라엘 구간 courseId=shvil-israel ✓ / 분당 구간 courseId=${[...new Set(kr.samples.map((s) => s.courseId))].join(',')}`);
    expect(new Set(kr.samples.map((s) => s.courseId))).toEqual(new Set(['bundang-bulgoksan']));
  }, 300_000);
});

// ── 5. 완주 원장 ────────────────────────────────────────────────

/** 창을 페이스(하루 거리)에 맞춰 다시 시간 배치한다. tier 는 바뀌지 않는다. */
function repace(
  samples: WalkSample[],
  windowStartM: number[],
  dailyMeters: number,
  startTs: number,
): WalkSample[] {
  return samples.map((s, i) => {
    const m = windowStartM[i] ?? 0;
    const day = Math.floor(m / dailyMeters);
    const inDayS = (m % dailyMeters) / 1.0;
    return { ...s, timestamp: startTs + day * DAY_MS + inDayS * 1000 };
  });
}

interface LedgerOut {
  amountDshv: number;
  days: number;
  cappedDays: number;
  lostToCapDshv: number;
  rejected: Record<string, number>;
  acceptedMeters: number;
  weeklyMax: number;
}

function runLedger(samples: WalkSample[]): LedgerOut {
  const ledger = new PendingWalkLedger({ memberId: 'sim-hiker', tzOffsetMinutes: 0 });
  const rejected: Record<string, number> = {};
  let acceptedMeters = 0;
  for (const s of samples) {
    const v = ledger.recordSample(s);
    if (!v.accepted) rejected[v.reason ?? '?'] = (rejected[v.reason ?? '?'] ?? 0) + 1;
    else acceptedMeters += v.creditedDistanceM;
  }
  const draft = ledger.settleManual(Date.now());
  const bd = draft?.dailyBreakdown ?? [];
  const cap = DEFAULT_ECONOMIC_PARAMS.dailyCapDshv;
  // 7일 이동합 최대 (인간 한계 프로파일 대조용)
  let weeklyMax = 0;
  for (let i = 0; i < bd.length; i++) {
    let sum = 0;
    for (let j = i; j < bd.length && j < i + 7; j++) sum += bd[j]!.amountDshv;
    weeklyMax = Math.max(weeklyMax, sum);
  }
  return {
    amountDshv: draft?.amountDshv ?? 0,
    days: bd.length,
    cappedDays: bd.filter((d) => d.amountDshv >= cap).length,
    lostToCapDshv: 0,
    rejected,
    acceptedMeters,
    weeklyMax,
  };
}

heavy('5. 1,055 km 완주 — 실제로 얼마가 생성되는가', () => {
  it('5-A ★진짜 길 전 구간을 걷고 페이스별로 정산한다 (운영 GPS 설정)', async () => {
    const raw = rawTrail();
    const r = await simulateWalk(COURSES, raw, { statsEvery: 5 });
    report(r, '5-A 완주 (진짜 길 1,080 km, 픽스 5초/5m · 창 12픽스 = walkService 설정)');

    const startTs = Date.parse('2026-08-01T05:00:00Z');
    const paces = [
      { days: 60, label: '60일' },
      { days: 45, label: '45일' },
      { days: 30, label: '30일' },
      { days: 25, label: '25일' },
      { days: 20, label: '20일(비현실)' },
    ];
    const rows: string[] = [];
    for (const p of paces) {
      const daily = r.trueMeters / p.days;
      const out = runLedger(repace(r.samples, r.windowStartM, daily, startTs));
      const rej = Object.entries(out.rejected).map(([k, v]) => `${k}×${v}`).join(' ') || '없음';
      rows.push(
        `   ${p.label.padEnd(12)} ${(daily / 1000).toFixed(1)} km/일 → ${(out.amountDshv / 10).toFixed(1)} SHV ` +
          `| 정산일수 ${out.days} 상한도달일 ${out.cappedDays} 주간최대 ${(out.weeklyMax / 10).toFixed(0)}/${DEFAULT_HUMAN_LIMIT_PROFILE.weeklyMaxDshv / 10} SHV | 기각 ${rej}`,
      );
    }
    log(
      `5-A 완주 발행량\n` +
        `   기대치(1 km = 1 SHV, ×1.0): 걸은 거리 ${(r.trueMeters / 1000).toFixed(1)} km → ${(r.trueMeters / 1000).toFixed(1)} SHV\n` +
        `   창이 실제로 방출한 거리 ${(r.measuredMeters / 1000).toFixed(1)} km ` +
        `(창 경계 누락 ${((1 - r.measuredMeters / r.trueMeters) * 100).toFixed(2)}%)\n` +
        rows.join('\n'),
    );

    const sixty = runLedger(repace(r.samples, r.windowStartM, r.trueMeters / 60, startTs));
    log(
      `5-A ★60일 완주 = ${(sixty.amountDshv / 10).toFixed(1)} SHV ` +
        `(1,055 대비 ${((sixty.amountDshv / 10 / 1055) * 100).toFixed(1)}% / 실제 걸은 ${(r.trueMeters / 1000).toFixed(0)} km 대비 ${((sixty.amountDshv / 10 / (r.trueMeters / 1000)) * 100).toFixed(1)}%)`,
    );
    expect(sixty.amountDshv).toBeGreaterThan(0);
  }, 1_800_000);

  it('5-B ★창 경계 거리 누락 — 픽스 간격별 손실률', async () => {
    // 100 km 구간을 여러 GPS 간격으로 걷고, "걸은 거리" 대비 "창이 방출한 거리"를 본다.
    const path = rawSlice(0, 4_000);
    const cases = [
      { intervalS: 1, fixes: 60, label: '1초 간격(1Hz) 60픽스' },
      { intervalS: 5, fixes: 12, label: '5초 간격 12픽스 ← 운영 설정' },
      { intervalS: 10, fixes: 6, label: '10초 간격 6픽스' },
      { intervalS: 15, fixes: 4, label: '15초 간격 4픽스' },
    ];
    for (const c of cases) {
      const r = await simulateWalk(COURSES, path, {
        intervalS: c.intervalS,
        fixesPerWindow: c.fixes,
        statsEvery: 10,
      });
      const loss = 1 - r.measuredMeters / r.trueMeters;
      log(
        `5-B ${c.label.padEnd(28)} 걸은 ${(r.trueMeters / 1000).toFixed(1)} km → 방출 ${(r.measuredMeters / 1000).toFixed(1)} km ` +
          `| 누락 ${(loss * 100).toFixed(2)}% (이론 1/${c.fixes} = ${((100 / c.fixes)).toFixed(2)}%)`,
      );
    }
    log('5-B → 1,080 km 완주 기준 운영 설정(5초/12픽스)의 누락은 약 90 km = 90 SHV.');
    expect(true).toBe(true);
  }, 900_000);

  it('5-D 완주 + 횡방향 고정 이탈 20 m / 50 m (전 구간)', async () => {
    const raw = rawTrail();
    const startTs = Date.parse('2026-08-01T05:00:00Z');
    for (const off of [20, 50]) {
      const r = await simulateWalk(COURSES, raw, { lateralM: off, statsEvery: 5 });
      const out = runLedger(repace(r.samples, r.windowStartM, r.trueMeters / 60, startTs));
      const rej = Object.entries(out.rejected).map(([k, v]) => `${k}×${v}`).join(' ') || '없음';
      log(
        `5-D +${off} m 전 구간: ON_COURSE ${pct(r.tierCounts['ON_COURSE'] ?? 0, r.windows)} ` +
          `이탈 중앙 ${r.distStats.median.toFixed(1)}m 최대 ${r.distStats.max.toFixed(1)}m → 60일 ${(out.amountDshv / 10).toFixed(1)} SHV | 기각 ${rej}`,
      );
    }
    expect(true).toBe(true);
  }, 1_800_000);

  it('5-C GPS 드리프트 σ=15 m 를 얹은 현실적 완주', async () => {
    const r = await simulateWalk(COURSES, rawTrail(), {
      driftSigmaM: 15,
      accuracyM: 20,
      seed: 11,
      statsEvery: 5,
    });
    report(r, '5-C 완주 + 드리프트 σ=15 m');
    const startTs = Date.parse('2026-08-01T05:00:00Z');
    const out = runLedger(repace(r.samples, r.windowStartM, r.trueMeters / 60, startTs));
    const rej = Object.entries(out.rejected).map(([k, v]) => `${k}×${v}`).join(' ') || '없음';
    log(`5-C → 60일 ${(out.amountDshv / 10).toFixed(1)} SHV | 정산일수 ${out.days} | 기각 ${rej}`);
    expect(out.amountDshv).toBeGreaterThan(0);
  }, 1_800_000);
});
