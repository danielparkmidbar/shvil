/**
 * 디렉토리 서버 wiring — API 클라이언트에 서버 URL(kv 오버라이드)과
 * 인증 컨텍스트(기기 키 서명)를 주입하고, 오프라인 캐시를 관리한다.
 *
 * 오프라인 우선: 여기의 모든 sync류 함수는 실패해도 앱 동작에 영향이 없다.
 * 캐시 대상은 공개 데이터뿐이다 — 코스 폴리라인, 엔젤 포인트(본인 자발 공개),
 * 프로모션 발행 공개키. 사용자 이동 궤적 좌표는 어디에도 저장하지 않는다.
 */
import { coinFingerprint, type CourseData, type Signed } from '@shvil/shared';
import {
  DEFAULT_SERVER_URL,
  DirectoryApi,
  type AngelDirectoryEntry,
  type FlaggedMemberEntry,
  type SpotListEntry,
  type TreasureListEntry,
  type TrustedKeyInfo,
} from './api';
import { DIST_PIN_KEY, guardDistribution } from './distributionGuard';
import { kvGet, kvSet, loadCoinsForSync } from './db';
import { FLAGGED_CACHE_KEY, parseFlaggedCache } from './flagged';
import { getIntegrityToken } from './integrity';
import { isProvisionalMemberId } from './identity';
import { isMembershipRenewalDue } from './membershipRenewal';
import { foldTrustedKeys, mergeTrustedKeyInfos } from './trustedKeys';
import { wallet } from './walletService';

const SERVER_URL_KEY = 'serverUrl.v1';
const KEYS_INFO_CACHE = 'keysInfo.v1';
const COURSES_CACHE = 'courses.v1';
const ANGELS_CACHE = 'angels.v1';
const TREASURES_CACHE = 'treasures.v1';

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
 *
 * ★2026-07-26: 덮어쓰기를 **누적**으로 바꿨다. 예전에는 서버 응답으로 캐시를 통째
 * 교체해서, 루트 키를 한 번 회전하면 그 순간 보유 중인 옛 코인이 전부
 * `UNKNOWN_MEMBERSHIP_ROOT`가 되었다. 규칙은 trustedKeys.ts 참조 (keyId 단위 TOFU
 * + 유도식 검산). 검산에 걸린 항목은 버려지고 캐시는 그대로 남는다.
 */
async function fetchKeyInfos(): Promise<TrustedKeyInfo[]> {
  try {
    const { keys } = await verifyAndPin(await directoryApi.getTrustedKeys());
    const merged = mergeTrustedKeyInfos(await loadCachedKeyInfos(), keys);
    await kvSet(KEYS_INFO_CACHE, JSON.stringify(merged));
    return merged;
  } catch {
    return loadCachedKeyInfos();
  }
}

