/**
 * 디렉토리 서버 wiring — API 클라이언트에 서버 URL(kv 오버라이드)과
 * 인증 컨텍스트(기기 키 서명)를 주입하고, 오프라인 캐시를 관리한다.
 *
 * 오프라인 우선: 여기의 모든 sync류 함수는 실패해도 앱 동작에 영향이 없다.
 * 캐시 대상은 공개 데이터뿐이다 — 코스 폴리라인, 엔젤 포인트(본인 자발 공개),
 * 프로모션 발행 공개키. 사용자 이동 궤적 좌표는 어디에도 저장하지 않는다.
 */
import type { CourseData } from '@shvil/shared';
import { DEFAULT_SERVER_URL, DirectoryApi, type AngelDirectoryEntry, type FlaggedMemberEntry } from './api';
import { kvGet, kvSet } from './db';
import { FLAGGED_CACHE_KEY, parseFlaggedCache } from './flagged';
import { wallet } from './walletService';

const SERVER_URL_KEY = 'serverUrl.v1';
const TRUSTED_KEYS_CACHE = 'trustedKeys.v1';
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

/**
 * 신뢰 발행 키 3종 — 프로모(엔젤 보너스)·클레임·격려 (GET /keys).
 * 서버에서 갱신 시도 → 실패하면 캐시 사용. 아무것도 없으면 빈 목록.
 * verifyCoin의 trustedIssuerKeys로 3종 전부가 들어간다.
 */
export async function getTrustedIssuerKeys(): Promise<Record<string, string>> {
  try {
    const infos = await directoryApi.getTrustedKeys();
    const keys: Record<string, string> = {};
    for (const k of infos) keys[k.keyId] = k.publicKey;
    await kvSet(TRUSTED_KEYS_CACHE, JSON.stringify(keys));
    return keys;
  } catch {
    const cached = await kvGet(TRUSTED_KEYS_CACHE);
    return cached ? (JSON.parse(cached) as Record<string, string>) : {};
  }
}

// ── 소명 대기 목록 (지시서 3장 5절 — 수신 지갑의 수령 보류) ───────

/**
 * 소명 대기 회원 번호 목록을 kv에 캐시한다 — 앱 시작 시 + 수동 새로고침.
 * 실패해도 앱 동작에 영향 없음 (기존 캐시 유지). 반환: 갱신된 목록.
 */
export async function syncFlaggedList(): Promise<FlaggedMemberEntry[]> {
  const members = await directoryApi.getFlaggedMembers();
  await kvSet(FLAGGED_CACHE_KEY, JSON.stringify(members));
  return members;
}

/** 캐시된 소명 대기 목록 (없으면 빈 목록). */
export async function loadFlaggedMembers(): Promise<FlaggedMemberEntry[]> {
  return parseFlaggedCache(await kvGet(FLAGGED_CACHE_KEY));
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
