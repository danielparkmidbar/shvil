/**
 * 쉬빌 코인 확정 파라미터.
 *
 * 확정(변경 금지, 지시서 0장):
 *  - 등록 코스 위 도보 1km = 1 SHV (기준 요율)
 *  - 0.1 SHV 단위 내림, 1인 1일 상한 40 SHV
 *
 * 다니엘 쌤 확정 2026-07-13 (지시서 8장 결정 대기 → 확정, docs/결정대기_검토.md):
 *  - 코스 이탈 감액 요율: 1/10
 *  - 일상 걸음 미세 요율: 1/1,000
 *  - 난이도 계수 상한: ×4.0
 *  - 엔젤 우회 인정 한도: 편도 5km
 *  - 인간 한계 주간 상한: 300 SHV/7일
 *  - 마켓 수수료: 2.5% · 격려 코인: 완주 10 / 구간 3 SHV · 클레임: 5표·월 2회
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
  /**
   * 코스 이탈 감액 분모 (기준 요율의 1/N).
   * 확정 (2026-07-15 다니엘 쌤, T-1): 설정된 트레일을 벗어나면 일상과 동일 —
   * dailyLifeDivisor와 같은 1,000. "트레일 위 = 정상, 벗어남 = 조금"의 단순한 2단계.
   */
  offCourseDivisor: number;
  /** 일상 걸음 미세 요율 분모. 확정: 1,000. */
  dailyLifeDivisor: number;
  /** 난이도 계수 상한 (×10 정수: 40 = ×4.0). 결정 대기 — 제안 ×4.0. */
  difficultyMaxTenths: number;
  /** 엔젤 우회 인정 한도, 편도 미터. 결정 대기 — 제안 5,000 m. */
  angelDetourMaxMeters: number;
  /**
   * 자전거 모드 배율 (×10 정수: 5 = ×0.5). 확정 (2026-07-15 다니엘 쌤, T-2):
   * 자전거 1km = 0.5 SHV — 에너지 비율(자전거 ≈ 도보의 1/2). 도보는 tenths=10(×1.0).
   * 부동소수 금지 규칙에 맞춰 정수 tenths로 두고 metersToMicroDshv가 정수 나눗셈으로 적용한다.
   * 일 상한(dailyCapDshv 40 SHV)은 이동 수단과 무관하게 동일 — 도보·자전거 발행을 합산해
   * 하루 40 SHV 상한에 함께 걸린다(에너지 총량이 하나이므로). 이 합산은 원장 정산에서 이루어진다.
   */
  bikeMultiplierTenths: number;
}

export const DEFAULT_ECONOMIC_PARAMS: EconomicParams = {
  dailyCapDshv: 400,
  offCourseDivisor: 1_000, // T-1 확정: 이탈 = 일상과 동일 요율
  dailyLifeDivisor: 1_000,
  difficultyMaxTenths: 40,
  angelDetourMaxMeters: 5_000,
  bikeMultiplierTenths: 5, // T-2 확정: 자전거 ×0.5
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

/**
 * 자전거 모드 속도 필터 (M11 — docs/몸인증_보물마이닝_설계.md 3장).
 *
 * 도보 필터의 걸음-거리·케이던스 교차 검증은 자전거에 쓸 수 없다 — 자전거는
 * 만보기 걸음이 없다(steps=0). 따라서 자전거 필터는 **속도 상한만으로 원동기(차량·
 * 오토바이)를 배제**하고, 실주행 확인은 걸음이 아니라 트레일 포인트의 M9 몸 인증
 * 미션(자전거를 세우고 지시대로 걷기)이 담당한다. 이 이원화가 3장의 설계다.
 *
 * 속도 상한 35km/h: 사람 다리 힘의 지속 주행 상한을 여유 있게 잡은 값. 그 이상은
 * 내리막 순간을 빼면 원동기다 → 차량으로 배제(도보 컷 ~8km/h의 자전거판).
 */
export interface BikeFilterParams {
  /** 자전거 인정 최대 속도(km/h). 이 이상은 원동기(차량·오토바이)로 배제. */
  maxBikeSpeedKmh: number;
  /** 이 미만의 창 거리(m)는 정지/신호 대기로 보고 발행 기여 0 (도보와 동일 관용). */
  restDistanceThresholdM: number;
}

export const DEFAULT_BIKE_FILTER_PARAMS: BikeFilterParams = {
  maxBikeSpeedKmh: 35,
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
