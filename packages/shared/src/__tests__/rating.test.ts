import { describe, expect, it } from 'vitest';
import {
  aggregateRatings,
  newRatingId,
  parseRatingPayload,
  RATING_REVIEW_MAX,
  serializeRatingPayload,
  validateRatingPayload,
  type RatingCardPayload,
} from '../rating';
import { parseBookingPayload } from '../booking';
import { parseThanksCardPayload } from '../thanksCard';
import { generateKeyPair, signerFromKeyPair } from '../crypto';
import { generateMessagingKeyPair, openMessage, sealMessage } from '../messaging';
import { T0 } from './helpers';

function sampleRating(overrides: Partial<RatingCardPayload> = {}): RatingCardPayload {
  return {
    kind: 'RATING',
    ratingId: newRatingId(),
    stars: 5,
    review: '따뜻하게 맞아주셔서 북쪽 구간을 잘 이어 걸었습니다. 고맙습니다.',
    fromDisplayName: '리오르',
    direction: 'GUEST_TO_ANGEL',
    relationProof: { kind: 'BOOKING_APPROVAL', requestId: 'bkg-0011223344556677' },
    makePublic: true,
    ...overrides,
  };
}

describe('별점 페이로드 — 왕복 직렬화 (M7-B, 안 B)', () => {
  it('별점 카드가 직렬화 → 파싱으로 원형 복원된다', () => {
    const card = sampleRating();
    expect(parseRatingPayload(serializeRatingPayload(card))).toEqual(card);
  });

  it('후기 없는 별점도 왕복된다', () => {
    const card = sampleRating();
    delete card.review;
    expect(parseRatingPayload(serializeRatingPayload(card))).toEqual(card);
  });

  it('지불 코인 관계 증명도 왕복된다', () => {
    const card = sampleRating({
      direction: 'ANGEL_TO_GUEST',
      relationProof: { kind: 'PAYMENT_COIN', coinId: 'a'.repeat(64) },
    });
    expect(parseRatingPayload(serializeRatingPayload(card))).toEqual(card);
  });

  it('makePublic=false 별점도 왕복된다 (피평가자가 게시할 수 없음)', () => {
    const card = sampleRating({ makePublic: false });
    expect(parseRatingPayload(serializeRatingPayload(card))).toEqual(card);
  });

  it('ratingId 형식이 rat-16hex다', () => {
    expect(newRatingId()).toMatch(/^rat-[0-9a-f]{16}$/);
  });

  it('별 1~5 정수는 모두 유효하다', () => {
    for (const stars of [1, 2, 3, 4, 5]) {
      expect(validateRatingPayload(sampleRating({ stars }))).toEqual([]);
    }
  });
});

describe('별점 페이로드 — 검증 거부', () => {
  it('별점 범위를 벗어나면 거부된다', () => {
    expect(validateRatingPayload(sampleRating({ stars: 0 }))).not.toEqual([]);
    expect(validateRatingPayload(sampleRating({ stars: 6 }))).not.toEqual([]);
    expect(validateRatingPayload(sampleRating({ stars: 4.5 }))).not.toEqual([]);
  });

  it('200자 초과 후기는 거부된다', () => {
    expect(validateRatingPayload(sampleRating({ review: 'ㄱ'.repeat(RATING_REVIEW_MAX + 1) }))).not.toEqual([]);
    // 정확히 200자는 통과
    expect(validateRatingPayload(sampleRating({ review: 'ㄱ'.repeat(RATING_REVIEW_MAX) }))).toEqual([]);
  });

  it('ratingId 형식 위반은 거부된다', () => {
    expect(validateRatingPayload(sampleRating({ ratingId: 'rat-XYZ' }))).not.toEqual([]);
    expect(validateRatingPayload(sampleRating({ ratingId: 'thx-0011223344556677' }))).not.toEqual([]);
  });

  it('방향 enum 위반은 거부된다', () => {
    expect(validateRatingPayload({ ...sampleRating(), direction: 'SIDEWAYS' })).not.toEqual([]);
  });

  it('닉네임 누락은 거부된다', () => {
    expect(validateRatingPayload(sampleRating({ fromDisplayName: ' ' }))).not.toEqual([]);
  });

  it('관계 증명 누락·형식 위반은 거부된다 (가짜 평가 방어)', () => {
    // @ts-expect-error — 관계 증명 없는 카드
    expect(validateRatingPayload(sampleRating({ relationProof: undefined }))).not.toEqual([]);
    expect(
      validateRatingPayload(sampleRating({ relationProof: { kind: 'BOOKING_APPROVAL', requestId: 'nope' } })),
    ).not.toEqual([]);
    expect(
      // @ts-expect-error — 알 수 없는 관계 증명 종류
      validateRatingPayload(sampleRating({ relationProof: { kind: 'GOSSIP' } })),
    ).not.toEqual([]);
  });

  it('makePublic이 boolean이 아니면 거부된다', () => {
    expect(validateRatingPayload({ ...sampleRating(), makePublic: 'yes' })).not.toEqual([]);
  });

  it('serializeRatingPayload는 형식 위반 시 throw한다', () => {
    expect(() => serializeRatingPayload(sampleRating({ stars: 9 }))).toThrow();
  });
});

