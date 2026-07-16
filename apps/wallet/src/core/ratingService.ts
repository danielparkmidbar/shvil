/**
 * 상호 별점 서비스 — M7-B (별점_프라이버시_결정 안 B, 헌법 제5조·제9조).
 *
 * 감사 카드 서비스와 같은 사상이다. 발송은 E2E 메시지고(chatService.sendMessage로
 * 봉인), 서버는 암호문 봉투만 중계한다. 게시/철회만 서버 왕복이 있으며, 이는
 * 피평가자가 받은 별점을 자발 공개하는 행위다 (서버는 원본 카드를 못 본다).
 *
 * ── 은폐/날조 방어 (안 B) — 완화일 뿐, 근본 진위는 보장하지 못한다 ────────
 * (a) 별점은 E2E 서명 → 피평가자가 자기가 받은 카드의 점수를 (정직한 클라이언트
 *     안에서) 위조할 수 없다. 단 공개 게시 값은 서명 없이 서버로 가므로 그 진위는
 *     보장되지 않는다 — 공개 별점은 "참고 지표"다 (rating.ts 정직화 주석 참조).
 * (b) 준 별점의 사본을 이 기기(given_ratings)에 보관 → 분쟁 시 평가자가 증명 가능.
 * (c) 관계 증명(relationProof) 대조 → 피평가자 지갑이 받은 카드의 관계 증명을 자기
 *     로컬 이력과 대조해(ratingFormat.ts verifyRelationProof) 대조 실패 카드를 게시
 *     후보에서 제외한다 (loadReceivedRatings가 relationVerified를 채운다). 낯선 가짜
 *     별점을 거른다 — 정직한(미수정) 클라이언트 한정, 서버 강제 아님.
 * relationProof는 게시(POST /ratings)에 포함하지 않는다 — 서버로 가면 관계망이
 * 남으므로(안 B 위배). 그것은 E2E 카드 안에만 있고 피평가자 지갑이 검증한다.
 * ⚠ 프로필 주인의 자기 날조(가짜 5★ 게시)는 위 어느 것으로도 막지 못한다 — 근본
 *   해결은 다니엘 쌤 결정 대기 (별점_프라이버시_결정.md R-1d).
 */
import {
  newRatingId,
  serializeRatingPayload,
  type RatingCardPayload,
  type RatingDirection,
  type RatingRelationProof,
} from '@shvil/shared';
import { chatService } from './chatService';
import { directoryApi } from './directory';
import {
  loadAllChatMessages,
  loadCoinsForSync,
  loadGivenRatings,
  saveGivenRating,
  type GivenRatingRow,
} from './db';
import { buildReceivedRatings, type ReceivedRating } from './ratingFormat';

export interface SendRatingArgs {
  peerMemberId: string;
  stars: number;
  review?: string;
  fromDisplayName: string;
  direction: RatingDirection;
  /** 관계 증명 (자격) — 예약 승인 참조 또는 지불 코인 id 참조. */
  relationProof: RatingRelationProof;
  /** 피평가자 공개 허용 동의. */
  makePublic: boolean;
}

/**
 * 별점 발송 (상호 양방향). 형식 위반·미가입·오프라인은 throw (호출부 알림).
 * 발송과 동시에 **준 별점의 사본을 보관**한다 (분쟁 대비 — 안 B (b)).
 */
export async function sendRating(args: SendRatingArgs): Promise<RatingCardPayload> {
  const payload: RatingCardPayload = {
    kind: 'RATING',
    ratingId: newRatingId(),
    stars: args.stars,
    ...(args.review && args.review.trim() !== '' ? { review: args.review.trim() } : {}),
    fromDisplayName: args.fromDisplayName.trim(),
    direction: args.direction,
    relationProof: args.relationProof,
    makePublic: args.makePublic,
  };
  const plaintext = serializeRatingPayload(payload); // 형식 위반이면 여기서 throw
  await chatService.sendMessage(args.peerMemberId, plaintext);
  // 분쟁 대비 사본 — 서버로 가지 않는다 (이 기기 안에만).
  await saveGivenRating(payload.ratingId, args.peerMemberId, plaintext, Date.now());
  return payload;
}

/**
 * 내가 받은 별점 목록 (피평가자 view) — 기기 내 대화에서 파생.
 * 관계 증명 대조(조건 2)를 위해 내 대화 이력 + 아는 코인 id 집합을 함께 넘긴다 —
 * 각 카드의 relationVerified가 채워진다 (대조 실패 카드는 게시 후보에서 제외된다).
 */
export async function loadReceivedRatings(): Promise<ReceivedRating[]> {
  const [messages, coins] = await Promise.all([loadAllChatMessages(), loadCoinsForSync()]);
  const knownCoinIds = new Set(coins.map((c) => c.id));
  return buildReceivedRatings(messages, knownCoinIds);
}

/** 내가 준 별점 사본 (분쟁 대비 확인용). */
export async function loadMyGivenRatings(): Promise<GivenRatingRow[]> {
  return loadGivenRatings();
}

/**
 * 받은 별점 하나를 프로필에 공개 게시한다.
 * makePublic=true(평가자 동의)인 별점만 — 서버는 원본을 못 보므로 이 확인은 지갑의 몫.
 * receivedCount(자발 신고 받은 총 개수)를 함께 보내 공개율 분모를 갱신한다 —
 * 관계 증명은 보내지 않는다 (프라이버시 핵심).
 */
export async function publishRating(card: RatingCardPayload, receivedCount: number): Promise<void> {
  if (!card.makePublic) {
    throw new Error('평가자가 공개에 동의하지 않은 별점입니다.');
  }
  await directoryApi.publishRating({
    ratingId: card.ratingId,
    stars: card.stars,
    ...(card.review ? { review: card.review } : {}),
    fromDisplayName: card.fromDisplayName,
    direction: card.direction,
    receivedCount,
  });
}

/** 게시 철회 — 피평가자 자기 프로필의 별점만. */
export async function unpublishRating(ratingId: string): Promise<void> {
  await directoryApi.removeRating(ratingId);
}

/** 내 프로필의 공개 별점 요약 조회 (피평가자). 실패 시 throw — 호출부가 폴백. */
export async function loadMyPublicRatings(memberId: string) {
  return directoryApi.getRatings(memberId);
}

/** 공개율 % — publicCount / receivedCount (분모 0이면 0). */
export function publicRatioPercent(publicCount: number, receivedCount: number): number {
  return receivedCount > 0 ? Math.round((publicCount / receivedCount) * 100) : 0;
}
