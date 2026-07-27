/**
 * 적대검증 1 (계측 쪽) — **나쁜 GPS의 날과, 그 관대함을 노리는 공격.**
 *
 * 2026-07-27 개정으로 두 가지가 바뀌었다.
 *  ① 회랑 안 창의 거리를 폴리라인 위 **순이동**으로 잰다.
 *  ② accuracy 50 m 초과 픽스를 버리는 대신 그만큼 **회랑을 넓힌다** (여유 상한 100 m).
 *
 * 여기서 묻는 것은 셋이다.
 *  ⑤ 정직한 사람: 나쁜 GPS의 날(50~80 m)에 코인이 쌓이는가, 0이 되는가.
 *  ⑧ 순이동 계측에서 **회랑 안 제자리 왕복이 거리로 누적되는가** — 새 발행 누수인가.
 *  ⑨ 회랑이 넓어져 스푸핑이 쉬워졌는가 — **accuracy는 공격자가 적는 숫자다.**
 *
 * 판정·요율·필터는 전부 운영 코드(CorridorEngine·PendingWalkLedger)를 그대로 부른다.
 */
import { describe, expect, it } from 'vitest';
import { BUNDANG_BULGOKSAN_SAMPLE, PendingWalkLedger, SHVIL_ISRAEL, type WalkSample } from '@shvil/shared';
import { CorridorEngine, DEFAULT_CORRIDOR_PARAMS, type GpsFix } from '../corridorEngine';
import { haversineM, type GeoPoint } from '../geo';
import { mulberry32, resample } from './simHarness';

const T0 = Date.parse('2026-08-01T06:00:00Z');
const INTERVAL_S = 5;
const FIXES_PER_WINDOW = 12;
const SPEED_MPS = 1.0;

interface RunOptions {
  /** 코스로부터의 횡방향 고정 이동 (m). 양수 = 좌측. */
  lateralM?: number;
  /** AR(1) GPS 흔들림 표준편차 (m). */
  sigmaM?: number;
  rho?: number;
  /** 픽스가 신고하는 정확도 (m) — ★공격자가 마음대로 적을 수 있는 숫자다. */
  accuracyM?: number;
  seed?: number;
  /** 창당 걸음 수 강제 (미지정 시 실제 이동 거리에서 보폭 0.75 m로 환산). */
  stepsPerWindow?: number;
  memberId?: string;
}

interface RunResult {
  samples: WalkSample[];
  onCourse: number;
  emittedM: number;
  trueM: number;
  /** 정산 금액 (dSHV). */
  dshv: number;
  rejected: number;
}

