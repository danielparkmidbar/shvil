/**
 * 별점 표시·수신·관계 증명 파생 — 순수 함수 (expo 무의존, vitest 테스트 대상).
 *
 * 별점은 E2E 메시지다 (M7-B, 안 B). 기기 안 chat_messages(복호화 평문)를 스캔해
 * 수신 별점을 파생하고, 자격(관계) 증명을 대화 이력에서 찾는다. 구조화 메시지
 * 판별·검증·집계는 @shvil/shared rating.ts. booking·thanksCard 파서와 kind로 분기
 * 되어 공존한다.
 */
import {
  aggregateRatings,
  parseBookingPayload,
  parseRatingPayload,
  type RatingAggregate,
  type RatingCardPayload,
  type RatingDirection,
  type RatingRelationProof,
} from '@shvil/shared';
import type { ChatMessageRow } from './db';
import { SENDER_UNVERIFIED_PREFIX } from './chatFormat';

/** 채팅 저장 텍스트에서 별점을 판별한다 (서명 경고 표식은 벗기고). */
export function parseChatRating(text: string): RatingCardPayload | null {
  const body = text.startsWith(SENDER_UNVERIFIED_PREFIX)
    ? text.slice(SENDER_UNVERIFIED_PREFIX.length)
    : text;
  return parseRatingPayload(body);
}

/** 방향별 한 줄 라벨 (한국어 UI). */
export const RATING_DIRECTION_LABEL: Record<RatingDirection, string> = {
  GUEST_TO_ANGEL: '손님 → 엔젤',
  ANGEL_TO_GUEST: '엔젤 → 손님',
};

