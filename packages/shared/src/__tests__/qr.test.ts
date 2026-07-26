import { describe, expect, it } from 'vitest';
import { addressFromPublicKey, generateKeyPair, signerFromKeyPair, type Signer } from '../crypto';
import { PendingWalkLedger } from '../ledger';
import { buildWalkSegmentProof } from '../proof';
import { currentOwnerAddress, mintWalkCoin, splitCoin, verifyCoin } from '../coin';
import {
  acceptPayment,
  buildCharge,
  buildPayment,
  decodeQr,
  encodeQr,
  verifyCharge,
  verifyConfirm,
  type PaymentMessage,
} from '../qr';
import type { Coin } from '../types';
import { T0, walkKm } from './helpers';

const list = signerFromKeyPair(generateKeyPair()); // 리스트 (지불자)
const angel = signerFromKeyPair(generateKeyPair()); // 엔젤 (수령자)

function mintCoinFor(memberId: string, signer: Signer, km = 17.3): Coin {
  const ledger = new PendingWalkLedger({ memberId });
  const end = walkKm(ledger, km);
  return mintWalkCoin(buildWalkSegmentProof(ledger.settleOnSpend(end)!, signer));
}

describe('QR 왕복 지불 — 서버 개입 0회, 통신 불요 (지시서 2.3)', () => {
  it('청구 → 지불 → 역스캔 확인 전 과정이 로컬 서명만으로 완결된다', () => {
    // 1) 엔젤: 잠자리 10 SHV 청구 QR
    const charge = buildCharge(
      { chargeId: 'chg-001', angelMemberId: 'm-angel', amountDshv: 100, serviceType: '잠자리', createdAt: T0 },
      angel,
    );
    const chargeQr = encodeQr(charge);

    // 2) 리스트: 스캔 → 잔돈 분할 → 지불 서명 → 지불 QR
    const scannedCharge = decodeQr(chargeQr);
    expect(scannedCharge.type).toBe('shvil/charge');
    if (scannedCharge.type !== 'shvil/charge') throw new Error('unexpected');
    expect(verifyCharge(scannedCharge)).toBe(true);

    const wallet = mintCoinFor('m-list', list); // 173 dSHV
    const [pay] = splitCoin(wallet, list, [100, 73], T0 + 500);
    const payment = buildPayment(scannedCharge, [pay!], 'm-list', list, T0 + 1000);
    const paymentQr = encodeQr(payment);

    // 3) 엔젤: 역스캔 → 로컬 위조 검사 → 확인 서명으로 완결
    const scannedPayment = decodeQr(paymentQr) as PaymentMessage;
    const result = acceptPayment(scannedCharge, scannedPayment, angel);
    expect(result.coins).toHaveLength(1);
    const received = result.coins[0]!;
    expect(verifyCoin(received).valid).toBe(true);
    expect(currentOwnerAddress(received)).toBe(addressFromPublicKey(angel.publicKeyHex));
    expect(received.memberId).toBe('m-list'); // 생성자 각인 유지

    // 4) 리스트: 확인 QR 검증 → 영수증
    const confirmQr = encodeQr(result.confirm);
    const confirm = decodeQr(confirmQr);
    if (confirm.type !== 'shvil/confirm') throw new Error('unexpected');
    expect(verifyConfirm(confirm, scannedCharge)).toBe(true);
    expect(confirm.coinIds).toEqual([received.id]);
  });

  it('지불 합계가 청구액과 다르면 지불을 만들 수 없다 (분할 선행 필수)', () => {
    const charge = buildCharge(
      { chargeId: 'chg-002', angelMemberId: 'm-angel', amountDshv: 100, createdAt: T0 },
      angel,
    );
    const wallet = mintCoinFor('m-list', list); // 173 ≠ 100
    expect(() => buildPayment(charge, [wallet], 'm-list', list, T0)).toThrow(/split first/);
  });

  it('위조 코인이 섞인 지불은 엔젤의 로컬 검증에서 거부된다', () => {
    const charge = buildCharge(
      { chargeId: 'chg-003', angelMemberId: 'm-angel', amountDshv: 100, createdAt: T0 },
      angel,
    );
    const real = mintCoinFor('m-list', list);
    // 공격: 금액을 100으로 조작한 코인 (ID·서명 불일치)
    const forged: Coin = { ...real, amountDshv: 100 };
    const payment = buildPayment(charge, [forged], 'm-list', list, T0 + 1000);
    // ★진짜 위조(계보 손상)에는 그대로 "손상"이라고 말한다.
    expect(() => acceptPayment(charge, payment, angel)).toThrow(/서명 또는 계보가 손상/);
  });

  it('★자격을 확인 못 한 코인은 거부하되 "위조"라고 말하지 않는다 (사람이 보는 문구)', () => {
    // 이 문자열이 그대로 ReceiveScreen의 Alert에 뜬다. 키 목록이 비었거나 낡은
    // 엔젤이 정직한 종주자의 코인을 스캔하는 상황 — 받지는 않지만 위폐범 취급은 안 된다.
    const real = mintCoinFor('m-list', list);
    const charge = buildCharge(
      { chargeId: 'chg-003b', angelMemberId: 'm-angel', amountDshv: real.amountDshv, createdAt: T0 },
      angel,
    );
    const payment = buildPayment(charge, [real], 'm-list', list, T0 + 1000);
    // 증서가 없는 코인 + 필수화 스위치 on → MISSING_INTEGRITY_TOKEN (자격 미증명).
    let message = '';
    try {
      acceptPayment(charge, payment, angel, { requireIntegrityToken: true });
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain('수령을 보류');
    expect(message).toContain('위조라는 뜻이 아닙니다');
    expect(message).not.toContain('손상');
    expect(message.toLowerCase()).not.toContain('forged');
  });

  it('지불 메시지 변조(금액·수신자 조작)는 서명 검증에서 걸린다', () => {
    const charge = buildCharge(
      { chargeId: 'chg-004', angelMemberId: 'm-angel', amountDshv: 100, createdAt: T0 },
      angel,
    );
    const wallet = mintCoinFor('m-list', list);
    const [pay] = splitCoin(wallet, list, [100, 73], T0);
    const payment = buildPayment(charge, [pay!], 'm-list', list, T0 + 1000);
    const tampered: PaymentMessage = { ...payment, payerMemberId: 'm-attacker' };
    expect(() => acceptPayment(charge, tampered, angel)).toThrow(/invalid payment signature/);
  });

  it('다른 청구에 대한 지불은 수락되지 않는다 (재사용 방지)', () => {
    const charge1 = buildCharge(
      { chargeId: 'chg-005', angelMemberId: 'm-angel', amountDshv: 100, createdAt: T0 },
      angel,
    );
    const charge2 = buildCharge(
      { chargeId: 'chg-006', angelMemberId: 'm-angel', amountDshv: 100, createdAt: T0 },
      angel,
    );
    const wallet = mintCoinFor('m-list', list);
    const [pay] = splitCoin(wallet, list, [100, 73], T0);
    const payment = buildPayment(charge1, [pay!], 'm-list', list, T0 + 1000);
    expect(() => acceptPayment(charge2, payment, angel)).toThrow(/charge mismatch/);
  });

  it('QR 텍스트 인코딩은 유니코드 포함 왕복 무손실이다', () => {
    const charge = buildCharge(
      { chargeId: 'chg-007', angelMemberId: 'm-angel', amountDshv: 180, serviceType: '풀 패키지 🌵', createdAt: T0 },
      angel,
    );
    expect(decodeQr(encodeQr(charge))).toEqual(charge);
  });

  it('알 수 없는 QR 텍스트는 거부된다', () => {
    expect(() => decodeQr('https://evil.example/qr')).toThrow(/unknown prefix/);
  });
});
