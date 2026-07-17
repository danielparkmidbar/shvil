/**
 * 검증 가능한 신뢰 지표 코어 (C — trust.ts) 단위 테스트.
 * 구간 뱃지 경계와 일자 절사(시각 비노출)를 확인한다.
 */
import { describe, expect, it } from 'vitest';
import { TRUST_WALK_TIER_MIN_DSHV, trustDayOf, walkTierOf } from '../trust';

describe('walkTierOf — 교차 목격 걷기 실적 구간 뱃지', () => {
  it('실적이 없으면 NONE', () => {
    expect(walkTierOf(0)).toBe('NONE');
  });

  it('경계값에서 정확히 승급한다 (≥ 하한)', () => {
    expect(walkTierOf(TRUST_WALK_TIER_MIN_DSHV.STARTER - 1)).toBe('NONE');
    expect(walkTierOf(TRUST_WALK_TIER_MIN_DSHV.STARTER)).toBe('STARTER');
    expect(walkTierOf(TRUST_WALK_TIER_MIN_DSHV.EXPERIENCED - 1)).toBe('STARTER');
    expect(walkTierOf(TRUST_WALK_TIER_MIN_DSHV.EXPERIENCED)).toBe('EXPERIENCED');
    expect(walkTierOf(TRUST_WALK_TIER_MIN_DSHV.VETERAN - 1)).toBe('EXPERIENCED');
    expect(walkTierOf(TRUST_WALK_TIER_MIN_DSHV.VETERAN)).toBe('VETERAN');
    expect(walkTierOf(TRUST_WALK_TIER_MIN_DSHV.VETERAN * 10)).toBe('VETERAN');
  });

  it('구간 경계는 단조 증가한다 (STARTER < EXPERIENCED < VETERAN)', () => {
    expect(TRUST_WALK_TIER_MIN_DSHV.STARTER).toBeLessThan(TRUST_WALK_TIER_MIN_DSHV.EXPERIENCED);
    expect(TRUST_WALK_TIER_MIN_DSHV.EXPERIENCED).toBeLessThan(TRUST_WALK_TIER_MIN_DSHV.VETERAN);
  });
});

describe('trustDayOf — 가입·등록 시각의 일 단위 절사', () => {
  it('YYYY-MM-DD (UTC)로 절사해 시각을 노출하지 않는다', () => {
    const ts = Date.parse('2026-07-17T13:45:07Z');
    expect(trustDayOf(ts)).toBe('2026-07-17');
    // 같은 날 다른 시각은 같은 문자열 (시·분·초가 남지 않는다)
    expect(trustDayOf(Date.parse('2026-07-17T00:00:00Z'))).toBe('2026-07-17');
    expect(trustDayOf(Date.parse('2026-07-17T23:59:59Z'))).toBe('2026-07-17');
  });
});
