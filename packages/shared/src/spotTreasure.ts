/**
 * 스팟 보물 (M12 — docs/몸인증_보물마이닝_설계.md 4장).
 *
 * 사업자가 트레일 근처 자기 사업장(호텔·식당·주유소)에 코인을 숨긴다. 손님이
 * 벽 QR을 스캔하면 코인을 받는다 — 방문 유인이다. M10 무기명 벽-QR 바우처는 두
 * 차례 적대적 감사로 폐기됐다(무기명 베어러는 중앙 원장 없이 이중지불을 못 막는다).
 * M12는 그 실패를 피해 **서버 회계**로 간다.
 *
 * 핵심 원칙 (헌법 정합 — 총량 보존):
 *  - 사업자는 발행 주체가 아니다. 마켓에서 **구매한** 코인만 재배포한다.
 *  - 재배포는 발행이 아니라 **예치(소각) → 서버가 동량 재발행**이다. 사업자가 자기
 *    코인 N개를 "보물 리저브 주소"로 이전(소각)한 만큼만 서버가 스팟 그랜트를 낸다.
 *  - **총량 보존 불변식**: (발행 총액) ≤ (예치 총액). 코드로 보장하고 테스트로 고정한다.
 *    발행 슬롯 수 = floor(예치총액 / 1인당 양)이므로 발행이 예치를 넘을 수 없다.
 *
 * 이 모듈은 순수 함수·타입만 담는다 — 서버(server/src/spotTreasure.ts)가 예치 검증·
 * 선착순 회계·수량 한정 발행을 맡고, 지갑(apps/wallet)이 예치 서명·스캔 청구를 맡는다.
 *
 * ★현장 결속 (R-스팟-현장결속, 2026-07-18 확정 — V-1 근본 완화): 청구 전에 서버가
 * 1회용 랜덤 이동 지시를 발급하고(spotPresence.ts) 손님이 그 자리에서 몸으로 수행해야
 * 청구가 성립한다 — "벽 QR 스캔"만으로는(spotId 취득) 원격 청구가 되지 않는다.
 * 기본 요구·사업자 선택 해제(requirePresence). 서버는 여전히 좌표를 받지 않는다
 * (헌법 제9조) — 근접·변위 판정은 폰 로컬, 서버는 지시 일치·소요 시간·걸음 대역만
 * 대조한다. fake-walk 예치 세탁 차단(V-3)은 서버 초과생성 탐지에서 한다.
 *
 * M9(server/src/treasure.ts)와의 차이:
 *  - M9 보물: 운영자 발행 키로 그랜트 (수량은 운영자가 선언).
 *  - M12 스팟: 사업자 예치(소각)한 만큼만 재배포 (수량은 예치에서 유도 — 총량 보존).
 */
import { verifyCoin, type VerifyCoinOptions } from './coin';
import { GRANT_MAX_DSHV } from './coin';
import { checkHumanLimits } from './humanLimits';
import { addressFromPublicKey } from './crypto';
import type { Coin } from './types';
import type { GeoPoint } from './courses';

// ── 명세 ──────────────────────────────────────────────────────────

/**
 * 스팟 보물 명세 — 사업자가 등록하고 서버가 보관·배포한다.
 *
 * 위치 원칙: 스팟은 사업장이므로 위치가 **공개**다 (엔젤 집처럼 눈금화하지 않는다 —
 * 다니엘 쌤 결정 2번: "쉬빌리스트 맵에 보물 QR 위치 표시"). 이는 걷는 사람이 지도를
 * 보고 "걸으며 갈지 말지 결정"하기 위해 필요하다. 정확 공개 수위는 다니엘 쌤 확인 항목.
 */
export interface SpotTreasureSpec {
  spotId: string;
  /** 소속 트레일 지역 (regions.ts). */
  regionId: string;
  /** 사업자 회원 번호 — 이 스팟의 예치·수정 권한자. */
  sponsorMemberId: string;
  /** 사업장 표시명 (사용자 원문 — 번역 대상 아님, 엔젤 이름과 같은 범주). */
  displayName: string;
  /** 사업장 공개 위치 (스팟은 눈금화하지 않는다 — 위 주석). */
  location: GeoPoint;
  /** 1인당 지급액 (dSHV). 1 ~ 400(TREASURE 그랜트 상한). */
  perClaimDshv: number;
  validFrom: number;
  validUntil: number;
}