/** 검증 함수가 받는 모양으로 접는다 — 본체는 trustedKeys.ts(순수·테스트 대상). */
function pickKeys(infos: TrustedKeyInfo[], isRoot: boolean): Record<string, string> {
  return foldTrustedKeys(infos, isRoot);
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

/**
 * 캐시된 신뢰 발행 키만 (네트워크 없음) — 오프라인 대면 수령 경로에서 사용.
 *
 * ★대면 수령이 이 목록을 **아예 넘기지 않고** 있었다. `verifyCoin`은 발행 키 목록이
 * 없으면 GRANT 계보를 무조건 `UNTRUSTED_ISSUER`로 거부하므로(coin.ts), 엔젤 보너스·
 * 보물·격려 코인은 대면으로 건네줄 수가 없었다. 캐시를 넘기면 아는 키로 발행된 것은
 * 통과하고, 캐시가 비었을 때의 동작은 예전과 똑같다(모르면 거부 — fail-closed).
 */
export async function loadCachedTrustedIssuerKeys(): Promise<Record<string, string>> {
  return pickKeys(await loadCachedKeyInfos(), false);
}

// ── 회원 증서 갱신 (온라인 전용·실패 무시 — 거래는 계속 오프라인) ──

/**
 * 회원 증서가 없거나 만료 임박이면 서버에서 재발급한다. 미가입(임시 번호)이면 skip.
 * 앱 시작 시 fire-and-forget으로 호출된다 — 실패해도 앱 동작에 영향 없다.
 */
export async function renewMembershipIfDue(now: number = Date.now()): Promise<void> {
  if (isProvisionalMemberId(wallet.identity.memberId)) return;
  if (!isMembershipRenewalDue(wallet.identity.membership, now)) return;
  // 챌린지 → 실토큰 → 갱신. 챌린지 발급이 실패해도(오프라인 등) 폴백 토큰으로
  // 시도한다 — 그 경우 서버가 UNVERIFIED로 판정할 뿐 앱은 계속 동작한다(0층 불변).
  let challenge: string | undefined;
  try {
    const res = await directoryApi.requestIntegrityChallenge(wallet.identity.signer.publicKeyHex);
    challenge = res.challenge;
  } catch {
    challenge = undefined;
  }
  const { platform, token } = await getIntegrityToken(challenge, wallet.identity.signer.publicKeyHex);
  const { membershipCertificate } = await directoryApi.refreshCertificate({
    integrityToken: token,
    platform,
    ...(challenge !== undefined ? { integrityChallenge: challenge } : {}),
  });
  await wallet.applyMembership(membershipCertificate, token);
}

// ── 기회적 동기화 (보안 감사 H-1, 지시서 2.3·3장 4절) ────────────

/**
 * 보유·사용 완료 코인의 지문을 서버에 제출한다 — 사후 이중 사용·초과 생성 대조.
 * 온라인일 때만 성공하며(기회적), 실패는 무해하다(다음 기회에 재제출).
 * 미가입(임시 번호)이면 skip — 제출은 서명 인증이 필요하다.
 * 좌표는 지문에 없다. 코인에 이미 새겨져 유통되는 공개 정보뿐이다.
 */
export async function syncCoinFingerprints(): Promise<number> {
  if (isProvisionalMemberId(wallet.identity.memberId)) return 0;
  const coins = await loadCoinsForSync();
  if (coins.length === 0) return 0;
  const { accepted } = await directoryApi.syncCoinFingerprints(coins.map(coinFingerprint));
  return accepted;
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

// ── 보물 명세 캐시 (M9 — 존 진입 감지의 오프라인 입력) ────────────

/**
 * 지역 보물 명세를 kv에 캐시한다 (코스 캐시와 동일 패턴). 배포 서명 검증(H-3)
 * 실패 시 기존 캐시 유지. 캐시 대상은 운영자가 공개한 존 좌표·지시뿐 —
 * 사용자 이동 궤적이 아니다. 존 진입 판정은 휘발성 경로에서만 이루어진다.
 */
export async function syncTreasures(region?: string): Promise<void> {
  const { treasures } = await verifyAndPin(await directoryApi.getTreasures(region));
  await kvSet(TREASURES_CACHE, JSON.stringify(treasures));
}

/** 캐시된 보물 명세 (없으면 빈 목록 — 보물이 없으면 걷기 화면은 지금과 동일하다). */
export async function loadCachedTreasures(): Promise<TreasureListEntry[]> {
  const cached = await kvGet(TREASURES_CACHE);
  return cached ? (JSON.parse(cached) as TreasureListEntry[]) : [];
}

// ── 스팟 보물 캐시 (M12 — 잔여>0 스팟만 배포. 코인 없으면 애초에 안 온다) ──

const SPOTS_CACHE = 'spots.v1';

/**
 * 잔여>0 스팟 목록을 서버에서 갱신 시도 → 배포 서명 검증(H-3) 후 kv 캐시.
 * 실패(오프라인·검증 실패) 시 기존 캐시로 폴백. 캐시 대상은 공개 사업장 위치·잔여·
 * 1인당 양뿐 — 사용자 이동 궤적이 아니다. 반환: 검증된 스팟 목록(없으면 캐시/빈 목록).
 */
export async function syncSpots(region?: string): Promise<SpotListEntry[]> {
  try {
    const { spots } = await verifyAndPin(await directoryApi.getSpots(region));
    await kvSet(SPOTS_CACHE, JSON.stringify(spots));
    return spots;
  } catch {
    return loadCachedSpots();
  }
}

/** 캐시된 스팟 목록 (없으면 빈 목록 — 스팟이 없으면 지도에 아무것도 안 뜬다). */
export async function loadCachedSpots(): Promise<SpotListEntry[]> {
  const cached = await kvGet(SPOTS_CACHE);
  return cached ? (JSON.parse(cached) as SpotListEntry[]) : [];
}

// ── 엔젤 디렉토리 캐시 (엔젤 우회 판정·지도 오프라인 폴백) ────────

export async function cacheAngels(angels: AngelDirectoryEntry[]): Promise<void> {
  await kvSet(ANGELS_CACHE, JSON.stringify(angels));
}

export async function loadCachedAngels(): Promise<AngelDirectoryEntry[] | null> {
  const cached = await kvGet(ANGELS_CACHE);
  return cached ? (JSON.parse(cached) as AngelDirectoryEntry[]) : null;
}
