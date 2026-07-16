/**
 * 상호 별점 메시지 스키마 — M7-B (별점_프라이버시_결정.md 안 B, 헌법 제5조·제9조).
 *
 * 별점은 "서버가 관리하는 평판 점수"가 아니라 **당사자가 서명해 건네는 편지 같은
 * 평가**다. 감사 카드(thanksCard.ts)·게스트북과 같은 신뢰 모델을 따른다:
 *   - E2E 서명: 각 별점은 평가자 기기 키로 서명되어 피평가자에게 전달된다
 *     (messaging.ts sealMessage의 "평문" 안에 담긴다). 서버는 암호문 봉투만
 *     중계하며 이 형식의 존재조차 모른다 — booking·thanksCard와 형제 타입이다.
 *   - 자발 공개: 피평가자가 받은 별점 중 원하는 것만 자기 프로필에 게시한다.
 *
 * ── 프라이버시 트레이드오프와 그 한계 (M7-B에서 정직히 남기는 설계 결정) ──────
 * "받은 총 개수를 위조·은폐 불가하게 고정"하려면 서버가 별점 이벤트를 카운트해야
 * 하는데, 그러면 "엔젤이 N번 평가받음 = N번 접대"라는 관계 정보가 서버에 남아
 * 안 B(별점_프라이버시_결정.md)의 프라이버시가 무너진다 — 서버 해킹 시 "누가 누구
 * 집에 묵었나"의 관계망이 유출된다. 그래서 **프라이버시를 우선**한다:
 * 서버 카운터를 만들지 않고, 게스트북과 동일하게 피평가자가 자발 공개한 별점만
 * 서버가 보관한다.
 *
 * ★정직화 (적대적 검증 반영, 2026-07-16): 아래 (a)~(c)는 방어를 **완화**할 뿐
 * 근본 진위를 보장하지 못한다. 특히 **공개 집계는 프로필 주인이 날조할 수 있다.**
 *   - 평가자 기기 키 서명(sealMessage)은 수신 지갑 안의 **사적 사본**이 정직한
 *     클라이언트에서 변조되지 않게만 지킨다. "위변조 불가 평판"이 아니다.
 *   - 프로필에 게시(POST /ratings)될 때 그 서명은 서버로 가지 **않는다** — 서명을
 *     서버가 검증하려면 평가자 신원을 알아야 해 프라이버시가 무너지기 때문이다.
 *     따라서 프로필 주인은 서명 없는 가짜 5★를 임의 닉네임으로 자기 프로필에
 *     얼마든지 게시할 수 있다. **공개 별점은 "검증된 평판"이 아니라 참고 지표다.**
 * "은폐/날조" 방어는 아래로 **완화**한다 (제거가 아니다):
 *   (a) 각 별점은 평가자 기기 키로 **서명** → 피평가자가 자기가 받은 카드의 점수를
 *       (정직한 클라이언트 안에서) 위조할 수 없다. 단 위에 적었듯 공개 게시 값의
 *       진위는 서명이 보장하지 못한다.
 *   (b) 평가자도 자기가 준 별점의 서명 사본을 보관 → 분쟁 시 "나는 별 2개를 줬는데
 *       프로필에 없다"를 증명 가능(커뮤니티 감시 — 사본 보관까지가 이번 범위).
 *   (c) 관계 증명(relationProof) 첨부 → 피평가자 지갑이 받은 카드의 관계 증명을
 *       **자기 로컬 이력(예약 승인 회신 / 지불 코인)과 대조**해, 대조 실패 카드를
 *       게시 후보에서 거른다 (ratingFormat.ts verifyRelationProof). 이로써 낯선
 *       가짜 별점이 정직한 지갑에서 프로필로 올라가지 않는다. 단 이 게이트는
 *       **정직한(미수정) 클라이언트에서만** 동작한다 — 수정 클라이언트나 API 직접
 *       호출은 우회하며, 서버 강제는 relationProof를 서버로 보내야 해(안 B 위배)
 *       하지 않는다.
 * 남는 위험: (1) 피평가자가 불리한 별점을 **숨길** 여지, (2) 프로필 주인이 가짜
 * 별점을 **날조**할 여지가 모두 남는다. (1)은 "N개 받음 / M개 공개"(공개율)로
 * 가시화해 완화하되 분모는 자발 신고라 축소 신고로 부풀릴 수 있고, (2)의 근본
 * 해결(서버가 평가자 서명 검증 = 프라이버시 순간 양보, 또는 커밋-리빌)은 다니엘
 * 쌤 결정 대기다(별점_프라이버시_결정.md R-1d). 그래서 UI는 별점을 "참고 지표 —
 * 검증된 값이 아닙니다"로 겸손히 표시한다. 보복 방지(커밋-리빌)는 후속.
 *
 * 하위 호환: 평문이 JSON이고 kind가 RATING이면 구조화 메시지, 파싱·검증 실패 시
 * 일반 텍스트로 취급한다 (parseRatingPayload가 null 반환). booking·thanksCard
 * 파서와 kind로 분기되어 공존한다 — 서로에 대해 항상 null이다.
 */

