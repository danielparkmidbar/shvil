/**
 * 동행 찾기 스키마 — M8 (서비스 재조정 §4-6).
 * 게시글 입력 검증 + 관심 표명(COMPANION_INTEREST) E2E 왕복을 확인한다.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPANION_NOTE_MAX,
  COMPANION_PARTY_MAX,
  isCompanionPostId,
  newCompanionPostId,
  parseCompanionInterest,
  serializeCompanionInterest,
  validateCompanionInput,
  validateCompanionInterest,
  validateCompanionUpdate,
  type CompanionInterestPayload,
  type CompanionPostInput,
} from '../companion';
import { parseBookingPayload } from '../booking';
import { parseRatingPayload } from '../rating';
import { generateKeyPair, signerFromKeyPair } from '../crypto';
import { generateMessagingKeyPair, openMessage, sealMessage } from '../messaging';

function samplePost(overrides: Partial<CompanionPostInput> = {}): CompanionPostInput {
  return {
    regionId: 'israel-national',
    courseId: 'shvil-israel',
    fromDate: '2026-08-01',
    toDate: '2026-08-05',
    partySizeCurrent: 1,
    partySizeTarget: 4,
    mode: 'WALK',
    displayName: '리오르',
    note: '북부 구간을 함께 걸을 3~4인 팀을 찾습니다. 천천히 걷습니다.',
    ...overrides,
  };
}

describe('동행 게시글 입력 검증', () => {
  it('정상 입력은 통과한다 (사유 없음)', () => {
    expect(validateCompanionInput(samplePost())).toEqual([]);
  });

  it('COMING_SOON 지역도 미리 팀 모집 가능하다 (코스 미지정)', () => {
    const post = samplePost({ regionId: 'camino-de-santiago' });
    delete post.courseId;
    expect(validateCompanionInput(post)).toEqual([]);
  });

  it('알 수 없는 지역은 거부한다', () => {
    expect(validateCompanionInput(samplePost({ regionId: 'nowhere-trail' }))).toContain('regionId: unknown region');
  });

  it('날짜 형식·순서를 검사한다', () => {
    expect(validateCompanionInput(samplePost({ fromDate: '2026-13-01' }))).toContain('fromDate: invalid');
    expect(validateCompanionInput(samplePost({ fromDate: '2026-08-10', toDate: '2026-08-05' }))).toContain(
      'fromDate: after toDate',
    );
  });

  it('팀 규모 범위·정합을 검사한다', () => {
    expect(validateCompanionInput(samplePost({ partySizeTarget: 1 }))).toContain('partySizeTarget: out of range');
    expect(validateCompanionInput(samplePost({ partySizeTarget: COMPANION_PARTY_MAX + 1 }))).toContain(
      'partySizeTarget: out of range',
    );
    expect(validateCompanionInput(samplePost({ partySizeCurrent: 5, partySizeTarget: 4 }))).toContain(
      'partySizeCurrent: exceeds target',
    );
  });

  it('이동 수단 enum·닉네임·한마디 길이를 검사한다', () => {
    expect(validateCompanionInput(samplePost({ mode: 'FLY' as never }))).toContain('mode: invalid');
    expect(validateCompanionInput(samplePost({ displayName: '' }))).toContain('displayName: required');
    expect(validateCompanionInput(samplePost({ note: 'x'.repeat(COMPANION_NOTE_MAX + 1) }))).toContain('note: invalid');
  });
});

describe('동행 게시글 갱신 검증', () => {
  it('빈 갱신은 거부한다', () => {
    expect(validateCompanionUpdate({})).toContain('input: no fields to update');
  });
  it('상태·인원 갱신은 통과한다', () => {
    expect(validateCompanionUpdate({ status: 'CLOSED' })).toEqual([]);
    expect(validateCompanionUpdate({ partySizeCurrent: 3 })).toEqual([]);
  });
  it('잘못된 상태는 거부한다', () => {
    expect(validateCompanionUpdate({ status: 'PAUSED' })).toContain('status: invalid');
  });
});

describe('게시글 식별자', () => {
  it('newCompanionPostId는 cmp-16hex 형식이다', () => {
    const id = newCompanionPostId();
    expect(isCompanionPostId(id)).toBe(true);
    expect(id).toMatch(/^cmp-[0-9a-f]{16}$/);
  });
});

describe('관심 표명(COMPANION_INTEREST) — E2E 왕복 (서버는 내용을 모른다)', () => {
  function sampleInterest(overrides: Partial<CompanionInterestPayload> = {}): CompanionInterestPayload {
    return {
      kind: 'COMPANION_INTEREST',
      postId: newCompanionPostId(),
      fromDisplayName: '노아',
      note: '저도 같은 날짜에 북부를 걷습니다. 함께 걸어요!',
      ...overrides,
    };
  }

  it('직렬화 → 파싱으로 원형 복원된다', () => {
    const card = sampleInterest();
    expect(parseCompanionInterest(serializeCompanionInterest(card))).toEqual(card);
  });

  it('booking·rating 파서와 공존한다 (서로에 대해 null)', () => {
    const text = serializeCompanionInterest(sampleInterest());
    expect(parseBookingPayload(text)).toBeNull();
    expect(parseRatingPayload(text)).toBeNull();
  });

  it('일반 텍스트·잘못된 형식은 null이다', () => {
    expect(parseCompanionInterest('안녕하세요, 같이 걸어요')).toBeNull();
    expect(parseCompanionInterest(JSON.stringify({ kind: 'COMPANION_INTEREST', postId: 'nope', fromDisplayName: '노아' }))).toBeNull();
  });

  it('sealMessage 봉투에 관심 내용이 평문으로 드러나지 않는다', () => {
    const sender = generateMessagingKeyPair();
    const recipient = generateMessagingKeyPair();
    const signer = signerFromKeyPair(generateKeyPair());
    const card = sampleInterest();
    const envelope = sealMessage({
      plaintext: serializeCompanionInterest(card),
      fromMemberId: 'SHV-100001',
      toMemberId: 'SHV-100002',
      senderMsgKeyPair: sender,
      recipientMsgPublicKey: recipient.publicKeyHex,
      deviceSigner: signer,
      now: Date.now(),
    });
    expect(JSON.stringify(envelope)).not.toContain('COMPANION_INTEREST');
    expect(JSON.stringify(envelope)).not.toContain(card.postId);
    const opened = openMessage(envelope, recipient);
    expect(opened.signatureValid).toBe(true);
    expect(parseCompanionInterest(opened.plaintext)).toEqual(card);
  });
});
