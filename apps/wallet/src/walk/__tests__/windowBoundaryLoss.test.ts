/**
 * 창 경계 거리 누락 — 재현 → 수정 → 회귀 방지 (2026-07-27).
 *
 * 【재현됐던 결함】closeWindow()는 **그 창 안의 픽스들 사이** 거리만 합산하고 좌표
 * 버퍼를 비웠다. 그래서 "직전 창의 마지막 픽스 → 다음 창의 첫 픽스" 구간은 어느
 * 창에서도 합산되지 않았다. walkService 설정(픽스 5초·창 60초)에서 창당 1회 =
 * 5/60 = **8.33%**. 픽스 간격은 `distanceInterval: 5`(5m) 때문에 느린 사람일수록
 * 벌어지므로 2.5 km/h 순례자는 12.7%를 잃었다. 1,055 km 완주 기준 90~140 SHV다.
 * 실제로 걸은 거리이므로 이것은 정량적 인정의 누락이다(헌법 제6조).
 *
 * 【수정】창이 닫힐 때 마지막 좌표 한 점을 남겨(#carryFix) 다음 픽스가 오면 거리로
 * 환산하고 좌표는 즉시 버린다. 이월분은 **그 창의 평균 속도 × 경계 시간**을 넘지
 * 못한다 — 그래서 이월이 창의 평균 속도를 절대 올리지 않는다(멀쩡한 창이
 * TOO_FAST/VEHICLE로 뒤집히지 않고, 걷지 않은 거리가 새로 생기지도 않는다).
 *
 * 이 파일은 그 불변식을 못박는다.
 */
import { describe, expect, it } from 'vitest';
import { evaluateWalkSample } from '@shvil/shared';
import { CorridorEngine, DEFAULT_CORRIDOR_PARAMS } from '../corridorEngine';
import { haversineM } from '../geo';

/** 정북으로 직진. 위도 1도 = 111,320 m 근사. */
function north(startLat: number, meters: number): { lat: number; lon: number } {
  return { lat: startLat + meters / 111_320, lon: 35.0 };
}

const LAT0 = 31.0;

/** 픽스 간격·창 픽스 수를 주고 연속 보행(1 m/s)을 재생한다. */
function walkStraight(intervalS: number, fixesPerWindow: number, windows: number) {
  const engine = new CorridorEngine([], []);
  let emitted = 0;
  let n = 0;
  for (let w = 0; w < windows; w++) {
    for (let k = 0; k < fixesPerWindow; k++) {
      engine.addFix({
        ...north(LAT0, n * intervalS),
        timestamp: Math.round(n * intervalS * 1000),
        accuracy: 10,
      });
      n++;
    }
    engine.addSteps(Math.round((fixesPerWindow * intervalS * 80) / 60));
    emitted += engine.closeWindow()?.distanceM ?? 0;
  }
  const walked = haversineM(north(LAT0, 0), north(LAT0, (n - 1) * intervalS));
  return { emitted, walked, loss: 1 - emitted / walked };
}

describe('창 경계 거리 누락 (수정 후) — 걸은 거리가 전부 인정된다', () => {
  it('★픽스 5초·창 60초에서 누락이 사라졌다 (수정 전 8.33%)', () => {
    const { emitted, walked, loss } = walkStraight(5, 12, 10);
    // 첫 창은 이월할 직전 창이 없으므로 자기 구간(11개)만 낸다 — 그것이 진실이다.
    // 그 뒤 9창은 경계 구간까지 합산한다: 55 + 9×60 = 595 m.
    expect(emitted).toBe(595);
    expect(walked).toBeCloseTo(594.3, 0);
    expect(Math.abs(loss)).toBeLessThan(0.005);
    // 수정 전에는 창마다 55 m 만 냈다 (10창 = 550 m).
    expect(emitted).toBeGreaterThan(10 * 55);
  });

  it('★느린 하이커도 손해 보지 않는다 — 픽스 간격이 벌어져도 누락이 남지 않는다', () => {
    for (const [intervalS, fixes] of [
      [1, 60],
      [5, 12],
      [6, 10],
      [7.2, 8], // 2.5 km/h — 무거운 배낭의 순례 속도 (distanceInterval 5m 기준)
      [10, 6],
    ] as [number, number][]) {
      const { loss, emitted, walked } = walkStraight(intervalS, fixes, 20);
      // 수정 전 누락은 정확히 1/fixes 였다 (10초 간격이면 16.7%).
      const before = 1 / fixes;
      console.log(
        `   픽스 ${intervalS}초 · 창 ${fixes}픽스 → 누락 ${(loss * 100).toFixed(2)}% ` +
          `(수정 전 ${(before * 100).toFixed(2)}%) 방출 ${emitted}m / 걸음 ${walked.toFixed(0)}m`,
      );
      expect(loss).toBeLessThan(before / 4);
      expect(loss).toBeLessThan(0.02);
    }
  });
});