export const RATING_KIND = 'RATING' as const;

/** 평가 방향 — 상호 별점 (리스트→엔젤, 엔젤→리스트). */
export type RatingDirection = 'GUEST_TO_ANGEL' | 'ANGEL_TO_GUEST';

export const RATING_DIRECTIONS: readonly RatingDirection[] = ['GUEST_TO_ANGEL', 'ANGEL_TO_GUEST'];

export const RATING_STARS_MIN = 1;
export const RATING_STARS_MAX = 5;
/** 한 줄 후기 최대 길이 (자, 코드포인트). 선택 입력. */
export const RATING_REVIEW_MAX = 200;

/**
 * 관계 증명 — 평가 자격의 "검증 가능한 최소 증명" (자격: 예약 승인 또는 대면 지불).
 *
 * 전체 서명 사본을 싣지 않고, 두 당사자가 각자 로컬에 이미 보유한 증거를 **참조**만
 * 한다 (최소 증명). 피평가자 지갑이 자기 기록(예약 승인 회신 / 수령·지불 코인)과
 * 대조해 "실제 나와 관계있는 평가자"임을 확인한다. 이 참조는 서버로 가지 않는다 —
 * 서버가 관계를 알게 되면 안 B가 무너지므로, 게시(POST /ratings)에는 포함하지 않는다.
 */
export type RatingRelationProof =
  | {
      /** 예약 승인(BOOKING_REPLY APPROVED)이 있었던 관계 — 그 신청 식별자를 참조. */
      kind: 'BOOKING_APPROVAL';
      requestId: string;
    }
  | {
      /** 대면 지불(코인 이전)이 있었던 관계 — 오간 코인의 id를 참조. */
      kind: 'PAYMENT_COIN';
      coinId: string;
    };

/** 상호 별점 카드. E2E 평문에 담긴다 — 서버는 내용을 모른다. */
export interface RatingCardPayload {
  kind: typeof RATING_KIND;
  /** 별점 식별자 — 피평가자 게시 시 중복 방지 키가 된다. */
  ratingId: string;
  /** 별 1~5 (정수). */
  stars: number;
  /** 한 줄 후기 (선택, ≤200자). 사용자 원문 — 번역 대상이 아니다. */
  review?: string;
  /** 평가자 표시명 (닉네임 — 실명 아님). */
  fromDisplayName: string;
  /** 평가 방향 — 상호. */
  direction: RatingDirection;
  /** 관계 증명 (자격의 최소 참조) — 피평가자가 가짜 평가를 거부하는 근거. */
  relationProof: RatingRelationProof;
  /**
   * 평가자 동의: 피평가자가 이 별점을 프로필에 공개해도 됨.
   * 서버는 원본 카드를 못 보므로(E2E) 이 동의의 확인·집행은 피평가자 지갑의 몫이다.
   */
  makePublic: boolean;
}

// ── 검증 ─────────────────────────────────────────────────────────

const RATING_ID_RE = /^rat-[0-9a-f]{16}$/;
const BOOKING_REQUEST_ID_RE = /^bkg-[0-9a-f]{16}$/;
/** 코인 id는 sha256 hex(계보 해시) — 형식만 방어적으로 확인(코인 내부에 결합하지 않음). */
const COIN_ID_RE = /^[0-9a-f]{16,128}$/i;

