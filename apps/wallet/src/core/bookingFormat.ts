/**
 * 예약 메시지 표시·수신함 파생 — 순수 함수 (expo 무의존, vitest 테스트 대상).
 *
 * 예약 상태는 서버에 없다 (헌법 제9조 — 서버는 예약을 승인하지 않는다).
 * 기기 안 chat_messages(E2E 복호화된 평문)를 스캔해 신청↔회신을 requestId로
 * 짝지어 로컬에서 파생한다. 구조화 메시지 판별·검증은 @shvil/shared booking.ts.
 */
import {
  parseBookingPayload,
  type BookingDates,
  type BookingPayload,
  type BookingReplyPayload,
  type BookingRequestPayload,
} from '@shvil/shared';
import type { ChatMessageRow } from './db';
import { SENDER_UNVERIFIED_PREFIX } from './chatFormat';

/** 채팅 저장 텍스트에서 구조화 예약 메시지를 판별한다 (서명 경고 표식은 벗기고). */
export function parseChatBooking(text: string): BookingPayload | null {
  const body = text.startsWith(SENDER_UNVERIFIED_PREFIX)
    ? text.slice(SENDER_UNVERIFIED_PREFIX.length)
    : text;
  return parseBookingPayload(body);
}

/** 날짜 범위 표기 — "2026-07-20 ~ 2026-07-21" (1박이면 단일 날짜). */
export function fmtBookingDates(dates: BookingDates): string {
  return dates.fromDate === dates.toDate ? dates.fromDate : `${dates.fromDate} ~ ${dates.toDate}`;
}

/** 대화 목록 미리보기 — 구조화 메시지는 원문 JSON 대신 한 줄 요약으로. */
export function chatPreviewText(text: string): string {
  const payload = parseChatBooking(text);
  if (!payload) return text;
  if (payload.kind === 'BOOKING_REQUEST') {
    return `🛏 투숙 신청 · ${fmtBookingDates(payload.dates)} · ${payload.partySize}명`;
  }
  switch (payload.decision) {
    case 'APPROVED':
      return '✅ 투숙 승인 — 정확한 위치가 전달되었습니다';
    case 'DECLINED':
      return '🙏 투숙 거절';
    case 'SUGGEST':
      return payload.suggestedDates
        ? `📅 다른 날짜 제안 · ${fmtBookingDates(payload.suggestedDates)}`
        : '📅 다른 날짜 제안';
  }
}

// ── 손님 수신함 (엔젤 모드) ──────────────────────────────────────

export interface GuestInboxItem {
  requestId: string;
  /** 신청자 회원 번호 (대화 상대). */
  peerMemberId: string;
  request: BookingRequestPayload;
  receivedAt: number;
  /** 내가 보낸 회신 — 아직 없으면 null (대기 중). */
  reply: BookingReplyPayload | null;
  repliedAt: number | null;
}

/**
 * 기기 내 전체 대화에서 수신 BOOKING_REQUEST를 추리고, 발신 BOOKING_REPLY를
 * requestId로 짝지어 수신함을 만든다. 같은 requestId 재수신은 최신 것으로 갱신.
 * 정렬: 미회신 신청이 먼저, 그 안에서 최근 수신순.
 */
export function buildGuestInbox(messages: ChatMessageRow[]): GuestInboxItem[] {
  const items = new Map<string, GuestInboxItem>();
  const replies = new Map<string, { reply: BookingReplyPayload; at: number }>();

  for (const m of messages) {
    const payload = parseChatBooking(m.text);
    if (!payload) continue;
    if (m.direction === 'IN' && payload.kind === 'BOOKING_REQUEST') {
      items.set(payload.requestId, {
        requestId: payload.requestId,
        peerMemberId: m.peerMemberId,
        request: payload,
        receivedAt: m.sentAt,
        reply: null,
        repliedAt: null,
      });
    } else if (m.direction === 'OUT' && payload.kind === 'BOOKING_REPLY') {
      replies.set(payload.requestId, { reply: payload, at: m.sentAt });
    }
  }

  const list = [...items.values()].map((item) => {
    const r = replies.get(item.requestId);
    return r ? { ...item, reply: r.reply, repliedAt: r.at } : item;
  });
  list.sort((a, b) => {
    const aPending = a.reply === null ? 0 : 1;
    const bPending = b.reply === null ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
    return b.receivedAt - a.receivedAt;
  });
  return list;
}

/** 회신 상태 라벨 (손님 수신함 카드용). */
export function replyStatusLabel(reply: BookingReplyPayload | null): string {
  if (!reply) return '대기 중';
  switch (reply.decision) {
    case 'APPROVED':
      return '승인함';
    case 'DECLINED':
      return '거절함';
    case 'SUGGEST':
      return '다른 날짜 제안함';
  }
}
