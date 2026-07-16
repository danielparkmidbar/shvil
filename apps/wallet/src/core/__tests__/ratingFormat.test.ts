import { describe, expect, it } from 'vitest';
import {
  aggregateReceived,
  buildReceivedRatings,
  findBookingRelationProof,
  inferDirection,
  parseChatRating,
  publishableReceivedRatings,
  ratingPreviewText,
  starGlyphs,
  verifyRelationProof,
} from '../ratingFormat';
import { SENDER_UNVERIFIED_PREFIX } from '../chatFormat';
import { newRatingId, serializeRatingPayload, type RatingCardPayload } from '@shvil/shared';
import type { ChatMessageRow } from '../db';

function ratingText(overrides: Partial<RatingCardPayload> = {}): string {
  const card: RatingCardPayload = {
    kind: 'RATING',
    ratingId: newRatingId(),
    stars: 5,
    review: '고맙습니다',
    fromDisplayName: '리오르',
    direction: 'GUEST_TO_ANGEL',
    relationProof: { kind: 'BOOKING_APPROVAL', requestId: 'bkg-0011223344556677' },
    makePublic: true,
    ...overrides,
  };
  return serializeRatingPayload(card);
}

function msg(partial: Partial<ChatMessageRow> & { text: string; direction: 'IN' | 'OUT' }): ChatMessageRow {
  return { id: 1, peerMemberId: 'SHV-222222', sentAt: 1000, ...partial };
}

describe('별점 채팅 파싱 · 미리보기', () => {
  it('별점 텍스트를 카드로 판별한다 (서명 경고 표식도 벗긴다)', () => {
    const text = ratingText({ stars: 4 });
    expect(parseChatRating(text)?.stars).toBe(4);
    expect(parseChatRating(SENDER_UNVERIFIED_PREFIX + text)?.stars).toBe(4);
  });

  it('일반 텍스트는 null', () => {
    expect(parseChatRating('좋았어요')).toBeNull();
  });

  it('미리보기는 별 글리프 + 라벨, 별점이 아니면 null', () => {
    expect(ratingPreviewText(ratingText({ stars: 3 }))).toBe('★★★☆☆ 별점');
    expect(ratingPreviewText('안녕하세요')).toBeNull();
  });

  it('starGlyphs는 1~5로 클램프한다', () => {
    expect(starGlyphs(5)).toBe('★★★★★');
    expect(starGlyphs(0)).toBe('☆☆☆☆☆');
    expect(starGlyphs(3)).toBe('★★★☆☆');
  });
});

describe('받은 별점 파생 · 집계', () => {
  it('수신(IN) 별점만, 최신순, 같은 ratingId는 최초만', () => {
    const dup = ratingText();
    const messages: ChatMessageRow[] = [
      msg({ id: 1, text: ratingText({ stars: 2 }), direction: 'IN', sentAt: 100 }),
      msg({ id: 2, text: dup, direction: 'IN', sentAt: 300 }),
      msg({ id: 3, text: dup, direction: 'IN', sentAt: 200 }), // 같은 ratingId 재수신
      msg({ id: 4, text: ratingText({ stars: 5 }), direction: 'OUT', sentAt: 400 }), // 내가 준 것 — 제외
      msg({ id: 5, text: '일반 텍스트', direction: 'IN', sentAt: 500 }),
    ];
    const received = buildReceivedRatings(messages);
    expect(received).toHaveLength(2);
    expect(received[0]!.receivedAt).toBe(300); // 최신 먼저
    const agg = aggregateReceived(received);
    expect(agg.count).toBe(2);
    expect(agg.publicCount).toBe(2);
  });
});

describe('관계 증명 탐색 (자격 — 예약 승인)', () => {
  const approvedReply = JSON.stringify({
    kind: 'BOOKING_REPLY',
    requestId: 'bkg-00aabbccddeeff00',
    decision: 'APPROVED',
  });
  const declinedReply = JSON.stringify({
    kind: 'BOOKING_REPLY',
    requestId: 'bkg-1122334455667788',
    decision: 'DECLINED',
  });

  it('대화에 승인 회신이 있으면 그 신청 id로 관계 증명을 만든다', () => {
    const messages = [msg({ text: approvedReply, direction: 'OUT' })];
    expect(findBookingRelationProof(messages, 'SHV-222222')).toEqual({
      kind: 'BOOKING_APPROVAL',
      requestId: 'bkg-00aabbccddeeff00',
    });
  });

  it('거절 회신만 있으면 관계 증명 없음 (null)', () => {
    const messages = [msg({ text: declinedReply, direction: 'IN' })];
    expect(findBookingRelationProof(messages, 'SHV-222222')).toBeNull();
  });

  it('다른 상대의 승인은 무관 (null)', () => {
    const messages = [msg({ text: approvedReply, direction: 'OUT', peerMemberId: 'SHV-999999' })];
    expect(findBookingRelationProof(messages, 'SHV-222222')).toBeNull();
  });
});

