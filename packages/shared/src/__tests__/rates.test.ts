import { describe, expect, it } from 'vitest';
import {
  applyDailyCap,
  floorMicroToDshv,
  metersToMicroDshv,
  normalizeDifficultyTenths,
} from '../rates';
import { DEFAULT_ECONOMIC_PARAMS, MICRO_PER_DSHV } from '../params';

describe('3단계 생성 요율 (지시서 2.2)', () => {
  it('등록 코스 회랑 안: 1km = 1 SHV (10 dSHV)', () => {
    expect(floorMicroToDshv(metersToMicroDshv(1_000, 'ON_COURSE'))).toBe(10);
    expect(floorMicroToDshv(metersToMicroDshv(20_000, 'ON_COURSE'))).toBe(200); // 하루 성실한 걸음 ≈ 20 SHV
  });

  it('코스 이탈: 감액 요율 1/10 (제안 기본값)', () => {
    expect(floorMicroToDshv(metersToMicroDshv(10_000, 'OFF_COURSE'))).toBe(10); // 10km → 1 SHV
  });

  it('일상 걸음: 미세 요율 1/1,000 (제안 기본값)', () => {
    expect(floorMicroToDshv(metersToMicroDshv(10_000, 'DAILY_LIFE'))).toBe(0); // 10km → 0.01 SHV → 내림 0
    expect(floorMicroToDshv(metersToMicroDshv(100_000, 'DAILY_LIFE'))).toBe(1); // 100km 누적 → 0.1 SHV
  });

  it('일상 요율 1/10,000 설정도 지원 (확정 대기 범위)', () => {
    const params = { ...DEFAULT_ECONOMIC_PARAMS, dailyLifeDivisor: 10_000 };
    expect(metersToMicroDshv(100_000, 'DAILY_LIFE', undefined, params)).toBe(100_000); // 0.1 dSHV
  });

  it('엔젤 우회: 기준 요율로 카운트 (확정은 정산 로직 소관)', () => {
    expect(metersToMicroDshv(1_000, 'ANGEL_DETOUR')).toBe(metersToMicroDshv(1_000, 'ON_COURSE'));
  });
});

describe('난이도 계수', () => {
  it('계수는 코스 위에서만 거리당 발행을 곱한다 (에베레스트 예: 8km × 2.5 = 20 SHV)', () => {
    expect(floorMicroToDshv(metersToMicroDshv(8_000, 'ON_COURSE', 25))).toBe(200);
  });

  it('계수 하한 ×1.0, 상한 ×4.0(제안) 클램프', () => {
    expect(normalizeDifficultyTenths(undefined)).toBe(10);
    expect(normalizeDifficultyTenths(5)).toBe(10); // ×0.5 시도 → ×1.0
    expect(normalizeDifficultyTenths(99)).toBe(40); // ×9.9 시도 → ×4.0
  });
});

describe('내림과 일일 상한 (확정 파라미터)', () => {
  it('0.1 SHV 단위 내림: 17.38km → 17.3 SHV', () => {
    expect(floorMicroToDshv(metersToMicroDshv(17_380, 'ON_COURSE'))).toBe(173);
  });

  it('내림은 정수 dSHV로 — 잔여 micro는 소멸', () => {
    expect(floorMicroToDshv(MICRO_PER_DSHV - 1)).toBe(0);
    expect(floorMicroToDshv(MICRO_PER_DSHV)).toBe(1);
  });

  it('1일 상한 40 SHV(400 dSHV): 초과분 절사', () => {
    expect(applyDailyCap(500, 0)).toBe(400);
    expect(applyDailyCap(100, 350)).toBe(50);
    expect(applyDailyCap(100, 400)).toBe(0);
  });

  it('상한은 요율·계수 적용 후 총액 기준: ×4.0으로 15km 걸어도 40 SHV', () => {
    const dshv = floorMicroToDshv(metersToMicroDshv(15_000, 'ON_COURSE', 40)); // 600 dSHV
    expect(applyDailyCap(dshv, 0)).toBe(400);
  });
});
