/**
 * 예약(투숙 신청/승인) 메시지 스키마 — M6 (서비스 재조정 §4-2).
 *
 * 예약은 코인 거래가 아니라 두 사람 사이의 일정 약속이다 (헌법 제9조: 서버는
 * 거래를 승인하지 않는다). 이 페이로드는 E2E 메신저(messaging.ts sealMessage)의
 * "평문" 안에 담기는 구조화 데이터다 — 서버는 암호문 봉투만 중계하며 이 형식의
 * 존재조차 모른다. 상태(승인/거부)는 각 지갑 로컬에서 회신 메시지로 파생된다.
 *
 * - R-2 (기본값): 신청 첨부 프로필 = 닉네임 + 가입 시기 + 여정 한 줄.
 *   실명·사진 없음. 별점은 M7 예정 — 자리만 optional(rating)로 예약.
 * - R-4 (확정): 정확한 위치·주소·연락처는 APPROVED 회신에만 실려
 *   승인된 두 개인 간 E2E로 전달된다. 서버 저장 금지.
 * - 하위 호환: 평문이 JSON이고 kind 필드가 있으면 구조화 메시지, 파싱·검증
 *   실패 시 일반 텍스트로 취급한다 (parseBookingPayload가 null 반환).
 */
import type { GeoPoint } from './courses';

export const BOOKING_REQUEST_KIND = 'BOOKING_REQUEST' as const;
export const BOOKING_REPLY_KIND = 'BOOKING_REPLY' as const;

/** 신청자가 동의하고 첨부하는 최소 프로필 (R-2) — 서버는 저장하지 않는다. */
export interface BookingProfile {
  /** 닉네임 (실명 아님). */
  displayName: string;
  /** 가입 시기 — 'YYYY-MM' 또는 'YYYY-MM-DD'. */
  memberSince?: string;
  /** 여정 한 줄 (자유 텍스트) — 예: "쉬빌 북부 구간 걷는 중". */
  journeyLine?: string;
  /** 별점 (0~5) — M7에서 채워질 자리. 현재는 항상 미첨부. */
  rating?: number;
}

/** 투숙 희망 날짜 범위 — ISO 날짜(YYYY-MM-DD). */
export interface BookingDates {
  fromDate: string;
  toDate: string;
}

/** 투숙 신청 (리스트 → 엔젤). */
export interface BookingRequestPayload {
  kind: typeof BOOKING_REQUEST_KIND;
  /** 신청 식별자 — 회신이 이 ID를 되돌려 신청↔회신을 짝짓는다. */
  requestId: string;
  dates: BookingDates;
  /** 인원 (1~10). */
  partySize: number;
  /** 한마디 (자유 텍스트). */
  note?: string;
  profile: BookingProfile;
}

export type BookingDecision = 'APPROVED' | 'DECLINED' | 'SUGGEST';

/** 투숙 회신 (엔젤 → 리스트). 승인/거부는 언제나 엔젤의 자유다 (헌법 제9조). */
export interface BookingReplyPayload {
  kind: typeof BOOKING_REPLY_KIND;
  requestId: string;
  decision: BookingDecision;
  /** SUGGEST일 때 필수 — 대안 날짜 제안. */
  suggestedDates?: BookingDates;
  note?: string;
  /**
   * R-4: 아래 세 필드는 APPROVED일 때만 허용된다 — 정확한 위치·주소·연락처는
   * 승인된 상대에게만 E2E로 전달된다. (엔젤 지갑 로컬 원본에서 꺼내 첨부한다.)
   */
  preciseLocation?: GeoPoint;
  addressText?: string;
  contact?: string;
}

export type BookingPayload = BookingRequestPayload | BookingReplyPayload;

// ── 검증 ─────────────────────────────────────────────────────────

const REQUEST_ID_RE = /^bkg-[0-9a-f]{16}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MEMBER_SINCE_RE = /^\d{4}-\d{2}(-\d{2})?$/;

export const BOOKING_PARTY_SIZE_MIN = 1;
export const BOOKING_PARTY_SIZE_MAX = 10;

