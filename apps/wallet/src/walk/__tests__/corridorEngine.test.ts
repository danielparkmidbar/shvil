import { describe, expect, it } from 'vitest';
import { PendingWalkLedger, evaluateWalkSample } from '@shvil/shared';
import { CorridorEngine, type GpsFix } from '../corridorEngine';
import { haversineM, type GeoPoint } from '../geo';
import { SAMPLE_ANGELS, SHVIL_ISRAEL_NORTH_SAMPLE } from '../data/shvilIsraelSample';

// 회랑 엔진 단위 테스트는 구간 경계(개활지 ×1.0 / 산악 ×1.5)를 인덱스로 짚어야 하므로
// 배포되지 않는 테스트 픽스처를 쓴다. 실물(SHVIL_ISRAEL)은 5,569점 단일 구간이라
// 구간별 요율 분기를 검증할 수 없다.
const COURSE = SHVIL_ISRAEL_NORTH_SAMPLE;
const T0 = Date.parse('2026-07-01T06:00:00Z');

function newEngine() {
  return new CorridorEngine([COURSE], SAMPLE_ANGELS);
}

/** from→to 직선을 따라 일정 속도로 이동하는 픽스 열 생성. */
function trackFixes(
  from: GeoPoint,
  to: GeoPoint,
  speedMps: number,
  intervalS: number,
  count: number,
  startTs = T0,
): GpsFix[] {
  const total = haversineM(from, to);
  const fixes: GpsFix[] = [];
  for (let i = 0; i < count; i++) {
    const frac = Math.min(1, (speedMps * intervalS * i) / total);
    fixes.push({
      lat: from.lat + (to.lat - from.lat) * frac,
      lon: from.lon + (to.lon - from.lon) * frac,
      timestamp: startTs + i * intervalS * 1000,
    });
  }
  return fixes;
}

/** 한 창(60초, 7픽스, 보행 속도)을 엔진에 넣고 닫는다. */
function runWindow(engine: CorridorEngine, from: GeoPoint, to: GeoPoint, opts: { speedMps?: number; steps?: number; startTs?: number } = {}) {
  const speed = opts.speedMps ?? 1.3; // 4.7 km/h
  for (const fix of trackFixes(from, to, speed, 10, 7, opts.startTs ?? T0)) engine.addFix(fix);
  engine.addSteps(opts.steps ?? 110);
  return engine.closeWindow();
}

describe('코스 회랑 판정 (지시서 2.2 / 프로토콜 1.5)', () => {
  it('코스 위 보행 → ON_COURSE, 코스 ID·난이도 계수 부여', () => {
    const sample = runWindow(newEngine(), COURSE.polyline[0]!, COURSE.polyline[1]!);
    expect(sample).not.toBeNull();
    expect(sample!.tier).toBe('ON_COURSE');
    expect(sample!.courseId).toBe('shvil-israel-sample');
    expect(sample!.difficultyTenths).toBe(10); // 개활지 구간 ×1.0
    expect(sample!.distanceM).toBeGreaterThan(70);
  });

  it('산악 구간에서는 구간 난이도 계수(×1.5)가 붙는다', () => {
    const sample = runWindow(newEngine(), COURSE.polyline[7]!, COURSE.polyline[8]!);
    expect(sample!.tier).toBe('ON_COURSE');
    expect(sample!.difficultyTenths).toBe(15);
  });

  it('회랑 밖 평행 이동(코스에서 ~400m) → OFF_COURSE', () => {
    // 개활지 회랑 반폭 50m를 훨씬 벗어난 동쪽 평행 경로.
    // 북향(등록 엔젤들에서 멀어지는 방향)으로 걸어 우회 판정과 분리해 검증한다.
    const off = 0.0043; // ≈ 400m 동쪽
    const from = { lat: COURSE.polyline[1]!.lat, lon: COURSE.polyline[1]!.lon + off };
    const to = { lat: COURSE.polyline[0]!.lat, lon: COURSE.polyline[0]!.lon + off };
    const sample = runWindow(newEngine(), from, to);
    expect(sample!.tier).toBe('OFF_COURSE');
  });

  it('생활권 걸음(코스에서 10km 이상) → DAILY_LIFE 미세 요율', () => {
    const from = { lat: 33.10, lon: 35.70 };
    const to = { lat: 33.101, lon: 35.70 };
    const sample = runWindow(newEngine(), from, to);
    expect(sample!.tier).toBe('DAILY_LIFE');
  });

  it('등록 엔젤 포인트로 접근하는 회랑 밖 이동 → ANGEL_DETOUR 잠정', () => {
    const angel = SAMPLE_ANGELS[0]!; // angel-dafna, 코스 동쪽 ~1.5km
    // 코스에서 200m 벗어난 지점에서 엔젤 방향으로 이동
    const start = { lat: 33.2273, lon: 35.6407 };
    const sample = runWindow(newEngine(), start, angel.location);
    expect(sample!.tier).toBe('ANGEL_DETOUR');
    expect(sample!.detourAngelMemberId).toBe('angel-dafna');
  });

  it('순간 GPS 오차 1~2 포인트로는 창을 기각하지 않는다 (이탈률 30% 미만)', () => {
    const engine = newEngine();
    const fixes = trackFixes(COURSE.polyline[0]!, COURSE.polyline[1]!, 1.3, 10, 7);
    // 7개 중 1개(14%)만 회랑 밖으로 튐
    fixes[3] = { ...fixes[3]!, lon: fixes[3]!.lon + 0.002 }; // ~185m 동쪽
    for (const f of fixes) engine.addFix(f);
    engine.addSteps(110);
    const sample = engine.closeWindow();
    expect(sample!.tier).toBe('ON_COURSE');
  });

  it('mock location 감지 시 그 창은 통째로 무효 (카운트 없음)', () => {
    const engine = newEngine();
    const fixes = trackFixes(COURSE.polyline[0]!, COURSE.polyline[1]!, 1.3, 10, 7);
    engine.addFix({ ...fixes[0]!, mocked: true });
    for (const f of fixes.slice(1)) engine.addFix(f);
    engine.addSteps(110);
    expect(engine.closeWindow()).toBeNull();
  });
});

