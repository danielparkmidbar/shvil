/**
 * 동행 찾기 (여정 공유·팀 모집) 스키마 — M8 (서비스 재조정 §4-6, R-6).
 *
 * 다니엘 쌤 경험: "1인 여행자보다 3~4팀이 신뢰도가 높다. 여정에서 친구가
 * 만들어져 함께 여행도 하지만 투숙을 용이하게 하기 위해 팀을 만드는 경우도 있다.
 * 자신의 여정을 나누고 함께 여행할 사람을 미리 만드는 공간."
 *
 * ── 두 부분으로 나뉜다 ────────────────────────────────────────────────
 * (1) 동행 게시글 (companions 테이블, 서버 저장): 게스트북·별점과 같은 **자발 공개
 *     모델**이다. 게시자는 공개 모집이므로 자기 여정(구간·대략 날짜·팀 규모)을
 *     스스로 공개한다. 서버는 이 공개 게시물만 안다. 정확한 위치·연락처는 담지
 *     않는다 — 관심 있는 사람이 아래 (2) E2E 메시지로 접촉한다.
 * (2) 관심 표명 (COMPANION_INTEREST, E2E 메시지): "관심 있어요"는 booking·rating·
 *     thanksCard와 같은 형제 타입으로, messaging.ts sealMessage의 "평문" 안에 담긴다.
 *     서버는 암호문 봉투만 중계하며 이 형식의 존재조차 모른다. 실제 팀 구성·조율은
 *     전부 이 E2E 채널에서 이루어진다.
 *
 * ── 프라이버시 (헌법 제9조·재조정 §4-6) ──────────────────────────────
 * 서버는 "누가 누구와 팀"이라는 **확정 팀 관계를 저장하지 않는다.** 저장하는 것은
 * 게시글(게시자 본인의 공개 정보)까지다. 관심 표명은 E2E 메시지라 서버가 내용을
 * 못 보고, 확정 팀 구성 자체가 서버로 오지 않는다 — companions 테이블 어디에도
 * "팀원"이나 "수락된 관심"을 저장하는 필드가 없다.
 */
import { regionById, type TrailRegion } from './regions';

// ── 게시글 계약 ───────────────────────────────────────────────────

/** 이동 수단 — 도보/자전거 (다니엘 쌤: 여정 방식). */
export type CompanionMode = 'WALK' | 'BIKE';
export const COMPANION_MODES: readonly CompanionMode[] = ['WALK', 'BIKE'];

/** 모집 상태 — 열림/마감. */
export type CompanionStatus = 'OPEN' | 'CLOSED';
export const COMPANION_STATUSES: readonly CompanionStatus[] = ['OPEN', 'CLOSED'];

/** 저장·조회 상한 — 사용자 원문 그대로지만 폭주를 막는 방어 한도 (스키마와 무관). */
export const COMPANION_NOTE_MAX = 500;
export const COMPANION_DISPLAY_NAME_MAX = 100;
export const COMPANION_COURSE_ID_MAX = 64;

/** 팀 규모 범위 — current(현재 인원)는 1(나 혼자)부터, target(목표)은 2부터. */
export const COMPANION_PARTY_MIN = 1;
export const COMPANION_PARTY_TARGET_MIN = 2;
export const COMPANION_PARTY_MAX = 10;

/**
 * 권장 팀 규모 3~4인 (신뢰도 — 다니엘 쌤 경험). 강제가 아니라 안내 표기용이다.
 * UI는 이 범위를 "권장"으로 부드럽게 안내한다 (제1원칙: 동행은 능동 진입).
 */
export const COMPANION_TEAM_RECOMMENDED_MIN = 3;
export const COMPANION_TEAM_RECOMMENDED_MAX = 4;

/**
 * author당 동시 OPEN 게시글 상한 (스팸 방지). 정상 이용에는 넉넉하고, 초과 시
 * 서버가 429 코드로 거부한다 (자연어 문구 아님 — noUiStrings 원칙).
 */
export const COMPANION_OPEN_LIMIT = 5;

/** 게시글 작성 입력 (게시자가 서명해 POST /companions로 보낸다). */
export interface CompanionPostInput {
  /** 소속 트레일 지역 (WORLD_TRAILS 슬러그). */
  regionId: string;
  /** 코스 ID (선택) — 특정 코스 위 구간을 걷는다면. */
  courseId?: string;
  /** 대략 날짜 범위 (ISO YYYY-MM-DD) — 정확 일정은 넣지 않는다. */
  fromDate: string;
  toDate: string;
  /** 현재 모인 인원 (1~target). */
  partySizeCurrent: number;
  /** 목표 팀 규모 (2~10, 권장 3~4). */
  partySizeTarget: number;
  mode: CompanionMode;
  /** 게시자 닉네임 (실명 아님) — 공개 표시명. */
  displayName: string;
  /** 한마디 (자유 텍스트, 선택) — 사용자 원문, 번역 대상 아님. */
  note?: string;
}

