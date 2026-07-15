/**
 * 생성 요율 계산 (지시서 2.2 표).
 *
 * | 걸음의 자리        | 요율                                    |
 * | 등록 코스 회랑 안   | 1km = 1 SHV × 구간 난이도 계수           |
 * | 코스 이탈          | 일상과 동일 1/1,000 (T-1 확정 2026-07-15) |
 * | 일상 걸음          | 미세 요율 1/1,000 (확정)                 |
 * | 엔젤 우회          | 기준 요율 잠정 — 해당 엔젤에게 사용 시 확정 |
 *
 * 단순함 원칙: 사용자에게는 "트레일 위 = 정상 생성, 벗어남 = 조금"의 2단계뿐이다.
 *
 * 이동 수단 (M11, T-2 확정): 자전거는 위 요율 전체에 ×0.5 (에너지 비례). 도보는 ×1.0.
 * 난이도 계수는 1차 구현에서 자전거에도 도보와 같은 difficultyTenths를 적용한다(단순).
 *   (후속 여지: 자전거는 오르막 난이도가 도보와 달라 별도 계수 테이블이 필요할 수 있다.)
 *
 * 모든 연산은 정수 microDshv (1 dSHV = 1e6 micro). 부동소수점 금지.
 */
import {
  DEFAULT_ECONOMIC_PARAMS,
  type EconomicParams,
  MICRO_PER_DSHV,
  MICRO_PER_METER_BASE,
} from './params';
import type { TravelMode, WalkTier } from './types';

/** 난이도 계수 정규화: 미지정→×1.0, 상한 클램프, 하한 ×1.0. */
export function normalizeDifficultyTenths(
  difficultyTenths: number | undefined,
  params: EconomicParams = DEFAULT_ECONOMIC_PARAMS,
): number {
  if (difficultyTenths === undefined) return 10;
  if (!Number.isInteger(difficultyTenths) || difficultyTenths < 10) return 10;
  return Math.min(difficultyTenths, params.difficultyMaxTenths);
}

/**
 * 거리(m) → 발행량(microDshv). tier별 요율 적용.
 * 난이도 계수는 등록 코스 회랑 안에서만 적용된다.
 *
 * mode: 'BIKE'면 tier 요율 전체에 자전거 배율(×0.5 = bikeMultiplierTenths/10)을 곱한다.
 * 배율은 정수 나눗셈(Math.floor)으로 적용해 microDshv 정수 규칙을 유지한다(부동소수 금지).
 * mode 미지정은 도보('WALK')로 취급 — 기존 호출부는 그대로 도보 요율이다.
 */
export function metersToMicroDshv(
  meters: number,
  tier: WalkTier,
  difficultyTenths?: number,
  params: EconomicParams = DEFAULT_ECONOMIC_PARAMS,
  mode: TravelMode = 'WALK',
): number {
  if (!Number.isFinite(meters) || meters <= 0) return 0;
  const m = Math.floor(meters);
  return applyModeMultiplier(baseMicroForTier(m, tier, difficultyTenths, params), mode, params);
}

/** tier별 기준 발행량(도보 ×1.0). 자전거 배율은 applyModeMultiplier에서 별도 적용. */
function baseMicroForTier(
  m: number,
  tier: WalkTier,
  difficultyTenths: number | undefined,
  params: EconomicParams,
): number {
  switch (tier) {
    case 'ON_COURSE': {
      const coeff = normalizeDifficultyTenths(difficultyTenths, params);
      return Math.floor((m * MICRO_PER_METER_BASE * coeff) / 10);
    }
    case 'ANGEL_DETOUR':
      // 기준 요율 (잠정) — 확정 여부는 정산 로직이 결정한다.
      return m * MICRO_PER_METER_BASE;
    case 'OFF_COURSE':
      return Math.floor((m * MICRO_PER_METER_BASE) / params.offCourseDivisor);
    case 'DAILY_LIFE':
      return Math.floor((m * MICRO_PER_METER_BASE) / params.dailyLifeDivisor);
  }
}

/** 이동 수단 배율: 자전거 ×(bikeMultiplierTenths/10), 도보 ×1.0. 정수 나눗셈 유지. */
function applyModeMultiplier(micro: number, mode: TravelMode, params: EconomicParams): number {
  if (mode === 'BIKE') return Math.floor((micro * params.bikeMultiplierTenths) / 10);
  return micro;
}

/** microDshv → dSHV 확정액: 0.1 SHV(=1 dSHV) 단위 내림 (지시서 2.2 "0.1 SHV 단위 내림"). */
export function floorMicroToDshv(micro: number): number {
  return Math.floor(micro / MICRO_PER_DSHV);
}

/**
 * 일일 상한 적용: 해당 일자의 기존 발행분을 감안해 추가 가능액을 잘라낸다.
 *
 * 이동 수단 무관 — 상한은 도보·자전거 공통 40 SHV(T-2 확정). 원리: 원동기가 아니면
 * 같은 음식으로 쓸 수 있는 하루 에너지는 하나다. 도보 발행과 자전거 발행은 **합산되어**
 * 이 하나의 40 SHV/일 상한에 함께 걸린다. 합산은 원장(PendingWalkLedger)이 요율 적용 후
 * micro를 일자별로 모아 이 함수에 넘기는 지점에서 이루어진다 — 자전거만 따로 40을 더
 * 벌 수 없다. 도보 ~40km, 자전거 ~80km에서 각각 상한에 도달한다.
 */
export function applyDailyCap(
  candidateDshv: number,
  alreadyMintedTodayDshv: number,
  params: EconomicParams = DEFAULT_ECONOMIC_PARAMS,
): number {
  const remaining = Math.max(0, params.dailyCapDshv - alreadyMintedTodayDshv);
  return Math.min(candidateDshv, remaining);
}
