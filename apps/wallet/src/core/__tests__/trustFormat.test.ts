/**
 * 신뢰 뱃지 표시 헬퍼 (C — trustFormat.ts) 단위 테스트.
 * 견고성 순서·compact 생략·정확 액수 비노출을 확인한다.
 */
import { describe, expect, it } from 'vitest';
import { trustBadges, walkTierLabel } from '../trustFormat';
import type { TrustSummary } from '@shvil/shared';

function summary(overrides: Partial<TrustSummary> = {}): TrustSummary {
  return {
    claimsApproved: 0,
    certificatesFull: 0,
    certificatesSection: 0,
    walkTier: 'NONE',
    memberSinceDay: '2026-07-01',
    angel: null,
    leaderboardVerified: false,
    ...overrides,
  };
}

describe('walkTierLabel', () => {
  it('구간 코드를 사람 문구로 옮긴다', () => {
    expect(walkTierLabel('STARTER')).toBe('걷기 시작');
    expect(walkTierLabel('EXPERIENCED')).toBe('경험 많은 트레커');
    expect(walkTierLabel('VETERAN')).toBe('베테랑 트레커');
  });
});

describe('trustBadges', () => {
  it('실적이 없어도 활동 기간 뱃지는 항상 하나 나온다', () => {
    const b = trustBadges(summary());
    expect(b).toHaveLength(1);
    expect(b[0]!.key).toBe('since');
    expect(b[0]!.strong).toBe(false);
  });

  it('위조가 어려운 지표(걷기 실적·완주·검증)가 강조되고 활동 기간보다 앞에 온다', () => {
    const b = trustBadges(
      summary({ walkTier: 'EXPERIENCED', claimsApproved: 3, leaderboardVerified: true }),
    );
    const keys = b.map((x) => x.key);
    expect(keys.indexOf('walk')).toBeLessThan(keys.indexOf('since'));
    expect(keys.indexOf('claims')).toBeLessThan(keys.indexOf('since'));
    expect(b.find((x) => x.key === 'walk')!.strong).toBe(true);
    expect(b.find((x) => x.key === 'claims')!.strong).toBe(true);
    expect(b.find((x) => x.key === 'verified')!.strong).toBe(true);
    expect(b.find((x) => x.key === 'since')!.strong).toBe(false);
  });

  it('compact는 보조 지표(인증 수·감사 카드)를 생략한다', () => {
    const full = summary({
      walkTier: 'STARTER',
      certificatesFull: 2,
      certificatesSection: 1,
      angel: { guestbookCards: 4, firstHosting: true, angelSinceDay: '2026-07-01' },
    });
    const compactKeys = trustBadges(full, true).map((b) => b.key);
    expect(compactKeys).not.toContain('certFull');
    expect(compactKeys).not.toContain('cards');
    expect(compactKeys).toContain('walk'); // 핵심은 남는다
    const fullKeys = trustBadges(full, false).map((b) => b.key);
    expect(fullKeys).toContain('certFull');
    expect(fullKeys).toContain('cards');
    expect(fullKeys).toContain('hosting');
  });

  it('뱃지 라벨 어디에도 정확한 dSHV 액수가 없다 (구간 뱃지만)', () => {
    const b = trustBadges(summary({ walkTier: 'VETERAN' }));
    for (const badge of b) {
      expect(badge.label).not.toMatch(/dshv|shv/i);
    }
  });
});