/** 게시글 상태·인원 갱신 입력 (PUT /companions/:id) — 모집 마감·인원 증감. */
export interface CompanionUpdateInput {
  status?: CompanionStatus;
  partySizeCurrent?: number;
  partySizeTarget?: number;
  note?: string;
}

/**
 * 공개 게시글 (GET /companions) — 게시자 닉네임으로 표시된다.
 *
 * ★ authorMemberId·messagingPublicKey는 **연락 라우팅 핸들**이다 (엔젤 디렉토리
 * GET /angels가 memberId·messagingPublicKey를 공개하는 것과 동일). 화면에 보이는
 * 신원은 displayName(닉네임)이며, memberId는 E2E 1:1 접촉과 웹 딥링크(shvil://chat/
 * {memberId})를 위한 기계 핸들일 뿐 실명·전화·이메일 같은 개인정보가 아니다.
 * 이 핸들을 공개해도 "확정 팀 관계"는 저장되지 않는다 — 관심 표명은 E2E다.
 */
export interface CompanionListing extends CompanionPostInput {
  postId: string;
  status: CompanionStatus;
  createdAt: number;
  /** 게시자 연락 핸들 (닉네임 표시용 아님 — E2E 접촉·딥링크 라우팅용). */
  authorMemberId: string;
  /** 게시자 메시징 공개키 — 관심자가 E2E 봉인에 사용. */
  messagingPublicKey: string;
}

// ── 관심 표명 (COMPANION_INTEREST) — E2E 메시지 페이로드 ───────────────

export const COMPANION_INTEREST_KIND = 'COMPANION_INTEREST' as const;

/**
 * "관심 있어요" 카드. E2E 평문에 담긴다 — 서버는 내용을 모른다.
 * booking·rating·thanksCard와 형제 타입으로, kind로 분기되어 공존한다.
 */
export interface CompanionInterestPayload {
  kind: typeof COMPANION_INTEREST_KIND;
  /** 관심 대상 게시글 식별자. */
  postId: string;
  /** 보내는 이 닉네임 (실명 아님). */
  fromDisplayName: string;
  /** 한마디 (선택) — 자유 텍스트. */
  note?: string;
}

// ── 검증 ─────────────────────────────────────────────────────────

