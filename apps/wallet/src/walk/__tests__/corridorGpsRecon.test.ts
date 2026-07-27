/**
 * 실측 C — 회랑·GPS 품질 정찰 (2026-07-27).
 *
 * 목적: (가) 불곡산 실기기 시험 코스가 실제로 어떻게 판정되는지,
 *       (나) GPS 흔들림이 발행을 얼마나 부풀리는지,
 *       (다) **폴리라인 위 투영 거리(along-track)** 로 재면 그 부풀림이 상쇄되는지.
 *
 * 판정·요율·원장은 운영 코드를 그대로 부른다. 여기 있는 것은 좌표 생성기와
 * "투영 거리로 재보면 어떨까"라는 **대안 계측기의 시뮬레이션**뿐이다.
 * 대안 계측기는 아직 운영 코드가 아니다 — 채택 여부는 다니엘 쌤 결정.
 */
import { describe, expect, it } from 'vitest';
import {
  BUNDANG_BULGOKSAN_SAMPLE,
  DEFAULT_CORRIDOR_HALF_WIDTH_M,
  PendingWalkLedger,
  SHVIL_ISRAEL,
  corridorHalfWidthAt,
  segmentMetaAt,
  type CourseData,
  type WalkSample,
} from '@shvil/shared';
import { CorridorEngine, type GpsFix } from '../corridorEngine';
import { nearestOnPolyline, type GeoPoint } from '../geo';
import { hav, lengthM, log, mulberry32, rad, rawTrail, resample } from './simHarness';

const BG = BUNDANG_BULGOKSAN_SAMPLE;

// ── 대안 계측기: 폴리라인 위 투영(along-track) 거리 ──────────────────────────
// 회랑 안이라면 "진행 거리"는 폴리라인 위 이동량으로 재는 것이 물리적으로 더 옳다.
// 횡방향 GPS 흔들림은 투영에서 통째로 떨어져 나간다(투영은 종방향 성분만 남긴다).

interface AlongTrack {
  /** 코스 시작점부터의 누적 거리(m) — 투영점 위치. */
  s: number;
  /** 폴리라인까지의 수직 거리(m). */
  perpM: number;
}

function cumulative(poly: GeoPoint[]): number[] {
  const cum = [0];
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1]! + hav(poly[i - 1]!, poly[i]!));
  return cum;
}

function projectAlong(p: GeoPoint, poly: GeoPoint[], cum: number[]): AlongTrack {
  let best = Infinity;
  let bestS = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]!;
    const b = poly[i + 1]!;
    const mPerLon = 111_320 * Math.cos(rad(a.lat));
    const bx = (b.lon - a.lon) * mPerLon;
    const by = (b.lat - a.lat) * 111_320;
    const px = (p.lon - a.lon) * mPerLon;
    const py = (p.lat - a.lat) * 111_320;
    const lenSq = bx * bx + by * by;
    if (lenSq === 0) continue;
    let t = (px * bx + py * by) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const dx = px - t * bx;
    const dy = py - t * by;
    const d = Math.hypot(dx, dy);
    if (d < best) {
      best = d;
      bestS = cum[i]! + t * Math.sqrt(lenSq);
    }
  }
  return { s: bestS, perpM: best };
}

// ── 공용 시뮬레이터 (창 단위로 세 가지 계측을 동시에 낸다) ────────────────────

interface ReconOpt {
  driftSigmaM?: number;
  driftRho?: number;
  accuracyM?: number;
  speedMps?: number;
  intervalS?: number;
  fixesPerWindow?: number;
  seed?: number;
  /** 이 비율의 픽스에 정확도 불량(값 = badAccuracyM)을 준다. */
  badAccuracyRatio?: number;
  badAccuracyM?: number;
}

