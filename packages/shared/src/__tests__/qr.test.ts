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

describe('QR 전송 형식 — 압축 도입 후에도 옛 것을 계속 읽는다', () => {
  /**
   * ★2026-07-27 압축(`SHV2.`) 도입 **이전**에 만들어진 실제 청구 QR 문자열이다.
   *  이 문자열은 새 코드가 존재하지 않던 시절의 산출물이므로, 이것이 계속 읽힌다는
   *  것이 곧 "새 규칙이 옛 화폐를 가짜로 만들지 않는다"의 증거다.
   *  ⚠이 상수를 새로 만들어 갱신하지 마라 — 갱신하는 순간 시험의 의미가 사라진다.
   */
  const LEGACY_CHARGE_QR =
    'SHV1.eyJ2IjoxLCJ0eXBlIjoic2h2aWwvY2hhcmdlIiwiY2hhcmdlSWQiOiJjaGdfbGVnYWN5X2ZpeHR1cmUiLCJhbmdlbE1lbWJlcklkIjoiU0hWLTIwMjYtMDAwOTk5IiwiYW5nZWxQdWJsaWNLZXkiOiJhMDlhYTVmNDdhNjc1OTgwMmZmOTU1ZjhkYzJkMmExNGE1Yzk5ZDIzYmU5N2Y4NjQxMjdmZjkzODM0NTVhNGYwIiwiYW1vdW50RHNodiI6MzAsInNlcnZpY2VUeXBlIjoiU0hPV0VSIiwiY3JlYXRlZEF0IjoxNzc3NzAxNjAwMDAwLCJzaWduYXR1cmUiOiJjMGE2N2UxMGU4MzQ1M2Y4NDJhMjRmNWFhYmQzN2NhYjNjMDNhZWExZDFiMTQ4ZTMzZGZkOTRiZDIzY2M4ZDAzMDU4OTc0NzY5ZWI4ZDU3M2UxMzliZDg0ZDljN2NkOTA3MmEyYWYyYzk1N2EyNjVhMzNhMzM5MjExZGY3Y2QwMyJ9';

  it('★옛 형식(SHV1.) 청구 QR이 그대로 읽히고 서명도 그대로 검증된다', () => {
    const decoded = decodeQr(LEGACY_CHARGE_QR);
    if (decoded.type !== 'shvil/charge') throw new Error('unexpected');
    expect(decoded.chargeId).toBe('chg_legacy_fixture');
    expect(decoded.angelMemberId).toBe('SHV-2026-000999');
    expect(decoded.amountDshv).toBe(30);
    // 서명 검증까지 통과해야 한다 — 전송 인코딩이 서명 대상을 건드리지 않았다는 증거.
    expect(verifyCharge(decoded)).toBe(true);
  });

  it('옛 형식으로 강제 인코딩한 결과도 그대로 왕복한다 (옛 지갑 호환 시험용)', () => {
    const charge = buildCharge(
      { chargeId: 'chg-legacy-2', angelMemberId: 'm-angel', amountDshv: 50, serviceType: '샤워 🚿', createdAt: T0 },
      angel,
    );
    const legacy = encodeQr(charge, { format: 'legacy' });
    expect(legacy.startsWith('SHV1.')).toBe(true);
    expect(decodeQr(legacy)).toEqual(charge);
  });

  it('손상된 압축 QR은 조용히 다른 메시지가 되지 않고 거부된다', () => {
    const charge = buildCharge(
      { chargeId: 'chg-corrupt', angelMemberId: 'm-angel', amountDshv: 50, createdAt: T0 },
      angel,
    );
    const wallet = mintCoinFor('m-list', list);
    const [pay] = splitCoin(wallet, list, [50, wallet.amountDshv - 50], T0);
    const qr = encodeQr(buildPayment(charge, [pay!], 'm-list', list, T0 + 1000));
    expect(qr.startsWith('SHV2.')).toBe(true);
    // 뒤를 잘라 낸다 → 반드시 던진다(멈추거나 엉뚱한 메시지를 만들지 않는다).
    let rejected = 0;
    for (const cut of [10, 50, 200, qr.length - 1]) {
      try {
        decodeQr(qr.slice(0, cut));
      } catch {
        rejected += 1;
      }
    }
    expect(rejected).toBe(4);
  });
});
