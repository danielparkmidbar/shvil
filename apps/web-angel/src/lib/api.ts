/**
 * 디렉토리 서버 공개 API 클라이언트 (지시서 1장).
 *
 * 이 웹은 공개(비서명) API만 소비한다: GET /angels · GET /courses ·
 * GET /market/listings · GET /transparency/promo · GET /transparency/market.
 * 서버에는 거래 승인 기능이 없고, 이 클라이언트에도 지불·수령 호출이 없다 —
 * SHV 거래는 두 기기의 로컬 서명으로 완결된다.
 *
 * 모든 fetch는 클라이언트 컴포넌트에서만 호출한다 (프리렌더 중 서버 미가동이
 * 빌드를 깨지 않게). 실패 시 throw하고 호출부가 안내 문구로 처리한다.
 */

export const DIRECTORY_URL =
  process.env.NEXT_PUBLIC_DIRECTORY_URL ?? 'http://localhost:8787';

const REQUEST_TIMEOUT_MS = 8_000;

// ── 계약 타입 (server/src/app.ts · market.ts 응답 형태) ──────────
//
// 규칙: 응답 타입에 화면용 자연어(설명 문장·안내 문구) 필드를 두지 않는다.
// 서버는 숫자·코드·ID만 반환하고, 다국어는 전적으로 이 웹의 책임이다
// (i18n 사전 en/he/ko/es). 서버가 문장을 보내면 어떤 로케일에서도 번역할 수 없다 —
// 실제로 /transparency/market의 note가 영어 화면에 한국어를 노출한 적이 있다.
// 사용자 자유 텍스트(엔젤 이름·접대 조건 등)는 예외 — 번역 대상이 아닌 원문 데이터다.

export interface GeoPoint {
  lat: number;
  lon: number;
}

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
  name: string;
  location: GeoPoint;
  services: AngelServices | null;
  capacity: number;
  conditions: string | null;
  visible: boolean;
  distanceKm?: number;
  /** C 신뢰 지표: 엔젤이 자발 공개한 완주·접대 실적 뱃지 (미공개면 null). */
  trust?: TrustSummary | null;
}

/**
 * 검증 가능한 신뢰 지표 (C — 별점 대신 사실, 검증가능신뢰_설계.md).
 * 별점(주관 점수)이 위조를 못 막으므로, 신뢰의 주 지표를 위조가 어려운 사실로
 * 옮긴다. 전부 뱃지·숫자·일자뿐 — 자연어는 이 웹 i18n 사전 몫. 정확한 코인 액수는
 * 나오지 않는다(walkTier 구간만) — 개인 재정 비노출.
 */
export type TrustWalkTier = 'NONE' | 'STARTER' | 'EXPERIENCED' | 'VETERAN';

export interface TrustAngel {
  guestbookCards: number;
  firstHosting: boolean;
  angelSinceDay: string;
}

export interface TrustSummary {
  claimsApproved: number;
  certificatesFull: number;
  certificatesSection: number;
  walkTier: TrustWalkTier;
  memberSinceDay: string;
  angel: TrustAngel | null;
  leaderboardVerified: boolean;
}

export interface CourseData {
  courseId: string;
  name: string;
  polyline: GeoPoint[];
  version: number;
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

/** 무정가 리스팅 — 가격 필드는 존재하지 않는다. 구매자가 제시한다. */
export interface MarketListing {
  listingId: number;
  sellerMemberId: string;
  sellerName: string | null;
  amountDshv: number;
  createdAt: number;
}

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

export async function fetchAngels(): Promise<AngelEntry[]> {
  const { angels } = await getJson<{ angels: AngelEntry[] }>('/angels');
  return angels;
}

export async function fetchCourses(): Promise<CourseData[]> {
  const { courses } = await getJson<{ courses: CourseData[] }>('/courses');
  return courses;
}

/**
 * 특정 엔젤의 공개 방명록 (M7-A) — 닉네임 + 감사 메시지만, 회원 번호 없음.
 * 이웃 엔젤 프로필 카드의 "방명록 N" 미리보기에 쓴다. 실패 시 throw (호출부가 폴백).
 */
export async function fetchGuestbook(memberId: string): Promise<{ total: number; cards: GuestbookCard[] }> {
  return getJson<{ total: number; cards: GuestbookCard[] }>(`/guestbook?member=${encodeURIComponent(memberId)}`);
}

/**
 * 특정 엔젤의 공개 별점 집계 (M7-B) — 닉네임 + 리뷰 원문만, 회원 번호 없음.
 * 이웃 엔젤 프로필 카드의 "별점" 요약에 쓴다. 실패 시 throw (호출부가 폴백).
 */
export async function fetchRatings(memberId: string): Promise<RatingSummary> {
  return getJson<RatingSummary>(`/ratings?member=${encodeURIComponent(memberId)}`);
}

export async function fetchListings(): Promise<MarketListing[]> {
  const { listings } = await getJson<{ listings: MarketListing[] }>('/market/listings');
  return listings;
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

/** 지갑 앱 메신저 딥링크 — href만 제공, 앱 연동은 후속. */
export function chatDeepLink(memberId: string): string {
  return `shvil://chat/${encodeURIComponent(memberId)}`;
}