interface ReconResult {
  samples: WalkSample[];
  windows: number;
  tierCounts: Record<string, number>;
  trueM: number;
  /** 운영 코드가 실제로 방출한 거리 합 (픽스 간 haversine 합). */
  havM: number;
  /** 대안 A: 창 안 연속 투영 이동량의 절댓값 합. */
  alongSumM: number;
  /** 대안 B: 창 첫 픽스 → 끝 픽스의 순 투영 이동량. */
  alongNetM: number;
  /** 투영 점프 최대치(m) — 자기교차·스위치백 오탐 위험 지표. */
  maxAlongJumpM: number;
  perpStats: { median: number; p95: number; max: number; outsideRatio: number };
  droppedFixes: number;
}

function simulate(courses: CourseData[], path: GeoPoint[], opt: ReconOpt = {}): ReconResult {
  const intervalS = opt.intervalS ?? 5;
  const speed = opt.speedMps ?? 1.0;
  const fpw = opt.fixesPerWindow ?? 12;
  const stepM = speed * intervalS;
  const rnd = mulberry32(opt.seed ?? 4242);
  const gauss = () => {
    const u = Math.max(1e-9, rnd());
    const v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const walker = resample(path, stepM);
  const engine = new CorridorEngine(courses, []);
  const main = courses[0]!;
  const cum = cumulative(main.polyline);

  const samples: WalkSample[] = [];
  const tierCounts: Record<string, number> = {};
  const perps: number[] = [];
  let outside = 0;
  let trueM = 0;
  let havM = 0;
  let alongSumM = 0;
  let alongNetM = 0;
  let maxJump = 0;
  let dropped = 0;

  const rho = opt.driftRho ?? 0.9;
  let drift = 0;
  let ts = Date.parse('2026-08-01T06:00:00Z');
  let inWindow = 0;
  let winFirstS: number | null = null;
  let winLastS = 0;
  let winPrevEndS: number | null = null;
  let prevS: number | null = null;

  for (let i = 0; i < walker.points.length; i++) {
    const base = walker.points[i]!;
    const pv = walker.perp[i]!;
    let off = 0;
    if (opt.driftSigmaM) {
      drift = rho * drift + Math.sqrt(1 - rho * rho) * gauss() * opt.driftSigmaM;
      off += drift;
    }
    const badFix = opt.badAccuracyRatio ? rnd() < opt.badAccuracyRatio : false;
    const fix: GpsFix = {
      lat: base.lat + pv.dLat * off,
      lon: base.lon + pv.dLon * off,
      timestamp: ts,
      accuracy: badFix ? (opt.badAccuracyM ?? 80) : (opt.accuracyM ?? 15),
    };
    engine.addFix(fix);
    if (badFix) dropped++;

    // 대안 계측기: 정확도 폐기 규칙은 운영과 동일하게 적용(공정 비교).
    if (!badFix) {
      const near = nearestOnPolyline(fix, main.polyline);
      const halfW = corridorHalfWidthAt(main, near.segmentIndex);
      perps.push(near.distanceM);
      if (near.distanceM > halfW) outside++;

      const at = projectAlong(fix, main.polyline, cum);
      if (winFirstS === null) winFirstS = at.s;
      winLastS = at.s;
      if (prevS !== null) {
        const d = Math.abs(at.s - prevS);
        maxJump = Math.max(maxJump, d);
        alongSumM += d;
      }
      prevS = at.s;
    }

    inWindow++;
    ts += intervalS * 1000;
    if (i > 0) trueM += stepM;

    if (inWindow === fpw) {
      engine.addSteps(Math.round((fpw * stepM) / 0.75));
      const s = engine.closeWindow();
      if (s) {
        samples.push(s);
        tierCounts[s.tier] = (tierCounts[s.tier] ?? 0) + 1;
        havM += s.distanceM;
      }
      // 투영 "순이동"도 경계를 이어붙인다 — 직전 창의 마지막 s에서 이어 재야
      // 창당 1구간(8.33%)이 사라지지 않는다.
      if (winFirstS !== null) alongNetM += Math.abs(winLastS - (winPrevEndS ?? winFirstS));
      winPrevEndS = winLastS;
      winFirstS = null;
      // ★prevS는 **끊지 않는다** — 운영 엔진의 #carryFix와 같은 창 경계 이월.
      //  끊으면 창당 1구간(=1/12 = 8.33%)이 통째로 사라진다(corridorEngine 주석 참조).
      inWindow = 0;
    }
  }

  const sorted = perps.slice().sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  return {
    samples,
    windows: samples.length,
    tierCounts,
    trueM,
    havM,
    alongSumM,
    alongNetM,
    maxAlongJumpM: maxJump,
    perpStats: {
      median: q(0.5),
      p95: q(0.95),
      max: sorted[sorted.length - 1] ?? 0,
      outsideRatio: outside / Math.max(1, perps.length),
    },
    droppedFixes: dropped,
  };
}

function mint(samples: WalkSample[]): { shv: number; rejected: Record<string, number>; rejWin: number } {
  const ledger = new PendingWalkLedger({ memberId: 'recon', tzOffsetMinutes: 540 });
  const rejected: Record<string, number> = {};
  let rejWin = 0;
  for (const s of samples) {
    const v = ledger.recordSample(s);
    if (!v.accepted) {
      rejected[v.reason ?? '?'] = (rejected[v.reason ?? '?'] ?? 0) + 1;
      rejWin++;
    }
  }
  const d = ledger.settleManual(Date.parse('2026-08-01T12:00:00Z'));
  return { shv: (d?.amountDshv ?? 0) / 10, rejected, rejWin };
}

const fmtRej = (r: Record<string, number>) =>
  Object.entries(r).map(([k, v]) => `${k}×${v}`).join(' ') || '없음';

// ── C-1 불곡산 코스 실측 ─────────────────────────────────────────────────────

describe('C-1 불곡산 코스 기하·회랑', () => {
  it('C-1-A 구간별 지형·난이도·회랑 반폭·길이', () => {
    const poly = BG.polyline;
    const total = lengthM(poly);
    log(`\nC-1-A 불곡산 코스 = ${BG.courseId} / 점 ${poly.length}개 / 총 ${total.toFixed(1)} m (${(total / 1000).toFixed(3)} km)`);
    for (const seg of BG.segments) {
      let segLen = 0;
      for (let i = seg.fromIdx; i < Math.min(seg.toIdx, poly.length - 1); i++) {
        segLen += hav(poly[i]!, poly[i + 1]!);
      }
      const halfW = seg.corridorHalfWidthM ?? DEFAULT_CORRIDOR_HALF_WIDTH_M[seg.terrain];
      log(
        `   선분 ${seg.fromIdx}~${seg.toIdx} ${seg.terrain.padEnd(8)} 난이도 ×${(seg.difficultyTenths / 10).toFixed(1)} ` +
          `회랑 반폭 ${halfW} m ${seg.corridorHalfWidthM === undefined ? '(지형 기본값)' : '(명시)'} 길이 ${segLen.toFixed(1)} m`,
      );
    }
    // 선분별 길이·방향 급변(회랑 사각지대) 점검
    let minSeg = Infinity;
    let maxSeg = 0;
    for (let i = 0; i < poly.length - 1; i++) {
      const d = hav(poly[i]!, poly[i + 1]!);
      minSeg = Math.min(minSeg, d);
      maxSeg = Math.max(maxSeg, d);
    }
    log(`   선분 길이 최소 ${minSeg.toFixed(1)} m / 최대 ${maxSeg.toFixed(1)} m`);
    log(`   ★회랑 반폭(URBAN 150 / MOUNTAIN 120)이 선분 길이(${minSeg.toFixed(0)}~${maxSeg.toFixed(0)} m)와 같은 자릿수 — 코스가 "선"이 아니라 "띠"다.`);
    expect(total).toBeGreaterThan(1000);
  });

  it('C-1-B 이상적 GPS(오차 없음)로 완주 → 발행량', () => {
    const r = simulate([BG], BG.polyline, { driftSigmaM: 0, accuracyM: 8, speedMps: 1.0 });
    const m = mint(r.samples);
    log(
      `C-1-B 오차 없음: 창 ${r.windows} | ON ${r.tierCounts['ON_COURSE'] ?? 0} ` +
        `| 걸은 ${(r.trueM / 1000).toFixed(3)} km → 방출 ${(r.havM / 1000).toFixed(3)} km | ${m.shv} SHV | 기각 ${fmtRej(m.rejected)}`,
    );
    log(`   → 왕복(2회 통과) 가정 시 대략 ${(m.shv * 2).toFixed(1)} SHV. 권장가 샤워 3 SHV 기준 ${(m.shv * 2 / 3).toFixed(1)}회분.`);
    expect(r.windows).toBeGreaterThan(0);
  });

  it('C-1-C 도심 근접 산 — GPS 다중경로 강도별', () => {
    const cases = [
      { sigma: 0, rho: 0, acc: 8, label: '오차 없음' },
      { sigma: 5, rho: 0.98, acc: 10, label: 'σ5 ρ0.98 개활' },
      { sigma: 10, rho: 0.9, acc: 20, label: 'σ10 ρ0.90 다중경로' },
      { sigma: 15, rho: 0.9, acc: 30, label: 'σ15 ρ0.90 협곡' },
      { sigma: 25, rho: 0.85, acc: 45, label: 'σ25 ρ0.85 아파트+숲' },
      { sigma: 40, rho: 0.8, acc: 60, label: 'σ40 ρ0.80 최악' },
    ];
    for (const c of cases) {
      const r = simulate([BG], BG.polyline, {
        driftSigmaM: c.sigma || undefined,
        driftRho: c.rho,
        accuracyM: c.acc,
        speedMps: 0.8, // 2.9 km/h — 오르막 포함 등산 속도
      });
      const m = mint(r.samples);
      log(
        `C-1-C ${c.label.padEnd(18)} 창 ${String(r.windows).padStart(3)} ON ${String(r.tierCounts['ON_COURSE'] ?? 0).padStart(3)} ` +
          `OFF ${String(r.tierCounts['OFF_COURSE'] ?? 0).padStart(2)} | 방출/걸은 ${(r.havM / Math.max(1, r.trueM)).toFixed(3)} ` +
          `| 수직거리 중앙 ${r.perpStats.median.toFixed(1)} p95 ${r.perpStats.p95.toFixed(1)} 최대 ${r.perpStats.max.toFixed(1)} m ` +
          `회랑밖 ${(r.perpStats.outsideRatio * 100).toFixed(1)}% | ${m.shv} SHV | 기각창 ${m.rejWin}/${r.windows} ${fmtRej(m.rejected)}`,
      );
    }
    expect(true).toBe(true);
  });

  it('C-1-D 정확도 불량 픽스 비율별 (maxAccuracyM=50, minFixesPerWindow=3)', () => {
    for (const ratio of [0, 0.1, 0.25, 0.5, 0.75, 0.9]) {
      const r = simulate([BG], BG.polyline, {
        driftSigmaM: 12,
        driftRho: 0.9,
        accuracyM: 25,
        speedMps: 0.8,
        badAccuracyRatio: ratio,
        badAccuracyM: 65,
        seed: 7,
      });
      const m = mint(r.samples);
      log(
        `C-1-D 불량픽스 ${String(Math.round(ratio * 100)).padStart(2)}% (65 m): 폐기 ${r.droppedFixes}개 → 창 ${r.windows} | ` +
          `방출 ${(r.havM / 1000).toFixed(3)} km | ${m.shv} SHV`,
      );
    }
    log('   ★불량 픽스는 "그 픽스만" 버려지는 게 아니다 — 창의 남은 픽스가 3개 미만이면 창 전체가 사라진다.');
    expect(true).toBe(true);
  });
});

/**
 * C-1-E ★핵심: **실제 등산로**를 걸었을 때 코스 회랑 안인가.
 *
 * 불곡산 폴리라인은 손으로 찍은 8점 직선 근사다(courses.ts:249 자인).
 * 다니엘 쌤이 실기기로 걸을 길은 이 직선이 아니라 **OSM에 있는 진짜 등산로**다.
 * 그 길의 좌표를 넣어 운영 엔진이 뭐라고 판정하는지 본다.
 *
 * 경로 JSON 생성(OSM Overpass, ODbL):
 *   SHVIL_BULGOK_ROUTE=<경로.json> 로 지정. 없으면 이 테스트는 건너뛴다.
 */
describe('C-1-E 실제 등산로 대조', () => {
  const routePath = process.env['SHVIL_BULGOK_ROUTE'];
  it.runIf(routePath)('C-1-E 진짜 등산로를 걸으면 ON_COURSE 인가', async () => {
    const { readFileSync } = await import('node:fs');
    const route = JSON.parse(readFileSync(routePath!, 'utf-8')) as GeoPoint[];
    log(`\nC-1-E 실제 OSM 등산로 ${route.length}점 / ${(lengthM(route) / 1000).toFixed(3)} km (손그림 코스 1.551 km)`);
    for (const c of [
      { sigma: 0, rho: 0, acc: 8, label: 'GPS 완벽' },
      { sigma: 10, rho: 0.9, acc: 20, label: 'σ10 다중경로' },
      { sigma: 20, rho: 0.9, acc: 35, label: 'σ20 숲+아파트' },
    ]) {
      const r = simulate([BG], route, {
        driftSigmaM: c.sigma || undefined,
        driftRho: c.rho,
        accuracyM: c.acc,
        speedMps: 0.8,
      });
      const m = mint(r.samples);
      log(
        `   ${c.label.padEnd(12)} 창 ${r.windows} | ON ${r.tierCounts['ON_COURSE'] ?? 0} OFF_COURSE ${r.tierCounts['OFF_COURSE'] ?? 0} ` +
          `DAILY_LIFE ${r.tierCounts['DAILY_LIFE'] ?? 0} | 코스선까지 중앙 ${r.perpStats.median.toFixed(0)} m p95 ${r.perpStats.p95.toFixed(0)} 최대 ${r.perpStats.max.toFixed(0)} m ` +
          `| 회랑밖 픽스 ${(r.perpStats.outsideRatio * 100).toFixed(1)}% | ${m.shv} SHV`,
      );
    }
    log('   ★OFF_COURSE는 요율 1/1,000이다 — 1.8 km 걸어도 0.0 SHV.');
    expect(true).toBe(true);
  }, 120_000);
});

// ── C-2 투영 거리(along-track) 대안 검증 ────────────────────────────────────

describe('C-2 폴리라인 투영 거리로 재면 흔들림이 상쇄되는가', () => {
  it('C-2-A 불곡산: haversine 합 vs 투영 합 vs 투영 순이동', () => {
    log('\nC-2-A 불곡산 1.55 km (2.9 km/h) — 계측 방식별 (진실 = 걸은 거리)');
    const cases = [
      { sigma: 0, rho: 0, label: '오차 없음' },
      { sigma: 5, rho: 0.98, label: 'σ5 ρ0.98' },
      { sigma: 10, rho: 0.9, label: 'σ10 ρ0.90' },
      { sigma: 15, rho: 0.9, label: 'σ15 ρ0.90' },
      { sigma: 25, rho: 0.85, label: 'σ25 ρ0.85' },
    ];
    for (const c of cases) {
      const r = simulate([BG], BG.polyline, {
        driftSigmaM: c.sigma || undefined,
        driftRho: c.rho,
        accuracyM: Math.max(10, c.sigma * 2),
        speedMps: 0.8,
      });
      log(
        `   ${c.label.padEnd(12)} 걸은 ${r.trueM.toFixed(0)} m | ` +
          `haversine ${r.havM.toFixed(0)} m (${((r.havM / r.trueM - 1) * 100).toFixed(1)}%) | ` +
          `투영합 ${r.alongSumM.toFixed(0)} m (${((r.alongSumM / r.trueM - 1) * 100).toFixed(1)}%) | ` +
          `투영순 ${r.alongNetM.toFixed(0)} m (${((r.alongNetM / r.trueM - 1) * 100).toFixed(1)}%) | 최대점프 ${r.maxAlongJumpM.toFixed(0)} m`,
      );
    }
    expect(true).toBe(true);
  });

  it('C-2-B 정지 상태에서 GPS만 흔들릴 때 (걷지 않았는데 발행되는가)', () => {
    // 사람은 한 점에 서 있고 GPS만 튄다. resample을 쓰지 않고 직접 픽스를 만든다.
    log('\nC-2-B 정지 60분 (사람은 안 걷고 GPS만 흔들림) — 창 60개');
    const anchor = BG.polyline[4]!;
    const cum = cumulative(BG.polyline);
    for (const sigma of [5, 10, 15, 25]) {
      const rnd = mulberry32(31);
      const gauss = () => {
        const u = Math.max(1e-9, rnd());
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
      };
      const engine = new CorridorEngine([BG], []);
      let ts = Date.parse('2026-08-01T06:00:00Z');
      let dLat = 0;
      let dLon = 0;
      let havSum = 0;
      let alongSum = 0;
      let alongNet = 0;
      let prevS: number | null = null;
      let winEndS: number | null = null;
      let lastS = 0;
      const samples: WalkSample[] = [];
      for (let w = 0; w < 60; w++) {
        for (let k = 0; k < 12; k++) {
          // 2차원 AR(1) 표류
          dLat = 0.9 * dLat + Math.sqrt(1 - 0.81) * (gauss() * sigma) / 111_320;
          dLon = 0.9 * dLon + Math.sqrt(1 - 0.81) * (gauss() * sigma) / (111_320 * Math.cos(rad(anchor.lat)));
          const fix: GpsFix = {
            lat: anchor.lat + dLat,
            lon: anchor.lon + dLon,
            timestamp: ts,
            accuracy: Math.max(10, sigma * 1.5),
          };
          engine.addFix(fix);
          const at = projectAlong(fix, BG.polyline, cum);
          if (prevS !== null) alongSum += Math.abs(at.s - prevS);
          prevS = at.s;
          lastS = at.s;
          ts += 5_000;
        }
        // 만보기: 실제로 안 걸었으므로 걸음도 없다(제자리 흔들림은 몇 걸음 나올 수 있다).
        engine.addSteps(4);
        const s = engine.closeWindow();
        if (s) {
          samples.push(s);
          havSum += s.distanceM;
        }
        alongNet += Math.abs(lastS - (winEndS ?? lastS));
        winEndS = lastS;
      }
      const m = mint(samples);
      log(
        `   σ${String(sigma).padStart(2)} m: 창 ${samples.length} | haversine ${havSum.toFixed(0)} m ` +
          `| 투영합 ${alongSum.toFixed(0)} m | 투영순 ${alongNet.toFixed(0)} m | 발행 ${m.shv} SHV | 기각 ${fmtRej(m.rejected)}`,
      );
    }
    log('   ★정지 창은 restDistanceThresholdM=20 m 미만이면 발행 0으로 통과한다. 그 위로 새면 "안 걷고 버는" 구멍이다.');
    expect(true).toBe(true);
  });

  it('C-2-C 투영 위험: 자기교차·근접 왕복 구간에서 s가 튀는가 (이스라엘 실물)', () => {
    // 폴리라인 위 두 점이 지리적으로 가까우면서 s(코스 시작부터의 거리)는 멀 수 있다.
    // 그런 곳에서는 GPS 몇 m 흔들림이 s를 km 단위로 점프시킨다 → 투영 계측의 급소.
    const poly = SHVIL_ISRAEL.polyline;
    const cum = cumulative(poly);
    // 격자 색인으로 "가깝지만 s가 먼" 쌍을 찾는다.
    const CELL = 0.002; // 약 220 m
    const grid = new Map<string, number[]>();
    for (let i = 0; i < poly.length; i++) {
      const k = `${Math.floor(poly[i]!.lat / CELL)},${Math.floor(poly[i]!.lon / CELL)}`;
      const arr = grid.get(k);
      if (arr) arr.push(i);
      else grid.set(k, [i]);
    }
    let worst = { i: 0, j: 0, distM: 0, dS: 0 };
    let pairsUnder100m = 0;
    let pairsUnder100mFarS = 0;
    const top: { i: number; j: number; distM: number; dS: number }[] = [];
    for (let i = 0; i < poly.length; i++) {
      const ci = Math.floor(poly[i]!.lat / CELL);
      const cj = Math.floor(poly[i]!.lon / CELL);
      // ★이웃 8칸까지 본다 — 같은 칸만 보면 칸 경계에 걸친 자기교차를 통째로 놓친다.
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          for (const j of grid.get(`${ci + di},${cj + dj}`) ?? []) {
            if (j <= i) continue;
            const d = hav(poly[i]!, poly[j]!);
            if (d > 100) continue;
            pairsUnder100m++;
            const dS = Math.abs(cum[j]! - cum[i]!);
            if (dS < 500) continue; // 같은 자리의 이웃 점 — 정상
            pairsUnder100mFarS++;
            top.push({ i, j, distM: d, dS });
            if (dS > worst.dS) worst = { i, j, distM: d, dS };
          }
        }
      }
    }
    top.sort((a, b) => b.dS - a.dS);
    log('\nC-2-C 투영 급소 — 지리적으로 100 m 이내인데 코스상 500 m 이상 떨어진 점 쌍');
    log(`   100 m 이내 점쌍 ${pairsUnder100m}개 중 s가 500 m 이상 벌어진 쌍 ${pairsUnder100mFarS}개`);
    log(`   최악: 점 ${worst.i}↔${worst.j} 지리 거리 ${worst.distM.toFixed(0)} m / 코스상 거리 ${(worst.dS / 1000).toFixed(1)} km`);
    for (const t of top.slice(0, 8)) {
      log(`     · 점 ${t.i}↔${t.j} 지리 ${t.distM.toFixed(0)} m / 코스상 ${(t.dS / 1000).toFixed(2)} km`);
    }
    log('   ★이 지점에서 GPS가 몇 m 튀면 투영 s가 km 단위로 점프한다 — 그대로 쓰면 순간 폭발 발행이다.');
    log('   → 완화: 직전 s의 ±(창 시간 × 최대 보행속도) 안에서만 투영 후보를 찾는다(국지 투영).');
    expect(pairsUnder100m).toBeGreaterThan(0);
  }, 300_000);

  it('C-2-D 단순화 손실: 투영은 "배포선 길이"만 인정한다', () => {
    // 배포 폴리라인은 원본을 20 m 허용오차로 Douglas–Peucker 단순화한 것이다.
    // 투영 계측은 배포선 위 이동량이므로, 원본과 배포선의 길이 차이만큼 **덜** 준다.
    const rawM = lengthM(rawTrail());
    const depM = lengthM(SHVIL_ISRAEL.polyline);
    log('\nC-2-D 원본 트레일 vs 배포 폴리라인 길이');
    log(
      `   원본(OSM 이어붙임) ${(rawM / 1000).toFixed(1)} km / 배포(DP 20 m) ${(depM / 1000).toFixed(1)} km ` +
        `→ 차이 ${((depM / rawM - 1) * 100).toFixed(2)}%`,
    );
    log('   ★투영 거리를 쓰면 정직한 하이커는 이 비율만큼 구조적으로 덜 받는다. 지금 haversine 합은 반대로 흔들림만큼 더 준다.');
    expect(rawM).toBeGreaterThan(0);
  }, 300_000);
});

