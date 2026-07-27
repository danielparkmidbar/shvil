/**
 * ★GPS 품질 개정 (2026-07-27) — 재현 → 수정 → 회귀 방지.
 *
 * 【재현됐던 결함 두 가지】
 *  ① 창 거리를 픽스 사이 haversine 합으로 재서, 오차가 **절댓값으로 누적**됐다.
 *     같은 노이즈가 먼저 발행을 부풀리고(도시 다중경로 +30~36%), 더 나빠지면 부푼 거리가
 *     보폭 검사를 터뜨려 **정직한 사람의 창을 통째로 기각**시켰다(협곡 σ15에서 −65%).
 *  ② accuracy > 50 m 픽스를 통째로 버려서, 51 m 하나 차이로 하루가 0이 됐다.
 *
 * 【수정】회랑 안 창은 폴리라인 위 진행량(투영)으로 재고, 정확도가 나쁜 픽스는 버리는
 * 대신 회랑을 그만큼(상한 100 m) 넓혀서 다룬다. ①이 먼저 있어야 ②가 안전하다 —
 * 투영은 계측을 정확도와 분리시키므로 회랑을 넓혀도 발행이 흔들리지 않는다.
 *
 * 【남는 위험】투영은 회랑 **안**에서만 쓸 수 있다. 회랑 밖 창(OFF_COURSE·DAILY_LIFE)은
 * 잴 기준선이 없어 예전 그대로 haversine 합이며, 거기서는 부풀림이 그대로 남는다.
 * 아래 마지막 describe가 그 크기를 실제로 잰다 — 숨기지 않는다(제3조).
 */
import { describe, expect, it } from 'vitest';
import { PendingWalkLedger, type CourseData, type WalkSample } from '@shvil/shared';
import { CorridorEngine, DEFAULT_CORRIDOR_PARAMS, type GpsFix } from '../corridorEngine';
import { buildPolylineIndex, haversineM, projectOnPolyline, type GeoPoint } from '../geo';

const LAT0 = 37.3;
const LON0 = 127.1;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);

const north = (m: number, eastM = 0): GeoPoint => ({
  lat: LAT0 + m / M_PER_DEG_LAT,
  lon: LON0 + eastM / M_PER_DEG_LON,
});

/** 정북 직선 코스 (개활지 회랑 50 m). 100 m마다 점 — 단순화 오차 0. */
function straightCourse(lengthM: number): CourseData {
  const polyline: GeoPoint[] = [];
  for (let m = 0; m <= lengthM; m += 100) polyline.push(north(m));
  return {
    courseId: 'test-straight',
    name: 'Straight test course',
    version: 1,
    polyline,
    segments: [{ fromIdx: 0, toIdx: polyline.length - 1, terrain: 'OPEN', difficultyTenths: 10 }],
  };
}

