/**
 * 소명 대기 목록 대조 (지시서 3장 5절 — 소명 책임 원칙).
 *
 * 이상 생성으로 포착된 회원 번호는 소명 대기 목록에 등재되어 각 지갑에 배포되고,
 * 수신 지갑들은 "그 회원 번호가 생성한 코인"의 수령을 보류한다.
 * 이것은 거래별 중앙 승인이 아니라 커뮤니티가 운영하는 예외 처리 절차다 —
 * 이미 보유한 그 회원의 정상 코인과 타인의 거래는 영향받지 않는다
 * (기존 보유 코인은 어떤 경우에도 건드리지 않는다).
 *
 * 이 모듈은 순수 TS다 — expo 모듈 import 금지 (vitest 테스트 대상).
 */
import type { Coin } from '@shvil/shared';
import type { FlaggedMemberEntry } from './api';

/** kv 캐시 키 — directory.syncFlaggedList가 쓰고 walletService가 읽는다. */
export const FLAGGED_CACHE_KEY = 'flaggedMembers.v1';

/** kv 캐시 JSON → 목록. 캐시 없음·손상 시 빈 목록 (수령 보류는 배포된 목록에 한한다). */
export function parseFlaggedCache(json: string | null): FlaggedMemberEntry[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as FlaggedMemberEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * 수령 대상 코인들에서 소명 대기 중인 생성 회원을 찾는다.
 * coin.memberId는 생성자 회원 번호다 — 분할·이전 후에도 불변 (계보 각인).
 * 반환: 처음 발견된 소명 대기 회원 번호, 없으면 null.
 */
export function findFlaggedProducer(coins: readonly Coin[], flaggedMemberIds: readonly string[]): string | null {
  if (flaggedMemberIds.length === 0) return null;
  const flagged = new Set(flaggedMemberIds);
  for (const coin of coins) {
    if (flagged.has(coin.memberId)) return coin.memberId;
  }
  return null;
}
