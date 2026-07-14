import { describe, expect, it } from 'vitest';
import {
  newBookingRequestId,
  parseBookingPayload,
  serializeBookingPayload,
  validateBookingPayload,
  type BookingReplyPayload,
  type BookingRequestPayload,
} from '../booking';
import { generateKeyPair, signerFromKeyPair } from '../crypto';
import { generateMessagingKeyPair, openMessage, sealMessage } from '../messaging';
import { T0 } from './helpers';

function sampleRequest(): BookingRequestPayload {
  return {
    kind: 'BOOKING_REQUEST',
    requestId: newBookingRequestId(),
    dates: { fromDate: '2026-07-20', toDate: '2026-07-21' },
    partySize: 2,
    note: '북쪽에서 이틀째 걷고 있습니다. 마당 텐트도 좋아요.',
    profile: { displayName: '리오르', memberSince: '2026-05', journeyLine: '쉬빌 북부 구간 걷는 중' },
  };
}

function approvedReply(requestId: string): BookingReplyPayload {
  return {
    kind: 'BOOKING_REPLY',
    requestId,
    decision: 'APPROVED',
    note: '기다릴게요',
    preciseLocation: { lat: 33.22947, lon: 35.65513 },
    addressText: '마을 어귀 파란 대문 집',
    contact: '+972-50-000-0000',
  };
}

describe('예약 페이로드 — 왕복 직렬화 (M6, 재조정 §4-2)', () => {
  it('신청이 직렬화 → 파싱으로 원형 복원된다', () => {
    const req = sampleRequest();
    const parsed = parseBookingPayload(serializeBookingPayload(req));
    expect(parsed).toEqual(req);
  });

  it('승인 회신(정확 위치·주소·연락처 포함)이 왕복 복원된다', () => {
    const rep = approvedReply(newBookingRequestId());
    const parsed = parseBookingPayload(serializeBookingPayload(rep));
    expect(parsed).toEqual(rep);
  });

  it('SUGGEST 회신은 대안 날짜와 함께 왕복된다', () => {
    const rep: BookingReplyPayload = {
      kind: 'BOOKING_REPLY',
      requestId: newBookingRequestId(),
      decision: 'SUGGEST',
      suggestedDates: { fromDate: '2026-07-22', toDate: '2026-07-23' },
      note: '그 날은 손님이 있어요',
    };
    expect(parseBookingPayload(serializeBookingPayload(rep))).toEqual(rep);
  });

  it('requestId 형식이 bkg-16hex다', () => {
    expect(newBookingRequestId()).toMatch(/^bkg-[0-9a-f]{16}$/);
  });
});

describe('예약 페이로드 — 검증 거부', () => {
  it('partySize 범위(1~10) 밖은 거부된다', () => {
    expect(validateBookingPayload({ ...sampleRequest(), partySize: 0 })).not.toEqual([]);
    expect(validateBookingPayload({ ...sampleRequest(), partySize: 11 })).not.toEqual([]);
    expect(validateBookingPayload({ ...sampleRequest(), partySize: 1.5 })).not.toEqual([]);
  });

  it('날짜 형식·순서 위반은 거부된다', () => {
    expect(validateBookingPayload({ ...sampleRequest(), dates: { fromDate: '2026/07/20', toDate: '2026-07-21' } })).not.toEqual([]);
    expect(validateBookingPayload({ ...sampleRequest(), dates: { fromDate: '2026-02-31', toDate: '2026-03-01' } })).not.toEqual([]);
    expect(validateBookingPayload({ ...sampleRequest(), dates: { fromDate: '2026-07-22', toDate: '2026-07-21' } })).not.toEqual([]);
  });

  it('requestId 형식 위반은 거부된다', () => {
    expect(validateBookingPayload({ ...sampleRequest(), requestId: 'bkg-XYZ' })).not.toEqual([]);
    expect(validateBookingPayload({ ...sampleRequest(), requestId: 'req-0011223344556677' })).not.toEqual([]);
  });

  it('프로필 닉네임 누락은 거부된다', () => {
    const req = sampleRequest();
    expect(validateBookingPayload({ ...req, profile: { ...req.profile, displayName: ' ' } })).not.toEqual([]);
  });

  it('R-4: 정확 위치·주소·연락처는 APPROVED가 아니면 거부된다', () => {
    const rep = approvedReply(newBookingRequestId());
    expect(validateBookingPayload({ ...rep, decision: 'DECLINED' })).not.toEqual([]);
    expect(validateBookingPayload({ ...rep, decision: 'SUGGEST', suggestedDates: { fromDate: '2026-07-22', toDate: '2026-07-23' } })).not.toEqual([]);
    // 정확 정보를 떼면 DECLINED도 유효하다
    expect(
      validateBookingPayload({ kind: 'BOOKING_REPLY', requestId: rep.requestId, decision: 'DECLINED', note: '죄송해요' }),
    ).toEqual([]);
  });

  it('SUGGEST에 대안 날짜가 없으면 거부된다', () => {
    expect(
      validateBookingPayload({ kind: 'BOOKING_REPLY', requestId: newBookingRequestId(), decision: 'SUGGEST' }),
    ).not.toEqual([]);
  });

  it('좌표 범위 밖 preciseLocation은 거부된다', () => {
    const rep = approvedReply(newBookingRequestId());
    expect(validateBookingPayload({ ...rep, preciseLocation: { lat: 91, lon: 35 } })).not.toEqual([]);
  });

  it('serializeBookingPayload는 형식 위반 시 throw한다', () => {
    expect(() => serializeBookingPayload({ ...sampleRequest(), partySize: 99 })).toThrow();
  });
});