/** 1인당 지급액 허용 범위 — TREASURE 그랜트 방어 상한과 일치 (coin.ts GRANT_MAX_DSHV). */
export const SPOT_PER_CLAIM_MIN_DSHV = 1;
export const SPOT_PER_CLAIM_MAX_DSHV = GRANT_MAX_DSHV.TREASURE;

/** 명세 형식 검사 — 서버 등록·클라이언트 캐시 수신의 공용 방어선. */
export function isValidSpotTreasureSpec(v: unknown): v is SpotTreasureSpec {
  if (v === null || typeof v !== 'object') return false;
  const s = v as Partial<SpotTreasureSpec>;
  return (
    typeof s.spotId === 'string' &&
    /^[a-z0-9-]{3,64}$/.test(s.spotId) &&
    typeof s.regionId === 'string' &&
    s.regionId.length > 0 &&
    typeof s.sponsorMemberId === 'string' &&
    s.sponsorMemberId.length > 0 &&
    typeof s.displayName === 'string' &&
    s.displayName.trim().length > 0 &&
    s.displayName.length <= 80 &&
    s.location !== null &&
    typeof s.location === 'object' &&
    typeof s.location.lat === 'number' &&
    Number.isFinite(s.location.lat) &&
    typeof s.location.lon === 'number' &&
    Number.isFinite(s.location.lon) &&
    typeof s.perClaimDshv === 'number' &&
    Number.isInteger(s.perClaimDshv) &&
    s.perClaimDshv >= SPOT_PER_CLAIM_MIN_DSHV &&
    s.perClaimDshv <= SPOT_PER_CLAIM_MAX_DSHV &&
    typeof s.validFrom === 'number' &&
    typeof s.validUntil === 'number' &&
    s.validUntil > s.validFrom
  );
}

// ── 선착순 회계 (총량 보존 불변식의 순수 함수부) ──────────────────

/**
 * 발행 가능 슬롯 총수 = floor(예치 총액 / 1인당 양).
 *
 * ★총량 보존의 핵심: 슬롯 수를 예치 총액에서 이렇게 유도하므로, 선착순으로 슬롯을
 * 다 발행해도 (발행 총액 = 슬롯수 × 1인당 양) ≤ 예치 총액이 **항상** 성립한다.
 * 예치가 1인당 양으로 나누어떨어지지 않는 나머지는 소각된 채 남는다(사업자 기부분) —
 * 이 방향의 오차는 보존을 깨지 않는다(발행이 예치를 넘지 못한다).
 */
export function spotTotalSlots(depositTotalDshv: number, perClaimDshv: number): number {
  if (!Number.isInteger(depositTotalDshv) || depositTotalDshv < 0) return 0;
  if (!Number.isInteger(perClaimDshv) || perClaimDshv <= 0) return 0;
  return Math.floor(depositTotalDshv / perClaimDshv);
}

/** 남은 선착순 슬롯 = 총 슬롯 − 발행 수 (음수는 0으로 바닥). */
export function spotRemainingSlots(depositTotalDshv: number, perClaimDshv: number, issuedCount: number): number {
  return Math.max(0, spotTotalSlots(depositTotalDshv, perClaimDshv) - Math.max(0, issuedCount | 0));
}

/**
 * 이번 청구를 코인으로 지급해도 되는가 (선착순 잔여 > 0). false면 코인 없음 —
 * 서버는 미충전(스탬프) 또는 소진(에러)으로 분기한다.
 */
export function spotHasRemaining(depositTotalDshv: number, perClaimDshv: number, issuedCount: number): boolean {
  return spotRemainingSlots(depositTotalDshv, perClaimDshv, issuedCount) > 0;
}

/**
 * 총량 보존 불변식: (발행 총액) ≤ (예치 총액). 테스트로 고정한다.
 * 발행 총액 = 발행 수 × 1인당 양. 발행 수가 총 슬롯을 넘지 않는 한 참이다.
 */
export function spotConservationHolds(depositTotalDshv: number, perClaimDshv: number, issuedCount: number): boolean {
  if (issuedCount < 0) return false;
  return issuedCount * perClaimDshv <= depositTotalDshv;
}

// ── 예치(소각) 증명 검증 (순수 함수 — 서버·지갑 공용) ─────────────

