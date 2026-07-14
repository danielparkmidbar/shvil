import { describe, expect, it } from 'vitest';
import {
  serializeBookingPayload,
  type BookingReplyPayload,
  type BookingRequestPayload,
} from '@shvil/shared';
import type { ChatMessageRow } from '../db';
import { SENDER_UNVERIFIED_PREFIX } from '../chatFormat';
import {
  buildGuestInbox,
  chatPreviewText,
  fmtBookingDates,
  parseChatBooking,
  replyStatusLabel,
} from '../bookingFormat';

const REQ: BookingRequestPayload = {
  kind: 'BOOKING_REQUEST',
  requestId: 'bkg-00112233aabbccdd',
  dates: { fromDate: '2026-07-20', toDate: '2026-07-21' },
  partySize: 2,
  note: '텐트도 좋아요',
  profile: { displayName: '리오르', memberSince: '2026-05', journeyLine: '북부 구간 걷는 중' },
};

const REPLY_OK: BookingReplyPayload = {
  kind: 'BOOKING_REPLY',
  requestId: REQ.requestId,
  decision: 'APPROVED',
  preciseLocation: { lat: 33.22947, lon: 35.65513 },
  addressText: '파란 대문 집',
};

function row(partial: Partial<ChatMessageRow> & Pick<ChatMessageRow, 'direction' | 'text'>): ChatMessageRow {
  return { id: 1, peerMemberId: 'SHV-111111', sentAt: 1_000, ...partial };
}

describe('예약 메시지 판별·표시 (M6)', () => {
  it('구조화 메시지를 판별하고, 서명 경고 표식이 붙어도 벗겨서 판별한다', () => {
    const text = serializeBookingPayload(REQ);
    expect(parseChatBooking(text)).toEqual(REQ);
    expect(parseChatBooking(SENDER_UNVERIFIED_PREFIX + text)).toEqual(REQ);
  });

  it('일반 텍스트는 null (하위 호환 폴백)', () => {
    expect(parseChatBooking('저녁 7시 도착 예정입니다')).toBeNull();
  });

  it('미리보기: 신청·회신이 원문 JSON 대신 한 줄 요약으로 나온다', () => {
    expect(chatPreviewText(serializeBookingPayload(REQ))).toContain('투숙 신청');
    expect(chatPreviewText(serializeBookingPayload(REQ))).toContain('2026-07-20 ~ 2026-07-21');
    expect(chatPreviewText(serializeBookingPayload(REPLY_OK))).toContain('승인');
    expect(chatPreviewText('그냥 문자')).toBe('그냥 문자');
  });

  it('같은 날짜 1박은 단일 날짜로 표기한다', () => {
    expect(fmtBookingDates({ fromDate: '2026-07-20', toDate: '2026-07-20' })).toBe('2026-07-20');
  });
});

describe('손님 수신함 파생 (엔젤 모드 — 로컬 메시지에서만)', () => {
  it('수신 신청과 발신 회신을 requestId로 짝짓는다', () => {
    const messages: ChatMessageRow[] = [
      row({ id: 1, direction: 'IN', text: serializeBookingPayload(REQ), sentAt: 1_000 }),
      row({ id: 2, direction: 'OUT', text: serializeBookingPayload(REPLY_OK), sentAt: 2_000 }),
    ];
    const inbox = buildGuestInbox(messages);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.request).toEqual(REQ);
    expect(inbox[0]!.reply?.decision).toBe('APPROVED');
    expect(inbox[0]!.repliedAt).toBe(2_000);
  });

  it('미회신 신청이 회신 완료보다 앞에 온다', () => {
    const otherReq: BookingRequestPayload = { ...REQ, requestId: 'bkg-ffeeddccbbaa0011' };
    const messages: ChatMessageRow[] = [
      row({ id: 1, direction: 'IN', text: serializeBookingPayload(REQ), sentAt: 1_000 }),
      row({ id: 2, direction: 'OUT', text: serializeBookingPayload(REPLY_OK), sentAt: 2_000 }),
      row({ id: 3, peerMemberId: 'SHV-222222', direction: 'IN', text: serializeBookingPayload(otherReq), sentAt: 500 }),
    ];
    const inbox = buildGuestInbox(messages);
    expect(inbox.map((i) => i.requestId)).toEqual(['bkg-ffeeddccbbaa0011', REQ.requestId]);
  });

  it('상대가 보낸(IN) 회신·내가 보낸(OUT) 신청은 수신함에 넣지 않는다', () => {
    const messages: ChatMessageRow[] = [
      row({ id: 1, direction: 'OUT', text: serializeBookingPayload(REQ) }), // 내가 보낸 신청 (리스트 모드)
      row({ id: 2, direction: 'IN', text: serializeBookingPayload(REPLY_OK) }), // 상대의 회신
      row({ id: 3, direction: 'IN', text: '일반 텍스트' }),
    ];
    expect(buildGuestInbox(messages)).toHaveLength(0);
  });

  it('회신 상태 라벨', () => {
    expect(replyStatusLabel(null)).toBe('대기 중');
    expect(replyStatusLabel(REPLY_OK)).toBe('승인함');
    expect(replyStatusLabel({ kind: 'BOOKING_REPLY', requestId: REQ.requestId, decision: 'DECLINED' })).toBe('거절함');
  });
});