/** 별 개수를 ★/☆로 (1~5). */
export function starGlyphs(stars: number): string {
  const n = Math.max(0, Math.min(5, Math.round(stars)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

/** 대화 목록 미리보기 — 별점이면 한 줄 요약, 아니면 null (호출부가 폴백). */
export function ratingPreviewText(text: string): string | null {
  const rating = parseChatRating(text);
  if (!rating) return null;
  return `${starGlyphs(rating.stars)} 별점`;
}

/**
 * 받은 별점의 관계 증명(relationProof)을 피평가자 자기 로컬 이력과 대조한다 (M7-B 조건 2).
 *
 * 정직화 반영: 이 대조가 통과해야 "실제 나와 관계있는 평가자"로 인정한다 — rating.ts
 * 주석 (c)를 코드로 실재화한 것이다. 낯선 사람이 관계 없이 보낸 가짜 별점(예: 프로필
 * 오염 목적)을 게시 후보에서 걸러 낸다.
 *   - BOOKING_APPROVAL: 그 신청 식별자(requestId)를 참조하는 예약 메시지가 이 상대와의
 *     내 대화 이력에 실재하는가 (신청·회신 어느 쪽이든 — 관계는 양방향).
 *   - PAYMENT_COIN: 그 코인 id를 이 지갑이 실제로 아는가 (보유·사용 완료 코인 집합).
 *
 * ⚠ 한계 (정직히 남긴다): 이 게이트는 **정직한(미수정) 클라이언트에서만** 동작한다.
 * 수정된 클라이언트나 서버 API 직접 호출은 우회한다 — 서버 강제는 relationProof를
 * 서버로 보내야 하므로 프라이버시(안 B)를 양보하게 되어 하지 않는다. 즉 이것은
 * 프로필 주인의 자기 날조를 막지 못한다(그 근본 해결은 다니엘 쌤 결정 대기, R-1d).
 */
export function verifyRelationProof(
  proof: RatingRelationProof,
  peerMemberId: string,
  messages: readonly ChatMessageRow[],
  knownCoinIds: ReadonlySet<string>,
): boolean {
  if (proof.kind === 'BOOKING_APPROVAL') {
    for (const m of messages) {
      if (m.peerMemberId !== peerMemberId) continue;
      const body = m.text.startsWith(SENDER_UNVERIFIED_PREFIX)
        ? m.text.slice(SENDER_UNVERIFIED_PREFIX.length)
        : m.text;
      const booking = parseBookingPayload(body);
      if (booking && booking.requestId === proof.requestId) return true;
    }
    return false;
  }
  // PAYMENT_COIN — 오간 코인의 id를 이 지갑이 실제로 아는지 대조.
  return knownCoinIds.has(proof.coinId);
}

/** 피평가자가 받은 별점 한 건 (게시 후보). */
export interface ReceivedRating {
  card: RatingCardPayload;
  /** 보낸 사람 회원 번호 (대화 상대). */
  peerMemberId: string;
  receivedAt: number;
  /**
   * 관계 증명이 내 로컬 이력과 대조되었는가 (M7-B 조건 2). false면 낯선/가짜 별점
   * 후보 — 게시 후보에서 제외하고 UI가 경고한다. 정직한 클라이언트 한정 방어.
   */
  relationVerified: boolean;
}

/**
 * 기기 내 전체 대화에서 수신(IN) 별점을 추린다 — 최신순, 같은 ratingId는 최초만.
 * 피평가자로서 "받은 별점" 목록·게시 후보로 쓴다.
 *
 * knownCoinIds: 이 지갑이 아는 코인 id 집합 (PAYMENT_COIN 관계 증명 대조용). 미지정
 * 시 빈 집합 — 그 경우 PAYMENT_COIN 카드는 대조 불가로 relationVerified=false가 된다.
 */
export function buildReceivedRatings(
  messages: ChatMessageRow[],
  knownCoinIds: ReadonlySet<string> = new Set(),
): ReceivedRating[] {
  const collected: ReceivedRating[] = [];
  for (const m of messages) {
    if (m.direction !== 'IN') continue;
    const card = parseChatRating(m.text);
    if (!card) continue;
    const relationVerified = verifyRelationProof(card.relationProof, m.peerMemberId, messages, knownCoinIds);
    collected.push({ card, peerMemberId: m.peerMemberId, receivedAt: m.sentAt, relationVerified });
  }
  collected.sort((a, b) => b.receivedAt - a.receivedAt);
  const seen = new Set<string>();
  return collected.filter((r) => {
    if (seen.has(r.card.ratingId)) return false;
    seen.add(r.card.ratingId);
    return true;
  });
}

/**
 * 프로필 게시 후보만 — 평가자 공개 동의(makePublic) + 관계 대조 통과(relationVerified).
 * 미동의·미대조 카드는 제외한다 (조건 2: 낯선 가짜 별점이 프로필로 올라가지 않게).
 */
export function publishableReceivedRatings(received: readonly ReceivedRating[]): ReceivedRating[] {
  return received.filter((r) => r.card.makePublic && r.relationVerified);
}

/** 받은 별점 집계 (피평가자 지갑의 자기 view — 받은 총 개수·평균·공개 후보 수). */
export function aggregateReceived(received: readonly ReceivedRating[]): RatingAggregate {
  return aggregateRatings(received.map((r) => r.card));
}

/**
 * 대화 이력에서 이 상대와의 관계 증명을 찾는다 (자격: 예약 승인).
 *
 * 상대와의 대화에서 BOOKING_REPLY(APPROVED)를 찾으면 그 신청 식별자를 참조하는
 * 관계 증명을 만든다 — 방향 무관(내가 승인했든, 상대가 나를 승인했든 관계는 성립).
 * 없으면 null (관계가 확인되지 않으면 별점 진입점을 노출하지 않는다 — 제1원칙).
 * 지불 코인 기반 증명(PAYMENT_COIN)은 호출부가 코인 id로 직접 만들어 넘긴다.
 */
export function findBookingRelationProof(
  messages: ChatMessageRow[],
  peerMemberId: string,
): RatingRelationProof | null {
  for (const m of messages) {
    if (m.peerMemberId !== peerMemberId) continue;
    const payload = parseBookingPayload(
      m.text.startsWith(SENDER_UNVERIFIED_PREFIX) ? m.text.slice(SENDER_UNVERIFIED_PREFIX.length) : m.text,
    );
    if (payload && payload.kind === 'BOOKING_REPLY' && payload.decision === 'APPROVED') {
      return { kind: 'BOOKING_APPROVAL', requestId: payload.requestId };
    }
  }
  return null;
}

/**
 * 별점 방향 추론 — 관계 증명 상대와 내 모드로부터. 엔젤 모드면 손님을 평가(ANGEL_TO_GUEST),
 * 리스트 모드면 엔젤을 평가(GUEST_TO_ANGEL). 상호 양방향을 이 한 값으로 표기한다.
 */
export function inferDirection(myMode: 'ANGEL' | 'LIST'): RatingDirection {
  return myMode === 'ANGEL' ? 'ANGEL_TO_GUEST' : 'GUEST_TO_ANGEL';
}