// ── C-4 정확도 적응 회랑 ────────────────────────────────────────────────────

describe('C-4 정확도에 따라 회랑을 넓히면 어떻게 되는가', () => {
  it('C-4-A 폐기(maxAccuracyM=50) vs 회랑 확대 — 인정 거리·부풀림 비교', () => {
    log('\nC-4-A 정확도 55~90 m 픽스가 섞일 때');
    // ★2026-07-27 시정: 이 정찰이 권고한 것이 그대로 구현됐다. 지금 규칙은
    //   "accuracy > 50 이면 폐기"가 아니라 "50 초과분만큼 회랑을 넓히고(상한 100 m),
    //   200 m 초과만 폐기"다. 아래 표의 창 개수가 더 이상 0으로 떨어지지 않는 이유다.
    //   거리도 haversine 합이 아니라 회랑 안 창은 폴리라인 위 순이동으로 잰다.
    for (const acc of [45, 50, 51, 65, 80]) {
      const r = simulate([BG], BG.polyline, {
        driftSigmaM: Math.max(4, acc / 3),
        driftRho: 0.9,
        accuracyM: acc,
        speedMps: 0.8,
        seed: 5,
      });
      const m = mint(r.samples);
      log(
        `   accuracy ${String(acc).padStart(2)} m: 창 ${String(r.windows).padStart(2)} | ` +
          `방출 ${(r.havM / 1000).toFixed(3)} km (투영합 ${(r.alongSumM / 1000).toFixed(3)} km) | ${m.shv} SHV | 기각 ${fmtRej(m.rejected)}`,
      );
    }
    log('   ★(정찰 당시) 51 m 부터 창이 0이었다 — 1 m 차이로 발행이 전부에서 0으로 떨어졌다.');
    log('   ★(수정 후) 창이 살아남는다. 회랑 확대만으로는 과대발행이 들어오므로 투영 계측을 먼저 넣었다.');
    log('     회귀 방지는 projectedDistance.test.ts 가 맡는다.');
    expect(true).toBe(true);
  });
});

