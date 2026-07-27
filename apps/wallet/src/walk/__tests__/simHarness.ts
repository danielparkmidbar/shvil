/**
 * 실주행 시뮬레이션 공용 도구 (테스트 전용 — 테스트 파일이 아니다).
 *
 * 판정·요율·원장은 **운영 코드 그대로** 호출한다. 여기 있는 것은 좌표 생성기와
 * 통계 집계뿐이다. 재구현된 판정 로직은 없다.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CORRIDOR_HALF_WIDTH_M,
  type CourseData,
  type WalkSample,
} from '@shvil/shared';
import { CorridorEngine, type GpsFix } from '../corridorEngine';
import { nearestOnPolyline, type GeoPoint } from '../geo';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(
  HERE, '..', '..', '..', '..', '..',
  'packages', 'shared', 'scripts', 'osm-cache', 'rel-282071.json',
);

export const REPORT_PATH = process.env['SHVIL_SIM_REPORT'] ?? join(HERE, 'sim-report.txt');

export function log(line: string): void {
  console.log(line);
  try {
    appendFileSync(REPORT_PATH, line + '\n', 'utf-8');
  } catch {
    /* 무해 */
  }
}

const R = 6_371_000;
export const rad = (d: number) => (d * Math.PI) / 180;

export function hav(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function lengthM(pts: GeoPoint[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += hav(pts[i - 1]!, pts[i]!);
  return s;
}

function stitchWays(ways: GeoPoint[][], gap = 250): GeoPoint[] {
  if (ways.length === 0) return [];
  const remaining = ways.map((w) => w.slice());
  let chain = remaining.shift()!;
  let progress = true;
  while (progress && remaining.length) {
    progress = false;
    const head = chain[0]!;
    const tail = chain[chain.length - 1]!;
    let bestIdx = -1;
    let bestMode = '';
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const w = remaining[i]!;
      const cands: [string, number][] = [
        ['tail-head', hav(tail, w[0]!)],
        ['tail-tail', hav(tail, w[w.length - 1]!)],
        ['head-tail', hav(head, w[w.length - 1]!)],
        ['head-head', hav(head, w[0]!)],
      ];
      for (const [mode, d] of cands) {
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
          bestMode = mode;
        }
      }
    }
    if (bestIdx >= 0 && bestDist <= gap) {
      const w = remaining.splice(bestIdx, 1)[0]!;
      if (bestMode === 'tail-head') chain = chain.concat(w.slice(1));
      else if (bestMode === 'tail-tail') chain = chain.concat(w.slice().reverse().slice(1));
      else if (bestMode === 'head-tail') chain = w.slice(0, -1).concat(chain);
      else chain = w.slice().reverse().slice(0, -1).concat(chain);
      progress = true;
    }
  }
  return chain;
}

let rawCache: GeoPoint[] | null = null;
/** OSM 원본(단순화 이전) 폴리라인 — 하이커가 실제로 밟는 "진짜 길". */
export function rawTrail(): GeoPoint[] {
  if (rawCache) return rawCache;
  const json = JSON.parse(readFileSync(CACHE, 'utf-8')) as {
    elements: { members?: { type: string; geometry?: { lat: number; lon: number }[] }[] }[];
  };
  const ways: GeoPoint[][] = [];
  for (const el of json.elements ?? []) {
    for (const mem of el.members ?? []) {
      if (mem.type === 'way' && Array.isArray(mem.geometry) && mem.geometry.length >= 2) {
        ways.push(mem.geometry.map((g) => ({ lat: g.lat, lon: g.lon })));
      }
    }
  }
  rawCache = stitchWays(ways);
  return rawCache;
}

// ── 걷기 시뮬레이터 ────────────────────────────────────────────────

interface Walker {
  points: GeoPoint[];
  perp: { dLat: number; dLon: number }[];
}

