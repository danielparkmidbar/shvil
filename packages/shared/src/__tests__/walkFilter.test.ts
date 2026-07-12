import { describe, expect, it } from 'vitest';
import { evaluateWalkSample } from '../walkFilter';
import { makeSample } from './helpers';

describe('걷기 판별 필터 (지시서 2.2 — 뛰기·차량 제외)', () => {
  it('정상 보행(5 km/h)은 인정', () => {
    const v = evaluateWalkSample(makeSample());
    expect(v.accepted).toBe(true);
    expect(v.creditedDistanceM).toBe(100);
  });

  it('뛰는 속도 이상(8 km/h)은 카운트하지 않는다', () => {
    // 72초에 160m = 8 km/h, 걸음도 그럴듯하게 붙여도 속도에서 거부
    const v = evaluateWalkSample(makeSample({ distanceM: 160, steps: 200 }));
    expect(v.accepted).toBe(false);
    expect(v.reason).toBe('TOO_FAST');
    expect(v.creditedDistanceM).toBe(0);
  });

  it('차량·교통수단 속도(60 km/h)는 자동 제외', () => {
    const v = evaluateWalkSample(makeSample({ distanceM: 1_200, steps: 0 }));
    expect(v.accepted).toBe(false);
    expect(v.reason).toBe('VEHICLE');
  });

  it('서행 차량(거리는 진행, 걸음 파형 없음)은 제외', () => {
    const v = evaluateWalkSample(makeSample({ distanceM: 90, steps: 0 }));
    expect(v.accepted).toBe(false);
    expect(v.reason).toBe('NO_STEPS');
  });

  it('흔들기(걸음만 쌓이고 거리 없음)는 발행 기여 0', () => {
    const v = evaluateWalkSample(makeSample({ distanceM: 0, steps: 140 }));
    expect(v.accepted).toBe(true); // 유해하지 않음 — 거리 기반 발행이라 무의미
    expect(v.creditedDistanceM).toBe(0);
  });

  it('걸음-거리 정합: 보폭이 인간 대역을 벗어나면 거부 (차량+걸음 위장)', () => {
    // 100m를 40걸음 = 보폭 2.5m
    const v = evaluateWalkSample(makeSample({ steps: 40 }));
    expect(v.accepted).toBe(false);
    expect(v.reason).toBe('STEP_DISTANCE_MISMATCH');
  });

  it('기계적 과다 케이던스는 거부', () => {
    // 72초에 200걸음 = 167 spm, 보폭 0.5m로 정합은 통과하는 케이스
    const v = evaluateWalkSample(makeSample({ distanceM: 100, steps: 200 }));
    expect(v.accepted).toBe(false);
    expect(v.reason).toBe('CADENCE_OUT_OF_RANGE');
  });

  it('휴식 창(거리 미미)은 통과하되 기여 0', () => {
    const v = evaluateWalkSample(makeSample({ distanceM: 5, steps: 10 }));
    expect(v.accepted).toBe(true);
    expect(v.creditedDistanceM).toBe(0);
  });

  it('비정상 샘플(음수 등)은 거부', () => {
    expect(evaluateWalkSample(makeSample({ distanceM: -10 })).reason).toBe('INVALID_SAMPLE');
    expect(evaluateWalkSample(makeSample({ durationS: 0 })).reason).toBe('INVALID_SAMPLE');
  });
});