describe('이월의 세 겹 잠금 — 이월이 새 발행을 만들지 않는다', () => {
  it('★경계에서 GPS가 500m 튀어도 이월은 자기 속도만큼만 인정된다 (창이 기각되지 않는다)', () => {
    const engine = new CorridorEngine([], []);
    // 1창: 정상 보행 1 m/s
    for (let k = 0; k < 12; k++) {
      engine.addFix({ ...north(LAT0, k * 5), timestamp: k * 5000, accuracy: 10 });
    }
    engine.addSteps(80);
    const first = engine.closeWindow();
    expect(first!.distanceM).toBe(55);

    // 2창: 첫 픽스가 5초 만에 500m 북쪽으로 튄다 (도심 반사·재획득).
    const JUMP = 500;
    for (let k = 0; k < 12; k++) {
      engine.addFix({
        ...north(LAT0, 55 + JUMP + k * 5),
        timestamp: 60_000 + k * 5000,
        accuracy: 10,
      });
    }
    engine.addSteps(80);
    const second = engine.closeWindow()!;

    // 이월 상한 = 자기 평균 속도(≈1 m/s) × 5초 = 5m. 500m가 통째로 들어오지 않는다.
    expect(second.distanceM).toBeLessThanOrEqual(61);
    expect(second.durationS).toBe(60);
    // 이월이 없던 때와 같은 속도이므로 걷기 필터가 그대로 통과시킨다.
    expect(evaluateWalkSample(second).accepted).toBe(true);
  });

  it('★30초 넘게 끊기면 이월하지 않는다 (앱 재시작·이동수단 뒤의 재개)', () => {
    const engine = new CorridorEngine([], []);
    for (let k = 0; k < 12; k++) {
      engine.addFix({ ...north(LAT0, k * 5), timestamp: k * 5000, accuracy: 10 });
    }
    engine.addSteps(80);
    expect(engine.closeWindow()!.distanceM).toBe(55);

    // 10분 공백 뒤 8km 떨어진 곳에서 재개 (차를 타고 이동했다).
    const GAP_MS = 600_000;
    for (let k = 0; k < 12; k++) {
      engine.addFix({
        ...north(LAT0, 8_000 + k * 5),
        timestamp: 55_000 + GAP_MS + k * 5000,
        accuracy: 10,
      });
    }
    engine.addSteps(80);
    const after = engine.closeWindow()!;
    expect(after.distanceM).toBe(55); // 8km는 한 톨도 들어오지 않는다
    expect(after.durationS).toBe(55); // 공백 시간도 창에 들어오지 않는다
    expect(DEFAULT_CORRIDOR_PARAMS.maxBridgeGapS).toBe(30);
  });

  it('★무효 창(mock location)은 이월을 끊는다 — 오염 구간을 건너뛰어 잇지 않는다', () => {
    const engine = new CorridorEngine([], []);
    for (let k = 0; k < 12; k++) {
      engine.addFix({ ...north(LAT0, k * 5), timestamp: k * 5000, accuracy: 10 });
    }
    engine.addSteps(80);
    expect(engine.closeWindow()).not.toBeNull();

    // 2창: mock 오염 → null. 이 창의 거리는 없던 일이 된다.
    engine.addFix({ ...north(LAT0, 60), timestamp: 60_000, mocked: true });
    for (let k = 0; k < 12; k++) {
      engine.addFix({ ...north(LAT0, 60 + k * 5), timestamp: 60_000 + k * 5000, accuracy: 10 });
    }
    engine.addSteps(80);
    expect(engine.closeWindow()).toBeNull();

    // 3창: 오염 창을 건너뛴 이월이 붙지 않는다 (자기 구간만).
    for (let k = 0; k < 12; k++) {
      engine.addFix({ ...north(LAT0, 120 + k * 5), timestamp: 120_000 + k * 5000, accuracy: 10 });
    }
    engine.addSteps(80);
    expect(engine.closeWindow()!.distanceM).toBe(55);
  });

  it('첫 창은 이월이 없다 — 걷기를 시작하기 전 거리는 만들어내지 않는다', () => {
    const { emitted } = walkStraight(5, 12, 1);
    expect(emitted).toBe(55);
  });

  it('이월점도 좌표를 남기지 않는다 — 창 마감 후 엔진 직렬화는 여전히 비어 있다', () => {
    const engine = new CorridorEngine([], []);
    for (let k = 0; k < 12; k++) {
      engine.addFix({ ...north(LAT0, k * 5), timestamp: k * 5000, accuracy: 10 });
    }
    engine.addSteps(80);
    engine.closeWindow();
    expect(JSON.stringify(engine)).toBe('{}');
    expect(JSON.stringify(engine.getLiveStatus())).not.toMatch(/"lat"|"lon"/);
  });
});
