/**
 * 엔젤 모드 서비스 — 내 포인트 등록, 등록/첫 접대 보너스 (지시서 2.4, 4장).
 *
 * - 프로필은 로컬(kv)에 먼저 저장하고 서버(PUT /angels/me)에 반영한다.
 *   서버 실패 시에도 로컬 저장은 유지된다 (오프라인 우선).
 * - 위치는 엔젤 본인이 자발 공개하는 엔젤 포인트다 — 위치 비저장 원칙(지시서 0-10)의
 *   유일한 예외이며, 공개 on/off는 언제든 엔젤이 결정한다 (엔젤의 자율성).
 * - R-4 (2026-07-14 확정): 정확 좌표는 이 기기(로컬 kv)에만 남는다. 서버 전송분은
 *   전송 직전 ~1km 눈금(0.01°)으로 눈금화한다 — 서버는 정확한 집 위치를 모른다.
 *   주소 등 정확 정보는 승인된 상대에게만 E2E 메시지로 전달한다.
 * - 보너스: 등록 20 SHV(최초 등록 응답의 grant), 첫 접대 30 SHV(수령 코인 증빙).
 *   민팅은 이 기기에서 이루어진다 — 서버는 승인서만 발행한다.
 */
import { snapToPrivacyGrid, type Coin, type SignedGrant } from '@shvil/shared';
import { ApiError, type AngelProfileInput } from './api';
import { directoryApi, getTrustedIssuerKeys } from './directory';
import { kvGet, kvSet } from './db';
import { isProvisionalMemberId } from './identity';
import { wallet } from './walletService';

const PROFILE_KEY = 'angelProfile.v1';
const FIRST_HOSTING_KEY = 'angel.firstHostingClaimed.v1';

export async function loadAngelProfile(): Promise<AngelProfileInput | null> {
  const json = await kvGet(PROFILE_KEY);
  return json ? (JSON.parse(json) as AngelProfileInput) : null;
}

export interface SaveProfileResult {
  /** 서버 반영 성공 여부 — false면 로컬에만 저장됨 (오프라인). */
  synced: boolean;
  /** 최초 등록 보너스(20 SHV)가 이번에 민팅되었는지. */
  registrationBonusCoin: Coin | null;
  /** synced=false일 때 사용자에게 보여줄 사유. */
  syncError?: string;
}

/** 프로필 저장: 로컬 우선 → 서버 반영 → 최초 등록이면 보너스 grant 민팅. */
export async function saveAngelProfile(profile: AngelProfileInput): Promise<SaveProfileResult> {
  // 정확 좌표는 로컬에만 (R-4) — 승인된 상대에게 E2E로 안내할 때 쓴다.
  await kvSet(PROFILE_KEY, JSON.stringify(profile));

  if (isProvisionalMemberId(wallet.getState().memberId)) {
    return { synced: false, registrationBonusCoin: null, syncError: '가입 후 서버에 등록됩니다 (더보기 > 가입/설정).' };
  }

  try {
    // 서버 전송분은 ~1km 눈금으로 — 서버는 정확한 집 위치를 저장하지 않는다 (R-4).
    const result = await directoryApi.putMyAngelProfile({
      ...profile,
      location: snapToPrivacyGrid(profile.location.lat, profile.location.lon),
    });
    let bonusCoin: Coin | null = null;
    if (result.registrationGrant) {
      bonusCoin = await mintBonus(result.registrationGrant);
    }
    return { synced: true, registrationBonusCoin: bonusCoin };
  } catch (e) {
    return {
      synced: false,
      registrationBonusCoin: null,
      syncError: e instanceof Error ? e.message : String(e),
    };
  }
}

async function mintBonus(grant: SignedGrant): Promise<Coin> {
  const trusted = await getTrustedIssuerKeys();
  return wallet.mintFromGrant(grant, trusted, Date.now());
}

export async function isFirstHostingClaimed(): Promise<boolean> {
  return (await kvGet(FIRST_HOSTING_KEY)) === 'true';
}

/**
 * 첫 접대 보너스(30 SHV) 청구 — 수령(접대의 지불 수령)으로 자동 확인된다 (지시서 2.4).
 * 조건: 정식 가입 + 아직 미수령 + 수령 코인(transferChain ≥ 1) 보유.
 * 성공 시 민팅된 코인, 조건 미충족·이미 수령이면 null. 네트워크 실패는 throw.
 */
export async function maybeClaimFirstHosting(): Promise<Coin | null> {
  if (isProvisionalMemberId(wallet.getState().memberId)) return null;
  if (await isFirstHostingClaimed()) return null;

  // 증빙: 실제로 이전받은(접대 수령) 코인 하나.
  const received = wallet.getState().coins.find((c) => c.coin.transferChain.length >= 1);
  if (!received) return null;

  try {
    const { grant } = await directoryApi.claimFirstHosting(received.coin);
    const coin = await mintBonus(grant);
    await kvSet(FIRST_HOSTING_KEY, 'true');
    return coin;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      // 이미 받았음 — 로컬 플래그만 갱신 (다른 기기·재설치 케이스).
      await kvSet(FIRST_HOSTING_KEY, 'true');
      return null;
    }
    throw e;
  }
}
