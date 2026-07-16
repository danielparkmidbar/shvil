/**
 * 디렉토리 서버 공개 API 클라이언트 (지시서 6장 — shvilist.org).
 *
 * 이 웹은 공개(비서명) GET API만 소비한다:
 *   /angels?region= · /courses · /courses/proposals · /claims?status= ·
 *   /certificates?courseId= · /leaderboard?region= · /limits/baseline ·
 *   /limits/flagged · /transparency/community · /transparency/promo ·
 *   /transparency/market.
 * 서버에는 거래 승인 기능이 없고, 이 클라이언트에도 지불·수령·제출 호출이 없다 —
 * 클레임 제출·인정 투표·완주 인증·리더보드 등재·투숙 신청은 전부 지갑 앱
 * (서명 인증)에서 한다 (재조정 설계 R-7: 웹 신청 불허 — 웹은 열람·계획까지).
 *
 * 모든 fetch는 클라이언트 컴포넌트에서만 호출한다 (프리렌더 중 서버 미가동이
 * 빌드를 깨지 않게). 실패 시 throw하고 호출부가 안내 문구로 처리한다.
 */

export const DIRECTORY_URL =
  process.env.NEXT_PUBLIC_DIRECTORY_URL ?? 'http://localhost:8787';

const REQUEST_TIMEOUT_MS = 8_000;

// ── 계약 타입 (server/src/app.ts · community.ts 응답 형태) ────────
//
// 규칙: 응답 타입에 화면용 자연어(설명 문장·안내 문구) 필드를 두지 않는다.
// 서버는 숫자·코드·ID만 반환하고, 다국어는 전적으로 이 웹의 책임이다
// (i18n 사전 en/he/ko/es). 서버가 문장을 보내면 어떤 로케일에서도 번역할 수 없다.
// 사용자 자유 텍스트(코스명·표시명 등)는 예외 — 번역 대상이 아닌 원문 데이터다.

export interface GeoPoint {
  lat: number;
  lon: number;
}

// ── 엔젤 디렉토리 (엔젤 찾기 지도 — 서비스 재조정 §2-2) ─────────
//
// 위치 원칙 (확정 R-4): 서버가 저장·반환하는 좌표는 ~1km 눈금(0.01°)으로
// 눈금화된 대략 위치뿐이다 (server가 PUT /angels/me에서 방어적으로 재눈금화).
// 정확한 집 위치·주소는 승인된 두 사람 사이의 E2E 지갑 메시지로만 오간다.

export type BedService = 'ROOM' | 'SOFA' | 'TENT' | null;

/**
 * 잠자리 유형별 수용 인원 (2026-07-15 — 잠자리 복수 선택).
 * 0 또는 undefined = 해당 유형 미제공. 서버가 정수 1~20으로 방어 검증한다.
 */
export interface AngelBeds {
  room?: number;
  sofa?: number;
  tent?: number;
}

export interface AngelServices {
  /** 하위 호환용 단일 유형 — beds가 있으면 "인원이 가장 많은 유형"의 파생값. */
  bed?: BedService;
  internet?: boolean;
  shower?: boolean;
  meal?: boolean;
  /** 유형별 수용 인원 — 없으면 옛 레코드 (bed+capacity로 폴백 표시). */
  beds?: AngelBeds;
}

export interface AngelEntry {
  memberId: string;
  /** 엔젤이 공개를 선택한 닉네임(표시명) — 실명이 아니다. */
  name: string;
  /** ~1km 눈금화된 대략 위치 (R-4). */
  location: GeoPoint;
  services: AngelServices | null;
  capacity: number;
  conditions: string | null;
  visible: boolean;
  /**
   * M6 예약 (R-3): 엔젤이 자발 공개한 "지금 손님 받기 가능" 여부 + 갱신 시각.
   * 서버가 아는 것은 이 수준뿐 — 구체 날짜·캘린더는 승인된 두 사람의 E2E 메시지로만.
   */
  available?: boolean;
  availabilityUpdatedAt?: number | null;
  regionId?: string;
  distanceKm?: number;
}

/**
 * 게스트북 카드 (M7-A — 빈집 방명록의 디지털판, 재조정 §4-5).
 * 엔젤이 받은 감사 카드 중 작성자가 공개에 동의한 것을 자발 게시한 것이다.
 * 회원 번호는 없다 — 닉네임(fromDisplayName)과 메시지만. message/journeyLine은
 * 번역 대상이 아닌 사용자 원문 데이터다.
 */
export interface GuestbookCard {
  cardId: string;
  fromDisplayName: string;
  /** 쪽지 템플릿 코드 — 화면 이모지는 이 웹이 붙인다 (자연어 아님). */
  template: 'DEFAULT' | 'TENT' | 'MEAL' | 'ROAD' | string;
  message: string;
  journeyLine: string | null;
  createdAt: number;
}

