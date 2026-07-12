/**
 * 디렉토리 서버 wiring — API 클라이언트에 서버 URL(kv 오버라이드)과
 * 인증 컨텍스트(기기 키 서명)를 주입하고, 오프라인 캐시를 관리한다.
 *
 * 오프라인 우선: 여기의 모든 sync류 함수는 실패해도 앱 동작에 영향이 없다.
 * 캐시 대상은 공개 데이터뿐이다 — 코스 폴리라인, 엔젤 포인트(본인 자발 공개),
 * 프로모션 발행 공개키. 사용자 이동 궤적 좌표는 어디에도 저장하지 않는다.
 */
import type { CourseData } from '@shvil/shared';
import { DEFAULT_SERVER_URL, DirectoryApi, type AngelDirectoryEntry } from './api';
import { kvGet, kvSet } from './db';
import { wallet } from './walletService';

const SERVER_URL_KEY = 'serverUrl.v1';
const PROMO_KEY_CACHE = 'promoKey.v1';
const COURSES_CACHE = 'courses.v1';
const ANGELS_CACHE = 'angels.v1';

export async function getServerUrl(): Promise<string> {
  return (await kvGet(SERVER_URL_KEY)) ?? DEFAULT_SERVER_URL;
}

export async function setServerUrl(url: string): Promise<void> {
  await kvSet(SERVER_URL_KEY, url.trim() || DEFAULT_SERVER_URL);
}

export const directoryApi = new DirectoryApi({
  getBaseUrl: getServerUrl,
  getAuth: () => ({ memberId: wallet.identity.memberId, signer: wallet.identity.signer }),
});

// ── 신뢰 발행 키 (GRANT 계보 검증용 trustedIssuerKeys) ────────────

/** 서버에서 갱신 시도 → 실패하면 캐시 사용. 아무것도 없으면 빈 목록. */
export async function getTrustedIssuerKeys(): Promise<Record<string, string>> {
  try {
    const info = await directoryApi.getPromoKey();
    const keys = { [info.keyId]: info.publicKey };
    await kvSet(PROMO_KEY_CACHE, JSON.stringify(keys));
    return keys;
  } catch {
    const cached = await kvGet(PROMO_KEY_CACHE);
    return cached ? (JSON.parse(cached) as Record<string, string>) : {};
  }
}

// ── 코스 데이터 갱신분 내려받기 (지시서 2.2 — 오프라인 동작 필수) ──

export async function syncCourses(): Promise<void> {
  const courses = await directoryApi.getCourses();
  if (courses.length > 0) await kvSet(COURSES_CACHE, JSON.stringify(courses));
}

/** 내장 샘플 대신 쓸 캐시된 코스 (없으면 null — 호출부가 내장 데이터로 폴백). */
export async function loadCachedCourses(): Promise<CourseData[] | null> {
  const cached = await kvGet(COURSES_CACHE);
  return cached ? (JSON.parse(cached) as CourseData[]) : null;
}

// ── 엔젤 디렉토리 캐시 (엔젤 우회 판정·지도 오프라인 폴백) ────────

export async function cacheAngels(angels: AngelDirectoryEntry[]): Promise<void> {
  await kvSet(ANGELS_CACHE, JSON.stringify(angels));
}

export async function loadCachedAngels(): Promise<AngelDirectoryEntry[] | null> {
  const cached = await kvGet(ANGELS_CACHE);
  return cached ? (JSON.parse(cached) as AngelDirectoryEntry[]) : null;
}
