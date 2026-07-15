/**
 * 감사 카드 서비스 — M7-A (재조정 §4-5, 헌법 제5조 감사의 화폐).
 *
 * 발송·수신은 전부 E2E 메시지다 — chatService.sendMessage로 봉인·발송되고, 서버는
 * 암호문 봉투만 중계한다. 게스트북 게시/철회만 서버 왕복이 있으며, 이는 엔젤이
 * makePublic=true 카드를 자발적으로 공개하는 행위다 (서버는 원본 카드를 못 본다 —
 * 신뢰 모델은 server/src/guestbook.ts 주석).
 */
import {
  newThanksCardId,
  serializeThanksCardPayload,
  type ThanksCardPayload,
  type ThanksCardTemplate,
} from '@shvil/shared';
import { chatService } from './chatService';
import { directoryApi } from './directory';
import type { GuestbookCard } from './api';

export interface SendThanksCardArgs {
  peerMemberId: string;
  template: ThanksCardTemplate;
  message: string;
  fromDisplayName: string;
  journeyLine?: string;
  /** 작성자 동의: 엔젤이 게스트북에 공개해도 됨. */
  makePublic: boolean;
}

/** 감사 카드 발송 (리스트 → 엔젤). 형식 위반·미가입·오프라인은 throw (호출부 알림). */
export async function sendThanksCard(args: SendThanksCardArgs): Promise<ThanksCardPayload> {
  const payload: ThanksCardPayload = {
    kind: 'THANKS_CARD',
    cardId: newThanksCardId(),
    template: args.template,
    message: args.message.trim(),
    fromDisplayName: args.fromDisplayName.trim(),
    ...(args.journeyLine && args.journeyLine.trim() !== '' ? { journeyLine: args.journeyLine.trim() } : {}),
    makePublic: args.makePublic,
  };
  const plaintext = serializeThanksCardPayload(payload); // 형식 위반이면 여기서 throw
  await chatService.sendMessage(args.peerMemberId, plaintext);
  return payload;
}

/**
 * 엔젤이 받은 감사 카드를 게스트북에 공개 게시한다.
 * makePublic=true(작성자 동의)인 카드만 — 서버는 원본을 못 보므로 이 확인은 지갑의 몫.
 */
export async function publishToGuestbook(card: ThanksCardPayload): Promise<void> {
  if (!card.makePublic) {
    throw new Error('작성자가 게스트북 공개에 동의하지 않은 카드입니다.');
  }
  await directoryApi.publishGuestbookCard({
    cardId: card.cardId,
    fromDisplayName: card.fromDisplayName,
    template: card.template,
    message: card.message,
    ...(card.journeyLine ? { journeyLine: card.journeyLine } : {}),
  });
}

/** 게시 철회 — 엔젤 자기 방명록의 카드만. */
export async function unpublishFromGuestbook(cardId: string): Promise<void> {
  await directoryApi.removeGuestbookCard(cardId);
}

/** 내 게스트북 게시 목록 조회 (엔젤). 실패 시 throw — 호출부가 폴백 처리. */
export async function loadMyGuestbook(memberId: string): Promise<GuestbookCard[]> {
  const { cards } = await directoryApi.getGuestbook(memberId);
  return cards;
}