/**
 * 상호 별점 (M7-B — 안 B, M7-A 게스트북의 형제 기능, 재조정 §4-5).
 * 손님↔엔젤이 서로 남긴 별점 중 작성자가 공개에 동의한 것의 집계다.
 * 회원 번호는 없다 — 닉네임(fromDisplayName)과 리뷰 원문만. review/fromDisplayName은
 * 번역 대상이 아닌 사용자 원문 데이터다. 공개율(公開率)의 분모는 피평가자가
 * 자기 신고한 총 수령 수(receivedCount)다.
 */
export interface PublicRating {
  ratingId: string;
  /** 별 개수 1~5 정수 — 화면의 ★ 글리프는 이 웹이 붙인다 (자연어 아님). */
  stars: number;
  review: string | null;
  fromDisplayName: string;
  direction: 'GUEST_TO_ANGEL' | 'ANGEL_TO_GUEST';
  createdAt: number;
}

export interface RatingSummary {
  /** 평균 별점 ×10 정수 — 46 = 4.6점. 별점이 없으면 0. */
  averageTenths: number;
  /** 공개된 별점 수. */
  publicCount: number;
  /** 피평가자가 자기 신고한 총 수령 수 (항상 publicCount 이상) — 공개율 분모. */
  receivedCount: number;
  ratings: PublicRating[];
}

export interface CourseSegmentMeta {
  fromIdx: number;
  toIdx: number;
  terrain: string;
  corridorHalfWidthM?: number;
  /** 난이도 계수 ×10 정수 (10 = ×1.0 ~ 40 = ×4.0). */
  difficultyTenths: number;
}

export interface CourseData {
  courseId: string;
  name: string;
  polyline: GeoPoint[];
  segments: CourseSegmentMeta[];
  version: number;
}

export interface CourseProposal {
  courseId: string;
  name: string;
  status: 'CANDIDATE' | 'OFFICIAL' | string;
  completions: number;
  promotionThreshold: number;
  createdAt: number;
}

export interface ClaimEntry {
  claimId: number;
  memberId: string;
  courseId: string;
  walkedAt: number;
  distanceM: number;
  photos: string[];
  status: 'OPEN' | 'APPROVED' | string;
  votes: number;
  voteThreshold: number;
  createdAt: number;
}

export interface CertificateEntry {
  certificateId: number;
  memberId: string;
  courseId: string;
  kind: 'FULL' | 'SECTION' | string;
  photos: string[];
  data: Record<string, unknown>;
  createdAt: number;
}

export interface LeaderboardEntry {
  rank: number;
  memberId: string;
  region: string;
  displayName: string;
  totalDistanceM: number;
  totalMintedDshv: number;
  verified: boolean;
}

export interface BaselineInfo {
  dailyMaxDshv: number;
  weeklyMaxDshv: number;
  regions: { region: string; topTotalMintedDshv: number; verifiedMembers: number }[];
}

// 소명 대기 목록(GET /limits/flagged)은 지갑 배포용이다 — 이 사이트는 회원 번호를
// 표시하지 않고 익명 카운트(transparency.flaggedPending)만 쓴다. 소명 절차 안내 문구는
// 사전(leaderboard.flaggedNote)에 4개 언어로 있다. 그래서 여기에 계약 타입을 두지 않는다.

export interface CommunityTransparency {
  claims: { open: number; approved: number; issuedDshv: number };
  rewards: { issued: number; issuedDshv: number };
  courses: { official: number; candidates: number };
  flaggedPending: number;
}

/** 사이트 발행분 공시 (전용 발행 키 서명 — 총량 투명성 페이지 공시 원칙). */
export interface PromoTransparency {
  registrationIssued: number;
  firstHostingIssued: number;
  registrationQuota: number;
}

export interface MarketTransparency {
  openListings: number;
  settledListings: number;
  settledDshv: number;
  collectedFeesUsdcMicro: number;
  feeBps: number;
}

// ── fetch 헬퍼 ───────────────────────────────────────────────────

/**
 * 무료 서버(Render free tier)는 15분 유휴 후 잠들고 첫 요청이 ~50초 걸린다.
 * 첫 시도는 짧게, 실패하면 점점 긴 타임아웃으로 재시도해 콜드 스타트를 견딘다.
 * (GET 전용 헬퍼라 재시도가 안전하다.)
 */
const RETRY_TIMEOUTS_MS = [REQUEST_TIMEOUT_MS, 30_000, 60_000];

