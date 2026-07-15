import { describe, expect, it } from 'vitest';
import {
  newThanksCardId,
  parseThanksCardPayload,
  serializeThanksCardPayload,
  validateThanksCardPayload,
  THANKS_MESSAGE_MAX,
  type ThanksCardPayload,
} from '../thanksCard';
import { parseBookingPayload } from '../booking';
import { generateKeyPair, signerFromKeyPair } from '../crypto';
import { generateMessagingKeyPair, openMessage, sealMessage } from '../messaging';
import { T0 } from './helpers';

function sampleCard(overrides: Partial<ThanksCardPayload> = {}): ThanksCardPayload {
  return {
    kind: 'THANKS_CARD',
    cardId: newThanksCardId(),
    template: 'TENT',
    message: '마당 텐트 자리와 따뜻한 차 정말 고마웠습니다. 덕분에 북쪽 구간을 잘 이어 걸었어요.',
    fromDisplayName: '리오르',
    journeyLine: '쉬빌 북부 구간을 걸었습니다',
    makePublic: true,
    ...overrides,
  };
}

describe('감사 카드 페이로드 — 왕복 직렬화 (M7-A, 재조정 §4-5)', () => {
  it('감사 카드가 직렬화 → 파싱으로 원형 복원된다', () => {
    const card = sampleCard();
    expect(parseThanksCardPayload(serializeThanksCardPayload(card))).toEqual(card);
  });

  it('journeyLine 없는 카드도 왕복된다', () => {
    const card = sampleCard();
    delete card.journeyLine;
    expect(parseThanksCardPayload(serializeThanksCardPayload(card))).toEqual(card);
  });

  it('makePublic=false 카드도 왕복된다 (엔젤이 게스트북에 못 올림)', () => {
    const card = sampleCard({ makePublic: false });
    expect(parseThanksCardPayload(serializeThanksCardPayload(card))).toEqual(card);
  });

  it('cardId 형식이 thx-16hex다', () => {
    expect(newThanksCardId()).toMatch(/^thx-[0-9a-f]{16}$/);
  });

  it('네 가지 템플릿이 모두 유효하다', () => {
    for (const template of ['DEFAULT', 'TENT', 'MEAL', 'ROAD'] as const) {
      expect(validateThanksCardPayload(sampleCard({ template }))).toEqual([]);
    }
  });
});

describe('감사 카드 페이로드 — 검증 거부', () => {
  it('빈 메시지는 거부된다', () => {
    expect(validateThanksCardPayload(sampleCard({ message: '   ' }))).not.toEqual([]);
  });

  it('500자 초과 메시지는 거부된다', () => {
    expect(validateThanksCardPayload(sampleCard({ message: 'ㄱ'.repeat(THANKS_MESSAGE_MAX + 1) }))).not.toEqual([]);
    // 정확히 500자는 통과
    expect(validateThanksCardPayload(sampleCard({ message: 'ㄱ'.repeat(THANKS_MESSAGE_MAX) }))).toEqual([]);
  });

  it('템플릿 enum 위반은 거부된다', () => {
    expect(validateThanksCardPayload({ ...sampleCard(), template: 'PARTY' })).not.toEqual([]);
  });

  it('cardId 형식 위반은 거부된다', () => {
    expect(validateThanksCardPayload(sampleCard({ cardId: 'thx-XYZ' }))).not.toEqual([]);
    expect(validateThanksCardPayload(sampleCard({ cardId: 'bkg-0011223344556677' }))).not.toEqual([]);
  });

  it('닉네임 누락은 거부된다', () => {
    expect(validateThanksCardPayload(sampleCard({ fromDisplayName: ' ' }))).not.toEqual([]);
  });

  it('makePublic이 boolean이 아니면 거부된다', () => {
    expect(validateThanksCardPayload({ ...sampleCard(), makePublic: 'yes' })).not.toEqual([]);
  });

  it('serializeThanksCardPayload는 형식 위반 시 throw한다', () => {
    expect(() => serializeThanksCardPayload(sampleCard({ message: '' }))).toThrow();
  });
});

describe('감사 카드 페이로드 — 일반 텍스트 폴백 · booking과 공존', () => {
  it('JSON이 아닌 평문은 null (일반 텍스트)', () => {
    expect(parseThanksCardPayload('고마웠어요!')).toBeNull();
  });

  it('kind가 없으면 null', () => {
    expect(parseThanksCardPayload(JSON.stringify({ hello: 'world' }))).toBeNull();
  });

  it('booking 메시지는 감사 카드 파서로 null, booking 파서로만 잡힌다', () => {
    const booking = JSON.stringify({
      kind: 'BOOKING_REQUEST',
      requestId: 'bkg-0011223344556677',
      dates: { fromDate: '2026-07-20', toDate: '2026-07-21' },
      partySize: 2,
      profile: { displayName: '리오르' },
    });
    expect(parseThanksCardPayload(booking)).toBeNull();
    expect(parseBookingPayload(booking)).not.toBeNull();
  });

  it('감사 카드 메시지는 booking 파서로 null (기존 booking 파서를 깨지 않는다)', () => {
    const card = serializeThanksCardPayload(sampleCard());
    expect(parseBookingPayload(card)).toBeNull();
    expect(parseThanksCardPayload(card)).not.toBeNull();
  });
});

describe('감사 카드 페이로드 — E2E 봉인/개봉 통합 (서버는 형식을 모른다)', () => {
  const listDevice = signerFromKeyPair(generateKeyPair());
  const listMsg = generateMessagingKeyPair();
  const angelMsg = generateMessagingKeyPair();

  it('sealMessage로 감싼 감사 카드가 엔젤 지갑에서 복원되고, 봉투에는 평문 조각이 없다', () => {
    const card = sampleCard();
    const envelope = sealMessage({
      plaintext: serializeThanksCardPayload(card),
      fromMemberId: 'SHV-111111',
      toMemberId: 'SHV-222222',
      senderMsgKeyPair: listMsg,
      recipientMsgPublicKey: angelMsg.publicKeyHex,
      deviceSigner: listDevice,
      now: T0,
    });

    // 서버가 보는 전부(봉투)에는 카드 내용이 없다
    const wire = JSON.stringify(envelope);
    expect(wire).not.toContain('THANKS_CARD');
    expect(wire).not.toContain('리오르');
    expect(wire).not.toContain('마당 텐트');

    const opened = openMessage(envelope, angelMsg);
    expect(opened.signatureValid).toBe(true);
    expect(parseThanksCardPayload(opened.plaintext)).toEqual(card);
  });
});