/** 경로를 stepM 간격으로 재표본하고 각 점의 좌측 수직 단위벡터를 계산한다. */
export function resample(path: GeoPoint[], stepM: number): Walker {
  const points: GeoPoint[] = [];
  const perp: { dLat: number; dLon: number }[] = [];
  let residual = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const segLen = hav(a, b);
    if (segLen === 0) continue;
    const mPerLon = 111_320 * Math.cos(rad(a.lat));
    const dx = (b.lon - a.lon) * mPerLon;
    const dy = (b.lat - a.lat) * 111_320;
    const n = Math.hypot(dx, dy) || 1;
    const pv = { dLat: dx / n / 111_320, dLon: -dy / n / mPerLon };
    let d = residual;
    while (d < segLen) {
      const t = d / segLen;
      points.push({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });
      perp.push(pv);
      d += stepM;
    }
    residual = d - segLen;
  }
  points.push(path[path.length - 1]!);
  perp.push(perp[perp.length - 1] ?? { dLat: 0, dLon: 0 });
  return { points, perp };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 기본값은 **운영 설정 그대로**다.
 *  - walkService.ts: Location.watchPositionAsync({ timeInterval: 5_000, distanceInterval: 5 })
 *    → 보행 속도 1 m/s 에서 픽스는 약 5초 / 5 m 간격.
 *  - WINDOW_MS = 60_000 → 창당 픽스 12개 (t=0,5,…,55 s).
 */
export const PROD_INTERVAL_S = 5;
export const PROD_FIXES_PER_WINDOW = 12;

export interface SimOptions {
  lateralM?: number;
  /** AR(1) 자기상관 GPS 드리프트 표준편차(m). */
  driftSigmaM?: number;
  driftRho?: number;
  accuracyM?: number;
  fixesPerWindow?: number;
  intervalS?: number;
  speedMps?: number;
  seed?: number;
  startTs?: number;
  /** 창당 걸음 수를 강제 (미지정 시 창 전체 60초 동안의 실제 걸음). */
  stepsOverride?: number;
  /** 통계용 거리 계산을 N픽스마다 1회만 (판정 자체는 매 픽스 — 운영 코드). */
  statsEvery?: number;
}

export interface WindowRec {
  tier: string;
  atKm: number;
  maxDistM: number;
}

export interface SimResult {
  samples: WalkSample[];
  /** 각 창 시작 시점의 경로 누적거리(m) — 정산 페이스 재배치용. */
  windowStartM: number[];
  windows: number;
  tierCounts: Record<string, number>;
  /** 창들이 실제로 방출한 distanceM 합 (= 실제 발행 근거). */
  measuredMeters: number;
  /** 사람이 실제로 걸은 거리. */
  trueMeters: number;
  /** 창 안 픽스 간 거리의 합 — 창 경계에서 새는 거리를 뺀 값. */
  creditableMeters: number;
  distStats: { median: number; p95: number; p99: number; max: number; outsideRatio: number };
  offWindows: WindowRec[];
  elapsedMs: number;
}

