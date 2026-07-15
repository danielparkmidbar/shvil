import { describe, expect, it } from 'vitest';
import { serializeThanksCardPayload, type ThanksCardPayload } from '@shvil/shared';
import type { ChatMessageRow } from '../db';
import { SENDER_UNVERIFIED_PREFIX } from '../chatFormat';
import {
  buildReceivedThanksCards,
  parseChatThanksCard,
  thanksCardPreviewText,
} from '../thanksCardFormat';

const CARD: ThanksCardPayload = {
  kind: 'THANKS_CARD',
  cardId: 'thx-00112233aabbccdd',
  template: 'TENT',
  message: '마당 텐트 자리 고마웠습니다',
  fromDisplayName: '리오르',
  journeyLine: '북부 구간을 걸었습니다',
  makePublic: true,
};

function row(
  partial: Partial<ChatMessageRow> & Pick<ChatMessageRow, 'direction' | 'text'>,
): ChatMessageRow {
  return { id: 1, peerMemberId: 'SHV-111111', sentAt: 1_000, ...partial };
}

describe('감사 카드 판별·미리보기 (M7-A)', () => {
  it('감사 카드를 판별하고, 서명 경고 표식이 붙어도 벗겨서 판별한다', () => {
    const text = serializeThanksCardPayload(CARD);
    expect(parseChatThanksCard(text)).toEqual(CARD);
    expect(parseChatThanksCard(SENDER_UNVERIFIED_PREFIX + text)).toEqual(CARD);
  });

  it('일반 텍스트·booking 메시지는 null (폴백)', () => {
    expect(parseChatThanksCard('고마웠어요')).toBeNull();
    expect(thanksCardPreviewText('고마웠어요')).toBeNull();
  });

  it('미리보기는 템플릿 이모지 + 한 줄 요약', () => {
    expect(thanksCardPreviewText(serializeThanksCardPayload(CARD))).toBe('⛺ 감사 카드');
  });
});

describe('받은 감사 카드 파생 (엔젤 모드)', () => {
  it('수신(IN) 카드만 추리고 최신순 정렬한다', () => {
    const older = serializeThanksCardPayload({ ...CARD, cardId: 'thx-0000000000000001' });
    const newer = serializeThanksCardPayload({ ...CARD, cardId: 'thx-0000000000000002' });
    const messages = [
      row({ direction: 'IN', text: older, sentAt: 1_000 }),
      row({ direction: 'OUT', text: serializeThanksCardPayload({ ...CARD, cardId: 'thx-0000000000000009' }), sentAt: 1_500 }),
      row({ direction: 'IN', text: newer, sentAt: 2_000 }),
      row({ direction: 'IN', text: '일반 대화', sentAt: 3_000 }),
    ];
    const received = buildReceivedThanksCards(messages);
    expect(received.map((r) => r.card.cardId)).toEqual(['thx-0000000000000002', 'thx-0000000000000001']);
  });

  it('같은 cardId 재수신은 한 번만 나온다', () => {
    const text = serializeThanksCardPayload(CARD);
    const received = buildReceivedThanksCards([
      row({ direction: 'IN', text, sentAt: 1_000 }),
      row({ direction: 'IN', text, sentAt: 2_000 }),
    ]);
    expect(received).toHaveLength(1);
  });
});