const POST_ID_RE = /^cmp-[0-9a-f]{16}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 새 게시글 식별자 — 'cmp-' + 랜덤 16 hex. */
export function newCompanionPostId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `cmp-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** 게시글 식별자 형식 검사 (서버·클라이언트 공용). */
export function isCompanionPostId(value: unknown): value is string {
  return typeof value === 'string' && POST_ID_RE.test(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  // JS Date는 2026-02-31 같은 값을 3월로 넘겨 버리므로 되돌려 대조한다.
  return new Date(t).toISOString().slice(0, 10) === value;
}

function isIntInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

/**
 * 게시글 입력 검증 — 통과 시 빈 배열, 실패 시 사유 코드 목록 (자연어 UI 문장 아님).
 * regionId가 알려진 트레일인지도 확인한다 (WORLD_TRAILS — LIVE/COMING_SOON 모두 허용:
 * 여정 계획은 아직 열리지 않은 트레일에 대해서도 미리 팀을 만들 수 있다).
 */
export function validateCompanionInput(
  input: unknown,
  regionResolver: (regionId: string) => TrailRegion | undefined = (id) => regionById(id),
): string[] {
  const reasons: string[] = [];
  const p = input as Partial<CompanionPostInput> | null;
  if (!p || typeof p !== 'object') return ['input: not an object'];

  if (typeof p.regionId !== 'string' || regionResolver(p.regionId) === undefined) {
    reasons.push('regionId: unknown region');
  }
  if (p.courseId !== undefined) {
    if (typeof p.courseId !== 'string' || p.courseId.trim() === '' || p.courseId.length > COMPANION_COURSE_ID_MAX) {
      reasons.push('courseId: invalid');
    }
  }
  if (!isIsoDate(p.fromDate)) reasons.push('fromDate: invalid');
  if (!isIsoDate(p.toDate)) reasons.push('toDate: invalid');
  if (isIsoDate(p.fromDate) && isIsoDate(p.toDate) && p.fromDate! > p.toDate!) {
    reasons.push('fromDate: after toDate');
  }
  if (!isIntInRange(p.partySizeTarget, COMPANION_PARTY_TARGET_MIN, COMPANION_PARTY_MAX)) {
    reasons.push('partySizeTarget: out of range');
  }
  if (!isIntInRange(p.partySizeCurrent, COMPANION_PARTY_MIN, COMPANION_PARTY_MAX)) {
    reasons.push('partySizeCurrent: out of range');
  }
  if (
    isIntInRange(p.partySizeCurrent, COMPANION_PARTY_MIN, COMPANION_PARTY_MAX) &&
    isIntInRange(p.partySizeTarget, COMPANION_PARTY_TARGET_MIN, COMPANION_PARTY_MAX) &&
    p.partySizeCurrent! > p.partySizeTarget!
  ) {
    reasons.push('partySizeCurrent: exceeds target');
  }
  if (!COMPANION_MODES.includes(p.mode as CompanionMode)) reasons.push('mode: invalid');
  if (typeof p.displayName !== 'string' || p.displayName.trim() === '' || p.displayName.length > COMPANION_DISPLAY_NAME_MAX) {
    reasons.push('displayName: required');
  }
  if (p.note !== undefined && (typeof p.note !== 'string' || p.note.length > COMPANION_NOTE_MAX)) {
    reasons.push('note: invalid');
  }
  return reasons;
}

/** 갱신 입력 검증 — 최소 한 필드는 있어야 하고, 있는 필드는 형식이 맞아야 한다. */
export function validateCompanionUpdate(input: unknown): string[] {
  const reasons: string[] = [];
  const p = input as Partial<CompanionUpdateInput> | null;
  if (!p || typeof p !== 'object') return ['input: not an object'];
  const hasAny =
    p.status !== undefined || p.partySizeCurrent !== undefined || p.partySizeTarget !== undefined || p.note !== undefined;
  if (!hasAny) reasons.push('input: no fields to update');
  if (p.status !== undefined && !COMPANION_STATUSES.includes(p.status as CompanionStatus)) {
    reasons.push('status: invalid');
  }
  if (p.partySizeTarget !== undefined && !isIntInRange(p.partySizeTarget, COMPANION_PARTY_TARGET_MIN, COMPANION_PARTY_MAX)) {
    reasons.push('partySizeTarget: out of range');
  }
  if (p.partySizeCurrent !== undefined && !isIntInRange(p.partySizeCurrent, COMPANION_PARTY_MIN, COMPANION_PARTY_MAX)) {
    reasons.push('partySizeCurrent: out of range');
  }
  if (p.note !== undefined && (typeof p.note !== 'string' || p.note.length > COMPANION_NOTE_MAX)) {
    reasons.push('note: invalid');
  }
  return reasons;
}

// ── 관심 표명 직렬화/파싱 ────────────────────────────────────────

const INTEREST_NOTE_MAX = 500;

/** 새 관심 표명 검증 — 통과 시 빈 배열, 실패 시 사유 코드 목록. */
export function validateCompanionInterest(payload: unknown): string[] {
  const reasons: string[] = [];
  const p = payload as Partial<CompanionInterestPayload> | null;
  if (!p || typeof p !== 'object') return ['payload: not an object'];
  if (p.kind !== COMPANION_INTEREST_KIND) return ['kind: not a companion interest'];
  if (!isCompanionPostId(p.postId)) reasons.push('postId: invalid format');
  if (typeof p.fromDisplayName !== 'string' || p.fromDisplayName.trim() === '') {
    reasons.push('fromDisplayName: required');
  }
  if (p.note !== undefined && (typeof p.note !== 'string' || p.note.length > INTEREST_NOTE_MAX)) {
    reasons.push('note: invalid');
  }
  return reasons;
}

/** E2E 평문으로 직렬화한다. 형식 위반이면 throw — 잘못된 관심 표명을 보내지 않는다. */
export function serializeCompanionInterest(payload: CompanionInterestPayload): string {
  const reasons = validateCompanionInterest(payload);
  if (reasons.length > 0) throw new Error(`invalid companion interest: ${reasons.join(', ')}`);
  return JSON.stringify(payload);
}

/**
 * 수신 평문에서 관심 표명을 판별한다.
 * JSON + kind === COMPANION_INTEREST + 검증 통과 → 페이로드, 그 외 전부 null
 * (일반 텍스트 폴백 — booking·rating·thanksCard·자유 텍스트와 공존).
 */
export function parseCompanionInterest(plaintext: string): CompanionInterestPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { kind?: unknown }).kind !== COMPANION_INTEREST_KIND) {
    return null;
  }
  if (validateCompanionInterest(parsed).length > 0) return null;
  return parsed as CompanionInterestPayload;
}