/** 결정적 난수 (LCG) — 실행마다 같은 값이 나온다. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 4_294_967_296;
  };
}

/** 표준정규 (Box-Muller). */
function gauss(r: () => number): number {
  const u = Math.max(1e-9, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

interface WalkOptions {
  /** 노이즈 표준편차 (m). */
  sigmaM?: number;
  /** 노이즈 자기상관 (0=백색, 0.9=다중경로). */
  rho?: number;
  /** 폰이 보고하는 정확도 (m). */
  accuracyM?: number | undefined;
  /** 코스에서 동쪽으로 얼마나 떨어져 걷는가 (m). */
  offsetEastM?: number;
  seed?: number;
}

/**
 * 코스 위(또는 그 동쪽 offsetEastM)를 1.2 m/s로 걸으며 5초마다 픽스를 낸다.
 * 창 60초 = 픽스 12개. 반환: 창 목록·방출 거리·실제 걸은 거리.
 */
function walk(
  courses: CourseData[],
  totalM: number,
  opts: WalkOptions = {},
): { samples: WalkSample[]; emittedM: number; trueM: number; tiers: Record<string, number> } {
  const sigma = opts.sigmaM ?? 0;
  const rho = opts.rho ?? 0;
  const r = rng(opts.seed ?? 42);
  const engine = new CorridorEngine(courses, [], {});
  const speed = 1.2;
  const stepS = 5;
  const perWindow = 12;
  const samples: WalkSample[] = [];
  let emittedM = 0;
  const tiers: Record<string, number> = {};
  let nx = 0;
  let ny = 0;
  let n = 0;
  const fixes = Math.floor(totalM / (speed * stepS));
  for (let i = 0; i < fixes; i++) {
    nx = rho * nx + Math.sqrt(1 - rho * rho) * gauss(r) * sigma;
    ny = rho * ny + Math.sqrt(1 - rho * rho) * gauss(r) * sigma;
    const alongM = i * speed * stepS;
    const p = north(alongM + ny, (opts.offsetEastM ?? 0) + nx);
    const fix: GpsFix = { lat: p.lat, lon: p.lon, timestamp: i * stepS * 1000, accuracy: opts.accuracyM };
    engine.addFix(fix);
    n++;
    if (n % perWindow === 0) {
      engine.addSteps(Math.round((perWindow * stepS * 100) / 60)); // 100 spm
      const s = engine.closeWindow();
      if (s) {
        samples.push(s);
        emittedM += s.distanceM;
        tiers[s.tier] = (tiers[s.tier] ?? 0) + 1;
      }
    }
  }
  return { samples, emittedM, trueM: (fixes - 1) * speed * stepS, tiers };
}

/** 원장을 태워 실제 발행량(SHV)까지 본다 — 계측만이 아니라 돈이 얼마나 나오는지. */
function mint(samples: WalkSample[]): { shv: number; rejected: Record<string, number> } {
  const ledger = new PendingWalkLedger({ memberId: 'gps-test', tzOffsetMinutes: 0 });
  const rejected: Record<string, number> = {};
  for (const s of samples) {
    const v = ledger.recordSample(s);
    if (!v.accepted) rejected[v.reason ?? '?'] = (rejected[v.reason ?? '?'] ?? 0) + 1;
  }
  const draft = ledger.settleManual(Date.now());
  return { shv: (draft?.amountDshv ?? 0) / 10, rejected };
}

const COURSE = straightCourse(3000);

describe('★① 폴리라인 투영 — GPS 흔들림이 발행을 지배하지 않는다', () => {
  it('노이즈가 커져도 인정 거리가 진실 근처에 머문다 (haversine 합이던 시절의 +30~180%가 사라진다)', () => {
    const rows: string[] = [];
    const results: { label: string; err: number; shv: number }[] = [];
    for (const [sigma, rho, label] of [
      [0, 0, '오차 없음'],
      [5, 0.98, 'σ5 개활지'],
      [10, 0.9, 'σ10 도시 다중경로'],
      [15, 0.9, 'σ15 협곡'],
      [25, 0.85, 'σ25 아파트+숲'],
    ] as [number, number, string][]) {
      const w = walk([COURSE], 2400, { sigmaM: sigma, rho });
      const err = w.emittedM / w.trueM - 1;
      const m = mint(w.samples);
      rows.push(
        `   ${label.padEnd(16)} 방출 ${(w.emittedM / 1000).toFixed(3)} km / 실제 ${(w.trueM / 1000).toFixed(3)} km ` +
          `= ${(err * 100 >= 0 ? '+' : '') + (err * 100).toFixed(1)}% | ${m.shv} SHV | 창 ${w.samples.length} ${JSON.stringify(w.tiers)} 기각 ${JSON.stringify(m.rejected)}`,
      );
      results.push({ label, err, shv: m.shv });
    }
    console.log('① 코스 위 걷기 — 노이즈별 인정 거리\n' + rows.join('\n'));
    for (const r of results) {
      // ★부풀림도 깎임도 ±20% 안. 수정 전에는 σ15에서 +67%, σ25에서 +179%였다.
      //   σ25(아파트+숲)에서 남는 오차의 정체는 아래 "남는 위험" describe에서 갈라 본다.
      expect(Math.abs(r.err)).toBeLessThan(0.2);
      // ★부푼 거리가 보폭 검사를 터뜨려 창이 전멸하던 일도 사라진다.
      expect(r.shv).toBeGreaterThan(0);
    }
    // 실제로 GPS가 쓸 만한 대역(σ≤15)에서는 오차가 5% 안이다.
    for (const r of results.slice(0, 4)) expect(Math.abs(r.err)).toBeLessThan(0.05);
  });

  it('회랑 안 창은 계측 방식이 PROJECTED로 표시된다 (화면이 사용자에게 그대로 설명한다)', () => {
    const engine = new CorridorEngine([COURSE], []);
    for (let i = 0; i < 12; i++) {
      const p = north(i * 6);
      engine.addFix({ lat: p.lat, lon: p.lon, timestamp: i * 5000, accuracy: 12 });
    }
    const st = engine.getLiveStatus();
    expect(st.tier).toBe('ON_COURSE');
    expect(st.distanceMeasure).toBe('PROJECTED');
    expect(st.accuracyM).toBe(12);
    expect(st.lastFixAccepted).toBe(true);
    expect(st.corridorSlackM).toBe(0);
    expect(st.windowFixes).toBe(12);
    expect(JSON.stringify(st)).not.toMatch(/"lat"|"lon"/);
  });

  it('자기교차(헤어핀)에서도 사영점이 뛰지 않는다 — 국지 투영', () => {
    // 북으로 1 km 올라갔다가 동쪽 30 m로 되짚어 내려온다. 회랑 50 m 안에 두 다리가
    // 동시에 들어오므로, 전역 투영이면 GPS가 몇 m 튈 때마다 s가 km 단위로 점프한다.
    const up: GeoPoint[] = [];
    for (let m = 0; m <= 1000; m += 50) up.push(north(m));
    const down: GeoPoint[] = [];
    for (let m = 1000; m >= 0; m -= 50) down.push(north(m, 30));
    const hairpin: CourseData = {
      courseId: 'hairpin',
      name: 'Hairpin',
      version: 1,
      polyline: [...up, ...down],
      segments: [{ fromIdx: 0, toIdx: up.length + down.length - 1, terrain: 'OPEN', difficultyTenths: 10 }],
    };
    const w = walk([hairpin], 960, { sigmaM: 12, rho: 0.9, seed: 7 });
    const err = w.emittedM / w.trueM - 1;
    console.log(
      `③ 헤어핀(두 다리 30 m 간격) σ12: 방출 ${w.emittedM} m / 실제 ${w.trueM} m = ${(err * 100).toFixed(1)}%`,
    );
    expect(w.tiers['ON_COURSE']).toBeGreaterThan(0);
    expect(Math.abs(err)).toBeLessThan(0.1); // km 단위 점프가 없다
  });

  it('투영 유틸 자체 — 진행 좌표는 코스 선 위 거리다', () => {
    const idx = buildPolylineIndex(COURSE.polyline);
    const p = north(250, 40); // 코스에서 동쪽 40 m
    const proj = projectOnPolyline(p, idx);
    expect(proj.alongM).toBeCloseTo(250, 0);
    expect(proj.distanceM).toBeCloseTo(40, 0);
    // 힌트를 주면 그 반경 밖은 보지 않는다.
    const local = projectOnPolyline(p, idx, { alongM: 1500, radiusM: 100 });
    expect(local.alongM).toBeGreaterThan(1300);
  });
});

describe('★② 정확도 절벽 제거 — 1 m 차이로 하루가 사라지지 않는다', () => {
  it('정확도 45~200 m에서 창이 살아남고 인정 거리가 정확도와 무관하다', () => {
    const rows: string[] = [];
    for (const acc of [45, 50, 51, 65, 90, 150, 199]) {
      const w = walk([COURSE], 2400, { sigmaM: 10, rho: 0.9, accuracyM: acc });
      const m = mint(w.samples);
      rows.push(
        `   accuracy ${String(acc).padStart(3)} m: 창 ${w.samples.length} | 방출 ${(w.emittedM / 1000).toFixed(3)} km | ${m.shv} SHV | 회랑 여유 ${Math.min(Math.max(0, acc - 50), 100)} m`,
      );
      expect(w.samples.length).toBeGreaterThan(0);
      expect(Math.abs(w.emittedM / w.trueM - 1)).toBeLessThan(0.08);
      expect(m.shv).toBeGreaterThan(0);
    }
    console.log('② 정확도별 — 예전에는 51 m부터 전부 0이었다\n' + rows.join('\n'));
  });

  it('폐기 임계(200 m)를 넘는 픽스는 여전히 버린다 — 아무것도 말해 주지 않는 위치다', () => {
    const w = walk([COURSE], 2400, { sigmaM: 10, rho: 0.9, accuracyM: 250 });
    expect(w.samples.length).toBe(0);
    expect(DEFAULT_CORRIDOR_PARAMS.hardMaxAccuracyM).toBe(200);
    console.log(`   accuracy 250 m: 창 ${w.samples.length} — 폐기 임계 ${DEFAULT_CORRIDOR_PARAMS.hardMaxAccuracyM} m 초과`);
  });

  it('회랑 확대에는 상한이 있다 — 코인이 나는 땅을 정확도 필드가 무한히 넓히지 못한다', () => {
    expect(DEFAULT_CORRIDOR_PARAMS.maxAccuracySlackM).toBe(100);
    // 코스에서 200 m 떨어져 걷는 사람은 정확도를 아무리 나쁘게 신고해도 회랑 안이 아니다.
    const w = walk([COURSE], 1200, { offsetEastM: 200, accuracyM: 190 });
    expect(w.tiers['ON_COURSE'] ?? 0).toBe(0);
    console.log(`   코스 200 m 밖 + accuracy 190 m: tiers ${JSON.stringify(w.tiers)} (회랑 50+100=150 m가 상한)`);
  });

  it('버려진 픽스는 화면 상태에 그대로 드러난다', () => {
    const engine = new CorridorEngine([COURSE], []);
    const p = north(0);
    engine.addFix({ lat: p.lat, lon: p.lon, timestamp: 0, accuracy: 500 });
    const st = engine.getLiveStatus();
    expect(st.lastFixAccepted).toBe(false);
    expect(st.droppedFixes).toBe(1);
    expect(st.accuracyM).toBe(500);
  });
});

describe('★남는 위험 — 정직하게 잰다 (제3조)', () => {
  it('회랑 밖 창은 여전히 직선 합이라 부풀림이 남는다 (다만 요율이 1/1000이다)', () => {
    const on = walk([COURSE], 2400, { sigmaM: 25, rho: 0.85 });
    const off = walk([COURSE], 2400, { sigmaM: 25, rho: 0.85, offsetEastM: 800 });
    const onErr = on.emittedM / on.trueM - 1;
    const offErr = off.emittedM / off.trueM - 1;
    console.log(
      `④ 같은 σ25 노이즈, 회랑 안 vs 밖\n` +
        `   회랑 안: ${(onErr * 100).toFixed(1)}% → ${mint(on.samples).shv} SHV  ${JSON.stringify(on.tiers)}\n` +
        `   회랑 밖: ${(offErr * 100).toFixed(1)}% → ${mint(off.samples).shv} SHV  ${JSON.stringify(off.tiers)}\n` +
        `   ★회랑 안 창(투영)과 회랑 밖 창(직선 합)이 한 걷기에 섞이면 섞인 만큼 오차가 남는다.`,
    );
    // ★부풀림이 회랑 밖에 남아 있다는 것을 못박아 둔다. 사라졌다고 말하지 않는다.
    expect(offErr).toBeGreaterThan(onErr);
    expect(offErr).toBeGreaterThan(1.0);
  });

  it('★서서 흔들리는 것만으로는 여전히 발행되지 않는다 — 최종 방어선은 걸음 교차검증이다', () => {
    // 투영 합은 |Δs|의 합이므로 제자리에서도 노이즈가 쌓인다. 그 값을 그대로 재고,
    // 원장(보폭·케이던스·휴식 임계)이 실제로 막는지 확인한다.
    const engine = new CorridorEngine([COURSE], []);
    const r = rng(99);
    const samples: WalkSample[] = [];
    let nx = 0;
    let ny = 0;
    let accumulated = 0;
    for (let i = 0; i < 12 * 60; i++) {
      nx = 0.85 * nx + Math.sqrt(1 - 0.85 ** 2) * gauss(r) * 25;
      ny = 0.85 * ny + Math.sqrt(1 - 0.85 ** 2) * gauss(r) * 25;
      const p = north(500 + ny, nx);
      engine.addFix({ lat: p.lat, lon: p.lon, timestamp: i * 5000, accuracy: 30 });
      if ((i + 1) % 12 === 0) {
        engine.addSteps(4); // 제자리 — 만보기는 거의 안 센다
        const s = engine.closeWindow();
        if (s) {
          samples.push(s);
          accumulated += s.distanceM;
        }
      }
    }
    const m = mint(samples);
    console.log(
      `⑤ 60분 제자리 흔들림(σ25): 투영 합 ${accumulated} m 가 쌓이지만 발행 ${m.shv} SHV — 기각 ${JSON.stringify(m.rejected)}`,
    );
    expect(m.shv).toBe(0);
  });

  it('투영은 배포 폴리라인의 길이만 인정한다 — 실제 트레일보다 짧으면 그만큼 덜 받는다', () => {
    // 배포선이 20 m 간격으로 단순화되면 곡선 구간의 길이가 줄어든다. 그 감액이
    // 얼마인지 직접 잰다(이스라엘 전 구간 실측은 -2.35%).
    const zigzag: GeoPoint[] = [];
    for (let m = 0; m <= 1000; m += 20) zigzag.push(north(m, m % 40 === 0 ? 0 : 15));
    const simplified: GeoPoint[] = [north(0), north(1000)];
    const realLen = zigzag.reduce((s, p, i) => (i === 0 ? 0 : s + haversineM(zigzag[i - 1]!, p)), 0);
    const deployedLen = haversineM(simplified[0]!, simplified[1]!);
    const loss = 1 - deployedLen / realLen;
    console.log(`⑥ 단순화 손실: 실제 경로 ${realLen.toFixed(0)} m → 배포선 ${deployedLen.toFixed(0)} m = -${(loss * 100).toFixed(1)}%`);
    expect(loss).toBeGreaterThan(0);
  });
});
