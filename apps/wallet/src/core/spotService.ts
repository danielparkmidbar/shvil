/**
 * 스팟 보물 서비스 (M12 — docs/몸인증_보물마이닝_설계.md 4장) — 사업자 예치·스캐너
 * 청구의 오케스트레이션.
 *
 * 무기명 베어러 금지(M10 폐기 — 두 차례 적대적 감사 반려). QR/근처 목록으로 얻는 것은
 * spotId뿐이고, 그랜트는 서버가 인증된 회원에게만 발행한다. 청구 왕복은 수량 한정
 * 발행의 회계다(거래 승인이 아니다 — 헌법 제9조 정합). 사업자는 발행 주체가 아니며,
 * 마켓에서 구매/생성한 자기 코인을 리저브로 소각한 만큼만 서버가 재배포한다(총량 보존).
 *
 * ★현장 결속 없음(V-1, 적대적 검증): 청구는 spotId만 알면 원격으로 가능하다 — 서버는
 * 위치를 볼 수 없다는 헌법 제9조 제약상 스캐너가 실제로 스팟에 있는지 검증할 수 없다.
 * 즉 QR 스캔은 spotId 취득 수단일 뿐 위치 증명이 아니며, GET /spot이 spotId·위치를
 * 공개하므로 스캔 없이도 청구가 성립한다. 근본 완화(M9 몸-걸음 인증 결합)는 결정 대기
 * (몸인증_보물마이닝_설계 4장 R-스팟-현장결속).
 *
 * 제1원칙(몸인증_보물마이닝_설계 0장): 이 계층은 선택 기능이다 — 스팟이 없거나 서버가
 * 없으면 지갑의 기본 걷기·지불 경험에 어떤 영향도 주지 않는다(모든 실패는 무해하다).
 *
 * 이 모듈은 순수 TS다 — expo 모듈 import 금지 (directory·walletService를 지연 로드).
 */
import type {
  SpotCreateInput,
  SpotDepositResult,
  SpotListEntry,
  SpotMineEntry,
} from './api';
import { wallet } from './walletService';

/** 스캔 청구 결과 피드백 (화면 표시용). */
export interface SpotScanResult {
  spotId: string;
  /** 지급액 (dSHV) — 스탬프면 0. */
  amountDshv: number;
  /** 그랜트를 받아 코인 민팅까지 끝났는가 (BONUS 계보 — 걸음 코인으로 둔갑 불가). */
  minted: boolean;
  /** 무보상 스팟(코인 없음) — 위치 확인 스탬프만 (M10 스탬프의 자리). */
  stamp: boolean;
}

/**
 * 스팟 QR/딥링크에서 spotId를 추출한다. QR은 spotId만 담는다(비밀키 없음 — M10 폐기).
 * 허용: `shvil://spot/<id>` 딥링크 또는 spotId 원문. 형식 위반이면 null.
 */
export function parseSpotQr(data: string): string | null {
  const raw = data.trim();
  const deep = raw.match(/^shvil:\/\/spot\/([a-z0-9-]{3,64})$/i);
  if (deep) return deep[1]!.toLowerCase();
  if (/^[a-z0-9-]{3,64}$/.test(raw)) return raw;
  return null;
}

/** 사업자가 인쇄해 붙일 스팟 QR 딥링크 — 손님이 스캔하면 spotId만 담긴다. */
export function spotQrLink(spotId: string): string {
  return `shvil://spot/${spotId}`;
}

export const spotService = {
  /**
   * 잔여>0 스팟 목록 (배포 서명 검증 + 캐시 폴백) — 스캐너가 근처 스팟을 고른다.
   * 코인이 없는 스팟은 서버가 애초에 내려주지 않는다 (다니엘 쌤 결정 2번).
   */
  async loadSpots(region?: string): Promise<SpotListEntry[]> {
    const { syncSpots } = await import('./directory');
    return syncSpots(region);
  },

  /**
   * 스캔 청구 (스캐너) — 스팟당 1인 1회. 코인이 있으면 TREASURE 그랜트를 받아 폰에서
   * 민팅한다(BONUS 계보 — 걸음 코인과 영구 구분). 코인이 없으면 스탬프뿐. 확정 거절
   * (소진·1인1회·기간 밖·버스트 상한)은 ApiError로 그대로 던진다 — 화면이 안내한다.
   * ※ QR 스캔은 spotId 취득 수단일 뿐 위치 증명이 아니다(V-1 — 위 모듈 주석 참조).
   */
  async claim(spotId: string): Promise<SpotScanResult> {
    const { directoryApi, getTrustedIssuerKeys } = await import('./directory');
    const res = await directoryApi.claimSpot(spotId);
    if (res.grant) {
      await wallet.mintFromGrant(res.grant, await getTrustedIssuerKeys(), Date.now());
      return { spotId: res.spotId, amountDshv: res.amountDshv, minted: true, stamp: false };
    }
    return { spotId: res.spotId, amountDshv: 0, minted: false, stamp: true };
  },

  // ── 사업자 ──────────────────────────────────────────────────────

  /** 내 스팟 목록 + 리저브 공개키 (사업자 서명) — 미충전 포함 전체 + 회계. */
  async loadMySpots(): Promise<{ spots: SpotMineEntry[]; reservePublicKey: string }> {
    const { directoryApi } = await import('./directory');
    return directoryApi.getMySpots();
  },

  /** 스팟 생성 (사업자) — 예치 전 상태. 응답의 리저브 공개키로 이후 예치를 만든다. */
  async create(input: SpotCreateInput): Promise<{ spotId: string; reservePublicKey: string }> {
    const { directoryApi } = await import('./directory');
    const res = await directoryApi.createSpot(input);
    return { spotId: res.spotId, reservePublicKey: res.reservePublicKey };
  },

  /**
   * 예치(충전) — 자기 코인을 리저브로 소각한 만큼 서버가 재배포 잔고로 등록한다.
   * 발행이 아니라 재배포다(총량 보존). 로컬 서명으로 소각을 만들고 서버에 제출한다.
   */
  async deposit(spotId: string, reservePublicKey: string, amountDshv: number): Promise<SpotDepositResult> {
    return wallet.depositToSpot(spotId, reservePublicKey, amountDshv, Date.now());
  },

  /** 스팟 마감 (사업자) — 남은 예치 소각분은 회수되지 않는다(영구 소각). */
  async close(spotId: string): Promise<void> {
    const { directoryApi } = await import('./directory');
    await directoryApi.closeSpot(spotId);
  },
};