/** 경로를 따라 걷고 창을 닫아 원장까지 넣는다 — 재구현한 판정은 하나도 없다. */
function walk(courses: typeof SHVIL_ISRAEL[], path: GeoPoint[], opt: RunOptions = {}): RunResult {
  const engine = new CorridorEngine(courses, []);
  const ledger = new PendingWalkLedger({ memberId: opt.memberId ?? 'SHV-2026-000001' });
  const pts = resample(path, SPEED_MPS * INTERVAL_S);
  const rnd = mulberry32(opt.seed ?? 4242);
  const gauss = () => {
    const u = Math.max(1e-9, rnd());
    const v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const rho = opt.rho ?? 0.9;
  let drift = 0;
  const samples: WalkSample[] = [];
  let inWindow = 0;
  let emittedM = 0;
  let trueM = 0;
  let rejected = 0;
  for (let i = 0; i < pts.points.length; i += 1) {
    const base = pts.points[i]!;
    const pv = pts.perp[i]!;
    let off = opt.lateralM ?? 0;
    if (opt.sigmaM) {
      drift = rho * drift + Math.sqrt(1 - rho * rho) * gauss() * opt.sigmaM;
      off += drift;
    }
    const fix: GpsFix = {
      lat: base.lat + pv.dLat * off,
      lon: base.lon + pv.dLon * off,
      timestamp: T0 + i * INTERVAL_S * 1000,
      accuracy: opt.accuracyM ?? 12,
    };
    engine.addFix(fix);
    inWindow += 1;
    if (i > 0) trueM += haversineM(pts.points[i - 1]!, base);
    if (inWindow === FIXES_PER_WINDOW) {
      engine.addSteps(opt.stepsPerWindow ?? Math.round((FIXES_PER_WINDOW * SPEED_MPS * INTERVAL_S) / 0.75));
      const s = engine.closeWindow();
      if (s) {
        samples.push(s);
        emittedM += s.distanceM;
        const v = ledger.recordSample(s);
        if (!v.accepted) rejected += 1;
      }
      inWindow = 0;
    }
  }
  const draft = ledger.settleManual(T0 + pts.points.length * INTERVAL_S * 1000 + 1000);
  return {
    samples,
    onCourse: samples.filter((s) => s.tier === 'ON_COURSE').length,
    emittedM,
    trueM,
    dshv: draft ? draft.amountDshv : 0,
    rejected,
  };
}

/** 이스라엘 코스 앞부분에서 길이 targetM 정도의 구간을 잘라 낸다 (OPEN 회랑 50 m). */
function israelSlice(targetM: number, fromIdx = 0): GeoPoint[] {
  const out: GeoPoint[] = [SHVIL_ISRAEL.polyline[fromIdx]!];
  let acc = 0;
  for (let i = fromIdx + 1; i < SHVIL_ISRAEL.polyline.length && acc < targetM; i += 1) {
    acc += haversineM(SHVIL_ISRAEL.polyline[i - 1]!, SHVIL_ISRAEL.polyline[i]!);
    out.push(SHVIL_ISRAEL.polyline[i]!);
  }
  return out;
}

/** 이 구간이 정말 OPEN(회랑 50 m)인지 — 시험의 전제를 시험이 확인한다. */
function terrainOf(fromIdx: number): string {
  const seg = SHVIL_ISRAEL.segments.find((s) => fromIdx >= s.fromIdx && fromIdx < s.toIdx);
  return seg ? `${seg.terrain}/${seg.corridorHalfWidthM ?? '기본'}` : '없음';
}

// ══════════════════════════════════════════════════════════════════════
describe('⑤ 정직한 사람 — GPS가 나쁜 날 걷는다', () => {
  const path = israelSlice(2_400);

  it('정확도 12~199 m에서 코인이 쌓이는가 (예전에는 51 m부터 0이었다)', () => {
    console.log(`\n[⑤] 이스라엘 코스 2.4 km 구간 (지형 ${terrainOf(0)})`);
    const rows: string[] = [];
    const results: { acc: number; dshv: number; on: number }[] = [];
    for (const acc of [12, 45, 50, 51, 60, 80, 120, 199, 201, 250]) {
      const r = walk([SHVIL_ISRAEL], path, { accuracyM: acc });
      results.push({ acc, dshv: r.dshv, on: r.onCourse });
      rows.push(
        `     accuracy ${String(acc).padStart(3)} m → 창 ${String(r.samples.length).padStart(2)} (ON_COURSE ${r.onCourse}) · ` +
          `방출 ${(r.emittedM / 1000).toFixed(3)} km · ${(r.dshv / 10).toFixed(1)} SHV`,
      );
    }
    for (const line of rows) console.log(line);
    // 폐기 임계(200 m) 이하에서는 하나도 0이 되지 않아야 한다.
    for (const r of results.filter((x) => x.acc <= 199)) {
      expect(r.dshv, `accuracy ${r.acc} m 에서 0 SHV가 됐다`).toBeGreaterThan(0);
    }
    // 폐기 임계 초과는 여전히 버린다.
    for (const r of results.filter((x) => x.acc > 200)) {
      expect(r.dshv, `accuracy ${r.acc} m 가 여전히 발행됐다`).toBe(0);
    }
  });

  it('★나쁜 정확도 + 실제 흔들림이 함께 있는 날 (숲·협곡의 진짜 모습)', () => {
    console.log('\n[⑤] 정확도와 흔들림이 같이 나쁜 날 — 실측 그대로');
    const rows: { label: string; sigma: number; acc: number }[] = [
      { label: '개활지', sigma: 5, acc: 20 },
      { label: '도시 다중경로', sigma: 10, acc: 40 },
      { label: '협곡', sigma: 15, acc: 60 },
      { label: '숲 하부', sigma: 20, acc: 80 },
      { label: '아파트+숲', sigma: 25, acc: 100 },
    ];
    for (const row of rows) {
      const r = walk([SHVIL_ISRAEL], path, { sigmaM: row.sigma, accuracyM: row.acc });
      const err = (100 * (r.emittedM - r.trueM)) / Math.max(1, r.trueM);
      console.log(
        `     ${row.label} (σ${row.sigma}·acc ${row.acc}) → ON_COURSE ${r.onCourse}/${r.samples.length} · ` +
          `실제 ${(r.trueM / 1000).toFixed(3)} km → 방출 ${(r.emittedM / 1000).toFixed(3)} km (${err >= 0 ? '+' : ''}${err.toFixed(1)}%) · ` +
          `${(r.dshv / 10).toFixed(1)} SHV · 창 기각 ${r.rejected}`,
      );
      expect(r.dshv, `${row.label}에서 0 SHV가 됐다`).toBeGreaterThan(0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
describe('⑤-b 다니엘 쌤의 실기기 시험 — 불곡산 왕복', () => {
  const up = BUNDANG_BULGOKSAN_SAMPLE.polyline as GeoPoint[];
  const down = [...up].reverse();
  const roundTrip = [...up, ...down.slice(1)];

  it('★올라갔다 내려오면 내려온 몫도 인정되는가 (순이동 계측의 첫 관문)', () => {
    const oneWay = walk([BUNDANG_BULGOKSAN_SAMPLE], up);
    const both = walk([BUNDANG_BULGOKSAN_SAMPLE], roundTrip);
    console.log(
      `\n[⑤-b] 불곡산 편도: 실제 ${(oneWay.trueM / 1000).toFixed(3)} km → 방출 ${(oneWay.emittedM / 1000).toFixed(3)} km · ` +
        `${(oneWay.dshv / 10).toFixed(1)} SHV (창 ${oneWay.samples.length})\n` +
        `[⑤-b] 불곡산 왕복: 실제 ${(both.trueM / 1000).toFixed(3)} km → 방출 ${(both.emittedM / 1000).toFixed(3)} km · ` +
        `${(both.dshv / 10).toFixed(1)} SHV (창 ${both.samples.length})\n` +
        `      왕복/편도 = ${(both.dshv / Math.max(1, oneWay.dshv)).toFixed(2)}배 ` +
        `(하산이 통째로 버려지면 1.0배가 된다)`,
    );
    // 하산이 인정되지 않으면 이 값이 1.0 부근이 된다.
    expect(both.dshv / oneWay.dshv).toBeGreaterThan(1.8);
  });

  it('되돌아서는 창 하나에서 얼마를 잃는가 (순이동의 대가)', () => {
    const both = walk([BUNDANG_BULGOKSAN_SAMPLE], roundTrip);
    const loss = both.trueM - both.emittedM;
    console.log(
      `[⑤-b] 왕복 손실 ${loss.toFixed(0)} m (${((100 * loss) / both.trueM).toFixed(2)}%) — ` +
        `정상에서 되돌아서는 창 하나가 순이동으로 상쇄된다`,
    );
    // 손실이 창 하나(≈60 m)를 크게 넘으면 반환점 처리가 잘못된 것이다.
    expect(loss).toBeLessThan(120);
  });

  it('실기기 시험 하루로 샤워(3 SHV)를 낼 수 있는가', () => {
    const both = walk([BUNDANG_BULGOKSAN_SAMPLE], roundTrip);
    console.log(
      `[⑤-b] 왕복 1회 = ${(both.dshv / 10).toFixed(1)} SHV / 권장가 샤워 3.0 · 식사 5.0 · 잠자리 10.0 SHV`,
    );
    expect(both.dshv).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════
describe('⑧ 공격 — 회랑 안에서 제자리 왕복하면 거리가 누적되는가', () => {
  /** 코스 위 stretchM 구간을 왕복하는 경로를 만든다 (실제로 걷는다 — 걸음도 진짜). */
  function pacingPath(stretchM: number, laps: number): GeoPoint[] {
    const seg = israelSlice(stretchM);
    const out: GeoPoint[] = [];
    for (let l = 0; l < laps; l += 1) {
      const leg = l % 2 === 0 ? seg : [...seg].reverse();
      out.push(...(l === 0 ? leg : leg.slice(1)));
    }
    return out;
  }

  it('★왕복은 직선 합보다 적게 인정된다 — 순이동 계측이 왕복을 깎는다', () => {
    console.log('\n[⑧] 회랑 안 왕복 (실제로 걷는다 — 걸음도 진짜)');
    const rows: { stretch: number; laps: number }[] = [
      { stretch: 30, laps: 40 },
      { stretch: 60, laps: 20 },
      { stretch: 120, laps: 10 },
      { stretch: 600, laps: 2 },
    ];
    for (const row of rows) {
      const path = pacingPath(row.stretch, row.laps);
      const r = walk([SHVIL_ISRAEL], path);
      const ratio = r.emittedM / Math.max(1, r.trueM);
      console.log(
        `     ${row.stretch} m 구간 × ${row.laps}회 왕복 · 실제 ${(r.trueM / 1000).toFixed(3)} km → ` +
          `방출 ${(r.emittedM / 1000).toFixed(3)} km (${(100 * ratio).toFixed(1)}%) · ${(r.dshv / 10).toFixed(1)} SHV`,
      );
      // 새 발행 누수라면 방출이 실제 이동을 **넘어야** 한다.
      expect(r.emittedM, `${row.stretch} m 왕복이 실제 이동보다 많이 발행됐다`).toBeLessThanOrEqual(r.trueM * 1.02);
    }
  });

  it('★제자리 흔들림(걷지 않는다)은 발행되지 않는다', () => {
    // 한 점에 서서 GPS만 흔들린다. 걸음은 0.
    const spot = SHVIL_ISRAEL.polyline[0]!;
    const still: GeoPoint[] = Array.from({ length: 720 }, () => ({ ...spot }));
    for (const sigma of [10, 25]) {
      const engine = new CorridorEngine([SHVIL_ISRAEL], []);
      const ledger = new PendingWalkLedger({ memberId: 'SHV-2026-000001' });
      const rnd = mulberry32(77);
      const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
      let drift = 0;
      let projected = 0;
      let inWindow = 0;
      for (let i = 0; i < still.length; i += 1) {
        drift = 0.9 * drift + Math.sqrt(1 - 0.81) * gauss() * sigma;
        const dLat = drift / 111_320;
        engine.addFix({ lat: spot.lat + dLat, lon: spot.lon, timestamp: T0 + i * INTERVAL_S * 1000, accuracy: 25 });
        inWindow += 1;
        if (inWindow === FIXES_PER_WINDOW) {
          engine.addSteps(0); // 걷지 않았다
          const s = engine.closeWindow();
          if (s) {
            projected += s.distanceM;
            ledger.recordSample(s);
          }
          inWindow = 0;
        }
      }
      const draft = ledger.settleManual(T0 + still.length * INTERVAL_S * 1000 + 1000);
      console.log(
        `\n[⑧] 60분 제자리 흔들림 σ${sigma} → 창이 잰 거리 ${projected} m · 발행 ${(draft ? draft.amountDshv : 0) / 10} SHV`,
      );
      expect(draft?.amountDshv ?? 0).toBe(0);
    }
  });

  it('★걸음까지 위조하면(흔들이 기계) 어떻게 되는가', () => {
    // 서 있으면서 만보기 걸음만 진짜처럼 만들어 준다 — 보폭 검사를 통과시키려는 시도.
    const spot = SHVIL_ISRAEL.polyline[0]!;
    for (const sigma of [10, 25, 50]) {
      const engine = new CorridorEngine([SHVIL_ISRAEL], []);
      const ledger = new PendingWalkLedger({ memberId: 'SHV-2026-000001' });
      const rnd = mulberry32(99);
      const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
      let drift = 0;
      let inWindow = 0;
      let measured = 0;
      const windowDist: number[] = [];
      for (let i = 0; i < 720; i += 1) {
        drift = 0.9 * drift + Math.sqrt(1 - 0.81) * gauss() * sigma;
        engine.addFix({
          lat: spot.lat + drift / 111_320,
          lon: spot.lon,
          timestamp: T0 + i * INTERVAL_S * 1000,
          accuracy: 25,
        });
        inWindow += 1;
        if (inWindow === FIXES_PER_WINDOW) {
          // 창 거리를 모르는 채로 "정상 케이던스"를 흉내 낸다 (60초 × 2 spm ≈ 120걸음).
          engine.addSteps(120);
          const s = engine.closeWindow();
          if (s) {
            measured += s.distanceM;
            windowDist.push(s.distanceM);
            ledger.recordSample(s);
          }
          inWindow = 0;
        }
      }
      const draft = ledger.settleManual(T0 + 720 * INTERVAL_S * 1000 + 1000);
      const med = windowDist.slice().sort((a, b) => a - b)[Math.floor(windowDist.length / 2)] ?? 0;
      console.log(
        `[⑧] 제자리 + 걸음 위조 σ${sigma} → 창 거리 중앙 ${med} m · 합 ${measured} m · 발행 ${(draft?.amountDshv ?? 0) / 10} SHV`,
      );
    }
    // 값을 못박지 않는다 — 이 시험의 목적은 실제 수치를 보고서에 남기는 것이다.
    expect(true).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
describe('⑨ 공격 — 정확도 완화로 스푸핑이 쉬워졌는가', () => {
  const path = israelSlice(2_400);

  it('★accuracy 숫자만 크게 적으면 회랑 밖을 걸어도 인정된다', () => {
    console.log(`\n[⑨] 코스에서 횡으로 벗어나 걷기 (지형 ${terrainOf(0)} — 회랑 반폭 50 m)`);
    console.log('     accuracy는 폰이 주는 값이며, 앱은 그 값을 검증할 방법이 없다.');
    const rows: string[] = [];
    const table: { lat: number; acc: number; on: number; dshv: number }[] = [];
    for (const lateral of [40, 80, 120, 145, 160]) {
      for (const acc of [12, 160]) {
        const r = walk([SHVIL_ISRAEL], path, { lateralM: lateral, accuracyM: acc });
        table.push({ lat: lateral, acc, on: r.onCourse, dshv: r.dshv });
        rows.push(
          `     횡 ${String(lateral).padStart(3)} m · accuracy ${String(acc).padStart(3)} m → ` +
            `ON_COURSE ${String(r.onCourse).padStart(2)}/${r.samples.length} · ${(r.dshv / 10).toFixed(1)} SHV`,
        );
      }
    }
    for (const line of rows) console.log(line);

    // 정직한 정확도(12 m)로는 회랑 50 m 밖에서 코인이 나지 않는다.
    // (창 42개 중 1개가 살아남는 것은 폴리라인이 굽은 자리에서 반대편 선분에 붙기
    //  때문이며, 발행은 0 SHV다 — 그 사실까지 함께 못박는다.)
    const honest80 = table.find((t) => t.lat === 80 && t.acc === 12)!;
    expect(honest80.on).toBeLessThanOrEqual(1);
    expect(honest80.dshv).toBe(0);
    // ★그런데 accuracy 160 이라고 적기만 하면 같은 자리가 ON_COURSE가 된다.
    const spoof80 = table.find((t) => t.lat === 80 && t.acc === 160)!;
    expect(spoof80.on).toBeGreaterThan(0);
    // 상한은 지켜진다 — 50 + 100 = 150 m를 넘는 자리는 발행이 나지 않는다.
    // (창 몇 개는 굽은 자리에서 살아남지만 이탈률 문턱을 넘어 금액이 0이다.)
    const spoof160 = table.find((t) => t.lat === 160 && t.acc === 160)!;
    expect(spoof160.dshv).toBe(0);
  });

  it('넓어진 넓이를 숫자로 못박는다 (코인이 나는 땅의 크기)', () => {
    const open = 50;
    const slack = DEFAULT_CORRIDOR_PARAMS.maxAccuracySlackM;
    const urban = 150;
    console.log(
      `\n[⑨] 회랑 반폭: OPEN ${open} m → 최대 ${open + slack} m (${((open + slack) / open).toFixed(1)}배) · ` +
        `URBAN ${urban} m → 최대 ${urban + slack} m (${((urban + slack) / urban).toFixed(1)}배)`,
    );
    expect(slack).toBe(100);
  });

  it('불곡산(URBAN 150 / MOUNTAIN 120)에서는 얼마나 벌어지는가', () => {
    const path = BUNDANG_BULGOKSAN_SAMPLE.polyline.slice(0, 20);
    const rows: string[] = [];
    for (const lateral of [100, 200, 240, 260]) {
      for (const acc of [12, 160]) {
        const r = walk([BUNDANG_BULGOKSAN_SAMPLE], path, { lateralM: lateral, accuracyM: acc });
        rows.push(
          `     횡 ${String(lateral).padStart(3)} m · accuracy ${String(acc).padStart(3)} m → ` +
            `ON_COURSE ${r.onCourse}/${r.samples.length} · ${(r.dshv / 10).toFixed(1)} SHV`,
        );
      }
    }
    console.log('\n[⑨] 불곡산 도심 구간 (URBAN 150 m)');
    for (const line of rows) console.log(line);
    expect(rows).toHaveLength(8);
  });

  it('mock location 플래그는 여전히 창을 통째로 죽인다', () => {
    const engine = new CorridorEngine([SHVIL_ISRAEL], []);
    const pts = resample(path, SPEED_MPS * INTERVAL_S);
    for (let i = 0; i < FIXES_PER_WINDOW; i += 1) {
      const p = pts.points[i]!;
      engine.addFix({ lat: p.lat, lon: p.lon, timestamp: T0 + i * 5000, accuracy: 12, mocked: i === 3 });
    }
    engine.addSteps(80);
    expect(engine.closeWindow()).toBeNull();
  });
});
