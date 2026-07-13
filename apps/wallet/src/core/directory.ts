/**
 * 디렉토리 서버 wiring — API 클라이언트에 서버 URL(kv 오버라이드)과
 * 인증 컨텍스트(기기 키 서명)를 주입하고, 오프라인 캐시를 관리한다.
 *
 * 오프라인 우선: 여기의 모든 sync류 함수는 실패해도 앱 동작에 영향이 없다.
 * 캐시 대상은 공개 데이터뿐이다 — 코스 폴리라인, 엔젤 포인트(본인 자발 공개),
 * 프로모션 발행 공개키. 사용자 이동 궤적 좌표는 어디에도 저장하지 않는다.
 */
import type { CourseData, Signed } from '@shvil/shared';
import {
  DEFAULT_SERVER_URL,
  DirectoryApi,
  type AngelDirectoryEntry,
  type FlaggedMemberEntry,
  type TrustedKeyInfo,
} from './api';
import { DIST_PIN_KEY, guardDistribution } from './distributionGuard';
import { kvGet, kvSet } from './db';
import { FLAGGED_CACHE_KEY, parseFlaggedCache } from './flagged';
import { getIntegrityToken } from './integrity';
import { isProvisionalMemberId } from './identity';
import { isMembershipRenewalDue } from './membershipRenewal';
import { wallet } from './walletService';

const SERVER_URL_KEY = 'serverUrl.v1';
const KEYS_INFO_CACHE = 'keysInfo.v1';
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

// ── 배포 서명 검증 + TOFU 핀 (보안 감사 H-3) ─────────────────────

/**
 * 배포 응답(_sig)을 검증하고 본문만 돌려준다. 첫 수신이면 배포 공개키를
 * 핀으로 고정(TOFU). 검증 실패 시 throw — 호출부의 기존 캐시 폴백이 그대로
 * 동작해 조작된 데이터가 캐시에 반영되지 않는다.
 */
async function verifyAndPin<T extends object>(response: Signed<T>): Promise<T> {
  const pinned = await kvGet(DIST_PIN_KEY);
  const { body, pinToStore } = guardDistribution(response, pinned);
  if (pinToStore) await kvSet(DIST_PIN_KEY, pinToStore);
  return body;
}

// ── 신뢰 키 (GET /keys) — 발행 키 + 회원 증서 루트 (보안 감사 C-2) ──

/**
 * 전체 신뢰 키 목록을 서버에서 갱신 시도 → 배포 서명 검증(H-3) 실패 포함 모든
 * 실패 시 기존 캐시 → 없으면 빈 목록. 조작된 키 목록은 캐시에 닿지 않는다.
 */
async function fetchKeyInfos(): Promise<TrustedKeyInfo[]> {
  try {
    const { keys } = await verifyAndPin(await directoryApi.getTrustedKeys());
    await kvSet(KEYS_INFO_CACHE, JSON.stringify(keys));
    return keys;
  } catch {
    return loadCachedKeyInfos();
  }
}

function pickKeys(infos: TrustedKeyInfo[], isRoot: boolean): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const k of infos) {
    if ((k.purpose === 'MEMBERSHIP_ROOT') === isRoot) keys[k.keyId] = k.publicKey;
  }
  return keys;
}

async function loadCachedKeyInfos(): Promise<TrustedKeyInfo[]> {
  const cached = await kvGet(KEYS_INFO_CACHE);
  if (!cached) return [];
  try {
    return JSON.parse(cached) as TrustedKeyInfo[];
  } catch {
    return [];
  }
}

/**
 * 신뢰 발행 키 — 프로모(엔젤 보너스)·클레임·격려. verifyCoin의 trustedIssuerKeys로
 * 쓰인다. MEMBERSHIP_ROOT는 발행 키가 아니므로 제외한다.
 */
export async function getTrustedIssuerKeys(): Promise<Record<string, string>> {
  return pickKeys(await fetchKeyInfos(), false);
}

/**
 * 회원 증서 신뢰 루트 (MEMBERSHIP_ROOT) — verifyCoin의 trustedRootKeys로 쓰인다.
 * 서버 갱신 시도 후 캐시 폴백. 앱에 핀되는 것과 동등한 신뢰 루트다 (보안 감사 C-2).
 */
export async function getTrustedRootKeys(): Promise<Record<string, string>> {
  return pickKeys(await fetchKeyInfos(), true);
}

/** 캐시된 회원 증서 루트만 (네트워크 없음) — 오프라인 지불 수령 검증 경로에서 사용. */
export async function loadCachedTrustedRootKeys(): Promise<Record<string, string>> {
  return pickKeys(await loadCachedKeyInfos(), true);
}

// ── 회원 증서 갱신 (온라인 전용·실패 무시 — 거래는 계속 오프라인) ──

/**
 * 회원 증서가 없거나 만료 임박이면 서버에서 재발급한다. 미가입(임시 번호)이면 skip.
 * 앱 시작 시 fire-and-forget으로 호출된다 — 실패해도 앱 동작에 영향 없다.
 */
export async function renewMembershipIfDue(now: number = Date.now()): Promise<void> {
  if (isProvisionalMemberId(wallet.identity.memberId)) return;
  if (!isMembershipRenewalDue(wallet.identity.membership, now)) return;
  const { platform, token } = await getIntegrityToken();
  const { membershipCertificate } = await directoryApi.refreshCertificate({ integrityToken: token, platform });
  await wallet.applyMembership(membershipCertificate, token);
}

// ── 소명 대기 목록 (지시서 3장 5절 — 수신 지갑의 수령 보류) ───────

/**
 * 소명 대기 회원 번호 목록을 kv에 캐시한다 — 앱 시작 시 + 수동 새로고침.
 * 실패해도 앱 동작에 영향 없음 (기존 캐시 유지). 반환: 갱신된 목록.
 */
export async function syncFlaggedList(): Promise<FlaggedMemberEntry[]> {
  // 배포 서명 검증(H-3): 조작된 소명 목록(정상 회원 차단·악성 회원 통과)은 캐시 갱신 거부.
  const { members } = await verifyAndPin(await directoryApi.getFlaggedMembers());
  await kvSet(FLAGGED_CACHE_KEY, JSON.stringify(members));
  return members;
}

/** 캐시된 소명 대기 목록 (없으면 빈 목록). */
export async function loadFlaggedMembers(): Promise<FlaggedMemberEntry[]> {
  return parseFlaggedCache(await kvGet(FLAGGED_CACHE_KEY));
}

// ── 코스 데이터 갱신분 내려받기 (지시서 2.2 — 오프라인 동작 필수) ──

export async function syncCourses(): Promise<void> {
  // 배포 서명 검증(H-3): 코스 폴리라인 주입 차단. 실패 시 기존 캐시/내장 데이터 유지.
  const { courses } = await verifyAndPin(await directoryApi.getCourses());
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
