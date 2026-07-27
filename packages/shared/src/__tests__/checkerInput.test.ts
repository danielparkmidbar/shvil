/** 위폐 감지기 입력 파서 (M16) — 사이트가 받는 형식 전부를 고정한다. */
import { describe, expect, it } from 'vitest';
import { generateKeyPair, signerFromKeyPair } from '../crypto';
import { PendingWalkLedger } from '../ledger';
import { buildWalkSegmentProof } from '../proof';
import { mintWalkCoin } from '../coin';
import { buildCharge, buildPayment, encodeQr } from '../qr';
import { parseCheckerInput } from '../checkerInput';
import type { Coin } from '../types';
import { walkKm } from './helpers';

const alice = signerFromKeyPair(generateKeyPair());
const angel = signerFromKeyPair(generateKeyPair());

function coin(km = 10): Coin {
  const ledger = new PendingWalkLedger({ memberId: 'm-alice' });
  const end = walkKm(ledger, km);
  return mintWalkCoin(buildWalkSegmentProof(ledger.settleOnSpend(end)!, alice));
}

describe('parseCheckerInput', () => {
  it('코인 JSON 한 개', () => {
    const c = coin();
    const r = parseCheckerInput(JSON.stringify(c));
    expect(r.source).toBe('COIN');
    expect(r.coins[0]!.id).toBe(c.id);
  });

  it('코인 배열', () => {
    const r = parseCheckerInput(JSON.stringify([coin(5), coin(6)]));
    expect(r.source).toBe('COIN_ARRAY');
    expect(r.coins).toHaveLength(2);
  });

  it('지갑 내보내기 { coins: [...] }', () => {
    const r = parseCheckerInput(JSON.stringify({ coins: [coin(5)], memberId: 'm-alice', v: 1 }));
    expect(r.source).toBe('COIN_LIST');
    expect(r.coins).toHaveLength(1);
  });

  /**
   * ★2026-07-27 적대검증에서 재현된 결함의 회귀 시험.
   *
   * 이 시험의 이름은 원래 "지불 QR(SHV1.)에서 코인을 꺼낸다"였는데, 정작 검사하는 것은
   * `encodeQr`가 실제로 내는 형식(짧은 쪽 = 거의 언제나 SHV2)이었다. 이름이 SHV1을
   * 가리키고 있으니 **SHV2가 깨졌을 때 무엇이 깨진 것인지 이름이 말해 주지 않았다.**
   * 두 형식을 각각 못박아, 어느 쪽이 끊겨도 그 이름이 화면에 뜨게 한다.
   */
  function paymentQrPair() {
    const c = coin(12);
    const charge = buildCharge(
      { chargeId: 'ch-1', angelMemberId: 'm-angel', amountDshv: c.amountDshv, serviceType: 'BED', createdAt: Date.now() },
      angel,
    );
    const payment = buildPayment(charge, [c], 'm-alice', alice, Date.now());
    return { coinId: c.id, current: encodeQr(payment), legacy: encodeQr(payment, { format: 'legacy' }) };
  }

  it('★지갑이 실제로 만드는 지불 QR(압축 SHV2.)에서 코인을 꺼낸다', () => {
    const { coinId, current } = paymentQrPair();
    expect(current.startsWith('SHV2.')).toBe(true); // 이 전제가 깨지면 아래 시험의 의미도 바뀐다
    const r = parseCheckerInput(current);
    expect(r.source).toBe('QR_PAYMENT');
    expect(r.coins[0]!.id).toBe(coinId);
  });

  it('옛 형식 지불 QR(SHV1.)도 영원히 읽는다', () => {
    const { coinId, legacy } = paymentQrPair();
    expect(legacy.startsWith('SHV1.')).toBe(true);
    const r = parseCheckerInput(legacy);
    expect(r.source).toBe('QR_PAYMENT');
    expect(r.coins[0]!.id).toBe(coinId);
  });

  it('청구 QR에는 코인이 없다 — 명확한 안내로 거절', () => {
    const charge = buildCharge(
      { chargeId: 'ch-2', angelMemberId: 'm-angel', amountDshv: 100, serviceType: null, createdAt: Date.now() },
      angel,
    );
    expect(() => parseCheckerInput(encodeQr(charge))).toThrow(/코인이 들어 있지 않습니다/);
  });

  it('빈 입력·비JSON·코인 아닌 JSON은 사용자용 메시지로 거절', () => {
    expect(() => parseCheckerInput('')).toThrow(/비어/);
    expect(() => parseCheckerInput('hello')).toThrow(/JSON/);
    expect(() => parseCheckerInput('{"foo":1}')).toThrow(/형식이 아닙니다/);
  });
});
