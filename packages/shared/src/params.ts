/**
 * 쉬빌 코인 확정 파라미터 및 결정 대기 파라미터.
 *
 * 확정(변경 금지, 지시서 0장):
 *  - 등록 코스 위 도보 1km = 1 SHV (기준 요율)
 *  - 0.1 SHV 단위 내림, 1인 1일 상한 40 SHV
 *
 * 결정 대기(지시서 8장 — 제안 기본값, 다니엘 쌤 확정 전까지 설정으로만 변경):
 *  - 코스 이탈 감액 요율: 제안 1/10
 *  - 일상 걸음 미세 요율: 1/1,000 ~ 1/10,000 (기본 1/1,000)
 *  - 난이도 계수 상한: 제안 ×4.0
 *  - 엔젤 우회 인정 한도: 제안 편도 5km
 */

/** 1 SHV = 10 dSHV. 원장 정밀도 0.1 SHV — 부동소수점 금지, 정수 dSHV만 사용. */
export const DSHV_PER_SHV = 10;

/** 내부 누적 정밀도: 1 dSHV = 1,000,000 microDshv (요율 나눗셈의 정수 유지용). */
export const MICRO_PER_DSHV = 1_000_000;

/** 100 m = 1 dSHV (기준 요율) → 1 m = 10,000 microDshv. */
export const MICRO_PER_METER_BASE = 10_000;

export interface EconomicParams {
  /** 1인 1일 발행 상한 (dSHV). 확정: 40 SHV = 400 dSHV. */
  dailyCapDshv: number;
  /** 코스 이탈 감액 분모 (기준 요율의 1/N). 결정 대기 — 제안 10. */
  offCourseDivisor: number;
  /** 일상 걸음 미세 요율 분모. 결정 대기 — 1,000 또는 10,000. */
  dailyLifeDivisor: number;
  /** 난이도 계수 상한 (×10 정수: 40 = ×4.0). 결정 대기 — 제안 ×4.0. */
  difficultyMaxTenths: number;
  /** 엔젤 우회 인정 한도, 편도 미터. 결정 대기 — 제안 5,000 m. */
  angelDetourMaxMeters: number;
}

export const DEFAULT_ECONOMIC_PARAMS: EconomicParams = {
  dailyCapDshv: 400,
  offCourseDivisor: 10,
  dailyLifeDivisor: 1_000,
  difficultyMaxTenths: 40,
  angelDetourMaxMeters: 5_000,
};

export interface WalkFilterParams {
  /** 보행 인정 최대 속도(km/h). 이 초과는 뛰기 — 카운트하지 않는다. */
  maxWalkSpeedKmh: number;
  /** 차량 판정 속도(km/h). 이 이상은 교통수단으로 분류. */
  vehicleSpeedKmh: number;
  /** 보폭 대역(m): GPS 거리와 걸음 수의 교차 검증. */
  strideMinM: number;
  strideMaxM: number;
  /** 보폭 대역 허용 오차 비율 (±30%). */
  strideToleranceRatio: number;
  /** 케이던스 대역 (걸음/분). */
  cadenceMinSpm: number;
  cadenceMaxSpm: number;
  /** 이 미만의 창 거리(m)는 정지/휴식으로 보고 정합 검사를 생략한다. */
  restDistanceThresholdM: number;
}

export const DEFAULT_WALK_FILTER_PARAMS: WalkFilterParams = {
  maxWalkSpeedKmh: 6,
  vehicleSpeedKmh: 10,
  strideMinM: 0.5,
  strideMaxM: 0.9,
  strideToleranceRatio: 0.3,
  cadenceMinSpm: 60,
  cadenceMaxSpm: 140,
  restDistanceThresholdM: 20,
};

/** 인간 한계 프로파일 — 수신 지갑의 로컬 개연성 검사 기준 (지시서 3장). */
export interface HumanLimitProfile {
  /** 하루 최대 생성 (dSHV). 확정 상한 40 SHV. */
  dailyMaxDshv: number;
  /** 7일 이동 합 최대 (dSHV). 지시서 예시: 주 300 SHV는 물리적 불가능치. */
  weeklyMaxDshv: number;
}

export const DEFAULT_HUMAN_LIMIT_PROFILE: HumanLimitProfile = {
  dailyMaxDshv: 400,
  weeklyMaxDshv: 3_000,
};

/** 권장 가격표 (dSHV) — 확정 파라미터. */
export const RECOMMENDED_PRICES_DSHV = {
  BED: 100,
  MEAL: 50,
  SHOWER: 30,
  FULL_PACKAGE: 180,
} as const;

/** 엔젤 등록 보너스 (dSHV) — 확정 파라미터 (기간·수량 한정 프로모션). */
export const ANGEL_BONUS_DSHV = {
  REGISTRATION: 200,
  FIRST_HOSTING: 300,
} as const;
