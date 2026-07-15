/**
 * 걷기·자전거 판별 필터 (지시서 2.2 · M11 3장 — 전부 온디바이스).
 *
 * 도보(WALK):
 * - 속도 프로파일: 보행 범위만 인정. 뛰는 속도 이상 카운트 안 함. 차량 자동 제외.
 * - 걸음 센서 교차 검증: GPS 거리와 걸음 파형이 일치해야 인정 (흔들기 무력화).
 *
 * 자전거(BIKE):
 * - 만보기 걸음이 없으므로(steps=0) 걸음-거리·케이던스 교차 검증을 쓸 수 없다.
 *   자전거 속도 프로파일로 **원동기만 배제**하고(≥35km/h), 실주행 확인은 걸음이 아니라
 *   트레일 포인트의 M9 몸 인증 미션이 맡는다(자전거를 세우고 지시대로 걷기). 이원화가 설계다.
 *
 * - 입력은 좌표가 아니라 창 요약(거리·걸음·시간·모드)뿐 — 위치 비저장 원칙.
 *
 * 사용자 패턴 학습 모델(이상 탐지)은 verification-engineer 담당으로 M1에서
 * 별도 모듈로 연동한다. 이 필터는 결정적 규칙 계층이다.
 */
import {
  DEFAULT_BIKE_FILTER_PARAMS,
  DEFAULT_WALK_FILTER_PARAMS,
  type BikeFilterParams,
  type WalkFilterParams,
} from './params';
import type { WalkRejectReason, WalkSample, WalkSampleVerdict } from './types';

const reject = (reason: WalkRejectReason): WalkSampleVerdict => ({
  accepted: false,
  reason,
  creditedDistanceM: 0,
});

export function evaluateWalkSample(
  sample: WalkSample,
  params: WalkFilterParams = DEFAULT_WALK_FILTER_PARAMS,
  bikeParams: BikeFilterParams = DEFAULT_BIKE_FILTER_PARAMS,
): WalkSampleVerdict {
  if (
    !Number.isFinite(sample.durationS) ||
    sample.durationS <= 0 ||
    !Number.isFinite(sample.distanceM) ||
    sample.distanceM < 0 ||
    !Number.isInteger(sample.steps) ||
    sample.steps < 0
  ) {
    return reject('INVALID_SAMPLE');
  }

  // 자전거 모드: 걸음 기반 교차 검증을 건너뛰고 속도로 원동기만 배제한다.
  if (sample.mode === 'BIKE') return evaluateBikeSample(sample, bikeParams);

  // 정지/휴식 창: 거리 기여가 없으므로 그대로 통과 (발행 0, 무해).
  if (sample.distanceM < params.restDistanceThresholdM) {
    return { accepted: true, creditedDistanceM: 0 };
  }

  const speedKmh = (sample.distanceM / 1000) / (sample.durationS / 3600);

  // 차량·교통수단: 어디서든 카운트하지 않는다.
  if (speedKmh >= params.vehicleSpeedKmh) return reject('VEHICLE');
  // 뛰는 속도 이상: 카운트하지 않는다.
  if (speedKmh > params.maxWalkSpeedKmh) return reject('TOO_FAST');

  // 거리는 진행되는데 걸음 파형이 없다 → 서행 차량/스푸핑.
  if (sample.steps === 0) return reject('NO_STEPS');

  // 걸음-거리 정합: 보폭이 인간 대역(±허용 오차)이어야 한다.
  const stride = sample.distanceM / sample.steps;
  const strideMin = params.strideMinM * (1 - params.strideToleranceRatio);
  const strideMax = params.strideMaxM * (1 + params.strideToleranceRatio);
  if (stride < strideMin || stride > strideMax) return reject('STEP_DISTANCE_MISMATCH');

  // 케이던스 대역: 기계적 반복(과다) 또는 파형 없는 진행(과소) 배제.
  const cadence = sample.steps / (sample.durationS / 60);
  if (cadence < params.cadenceMinSpm || cadence > params.cadenceMaxSpm) {
    return reject('CADENCE_OUT_OF_RANGE');
  }

  return { accepted: true, creditedDistanceM: sample.distanceM };
}

/**
 * 자전거 창 판정: 속도 상한으로 원동기(차량·오토바이)만 배제한다.
 * 걸음(steps)은 판정에 쓰지 않는다 — 자전거는 만보기 걸음이 없다.
 * 실주행 확인은 트레일 포인트의 M9 몸 인증 미션이 담당한다(요율 인정과 별개 계층).
 */
function evaluateBikeSample(sample: WalkSample, params: BikeFilterParams): WalkSampleVerdict {
  // 정지/신호 대기 창: 거리 기여 없음 (도보와 동일 관용).
  if (sample.distanceM < params.restDistanceThresholdM) {
    return { accepted: true, creditedDistanceM: 0 };
  }
  const speedKmh = (sample.distanceM / 1000) / (sample.durationS / 3600);
  // 자전거 인정 상한 초과: 원동기로 배제.
  if (speedKmh >= params.maxBikeSpeedKmh) return reject('VEHICLE');
  return { accepted: true, creditedDistanceM: sample.distanceM };
}