describe('별점 페이로드 — 일반 텍스트 폴백 · 형제(booking/thanks) 공존', () => {
  it('JSON이 아닌 평문은 null (일반 텍스트)', () => {
    expect(parseRatingPayload('별 다섯 개 드려요!')).toBeNull();
  });

  it('kind가 없으면 null', () => {
    expect(parseRatingPayload(JSON.stringify({ hello: 'world' }))).toBeNull();
  });

  it('booking·thanks 메시지는 별점 파서로 null, 별점은 그들 파서로 null', () => {
    const booking = JSON.stringify({
      kind: 'BOOKING_REQUEST',
      requestId: 'bkg-0011223344556677',
      dates: { fromDate: '2026-07-20', toDate: '2026-07-21' },
      partySize: 2,
      profile: { displayName: '리오르' },
    });
    expect(parseRatingPayload(booking)).toBeNull();
    const thanks = JSON.stringify({
      kind: 'THANKS_CARD',
      cardId: 'thx-0011223344556677',
      template: 'TENT',
      message: '고맙습니다',
      fromDisplayName: '리오르',
      makePublic: true,
    });
    expect(parseRatingPayload(thanks)).toBeNull();

    const rating = serializeRatingPayload(sampleRating());
    expect(parseBookingPayload(rating)).toBeNull();
    expect(parseThanksCardPayload(rating)).toBeNull();
    expect(parseRatingPayload(rating)).not.toBeNull();
  });
});

describe('별점 집계 (aggregateRatings — 부동소수 회피)', () => {
  it('빈 배열은 0 집계', () => {
    expect(aggregateRatings([])).toEqual({ count: 0, averageTenths: 0, publicCount: 0 });
  });

  it('평균은 ×10 정수로 반올림된다 (4,5,5 → 47)', () => {
    const cards = [
      sampleRating({ stars: 4, makePublic: true }),
      sampleRating({ stars: 5, makePublic: true }),
      sampleRating({ stars: 5, makePublic: false }),
    ];
    const agg = aggregateRatings(cards);
    expect(agg.count).toBe(3);
    expect(agg.averageTenths).toBe(47); // 14/3 = 4.666… → 4.7 → 47
    expect(agg.publicCount).toBe(2);
  });
});

describe('별점 — E2E 봉인/개봉 통합 (서버는 형식을 모른다)', () => {
  const listDevice = signerFromKeyPair(generateKeyPair());
  const listMsg = generateMessagingKeyPair();
  const angelMsg = generateMessagingKeyPair();

  it('sealMessage로 감싼 별점이 피평가자 지갑에서 복원되고, 봉투에는 평문 조각이 없다', () => {
    const card = sampleRating();
    const envelope = sealMessage({
      plaintext: serializeRatingPayload(card),
      fromMemberId: 'SHV-111111',
      toMemberId: 'SHV-222222',
      senderMsgKeyPair: listMsg,
      recipientMsgPublicKey: angelMsg.publicKeyHex,
      deviceSigner: listDevice,
      now: T0,
    });

    // 서버가 보는 전부(봉투)에는 별점 내용이 없다
    const wire = JSON.stringify(envelope);
    expect(wire).not.toContain('RATING');
    expect(wire).not.toContain('리오르');
    expect(wire).not.toContain('bkg-0011223344556677');

    const opened = openMessage(envelope, angelMsg);
    expect(opened.signatureValid).toBe(true);
    expect(parseRatingPayload(opened.plaintext)).toEqual(card);
  });
});