async function getJson<T>(path: string): Promise<T> {
  let lastErr: unknown;
  for (const timeoutMs of RETRY_TIMEOUTS_MS) {
    try {
      const res = await fetch(`${DIRECTORY_URL}${path}`, {
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export async function fetchAngels(region?: string): Promise<AngelEntry[]> {
  const qs = region ? `?region=${encodeURIComponent(region)}` : '';
  const { angels } = await getJson<{ angels: AngelEntry[] }>(`/angels${qs}`);
  return angels;
}

export async function fetchCourses(): Promise<CourseData[]> {
  const { courses } = await getJson<{ courses: CourseData[] }>('/courses');
  return courses;
}

/**
 * 특정 엔젤의 공개 방명록 (M7-A) — 닉네임 + 감사 메시지만, 회원 번호 없음.
 * 프로필 카드의 "방명록 N" 미리보기에 쓴다. 실패 시 throw (호출부가 조용히 폴백).
 */
export async function fetchGuestbook(memberId: string): Promise<{ total: number; cards: GuestbookCard[] }> {
  return getJson<{ total: number; cards: GuestbookCard[] }>(`/guestbook?member=${encodeURIComponent(memberId)}`);
}

/**
 * 특정 엔젤의 공개 별점 집계 (M7-B) — 닉네임 + 리뷰 원문만, 회원 번호 없음.
 * 프로필 카드의 "별점" 요약에 쓴다. 실패 시 throw (호출부가 조용히 폴백).
 */
export async function fetchRatings(memberId: string): Promise<RatingSummary> {
  return getJson<RatingSummary>(`/ratings?member=${encodeURIComponent(memberId)}`);
}

export async function fetchProposals(): Promise<CourseProposal[]> {
  const { proposals } = await getJson<{ proposals: CourseProposal[] }>('/courses/proposals');
  return proposals;
}

export async function fetchClaims(status?: string): Promise<ClaimEntry[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const { claims } = await getJson<{ claims: ClaimEntry[] }>(`/claims${qs}`);
  return claims;
}

export async function fetchCertificates(courseId?: string): Promise<CertificateEntry[]> {
  const qs = courseId ? `?courseId=${encodeURIComponent(courseId)}` : '';
  const { certificates } = await getJson<{ certificates: CertificateEntry[] }>(`/certificates${qs}`);
  return certificates;
}

export async function fetchLeaderboard(region?: string): Promise<LeaderboardEntry[]> {
  const qs = region ? `?region=${encodeURIComponent(region)}` : '';
  const { leaderboard } = await getJson<{ leaderboard: LeaderboardEntry[] }>(`/leaderboard${qs}`);
  return leaderboard;
}

export function fetchBaseline(): Promise<BaselineInfo> {
  return getJson<BaselineInfo>('/limits/baseline');
}

export function fetchCommunityTransparency(): Promise<CommunityTransparency> {
  return getJson<CommunityTransparency>('/transparency/community');
}

export function fetchPromoTransparency(): Promise<PromoTransparency> {
  return getJson<PromoTransparency>('/transparency/promo');
}

export function fetchMarketTransparency(): Promise<MarketTransparency> {
  return getJson<MarketTransparency>('/transparency/market');
}

// ── 표기 헬퍼 ────────────────────────────────────────────────────

/** 10 dSHV = 1 SHV. 123 dSHV → "12.3 SHV". */
export function fmtShv(amountDshv: number): string {
  return `${(amountDshv / 10).toFixed(1)} SHV`;
}

/** USDC 마이크로 단위 → "1.23 USDC". */
export function fmtUsdcMicro(micro: number): string {
  return `${(micro / 1_000_000).toFixed(2)} USDC`;
}

/** 수수료 bp → "2.5%". */
export function fmtBps(bps: number): string {
  return `${(bps / 100).toFixed(1).replace(/\.0$/, '')}%`;
}

/** 평균 별점 ×10 정수 → "4.6" (별 개수 문자열 — ★ 글리프는 사전이 붙인다). */
export function fmtRatingAverage(averageTenths: number): string {
  return (averageTenths / 10).toFixed(1);
}

/** 공개율 % — 분모는 피평가자 자기 신고 총 수령 수. 0 나눗셈 방어. */
export function publicRatioPercent(publicCount: number, receivedCount: number): number {
  return receivedCount > 0 ? Math.round((publicCount / receivedCount) * 100) : 0;
}

/**
 * 지갑 앱 메신저 딥링크 — href만 제공, 앱 연동은 후속 (지갑 = 메신저).
 * 투숙 신청도 이 채널로 시작한다: 웹은 서명 주체가 아니므로 신청을 보낼 수
 * 없고(R-7), 지갑 대화로 넘긴다.
 */
export function chatDeepLink(memberId: string): string {
  return `shvil://chat/${encodeURIComponent(memberId)}`;
}

/** 미터 → "12.3" (km 숫자 문자열 — 단위 표기는 사전이 결정). */
export function fmtKmNumber(distanceM: number): string {
  return (distanceM / 1000).toFixed(1);
}

/** 로케일에 맞춘 날짜 표기. */
export function fmtDate(ts: number, locale: string): string {
  return new Date(ts).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** 코스 구간들의 난이도 계수 범위 — "1.0" 또는 "1.0–4.0". */
export function difficultyRange(segments: CourseSegmentMeta[]): string {
  if (segments.length === 0) return '1.0';
  let min = Infinity;
  let max = -Infinity;
  for (const s of segments) {
    if (s.difficultyTenths < min) min = s.difficultyTenths;
    if (s.difficultyTenths > max) max = s.difficultyTenths;
  }
  const lo = (min / 10).toFixed(1);
  const hi = (max / 10).toFixed(1);
  return lo === hi ? lo : `${lo}–${hi}`;
}
