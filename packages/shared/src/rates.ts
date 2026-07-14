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
 * 모든 연산은 정수 microDshv (1 dSHV = 1e6 micro). 부동소수점 금지.
 */
import {
  DEFAULT_ECONOMIC_PARAMS,
  type EconomicParams,
  MICRO_PER_DSHV,
  MICRO_PER_METER_BASE,
} from './params';
import type { WalkTier } from './types';

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
 */
export function metersToMicroDshv(
  meters: number,
  tier: WalkTier,
  difficultyTenths?: number,
  params: EconomicParams = DEFAULT_ECONOMIC_PARAMS,
): number {
  if (!Number.isFinite(meters) || meters <= 0) return 0;
  const m = Math.floor(meters);
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

/** microDshv → dSHV 확정액: 0.1 SHV(=1 dSHV) 단위 내림 (지시서 2.2 "0.1 SHV 단위 내림"). */
export function floorMicroToDshv(micro: number): number {
  return Math.floor(micro / MICRO_PER_DSHV);
}

/** 일일 상한 적용: 해당 일자의 기존 발행분을 감안해 추가 가능액을 잘라낸다. */
export function applyDailyCap(
  candidateDshv: number,
  alreadyMintedTodayDshv: number,
  params: EconomicParams = DEFAULT_ECONOMIC_PARAMS,
): number {
  const remaining = Math.max(0, params.dailyCapDshv - alreadyMintedTodayDshv);
  return Math.min(candidateDshv, remaining);
}
