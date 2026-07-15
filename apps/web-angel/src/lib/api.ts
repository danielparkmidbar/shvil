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

export interface AngelServices {
  bed?: BedService;
  internet?: boolean;
  shower?: boolean;
  meal?: boolean;
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
}

export interface CourseData {
  courseId: string;
  name: string;
  polyline: GeoPoint[];
  version: number;
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

/** 지갑 앱 메신저 딥링크 — href만 제공, 앱 연동은 후속. */
export function chatDeepLink(memberId: string): string {
  return `shvil://chat/${encodeURIComponent(memberId)}`;
}
