'use client';

/**
 * 검증 가능한 신뢰 뱃지 (C — 별점 대신 사실, 검증가능신뢰_설계.md).
 *
 * 엔젤이 자발 공개한 TrustSummary(위조가 어려운 사실)를 뱃지 줄로 보여준다. 서버는
 * 코드·숫자·일자만 주므로 문구는 전부 i18n 사전(t.trust)에서 온다. 위조가 어려운 것
 * (커뮤니티 인정 완주·교차 목격 걷기 실적·검토단 검증)은 강조색, 활동 기간·인증 수·
 * 감사 카드는 연한 색. 정확한 코인 액수는 데이터에 없다(walkTier 구간만).
 *
 * XSS 안전: 모든 값은 사전 함수가 만든 문자열·숫자이며 JSX 텍스트 자식으로만 넣는다.
 */
import type { TrustSummary } from '@/lib/api';
import { useI18n } from '@/i18n';

export default function TrustBadges({
  trust,
  compact = false,
}: {
  trust: TrustSummary | null;
  compact?: boolean;
}) {
  const { t } = useI18n();
  if (!trust) return null;
  const s = t.trust;

  const badges: { key: string; label: string; strong?: boolean }[] = [];
  if (trust.walkTier !== 'NONE') {
    badges.push({ key: 'walk', label: s.walkTier(trust.walkTier), strong: true });
  }
  if (trust.claimsApproved > 0) {
    badges.push({ key: 'claims', label: s.claimsApproved(trust.claimsApproved), strong: true });
  }
  if (trust.leaderboardVerified) {
    badges.push({ key: 'verified', label: s.verified, strong: true });
  }
  badges.push({ key: 'since', label: s.memberSince(trust.memberSinceDay) });

  if (!compact) {
    if (trust.certificatesFull > 0) {
      badges.push({ key: 'certFull', label: s.certificatesFull(trust.certificatesFull) });
    }
    if (trust.certificatesSection > 0) {
      badges.push({ key: 'certSec', label: s.certificatesSection(trust.certificatesSection) });
    }
    if (trust.angel) {
      if (trust.angel.firstHosting) badges.push({ key: 'hosting', label: s.firstHosting });
      if (trust.angel.guestbookCards > 0) {
        badges.push({ key: 'cards', label: s.guestbookCards(trust.angel.guestbookCards) });
      }
    }
  }

  return (
    <div className="trust-badges" role="group" aria-label={s.title}>
      {badges.map((b) => (
        <span key={b.key} className={b.strong ? 'trust-badge trust-badge-strong' : 'trust-badge'}>
          {b.label}
        </span>
      ))}
    </div>
  );
}