// ── C-3 이스라엘 전 구간 지형 단일화 확인 ───────────────────────────────────

describe('C-3 이스라엘 코스 지형 구성', () => {
  it('C-3-A 전 구간이 OPEN(50 m) 하나인지 확인', () => {
    log('\nC-3-A shvil-israel 구간 메타');
    for (const seg of SHVIL_ISRAEL.segments) {
      const halfW = seg.corridorHalfWidthM ?? DEFAULT_CORRIDOR_HALF_WIDTH_M[seg.terrain];
      log(
        `   선분 ${seg.fromIdx}~${seg.toIdx} ${seg.terrain} 난이도 ×${(seg.difficultyTenths / 10).toFixed(1)} 회랑 ${halfW} m`,
      );
    }
    log(`   폴리라인 점 ${SHVIL_ISRAEL.polyline.length}개 / 총 ${(lengthM(SHVIL_ISRAEL.polyline) / 1000).toFixed(1)} km`);
    log(`   구간 메타 개수 ${SHVIL_ISRAEL.segments.length}개 — 즉 지형 구분이 ${SHVIL_ISRAEL.segments.length === 1 ? '없다' : '있다'}.`);
    // 위도 구간별 분포 (도시대/사막 대략 경계 확인용, 자동 분할 가능성 평가)
    const lats = SHVIL_ISRAEL.polyline.map((p) => p.lat);
    log(`   위도 범위 ${Math.min(...lats).toFixed(3)} ~ ${Math.max(...lats).toFixed(3)}`);
    expect(SHVIL_ISRAEL.segments.length).toBeGreaterThan(0);
  });

  it('C-3-B segmentMetaAt/corridorHalfWidthAt 실제 반환값 표본', () => {
    const n = SHVIL_ISRAEL.polyline.length;
    for (const idx of [0, Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75), n - 2]) {
      const meta = segmentMetaAt(SHVIL_ISRAEL, idx);
      log(`   선분 ${idx}: terrain=${meta.terrain} 회랑 ${corridorHalfWidthAt(SHVIL_ISRAEL, idx)} m`);
    }
    expect(true).toBe(true);
  });
});
