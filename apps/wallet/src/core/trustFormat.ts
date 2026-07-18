/**
 * 신뢰 지표 표시 헬퍼 (C — 별점 대신 사실, 검증가능신뢰_설계.md).
 *
 * 서버는 뱃지 코드·숫자·일자만 주므로(TrustSummary), 그것을 사람이 읽는 뱃지 줄로
 * 옮긴다. 위조가 어려운 것(커뮤니티 인정 완주·교차 목격 걷기 실적·활동 기간)을 앞에,
 * 보조 지표(인증 수·감사 카드)를 뒤에 둔다. 순수 TS라 vitest로 검증한다.
 *
 * ★정확한 코인 액수는 애초에 데이터에 없다(walkTier 구간 코드만) — 개인 재정 비노출.
 */
import { currentOwnerAddress, type Coin, type TrustSummary, type TrustWalkTier } from '@shvil/shared';

export interface TrustBadge {
  key: string;
  label: string;
  /** 위조가 어려운 핵심 지표 = 강조. 보조 지표 = false. */
  strong: boolean;
}

/** 걷기 실적 구간 뱃지 한국어 라벨 (지갑은 현재 단일 언어). NONE은 호출부가 제외. */
export function walkTierLabel(tier: Exclude<TrustWalkTier, 'NONE'>): string {
  switch (tier) {
    case 'VETERAN':
      return '베테랑 트레커';
    case 'EXPERIENCED':
      return '경험 많은 트레커';
    case 'STARTER':
      return '걷기 시작';
  }
}

/**
 * TrustSummary → 뱃지 목록 (견고성 순). compact=true면 핵심 몇 개만.
 * 아무 뱃지도 없을 수 있다(활동 기간은 항상 있으므로 최소 1개는 나온다).
 */
export function trustBadges(trust: TrustSummary, compact = false): TrustBadge[] {
  const out: TrustBadge[] = [];
  if (trust.walkTier !== 'NONE') {
    out.push({ key: 'walk', label: walkTierLabel(trust.walkTier), strong: true });
  }
  if (trust.claimsApproved > 0) {
    out.push({ key: 'claims', label: `커뮤니티 인정 완주 ${trust.claimsApproved}`, strong: true });
  }
  if (trust.leaderboardVerified) {
    out.push({ key: 'verified', label: '검토단 검증', strong: true });
  }
  out.push({ key: 'since', label: `${trust.memberSinceDay}부터 활동`, strong: false });

  if (!compact) {
    if (trust.certificatesFull > 0) {
      out.push({ key: 'certFull', label: `완주 인증 ${trust.certificatesFull}`, strong: false });
    }
    if (trust.certificatesSection > 0) {
      out.push({ key: 'certSec', label: `구간 인증 ${trust.certificatesSection}`, strong: false });
    }
    if (trust.angel) {
      if (trust.angel.firstHosting) out.push({ key: 'hosting', label: '접대 경험 있음', strong: false });
      if (trust.angel.guestbookCards > 0) {
        out.push({ key: 'cards', label: `감사 카드 ${trust.angel.guestbookCards}`, strong: false });
      }
    }
  }
  return out;
}

// ── 검증 실적 기여 (안 A) ─────────────────────────────────────────

/** 한 번에 올릴 코인 수 상한 (서버 POST /trust/coins 계약과 동일). */
export const TRUST_CONTRIBUTE_MAX = 100;

/**
 * 기여 후보 고르기 — 내가 **지금 보유**하고 있고 **남이 만든** 걷기 코인만.
 *
 * 서버가 최종 관문이지만(verifyCoin + 실보유·SELF 검사) 지갑도 보낼 것만 보낸다:
 *  - 자기 코인: 자기 실적이 될 수 없다(서버 SELF 배제) → 안 보낸다.
 *  - GRANT 계보(보너스·보물·클레임): 걸음이 아니다 → 안 보낸다.
 *  - 내가 소유자가 아닌 코인: 서버가 거부한다 → 안 보낸다.
 * 순수 함수라 vitest로 검증한다 (expo 모듈 import 금지 규약).
 */
export function pickWalkCreditCandidates(coins: Coin[], myMemberId: string, myAddress: string): Coin[] {
  const out: Coin[] = [];
  for (const coin of coins) {
    if (out.length >= TRUST_CONTRIBUTE_MAX) break;
    // 뿌리가 걷기인 코인만 실적이 된다.
    let root = coin;
    while (root.provenance.kind === 'SPLIT') root = root.provenance.parent;
    if (root.provenance.kind !== 'WALK') continue;
    if (coin.memberId === myMemberId) continue;
    try {
      if (currentOwnerAddress(coin) !== myAddress) continue;
    } catch {
      continue;
    }
    out.push(coin);
  }
  return out;
}
