/**
 * 예약(투숙 신청/승인) 서비스 — M6 (서비스 재조정 §4-2).
 *
 * 신청·회신은 전부 E2E 메시지다 — chatService.sendMessage로 봉인·발송되고,
 * 서버는 암호문 봉투만 중계한다. 서버에 예약 테이블은 없다 (헌법 제9조).
 *
 * - R-2: 첨부 프로필(닉네임·가입 시기·여정 한 줄)은 신청자가 동의해 첨부하는
 *   것이며, 이 기기(kv)와 상대 기기에만 남는다.
 * - R-4: 승인 회신의 정확 위치는 로컬 원본(angelProfile.v1 — 서버엔 눈금화
 *   좌표만 간 상태)에서 꺼내 첨부한다. 주소·연락처는 엔젤이 입력한 텍스트.
 */
import {
  newBookingRequestId,
  serializeBookingPayload,
  type BookingDates,
  type BookingReplyPayload,
  type BookingRequestPayload,
} from '@shvil/shared';
import { loadAngelProfile } from './angelService';
import { chatService } from './chatService';
import { kvGet, kvSet } from './db';
import { wallet } from './walletService';

/** 신청 폼 프로필 초안 (닉네임·여정 한 줄) — 다음 신청 때 미리 채움. */
const BOOKING_PROFILE_KEY = 'bookingProfile.v1';
/**
 * 가입 시기(YYYY-MM) — 처음 계산될 때 회원 증서 발급 시점으로 고정해 둔다.
 * (증서는 30일마다 갱신되므로 매번 읽으면 시기가 미끄러진다 — 첫 값을 보존.)
 */
const MEMBER_SINCE_KEY = 'member.sinceMonth.v1';

export interface BookingProfileDraft {
  displayName: string;
  journeyLine: string;
}

export async function loadBookingProfileDraft(): Promise<BookingProfileDraft | null> {
  const json = await kvGet(BOOKING_PROFILE_KEY);
  return json ? (JSON.parse(json) as BookingProfileDraft) : null;
}

export async function saveBookingProfileDraft(draft: BookingProfileDraft): Promise<void> {
  await kvSet(BOOKING_PROFILE_KEY, JSON.stringify(draft));
}

/** 가입 시기(YYYY-MM) — 회원 증서 기준, 최초 1회 고정. 미가입·증서 없음이면 undefined. */
export async function getMemberSinceMonth(): Promise<string | undefined> {
  const stored = await kvGet(MEMBER_SINCE_KEY);
  if (stored) return stored;
  const issuedAt = wallet.identity.membership?.issuedAt;
  if (!issuedAt) return undefined;
  const month = new Date(issuedAt).toISOString().slice(0, 7);
  await kvSet(MEMBER_SINCE_KEY, month);
  return month;
}

export interface SendBookingRequestArgs {
  peerMemberId: string;
  dates: BookingDates;
  partySize: number;
  note: string;
  profile: BookingProfileDraft;
}

/** 투숙 신청 발송 (리스트 → 엔젤). 형식 위반·미가입·오프라인은 throw (호출부 알림). */
export async function sendBookingRequest(args: SendBookingRequestArgs): Promise<BookingRequestPayload> {
  const memberSince = await getMemberSinceMonth();
  const payload: BookingRequestPayload = {
    kind: 'BOOKING_REQUEST',
    requestId: newBookingRequestId(),
    dates: args.dates,
    partySize: args.partySize,
    ...(args.note.trim() !== '' ? { note: args.note.trim() } : {}),
    profile: {
      displayName: args.profile.displayName.trim(),
      ...(memberSince ? { memberSince } : {}),
      ...(args.profile.journeyLine.trim() !== '' ? { journeyLine: args.profile.journeyLine.trim() } : {}),
      // rating: M7에서 — 자리만 스키마에 있다.
    },
  };
  const plaintext = serializeBookingPayload(payload); // 형식 위반이면 여기서 throw
  await saveBookingProfileDraft(args.profile);
  await chatService.sendMessage(args.peerMemberId, plaintext);
  return payload;
}

export interface ApproveBookingArgs {
  peerMemberId: string;
  requestId: string;
  addressText: string;
  contact: string;
  note: string;
}

/**
 * 승인 회신 — 로컬 원본 엔젤 프로필의 정확 위치(R-4: 서버는 모르는 좌표)를
 * 첨부해 이 손님에게만 E2E로 전달한다. 엔젤 포인트 미등록이면 throw.
 */
export async function approveBooking(args: ApproveBookingArgs): Promise<void> {
  const profile = await loadAngelProfile();
  if (!profile?.location) {
    throw new Error('내 엔젤 포인트의 위치를 먼저 등록하세요 (엔젤 모드 > 내 포인트).');
  }
  const payload: BookingReplyPayload = {
    kind: 'BOOKING_REPLY',
    requestId: args.requestId,
    decision: 'APPROVED',
    ...(args.note.trim() !== '' ? { note: args.note.trim() } : {}),
    preciseLocation: profile.location,
    ...(args.addressText.trim() !== '' ? { addressText: args.addressText.trim() } : {}),
    ...(args.contact.trim() !== '' ? { contact: args.contact.trim() } : {}),
  };
  await chatService.sendMessage(args.peerMemberId, serializeBookingPayload(payload));
}

/** 거절 회신 — 사유는 선택. 수락과 거절은 언제나 엔젤의 자유다 (헌법 제9조). */
export async function declineBooking(peerMemberId: string, requestId: string, note: string): Promise<void> {
  const payload: BookingReplyPayload = {
    kind: 'BOOKING_REPLY',
    requestId,
    decision: 'DECLINED',
    ...(note.trim() !== '' ? { note: note.trim() } : {}),
  };
  await chatService.sendMessage(peerMemberId, serializeBookingPayload(payload));
}

/** 다른 날짜 제안 회신. */
export async function suggestBookingDates(
  peerMemberId: string,
  requestId: string,
  suggestedDates: BookingDates,
  note: string,
): Promise<void> {
  const payload: BookingReplyPayload = {
    kind: 'BOOKING_REPLY',
    requestId,
    decision: 'SUGGEST',
    suggestedDates,
    ...(note.trim() !== '' ? { note: note.trim() } : {}),
  };
  await chatService.sendMessage(peerMemberId, serializeBookingPayload(payload));
}
