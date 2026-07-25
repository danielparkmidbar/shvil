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

  it('지불 QR(SHV1.)에서 코인을 꺼낸다', () => {
    const c = coin(12);
    const charge = buildCharge(
      { chargeId: 'ch-1', angelMemberId: 'm-angel', amountDshv: c.amountDshv, serviceType: 'BED', createdAt: Date.now() },
      angel,
    );
    const payment = buildPayment(charge, [c], 'm-alice', alice, Date.now());
    const r = parseCheckerInput(encodeQr(payment));
    expect(r.source).toBe('QR_PAYMENT');
    expect(r.coins[0]!.id).toBe(c.id);
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
