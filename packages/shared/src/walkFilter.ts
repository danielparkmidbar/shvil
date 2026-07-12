/**
 * 걷기 판별 필터 (지시서 2.2 — 전부 온디바이스).
 *
 * - 속도 프로파일: 보행 범위만 인정. 뛰는 속도 이상 카운트 안 함. 차량 자동 제외.
 * - 걸음 센서 교차 검증: GPS 거리와 걸음 파형이 일치해야 인정 (흔들기 무력화).
 * - 입력은 좌표가 아니라 창 요약(거리·걸음·시간)뿐 — 위치 비저장 원칙.
 *
 * 사용자 패턴 학습 모델(이상 탐지)은 verification-engineer 담당으로 M1에서
 * 별도 모듈로 연동한다. 이 필터는 결정적 규칙 계층이다.
 */
import { DEFAULT_WALK_FILTER_PARAMS, type WalkFilterParams } from './params.js';
import type { WalkRejectReason, WalkSample, WalkSampleVerdict } from './types.js';

export function evaluateWalkSample(
  sample: WalkSample,
  params: WalkFilterParams = DEFAULT_WALK_FILTER_PARAMS,
): WalkSampleVerdict {
  const reject = (reason: WalkRejectReason): WalkSampleVerdict => ({
    accepted: false,
    reason,
    creditedDistanceM: 0,
  });

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