describe('예약 페이로드 — 일반 텍스트 폴백 (하위 호환)', () => {
  it('JSON이 아닌 평문은 null (일반 텍스트)', () => {
    expect(parseBookingPayload('오늘 저녁 7시 도착 예정입니다')).toBeNull();
  });

  it('JSON이지만 kind가 없으면 null', () => {
    expect(parseBookingPayload(JSON.stringify({ hello: 'world' }))).toBeNull();
  });

  it('kind가 있어도 검증 실패면 null (깨진 구조화 메시지를 텍스트로 강등하지 않고 폐기 판단은 호출부 몫)', () => {
    expect(parseBookingPayload(JSON.stringify({ kind: 'BOOKING_REQUEST', requestId: 'bad' }))).toBeNull();
    expect(parseBookingPayload(JSON.stringify({ kind: 'SOMETHING_ELSE' }))).toBeNull();
  });
});

describe('예약 페이로드 — E2E 봉인/개봉 통합 (서버는 형식을 모른다)', () => {
  const listDevice = signerFromKeyPair(generateKeyPair());
  const listMsg = generateMessagingKeyPair();
  const angelMsg = generateMessagingKeyPair();

  it('sealMessage로 감싼 신청이 상대 지갑에서 복원되고, 봉투에는 평문 조각이 없다', () => {
    const req = sampleRequest();
    const envelope = sealMessage({
      plaintext: serializeBookingPayload(req),
      fromMemberId: 'SHV-111111',
      toMemberId: 'SHV-222222',
      senderMsgKeyPair: listMsg,
      recipientMsgPublicKey: angelMsg.publicKeyHex,
      deviceSigner: listDevice,
      now: T0,
    });

    // 서버가 보는 전부(봉투)에는 신청 내용이 없다
    const wire = JSON.stringify(envelope);
    expect(wire).not.toContain('BOOKING_REQUEST');
    expect(wire).not.toContain(req.requestId);
    expect(wire).not.toContain('리오르');

    const opened = openMessage(envelope, angelMsg);
    expect(opened.signatureValid).toBe(true);
    expect(parseBookingPayload(opened.plaintext)).toEqual(req);
  });

  it('승인 회신의 정확 위치도 봉투 밖(서버)에는 드러나지 않는다', () => {
    const rep = approvedReply(newBookingRequestId());
    const envelope = sealMessage({
      plaintext: serializeBookingPayload(rep),
      fromMemberId: 'SHV-222222',
      toMemberId: 'SHV-111111',
      senderMsgKeyPair: angelMsg,
      recipientMsgPublicKey: listMsg.publicKeyHex,
      deviceSigner: listDevice,
      now: T0,
    });
    const wire = JSON.stringify(envelope);
    expect(wire).not.toContain('33.22947');
    expect(wire).not.toContain('파란 대문');

    const opened = openMessage(envelope, listMsg);
    const parsed = parseBookingPayload(opened.plaintext);
    expect(parsed).toEqual(rep);
    expect(parsed?.kind === 'BOOKING_REPLY' && parsed.preciseLocation?.lat).toBe(33.22947);
  });
});
