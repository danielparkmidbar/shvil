/**
 * 코인 지문 (보안 감사 H-1) — 기회적 동기화의 사후 이상 탐지 입력 (지시서 2.3, 3장 4절).
 *
 * 지갑이 온라인이 될 때 보유·수령 코인의 지문을 서버에 제출하면, 서버는 이를
 * 대조해 물리적으로 불가능한 패턴을 포착한다:
 *  - 동일 코인 이중 사용: 같은 (coinId, 체인 길이)에 서로 다른 소유자 = 분기
 *    → 분기점 소유자(이중 지불자)를 소명 대기 목록에 자동 등재.
 *  - 동일 회원 초과 생성: 걷기 증명들의 일자별 합산이 인간 한계(일 40/주 300 SHV)
 *    초과 → 생산자를 등재.
 *
 * 이것은 거래 승인이 아니다 — 거래는 이미 완결됐고, 포착은 사후 예외 처리
 * (소명 책임 원칙)로 이어질 뿐이다. 지문에는 좌표·경로가 없다: 코인 ID·계보
 * 요약·주소뿐이며, 모두 코인 자체에 이미 새겨져 유통되는 공개 정보다.
 */
import { hashObject } from './crypto';
import { baseOwnerAddress, currentOwnerAddress } from './coin';
import type { Coin } from './types';

export interface CoinFingerprint {
  coinId: string;
  /** 뿌리 계보 종류 (WALK/GRANT — SPLIT은 뿌리를 따른다). */
  rootKind: 'WALK' | 'GRANT';
  /** 뿌리 걷기 증명 해시 — 분할 형제의 이중 계상 방지 dedup 키. GRANT면 null. */
  proofHash: string | null;
  /** 생성 회원 번호 (코인에 새겨진 값). */
  producerMemberId: string;
  amountDshv: number;
  /** 이전 체인 길이 — 분기 감지의 기준점. */
  chainLen: number;
  /** 현재 소유자 주소. */
  ownerAddress: string;
  /** 마지막 이전 링크의 지불자 주소 (체인이 비면 null) — 분기점 소유자 식별용. */
  lastFromAddress: string | null;
  /** 뿌리 걷기 증명의 일자별 발행 내역 — 초과 생성 합산용 (proofHash당 1회만 저장). */
  dailyBreakdown: { date: string; amountDshv: number }[] | null;
}

/** 코인에서 지문 추출 (순수 — 지갑·서버 공용). */
export function coinFingerprint(coin: Coin): CoinFingerprint {
  let root = coin;
  while (root.provenance.kind === 'SPLIT') root = root.provenance.parent;

  const isWalk = root.provenance.kind === 'WALK';
  const proof = isWalk && root.provenance.kind === 'WALK' ? root.provenance.proof : null;
  const lastLink = coin.transferChain[coin.transferChain.length - 1] ?? null;

  return {
    coinId: coin.id,
    rootKind: isWalk ? 'WALK' : 'GRANT',
    proofHash: proof ? hashObject(proof) : null,
    producerMemberId: coin.memberId,
    amountDshv: coin.amountDshv,
    chainLen: coin.transferChain.length,
    ownerAddress: currentOwnerAddress(coin),
    lastFromAddress: lastLink ? lastLink.from : null,
    dailyBreakdown: proof ? proof.dailyBreakdown : null,
  };
}

/** 지문에 좌표류 정보가 없음을 정적으로 보장하기 위한 키 목록 (테스트 대조용). */
export const FINGERPRINT_KEYS = [
  'coinId',
  'rootKind',
  'proofHash',
  'producerMemberId',
  'amountDshv',
  'chainLen',
  'ownerAddress',
  'lastFromAddress',
  'dailyBreakdown',
] as const;

/** 분기점 소유자 주소: 분기된 두 지문의 lastFrom이 같으면 그 주소가 이중 지불자다. */
export function forkSuspectAddress(a: CoinFingerprint, b: CoinFingerprint): string | null {
  if (a.coinId !== b.coinId || a.chainLen !== b.chainLen) return null;
  if (a.ownerAddress === b.ownerAddress) return null; // 동일 상태 — 분기 아님
  if (a.chainLen === 0) return null; // 민팅 상태 분기는 불가능(ID가 계보에 결속)
  return a.lastFromAddress === b.lastFromAddress ? a.lastFromAddress : null;
}

/** 민팅 직후(체인 0) 지문의 소유자는 뿌리 소유자여야 한다 — 위조 지문 걸러내기. */
export function fingerprintBaseOwner(coin: Coin): string {
  return baseOwnerAddress(coin);
}