describe('위치 비저장 원칙 (지시서 0-10)', () => {
  it('방출되는 WalkSample에는 좌표 필드가 없다', () => {
    const sample = runWindow(newEngine(), COURSE.polyline[0]!, COURSE.polyline[1]!);
    const json = JSON.stringify(sample);
    expect(json).not.toMatch(/lat|lon|coord/i);
    expect(Object.keys(sample!)).toEqual(
      expect.arrayContaining(['durationS', 'distanceM', 'steps', 'tier', 'timestamp']),
    );
  });

  it('창을 닫으면 좌표 버퍼는 폐기된다 — 엔진 직렬화에도 좌표 없음', () => {
    const engine = newEngine();
    runWindow(engine, COURSE.polyline[0]!, COURSE.polyline[1]!);
    // # private 필드는 JSON에 노출되지 않고, 공개 상태는 파생 지표뿐
    expect(JSON.stringify(engine)).toBe('{}');
    const status = engine.getLiveStatus();
    expect(JSON.stringify(status)).not.toMatch(/"lat"|"lon"/);
  });
});

describe('걷기 필터 연동 — 차량·뛰기 제외 (M1 완료 기준)', () => {
  it('차량 이동(60 km/h)은 원장에서 VEHICLE로 거부된다', () => {
    const engine = newEngine();
    const ledger = new PendingWalkLedger({ memberId: 'm-test' });
    const sample = runWindow(engine, COURSE.polyline[0]!, COURSE.polyline[5]!, { speedMps: 17, steps: 0 });
    expect(sample!.distanceM).toBeGreaterThan(900);
    const verdict = ledger.recordSample(sample!);
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe('VEHICLE');
    expect(ledger.getPending().pendingDshvEstimate).toBe(0);
  });

  it('뛰기(10.8 km/h)는 TOO_FAST로 거부된다', () => {
    const engine = newEngine();
    const sample = runWindow(engine, COURSE.polyline[0]!, COURSE.polyline[2]!, { speedMps: 3, steps: 180 });
    const verdict = evaluateWalkSample(sample!);
    expect(verdict.accepted).toBe(false);
    // 10.8 km/h는 차량 임계(10) 이상이라 VEHICLE, 아니면 TOO_FAST — 둘 다 제외가 핵심
    expect(['TOO_FAST', 'VEHICLE']).toContain(verdict.reason);
  });

  it('정상 보행 창은 원장에 잠정 누적된다 (코스 위 → 기준 요율)', () => {
    const engine = newEngine();
    const ledger = new PendingWalkLedger({ memberId: 'm-test' });
    let ts = T0;
    // 코스 첫 선분을 따라 12창 (~1km)
    for (let w = 0; w < 12; w++) {
      const frac = w / 12;
      const from = {
        lat: COURSE.polyline[0]!.lat + (COURSE.polyline[1]!.lat - COURSE.polyline[0]!.lat) * frac,
        lon: COURSE.polyline[0]!.lon + (COURSE.polyline[1]!.lon - COURSE.polyline[0]!.lon) * frac,
      };
      const sample = runWindow(engine, from, COURSE.polyline[1]!, { startTs: ts });
      ts += 70_000;
      const verdict = ledger.recordSample(sample!);
      expect(verdict.accepted).toBe(true);
    }
    const pending = ledger.getPending();
    expect(pending.distanceM).toBeGreaterThan(850);
    expect(pending.pendingDshvEstimate).toBeGreaterThanOrEqual(8); // ≈ 0.9 SHV
  });
});
