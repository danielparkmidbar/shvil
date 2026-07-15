/**
 * 감사 카드 표시·수신 파생 — 순수 함수 (expo 무의존, vitest 테스트 대상).
 *
 * 감사 카드는 E2E 메시지다 (헌법 제5조). 기기 안 chat_messages(복호화 평문)를
 * 스캔해 수신 카드를 파생한다. 구조화 메시지 판별·검증은 @shvil/shared thanksCard.ts.
 * booking 파서와 kind로 분기되어 공존한다.
 */
import {
  parseThanksCardPayload,
  type ThanksCardPayload,
  type ThanksCardTemplate,
} from '@shvil/shared';
import type { ChatMessageRow } from './db';
import { SENDER_UNVERIFIED_PREFIX } from './chatFormat';

/** 채팅 저장 텍스트에서 감사 카드를 판별한다 (서명 경고 표식은 벗기고). */
export function parseChatThanksCard(text: string): ThanksCardPayload | null {
  const body = text.startsWith(SENDER_UNVERIFIED_PREFIX)
    ? text.slice(SENDER_UNVERIFIED_PREFIX.length)
    : text;
  return parseThanksCardPayload(body);
}

/** 템플릿별 쪽지 이모지 — 화면 표시용 (자유 텍스트가 아닌 고정 장식). */
export const THANKS_TEMPLATE_EMOJI: Record<ThanksCardTemplate, string> = {
  DEFAULT: '💌',
  TENT: '⛺',
  MEAL: '🍲',
  ROAD: '🥾',
};

/** 템플릿별 한 줄 라벨 (한국어 UI). */
export const THANKS_TEMPLATE_LABEL: Record<ThanksCardTemplate, string> = {
  DEFAULT: '고마움을 담아',
  TENT: '마당·텐트 자리에 감사',
  MEAL: '따뜻한 한 끼에 감사',
  ROAD: '길 위의 쉼에 감사',
};

/** 대화 목록 미리보기 — 감사 카드면 한 줄 요약, 아니면 null (호출부가 폴백). */
export function thanksCardPreviewText(text: string): string | null {
  const card = parseChatThanksCard(text);
  if (!card) return null;
  return `${THANKS_TEMPLATE_EMOJI[card.template]} 감사 카드`;
}

/** 엔젤이 받은 감사 카드 한 건 (게스트북 게시 후보). */
export interface ReceivedThanksCard {
  card: ThanksCardPayload;
  /** 보낸 사람 회원 번호 (대화 상대). */
  peerMemberId: string;
  receivedAt: number;
}

/**
 * 기기 내 전체 대화에서 수신(IN) 감사 카드를 추린다 — 최신순, 같은 cardId는 최초만.
 * 엔젤 모드의 "받은 감사 카드" 목록·게스트북 게시 후보로 쓴다.
 */
export function buildReceivedThanksCards(messages: ChatMessageRow[]): ReceivedThanksCard[] {
  const collected: ReceivedThanksCard[] = [];
  for (const m of messages) {
    if (m.direction !== 'IN') continue;
    const card = parseChatThanksCard(m.text);
    if (card) collected.push({ card, peerMemberId: m.peerMemberId, receivedAt: m.sentAt });
  }
  collected.sort((a, b) => b.receivedAt - a.receivedAt);
  const seen = new Set<string>();
  return collected.filter((r) => {
    if (seen.has(r.card.cardId)) return false;
    seen.add(r.card.cardId);
    return true;
  });
}
