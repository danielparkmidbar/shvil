/**
 * 감사 카드 메시지 스키마 — M7-A (서비스 재조정 §4-5, 헌법 제5조).
 *
 * 감사 카드는 코인 거래가 아니라 마음을 전하는 쪽지다 (헌법 제5조: 코인은 감사의
 * 그릇이지 선행의 가격표가 아니다). 다니엘 쌤 말씀 그대로 — 엔젤이 빈집을 내어주면
 * 리스트들은 쪽지·감사 카드를 남기고 간다. 이것의 디지털판이며, 순례길 방명록이다.
 *
 * booking.ts와 동일한 방식으로 E2E 메신저(messaging.ts sealMessage)의 "평문" 안에
 * 담기는 구조화 데이터다 — 서버는 암호문 봉투만 중계하며 이 형식의 존재조차 모른다.
 *
 * - 작성자(리스트)가 makePublic=true로 동의하면, 카드를 받은 엔젤이 자기 프로필의
 *   "게스트북"에 게시할 수 있다 (엔젤의 자발 게시 — R-4/프라이버시 안전).
 * - 하위 호환: 평문이 JSON이고 kind가 THANKS_CARD면 구조화 메시지, 파싱·검증 실패
 *   시 일반 텍스트로 취급한다 (parseThanksCardPayload가 null 반환). booking 파서와
 *   kind로 분기되어 공존한다 — 같은 "구조화 메시지" 개념의 형제 타입이다.
 */

export const THANKS_CARD_KIND = 'THANKS_CARD' as const;

/** 쪽지 느낌의 템플릿 — 화면 문구는 클라이언트 i18n 몫, 여기선 코드만. */
export type ThanksCardTemplate = 'DEFAULT' | 'TENT' | 'MEAL' | 'ROAD';

export const THANKS_CARD_TEMPLATES: readonly ThanksCardTemplate[] = [
  'DEFAULT',
  'TENT',
  'MEAL',
  'ROAD',
];

export const THANKS_MESSAGE_MIN = 1;
export const THANKS_MESSAGE_MAX = 500;

/** 감사 카드 (리스트 → 엔젤). E2E 평문에 담긴다 — 서버는 내용을 모른다. */
export interface ThanksCardPayload {
  kind: typeof THANKS_CARD_KIND;
  /** 카드 식별자 — 게스트북 게시 시 중복 방지 키가 된다. */
  cardId: string;
  template: ThanksCardTemplate;
  /** 자필 텍스트 (1~500자). 사용자 원문 — 번역 대상이 아니다. */
  message: string;
  /** 보내는 사람 표시명 (닉네임 — 실명 아님). */
  fromDisplayName: string;
  /** 여정 한 줄 (선택) — 예: "쉬빌 북부 구간을 걸었습니다". */
  journeyLine?: string;
  /**
   * 작성자 동의: 엔젤이 이 카드를 게스트북에 공개해도 됨.
   * 서버는 원본 카드를 못 보므로(E2E), 이 동의의 확인·집행은 엔젤 지갑의 몫이다.
   */
  makePublic: boolean;
}

// ── 검증 ─────────────────────────────────────────────────────────

const CARD_ID_RE = /^thx-[0-9a-f]{16}$/;

/** 새 카드 식별자 — 'thx-' + 랜덤 16 hex. */
export function newThanksCardId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `thx-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** 코드포인트 길이 — "자" 단위 계수 (이모지 서러게이트 쌍을 1로 센다). */
function codePointLength(s: string): number {
  return [...s].length;
}

function isOptionalString(v: unknown): boolean {
  return v === undefined || typeof v === 'string';
}

/** 검증 — 통과 시 빈 배열, 실패 시 사유 코드 목록 (자연어 UI 문장 아님). */
export function validateThanksCardPayload(payload: unknown): string[] {
  const reasons: string[] = [];
  const p = payload as Partial<ThanksCardPayload> | null;
  if (!p || typeof p !== 'object') return ['payload: not an object'];

  if (p.kind !== THANKS_CARD_KIND) return ['kind: not a thanks card'];

  if (typeof p.cardId !== 'string' || !CARD_ID_RE.test(p.cardId)) {
    reasons.push('cardId: invalid format');
  }
  if (!THANKS_CARD_TEMPLATES.includes(p.template as ThanksCardTemplate)) {
    reasons.push('template: invalid');
  }
  if (typeof p.message !== 'string') {
    reasons.push('message: required');
  } else {
    const len = codePointLength(p.message.trim());
    if (len < THANKS_MESSAGE_MIN || codePointLength(p.message) > THANKS_MESSAGE_MAX) {
      reasons.push('message: length out of range');
    }
  }
  if (typeof p.fromDisplayName !== 'string' || p.fromDisplayName.trim() === '') {
    reasons.push('fromDisplayName: required');
  }
  if (!isOptionalString(p.journeyLine)) reasons.push('journeyLine: not a string');
  if (typeof p.makePublic !== 'boolean') reasons.push('makePublic: not a boolean');

  return reasons;
}

// ── 직렬화/파싱 ──────────────────────────────────────────────────

/** E2E 평문으로 직렬화한다. 형식 위반이면 throw — 잘못된 카드를 보내지 않는다. */
export function serializeThanksCardPayload(payload: ThanksCardPayload): string {
  const reasons = validateThanksCardPayload(payload);
  if (reasons.length > 0) throw new Error(`invalid thanks card payload: ${reasons.join(', ')}`);
  return JSON.stringify(payload);
}

/**
 * 수신 평문에서 감사 카드를 판별한다.
 * JSON + kind === THANKS_CARD + 검증 통과 → 페이로드, 그 외 전부 null (일반 텍스트
 * 폴백 — booking 메시지·자유 텍스트와의 공존/하위 호환).
 */
export function parseThanksCardPayload(plaintext: string): ThanksCardPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { kind?: unknown }).kind !== THANKS_CARD_KIND) {
    return null;
  }
  if (validateThanksCardPayload(parsed).length > 0) return null;
  return parsed as ThanksCardPayload;
}