/** 경로를 따라 걸으며 창을 닫고 WalkSample 열을 만든다 (엔진은 운영 코드). */
export async function simulateWalk(
  courses: CourseData[],
  path: GeoPoint[],
  opt: SimOptions = {},
): Promise<SimResult> {
  const t0 = Date.now();
  const fixesPerWindow = opt.fixesPerWindow ?? PROD_FIXES_PER_WINDOW;
  const intervalS = opt.intervalS ?? PROD_INTERVAL_S;
  const statsEvery = opt.statsEvery ?? 1;
  const speed = opt.speedMps ?? 1.0;
  const stepM = speed * intervalS;
  const rnd = mulberry32(opt.seed ?? 12345);
  const walker = resample(path, stepM);
  const engine = new CorridorEngine(courses, []);

  const samples: WalkSample[] = [];
  const windowStartM: number[] = [];
  const tierCounts: Record<string, number> = {};
  const dists: number[] = [];
  const offWindows: WindowRec[] = [];
  let measuredMeters = 0;
  let trueMeters = 0;
  let creditableMeters = 0;
  let outside = 0;

  const startTs = opt.startTs ?? Date.parse('2026-08-01T06:00:00Z');
  const gauss = () => {
    const u = Math.max(1e-9, rnd());
    const v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const rho = opt.driftRho ?? 0.9;
  let drift = 0;

  let inWindow = 0;
  let windowTrueM = 0;
  let windowMaxDist = 0;
  let windowStart = 0;
  let traveled = 0;
  let tsOffsetS = 0;

  for (let i = 0; i < walker.points.length; i++) {
    const base = walker.points[i]!;
    const pv = walker.perp[i]!;
    let off = opt.lateralM ?? 0;
    if (opt.driftSigmaM) {
      drift = rho * drift + Math.sqrt(1 - rho * rho) * gauss() * opt.driftSigmaM;
      off += drift;
    }
    const fix: GpsFix = {
      lat: base.lat + pv.dLat * off,
      lon: base.lon + pv.dLon * off,
      timestamp: startTs + tsOffsetS * 1000,
      accuracy: opt.accuracyM ?? 15,
    };
    if (inWindow === 0) windowStart = traveled;
    engine.addFix(fix);

    if (i % statsEvery === 0) {
      let best = Infinity;
      let halfW = 50;
      for (const c of courses) {
        const near = nearestOnPolyline(fix, c.polyline);
        if (near.distanceM < best) {
          best = near.distanceM;
          const meta =
            c.segments.find((s) => near.segmentIndex >= s.fromIdx && near.segmentIndex < s.toIdx) ??
            c.segments[c.segments.length - 1]!;
          halfW = meta.corridorHalfWidthM ?? DEFAULT_CORRIDOR_HALF_WIDTH_M[meta.terrain];
        }
      }
      dists.push(best);
      if (best > halfW) outside++;
      windowMaxDist = Math.max(windowMaxDist, best);
    }

    inWindow++;
    tsOffsetS += intervalS;
    traveled += stepM; // 창 경계를 넘어서도 사람은 계속 걷는다
    if (inWindow > 1) windowTrueM += stepM;

    if (inWindow === fixesPerWindow) {
      // 만보기는 창 경계에서 멈추지 않는다 — 60초 창 전체(픽스 수 × 간격)의 걸음.
      engine.addSteps(opt.stepsOverride ?? Math.round((fixesPerWindow * stepM) / 0.75));
      const s = engine.closeWindow();
      if (s) {
        samples.push(s);
        windowStartM.push(windowStart);
        tierCounts[s.tier] = (tierCounts[s.tier] ?? 0) + 1;
        measuredMeters += s.distanceM;
        if (s.tier !== 'ON_COURSE') {
          offWindows.push({ tier: s.tier, atKm: windowStart / 1000, maxDistM: windowMaxDist });
        }
      }
      trueMeters += fixesPerWindow * stepM;
      creditableMeters += windowTrueM;
      inWindow = 0;
      windowTrueM = 0;
      windowMaxDist = 0;
      if (samples.length % 2000 === 0) await new Promise((r) => setImmediate(r));
    }
  }

  const sorted = dists.slice().sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  return {
    samples,
    windowStartM,
    windows: samples.length,
    tierCounts,
    measuredMeters,
    trueMeters,
    creditableMeters,
    distStats: {
      median: q(0.5),
      p95: q(0.95),
      p99: q(0.99),
      max: sorted[sorted.length - 1] ?? 0,
      outsideRatio: outside / Math.max(1, dists.length),
    },
    offWindows,
    elapsedMs: Date.now() - t0,
  };
}

export function pct(n: number, d: number): string {
  return `${((100 * n) / Math.max(1, d)).toFixed(2)}%`;
}

export function report(r: SimResult, label: string): void {
  const on = r.tierCounts['ON_COURSE'] ?? 0;
  log(
    `${label}\n` +
      `   창 ${r.windows} | ON_COURSE ${on} (${pct(on, r.windows)}) ` +
      `OFF_COURSE ${r.tierCounts['OFF_COURSE'] ?? 0} DAILY_LIFE ${r.tierCounts['DAILY_LIFE'] ?? 0}\n` +
      `   폴리라인 이탈거리: 중앙 ${r.distStats.median.toFixed(1)}m p95 ${r.distStats.p95.toFixed(1)}m ` +
      `p99 ${r.distStats.p99.toFixed(1)}m 최대 ${r.distStats.max.toFixed(1)}m / 회랑밖 픽스 ${(r.distStats.outsideRatio * 100).toFixed(2)}%\n` +
      `   실제 걸은 ${(r.trueMeters / 1000).toFixed(2)} km → 창이 방출한 거리 ${(r.measuredMeters / 1000).toFixed(2)} km ` +
      `(창 경계 누락 ${(100 * (1 - r.measuredMeters / Math.max(1, r.trueMeters))).toFixed(2)}%) (${r.elapsedMs}ms)`,
  );
}