describe('별점 방향 추론', () => {
  it('엔젤 모드는 손님을, 리스트 모드는 엔젤을 평가', () => {
    expect(inferDirection('ANGEL')).toBe('ANGEL_TO_GUEST');
    expect(inferDirection('LIST')).toBe('GUEST_TO_ANGEL');
  });
});

describe('관계 증명 대조 — 받은 별점 게시 게이트 (조건 2, 낯선 가짜 별점 거르기)', () => {
  const approvedReply = (requestId: string) =>
    JSON.stringify({ kind: 'BOOKING_REPLY', requestId, decision: 'APPROVED' });

  it('BOOKING_APPROVAL이 이 상대와의 예약 이력과 대조되면 verified', () => {
    const proof = { kind: 'BOOKING_APPROVAL', requestId: 'bkg-0011223344556677' } as const;
    const messages = [msg({ text: approvedReply('bkg-0011223344556677'), direction: 'OUT' })];
    expect(verifyRelationProof(proof, 'SHV-222222', messages, new Set())).toBe(true);
  });

  it('대조되는 예약이 없거나 다른 상대면 unverified', () => {
    const proof = { kind: 'BOOKING_APPROVAL', requestId: 'bkg-0011223344556677' } as const;
    expect(verifyRelationProof(proof, 'SHV-222222', [], new Set())).toBe(false);
    const otherPeer = [
      msg({ text: approvedReply('bkg-0011223344556677'), direction: 'OUT', peerMemberId: 'SHV-999999' }),
    ];
    expect(verifyRelationProof(proof, 'SHV-222222', otherPeer, new Set())).toBe(false);
  });

  it('PAYMENT_COIN은 이 지갑이 아는 코인 id면 verified, 모르면 unverified', () => {
    const coinId = 'a'.repeat(64);
    const proof = { kind: 'PAYMENT_COIN', coinId } as const;
    expect(verifyRelationProof(proof, 'SHV-222222', [], new Set([coinId]))).toBe(true);
    expect(verifyRelationProof(proof, 'SHV-222222', [], new Set())).toBe(false);
  });

  it('buildReceivedRatings가 relationVerified를 채우고, 미대조 카드는 게시 후보에서 제외', () => {
    const verifiedCard = ratingText({
      relationProof: { kind: 'BOOKING_APPROVAL', requestId: 'bkg-00aabbccddeeff00' },
    });
    const strangerCard = ratingText({
      relationProof: { kind: 'BOOKING_APPROVAL', requestId: 'bkg-1122334455667788' },
    });
    const messages = [
      msg({ id: 1, text: approvedReply('bkg-00aabbccddeeff00'), direction: 'OUT', sentAt: 50 }),
      msg({ id: 2, text: verifiedCard, direction: 'IN', sentAt: 100 }),
      msg({ id: 3, text: strangerCard, direction: 'IN', sentAt: 200 }), // 대조되는 예약 없음
    ];
    const received = buildReceivedRatings(messages);
    expect(received.some((r) => r.relationVerified)).toBe(true);
    expect(received.some((r) => !r.relationVerified)).toBe(true);
    // 게시 후보엔 대조 통과 카드만 남는다 (낯선 가짜 별점 제외).
    const candidates = publishableReceivedRatings(received);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.relationVerified).toBe(true);
  });

  it('공개 미동의(makePublic=false)면 대조되어도 게시 후보 제외', () => {
    const card = ratingText({
      makePublic: false,
      relationProof: { kind: 'BOOKING_APPROVAL', requestId: 'bkg-00aabbccddeeff00' },
    });
    const messages = [
      msg({ id: 1, text: approvedReply('bkg-00aabbccddeeff00'), direction: 'OUT', sentAt: 50 }),
      msg({ id: 2, text: card, direction: 'IN', sentAt: 100 }),
    ];
    const received = buildReceivedRatings(messages);
    expect(received[0]!.relationVerified).toBe(true);
    expect(publishableReceivedRatings(received)).toHaveLength(0);
  });
});
