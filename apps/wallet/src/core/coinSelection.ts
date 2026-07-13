/**
 * 코인 선택·분할 계산 (순수 로직 — vitest 대상, expo import 금지).
 *
 * walletService.payCharge의 선택·분할 패턴을 계산부만 분리한 것:
 * 주어진 순서(로컬 원장은 오래된 것부터)대로 목표 금액을 채우고, 넘치면
 * 마지막 코인 하나만 잔돈 분할을 계획한다. 실행(splitCoin 서명·저장)은
 * 호출부가 한다 — 여기서는 서명도 상태 변경도 없다.
 */
import type { Coin } from '@shvil/shared';

export interface SplitStep {
  /** 분할할 코인 (선택된 마지막 코인). */
  coin: Coin;
  /** 지불/이전에 쓸 몫 (dSHV). */
  keepDshv: number;
  /** 지갑에 남는 잔돈 (dSHV). */
  changeDshv: number;
}

export interface CoinSelectionPlan {
  /** 그대로 이전할 코인들. */
  whole: Coin[];
  /** 잔돈 분할이 필요하면 그 계획, 정확히 맞으면 null. */
  split: SplitStep | null;
}

/** 오래된 것부터 선택해 amountDshv를 정확히 맞추는 계획. 잔액 부족이면 throw. */
export function planCoinSelection(coinsOldestFirst: Coin[], amountDshv: number): CoinSelectionPlan {
  if (!Number.isInteger(amountDshv) || amountDshv <= 0) {
    throw new Error('금액이 올바르지 않습니다 (양의 dSHV 정수)');
  }
  const picked: Coin[] = [];
  let total = 0;
  for (const coin of coinsOldestFirst) {
    if (total >= amountDshv) break;
    picked.push(coin);
    total += coin.amountDshv;
  }
  if (total < amountDshv) {
    throw new Error(`잔액 부족: ${total / 10} SHV < ${amountDshv / 10} SHV`);
  }
  if (total === amountDshv) return { whole: picked, split: null };
  const last = picked.pop()!;
  const changeDshv = total - amountDshv;
  return { whole: picked, split: { coin: last, keepDshv: last.amountDshv - changeDshv, changeDshv } };
}
