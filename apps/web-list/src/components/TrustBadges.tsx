'use client';

/**
 * 검증 가능한 신뢰 뱃지 (C — 별점 대신 사실, 검증가능신뢰_설계.md).
 *
 * 게시자·엔젤이 자발 공개한 TrustSummary(위조가 어려운 사실)를 뱃지 줄로 보여준다.
 * 서버는 코드·숫자·일자만 주므로 문구는 전부 i18n 사전(t.trust)에서 온다. 위조가
 * 어려운 것(커뮤니티 인정 완주·교차 목격 걷기 실적·활동 기간)을 앞에, 보조 지표
 * (인증 수·감사 카드)를 뒤에 둔다. 정확한 코인 액수는 애초에 데이터에 없다(구간만).
 *
 * XSS 안전: 모든 값은 사전 함수가 만든 문자열·숫자이며 JSX 텍스트 자식으로만 넣는다.
 */
import type { TrustSummary } from '@/lib/api';
import { useI18n } from '@/i18n';

/** 신뢰 뱃지를 컴팩트하게(핵심 몇 개) 또는 전체로 표시. */
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

  // 위조가 어려운 것 우선 (견고성 순) —
  if (trust.walkTier !== 'NONE') {
    badges.push({ key: 'walk', label: s.walkTier(trust.walkTier), strong: true });
  }
  if (trust.claimsApproved > 0) {
    badges.push({ key: 'claims', label: s.claimsApproved(trust.claimsApproved), strong: true });
  }
  if (trust.leaderboardVerified) {
    badges.push({ key: 'verified', label: s.verified, strong: true });
  }
  // 활동 기간 (소급 위조 불가) —
  badges.push({ key: 'since', label: s.memberSince(trust.memberSinceDay) });

  // 보조 지표 (compact에서는 생략) —
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
        <span key={b.key} className={b.strong ? 'badge badge-strong' : 'badge'}>
          {b.label}
        </span>
      ))}
    </div>
  );
}
