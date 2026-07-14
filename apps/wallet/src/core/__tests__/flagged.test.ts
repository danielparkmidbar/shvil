/**
 * 소명 대기 목록 대조 테스트 (지시서 3장 5절 — 소명 책임 원칙).
 * 수신 지갑은 소명 대기 회원이 "생성한" 코인의 수령만 보류한다 —
 * 이미 보유한 코인과 타인의 거래는 영향받지 않는다.
 */
import { describe, expect, it } from 'vitest';
import type { Coin } from '@shvil/shared';
import { findFlaggedProducer, parseFlaggedCache } from '../flagged';

/** 대조에 필요한 것은 생성자 회원 번호뿐 — coin.memberId (분할·이전 후에도 불변). */
function coinBy(memberId: string): Coin {
  return { id: `c-${memberId}-${Math.random()}`, amountDshv: 10, memberId } as Coin;
}

describe('findFlaggedProducer', () => {
  it('소명 대기 회원이 생성한 코인이 섞여 있으면 그 회원 번호를 돌려준다 (수령 보류)', () => {
    const coins = [coinBy('SHV-000001'), coinBy('SHV-999999'), coinBy('SHV-000002')];
    expect(findFlaggedProducer(coins, ['SHV-777777', 'SHV-999999'])).toBe('SHV-999999');
  });

  it('목록이 비었거나 생성 회원이 목록에 없으면 null — 타인의 거래는 영향받지 않는다', () => {
    const coins = [coinBy('SHV-000001'), coinBy('SHV-000002')];
    expect(findFlaggedProducer(coins, [])).toBeNull();
    expect(findFlaggedProducer(coins, ['SHV-999999'])).toBeNull();
    // 소명 대기 회원의 코인을 "보유"한 제3자가 아니라 "생성" 회원만 대조한다 —
    // transferChain의 중간 소유자는 검사 대상이 아니다 (coin.memberId만 본다).
  });
});

describe('parseFlaggedCache', () => {
  it('캐시 없음·손상 JSON·형식 불일치는 빈 목록 — 수령 보류는 배포된 목록에 한한다', () => {
    expect(parseFlaggedCache(null)).toEqual([]);
    expect(parseFlaggedCache('not-json{')).toEqual([]);
    expect(parseFlaggedCache('{"members":[]}')).toEqual([]); // 배열이 아니면 무시
    // 사유는 서버가 만든 문장이 아니라 코드 + 파라미터다 (다국어는 클라이언트 책임).
    const list = [
      {
        memberId: 'SHV-000009',
        reasonCode: 'OVERPRODUCTION_DAILY',
        params: { date: '2026-07-14', totalDshv: 500, limitDshv: 400 },
        flaggedAt: 1,
      },
    ];
    expect(parseFlaggedCache(JSON.stringify(list))).toEqual(list);
  });
});