/** 새 별점 식별자 — 'rat-' + 랜덤 16 hex. */
export function newRatingId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `rat-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** 코드포인트 길이 — "자" 단위 계수 (이모지 서러게이트 쌍을 1로 센다). */
function codePointLength(s: string): number {
  return [...s].length;
}

function validateRelationProof(proof: unknown, reasons: string[]): void {
  if (!proof || typeof proof !== 'object') {
    reasons.push('relationProof: required');
    return;
  }
  const p = proof as { kind?: unknown; requestId?: unknown; coinId?: unknown };
  if (p.kind === 'BOOKING_APPROVAL') {
    if (typeof p.requestId !== 'string' || !BOOKING_REQUEST_ID_RE.test(p.requestId)) {
      reasons.push('relationProof.requestId: invalid format');
    }
  } else if (p.kind === 'PAYMENT_COIN') {
    if (typeof p.coinId !== 'string' || !COIN_ID_RE.test(p.coinId)) {
      reasons.push('relationProof.coinId: invalid format');
    }
  } else {
    reasons.push('relationProof.kind: unknown');
  }
}

/** 검증 — 통과 시 빈 배열, 실패 시 사유 코드 목록 (자연어 UI 문장 아님). */
export function validateRatingPayload(payload: unknown): string[] {
  const reasons: string[] = [];
  const p = payload as Partial<RatingCardPayload> | null;
  if (!p || typeof p !== 'object') return ['payload: not an object'];

  if (p.kind !== RATING_KIND) return ['kind: not a rating'];

  if (typeof p.ratingId !== 'string' || !RATING_ID_RE.test(p.ratingId)) {
    reasons.push('ratingId: invalid format');
  }
  if (
    typeof p.stars !== 'number' ||
    !Number.isInteger(p.stars) ||
    p.stars < RATING_STARS_MIN ||
    p.stars > RATING_STARS_MAX
  ) {
    reasons.push('stars: out of range');
  }
  if (p.review !== undefined) {
    if (typeof p.review !== 'string') {
      reasons.push('review: not a string');
    } else if (codePointLength(p.review) > RATING_REVIEW_MAX) {
      reasons.push('review: too long');
    }
  }
  if (typeof p.fromDisplayName !== 'string' || p.fromDisplayName.trim() === '') {
    reasons.push('fromDisplayName: required');
  }
  if (!RATING_DIRECTIONS.includes(p.direction as RatingDirection)) {
    reasons.push('direction: invalid');
  }
  validateRelationProof(p.relationProof, reasons);
  if (typeof p.makePublic !== 'boolean') reasons.push('makePublic: not a boolean');

  return reasons;
}

// ── 직렬화/파싱 ──────────────────────────────────────────────────

/** E2E 평문으로 직렬화한다. 형식 위반이면 throw — 잘못된 별점을 보내지 않는다. */
export function serializeRatingPayload(payload: RatingCardPayload): string {
  const reasons = validateRatingPayload(payload);
  if (reasons.length > 0) throw new Error(`invalid rating payload: ${reasons.join(', ')}`);
  return JSON.stringify(payload);
}

/**
 * 수신 평문에서 별점 카드를 판별한다.
 * JSON + kind === RATING + 검증 통과 → 페이로드, 그 외 전부 null (일반 텍스트 폴백 —
 * booking·thanksCard 메시지·자유 텍스트와의 공존/하위 호환).
 */
export function parseRatingPayload(plaintext: string): RatingCardPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { kind?: unknown }).kind !== RATING_KIND) {
    return null;
  }
  if (validateRatingPayload(parsed).length > 0) return null;
  return parsed as RatingCardPayload;
}

// ── 집계 (순수 함수) ─────────────────────────────────────────────

export interface RatingAggregate {
  /** 집계 대상 별점 수. */
  count: number;
  /**
   * 평균 별점 ×10 정수 (부동소수 회피). 예: 평균 4.6 → 46. count=0이면 0.
   * 표시할 때 /10 한다 (예: (46/10).toFixed(1) = "4.6").
   */
  averageTenths: number;
  /** makePublic=true(평가자 공개 동의)인 별점 수 — 게시 후보. */
  publicCount: number;
}

/**
 * 별점 카드 배열을 집계한다 (순수 — 부동소수 저장 회피, 평균은 ×10 정수).
 * 피평가자 지갑이 자기가 받은 카드 전체를 넘겨 count(받은 총 개수)·평균·공개
 * 후보 수를 구한다. 공개 프로필의 서버 평균은 게시분만으로 서버가 따로 집계한다.
 */
export function aggregateRatings(cards: readonly RatingCardPayload[]): RatingAggregate {
  const count = cards.length;
  if (count === 0) return { count: 0, averageTenths: 0, publicCount: 0 };
  let sum = 0;
  let publicCount = 0;
  for (const c of cards) {
    sum += c.stars;
    if (c.makePublic) publicCount += 1;
  }
  return { count, averageTenths: Math.round((sum / count) * 10), publicCount };
}
