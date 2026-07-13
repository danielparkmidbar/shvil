/**
 * 마켓·지불 공용 코인 선택·분할 계산 테스트 (순수 로직).
 * 오래된 것부터 채우고, 넘치면 마지막 코인 하나만 잔돈 분할을 계획한다.
 */
import { describe, expect, it } from 'vitest';
import type { Coin } from '@shvil/shared';
import { planCoinSelection } from '../coinSelection';
import { fmtUsdcMicro, parseShvToDshv, parseUsdcToMicro } from '../amounts';

/** 계획 수립은 금액·순서만 본다 — 서명 검증은 실행부(splitCoin) 책임. */
function coin(id: string, amountDshv: number): Coin {
  return { id, amountDshv } as Coin;
}

describe('planCoinSelection — 오래된 것부터, 정확히 맞춤', () => {
  const oldestFirst = [coin('a', 30), coin('b', 50), coin('c', 200)];

  it('합계가 정확히 맞으면 분할 없이 선택한다 (오래된 것부터)', () => {
    const plan = planCoinSelection(oldestFirst, 80);
    expect(plan.whole.map((c) => c.id)).toEqual(['a', 'b']);
    expect(plan.split).toBeNull();
  });

  it('넘치면 마지막 코인만 분할 계획 — 지불 몫 + 잔돈 = 부모 금액', () => {
    const plan = planCoinSelection(oldestFirst, 100);
    expect(plan.whole.map((c) => c.id)).toEqual(['a', 'b']);
    expect(plan.split).toEqual({ coin: oldestFirst[2], keepDshv: 20, changeDshv: 180 });
    // 분할 검증 로직(자식 합 = 부모)과 같은 불변식.
    expect(plan.split!.keepDshv + plan.split!.changeDshv).toBe(200);
    // 선택 총액 = 목표 금액.
    const total = plan.whole.reduce((s, c) => s + c.amountDshv, 0) + plan.split!.keepDshv;
    expect(total).toBe(100);
  });

  it('잔액 부족이면 던진다 — 서버 호출 전에 로컬에서 걸린다', () => {
    expect(() => planCoinSelection(oldestFirst, 281)).toThrow(/잔액 부족/);
    expect(() => planCoinSelection([], 10)).toThrow(/잔액 부족/);
  });

  it('금액은 양의 dSHV 정수만 허용한다', () => {
    expect(() => planCoinSelection(oldestFirst, 0)).toThrow();
    expect(() => planCoinSelection(oldestFirst, 10.5)).toThrow();
  });
});

describe('금액 파싱 — 부동소수점 없이 정수 변환', () => {
  it('SHV → dSHV: 0.1 단위까지, 잘못된 입력은 null', () => {
    expect(parseShvToDshv('12.5')).toBe(125);
    expect(parseShvToDshv('40')).toBe(400);
    expect(parseShvToDshv('0')).toBeNull(); // 0은 거부
    expect(parseShvToDshv('1.25')).toBeNull(); // 0.01 단위 없음
    expect(parseShvToDshv('abc')).toBeNull();
  });

  it('USDC → micro: 소수 6자리까지 정확 변환, 표기는 뒤 0 제거', () => {
    expect(parseUsdcToMicro('9.5')).toBe(9_500_000);
    expect(parseUsdcToMicro('0.000001')).toBe(1);
    expect(parseUsdcToMicro('12')).toBe(12_000_000);
    expect(parseUsdcToMicro('1.2345678')).toBeNull(); // 7자리 거부
    expect(parseUsdcToMicro('0')).toBeNull();
    expect(fmtUsdcMicro(9_500_000)).toBe('9.5 USDC');
    expect(fmtUsdcMicro(9_262_500)).toBe('9.2625 USDC'); // 9.5 - 2.5% 수수료
    expect(fmtUsdcMicro(12_000_000)).toBe('12 USDC');
  });
});