export type SpotDepositRejectReason =
  | 'INVALID_COIN' // 위조 검사 실패 (계보·이전 체인 무효)
  | 'PENDING_COMMIT_MISSING' // 리저브 앞 미완결 이전(소각 서명)이 없다
  | 'NOT_COMMITTED_TO_RESERVE' // 미완결 이전의 수령자가 보물 리저브가 아니다
  | 'NOT_SPONSOR_OWNED' // 소각 서명의 지불자가 이 사업자가 아니다
  | 'EXCEEDS_HUMAN_LIMITS'; // 걷기 증명 자체가 인간 한계를 넘는다 (부풀린 코인)

export interface SpotDepositVerdict {
  valid: boolean;
  reasons: SpotDepositRejectReason[];
  /** 유효할 때 예치 인정액 (dSHV) = 코인 금액. */
  amountDshv: number;
}

export interface SpotDepositCheck {
  /** 예치자(사업자) 기기 공개키 — 소각 서명의 지불자여야 한다. */
  sponsorPublicKey: string;
  /** 보물 리저브 공개키 — 소각의 수령자(서버가 배포하는 상수). */
  reservePublicKey: string;
  /** verifyCoin 옵션 (신뢰 발행 키 등). 미완결 마지막 링크는 항상 허용된다. */
  verifyOptions?: Omit<VerifyCoinOptions, 'allowPendingLastLink'>;
}

/**
 * 예치 코인 검증 — 사업자가 자기 코인을 보물 리저브로 이전(소각)했음을 확인한다.
 *
 * 예치 코인은 `createTransfer(coin, sponsorSigner, reservePublicKey, now)`로 만든,
 * 리저브 앞 **미완결 이전**을 마지막 링크로 갖는 코인이다. 리저브는 이 이전을
 * 절대 확인(acknowledge)하지 않는다 — 코인은 리저브에 영구 봉인(소각)된다.
 *
 * 검사:
 *  (a) 진짜 코인: verifyCoin (미완결 마지막 링크 허용) 통과.
 *  (b) 리저브 소각: 마지막 링크가 미완결이고 수령자 = 리저브 주소.
 *  (c) 사업자 소유: 그 링크의 지불자 = 사업자 주소 (verifyCoin이 체인 연속성을
 *      검증하므로, 이 지불자는 소각 직전의 실소유자다).
 *
 * ※ 미소비(이중 예치) 방지는 순수 함수 밖이다 — 서버가 coinFingerprint(coin.id)를
 *   spot_deposits에 UNIQUE로 기록해 같은 코인의 재예치를 막는다.
 */
export function verifySpotDeposit(coin: Coin, check: SpotDepositCheck): SpotDepositVerdict {
  const reasons: SpotDepositRejectReason[] = [];

  const verdict = verifyCoin(coin, { ...(check.verifyOptions ?? {}), allowPendingLastLink: true });
  if (!verdict.valid) reasons.push('INVALID_COIN');

  // ★부풀린 걷기 코인 차단 (적대적 검증 2026-07-20 — 무제한 발행구):
  // 변조 앱은 PendingWalkLedger를 우회해 SettlementDraft.amountDshv를 손으로 지을 수
  // 있고, verifyWalkSegmentProof는 서명·일자합 정합만 보므로 그것을 통과시킨다.
  // 그런 코인이 예치되면 발행 슬롯이 생겨 **걷지 않고 만든 액수가 진짜 TREASURE
  // 그랜트로 재배포**된다(총량 보존 붕괴). 코인 자체의 증명이 인간 한계(일 400 /
  // 주 3,000 dSHV)를 넘는지 여기서 먼저 잘라낸다 — 여러 코인에 나눠 담는 회피는
  // 서버의 교차 합산 탐지(checkOverproduction)가 소명 등재로 잡는 2층 방어다.
  if (!checkHumanLimits(coin, []).ok) reasons.push('EXCEEDS_HUMAN_LIMITS');

  const last = coin.transferChain[coin.transferChain.length - 1];
  if (!last || last.toSignature !== null) {
    reasons.push('PENDING_COMMIT_MISSING');
    return { valid: false, reasons, amountDshv: 0 };
  }
  if (last.to !== addressFromPublicKey(check.reservePublicKey)) reasons.push('NOT_COMMITTED_TO_RESERVE');
  if (last.from !== addressFromPublicKey(check.sponsorPublicKey)) reasons.push('NOT_SPONSOR_OWNED');

  return { valid: reasons.length === 0, reasons: [...new Set(reasons)], amountDshv: coin.amountDshv };
}