/** 새 신청 식별자 — 'bkg-' + 랜덤 16 hex. */
export function newBookingRequestId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `bkg-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  // JS Date는 2026-02-31 같은 값을 3월로 넘겨 버리므로 되돌려 대조한다.
  return new Date(t).toISOString().slice(0, 10) === value;
}

function validateDates(dates: unknown, label: string, reasons: string[]): void {
  const d = dates as BookingDates | null;
  if (!d || typeof d !== 'object') {
    reasons.push(`${label}: dates required`);
    return;
  }
  if (!isIsoDate(d.fromDate)) reasons.push(`${label}: invalid fromDate`);
  if (!isIsoDate(d.toDate)) reasons.push(`${label}: invalid toDate`);
  if (isIsoDate(d.fromDate) && isIsoDate(d.toDate) && d.fromDate > d.toDate) {
    reasons.push(`${label}: fromDate after toDate`);
  }
}

function isOptionalString(v: unknown): boolean {
  return v === undefined || typeof v === 'string';
}

/** 검증 — 통과 시 빈 배열, 실패 시 사유 코드 목록 (자연어 UI 문장 아님). */
export function validateBookingPayload(payload: unknown): string[] {
  const reasons: string[] = [];
  const p = payload as Partial<BookingPayload> | null;
  if (!p || typeof p !== 'object') return ['payload: not an object'];

  if (typeof p.requestId !== 'string' || !REQUEST_ID_RE.test(p.requestId)) {
    reasons.push('requestId: invalid format');
  }

  if (p.kind === BOOKING_REQUEST_KIND) {
    const req = p as Partial<BookingRequestPayload>;
    validateDates(req.dates, 'request', reasons);
    if (
      typeof req.partySize !== 'number' ||
      !Number.isInteger(req.partySize) ||
      req.partySize < BOOKING_PARTY_SIZE_MIN ||
      req.partySize > BOOKING_PARTY_SIZE_MAX
    ) {
      reasons.push('partySize: out of range');
    }
    if (!isOptionalString(req.note)) reasons.push('note: not a string');
    const profile = req.profile as Partial<BookingProfile> | undefined;
    if (!profile || typeof profile !== 'object') {
      reasons.push('profile: required');
    } else {
      if (typeof profile.displayName !== 'string' || profile.displayName.trim() === '') {
        reasons.push('profile.displayName: required');
      }
      if (profile.memberSince !== undefined && !MEMBER_SINCE_RE.test(String(profile.memberSince))) {
        reasons.push('profile.memberSince: invalid format');
      }
      if (!isOptionalString(profile.journeyLine)) reasons.push('profile.journeyLine: not a string');
      if (profile.rating !== undefined && (typeof profile.rating !== 'number' || profile.rating < 0 || profile.rating > 5)) {
        reasons.push('profile.rating: out of range');
      }
    }
    return reasons;
  }

  if (p.kind === BOOKING_REPLY_KIND) {
    const rep = p as Partial<BookingReplyPayload>;
    if (rep.decision !== 'APPROVED' && rep.decision !== 'DECLINED' && rep.decision !== 'SUGGEST') {
      reasons.push('decision: invalid');
    }
    if (rep.decision === 'SUGGEST') {
      validateDates(rep.suggestedDates, 'suggest', reasons);
    } else if (rep.suggestedDates !== undefined) {
      reasons.push('suggestedDates: only for SUGGEST');
    }
    if (!isOptionalString(rep.note)) reasons.push('note: not a string');
    // R-4: 정확 정보는 승인 회신에만 — 그 외 결정에 실려 있으면 형식 위반으로 거부.
    if (rep.decision !== 'APPROVED') {
      if (rep.preciseLocation !== undefined) reasons.push('preciseLocation: only for APPROVED');
      if (rep.addressText !== undefined) reasons.push('addressText: only for APPROVED');
      if (rep.contact !== undefined) reasons.push('contact: only for APPROVED');
    } else {
      const loc = rep.preciseLocation;
      if (loc !== undefined) {
        if (
          typeof loc !== 'object' ||
          typeof loc.lat !== 'number' ||
          typeof loc.lon !== 'number' ||
          Math.abs(loc.lat) > 90 ||
          Math.abs(loc.lon) > 180
        ) {
          reasons.push('preciseLocation: invalid');
        }
      }
      if (!isOptionalString(rep.addressText)) reasons.push('addressText: not a string');
      if (!isOptionalString(rep.contact)) reasons.push('contact: not a string');
    }
    return reasons;
  }

  return ['kind: unknown'];
}

// ── 직렬화/파싱 ──────────────────────────────────────────────────

/** E2E 평문으로 직렬화한다. 형식 위반이면 throw — 잘못된 신청을 보내지 않는다. */
export function serializeBookingPayload(payload: BookingPayload): string {
  const reasons = validateBookingPayload(payload);
  if (reasons.length > 0) throw new Error(`invalid booking payload: ${reasons.join(', ')}`);
  return JSON.stringify(payload);
}

/**
 * 수신 평문에서 구조화 메시지를 판별한다.
 * JSON + kind 필드 + 검증 통과 → 페이로드, 그 외 전부 null (일반 텍스트 폴백 —
 * 기존 자유 텍스트 메시지와의 하위 호환).
 */
export function parseBookingPayload(plaintext: string): BookingPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || !('kind' in parsed)) return null;
  if (validateBookingPayload(parsed).length > 0) return null;
  return parsed as BookingPayload;
}
