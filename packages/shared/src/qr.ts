/**
 * QR 왕복 지불 스키마 (지시서 2.3).
 *
 * 수령자(엔젤) 청구 QR 제시 → 지불자(리스트) 스캔·서명 → 지불 QR 제시 →
 * 엔젤 역스캔·확인 서명 → 완결. 서버 개입 0회, 통신 불요, 승인 불요.
 * 광야 한복판에서도 동작한다.
 *
 * M1 참고: 코인 수가 많으면 QR 용량을 넘을 수 있다 — 앱 계층에서 분할 프레임
 * (animated QR) 또는 BLE/NFC 폴백을 얹는다. 스키마 자체는 전송 수단 중립.
 */
import { addressFromPublicKey, signObject, verifyObject, type Signer } from './crypto';
import {
  acknowledgeTransfer,
  createTransfer,
  currentOwnerAddress,
  isUnprovenOnly,
  verifyCoin,
  type VerifyCoinOptions,
} from './coin';
import type { Coin, CoinRejectReason } from './types';

// ── 메시지 타입 ───────────────────────────────────────────────────

export interface ChargeMessage {
  v: 1;
  type: 'shvil/charge';
  chargeId: string;
  angelMemberId: string;
  angelPublicKey: string;
  amountDshv: number;
  /** 권장 가격표 버튼 연동용 (BED/MEAL/SHOWER/FULL_PACKAGE/OTHER). */
  serviceType: string | null;
  createdAt: number;
  signature: string;
}

export interface PaymentMessage {
  v: 1;
  type: 'shvil/payment';
  chargeId: string;
  payerMemberId: string;
  payerPublicKey: string;
  /** 엔젤 앞 미완결 이전 링크가 붙은 코인들 — 합계가 청구액과 정확히 일치. */
  coins: Coin[];
  createdAt: number;
  signature: string;
}

export interface ConfirmMessage {
  v: 1;
  type: 'shvil/confirm';
  chargeId: string;
  coinIds: string[];
  createdAt: number;
  signature: string;
}

export type QrMessage = ChargeMessage | PaymentMessage | ConfirmMessage;

// ── 인코딩 (전송 수단 중립 텍스트) ───────────────────────────────

import { base64urlDecode, base64urlEncode, utf8Decode, utf8Encode } from './encoding';

const QR_PREFIX = 'SHV1.';

export function encodeQr(message: QrMessage): string {
  return QR_PREFIX + base64urlEncode(utf8Encode(JSON.stringify(message)));
}

export function decodeQr(text: string): QrMessage {
  if (!text.startsWith(QR_PREFIX)) throw new Error('qr: unknown prefix');
  const parsed = JSON.parse(utf8Decode(base64urlDecode(text.slice(QR_PREFIX.length)))) as QrMessage;
  if (parsed.v !== 1) throw new Error('qr: unsupported version');
  if (parsed.type !== 'shvil/charge' && parsed.type !== 'shvil/payment' && parsed.type !== 'shvil/confirm') {
    throw new Error('qr: unknown message type');
  }
  return parsed;
}

// ── 왕복 플로우 ───────────────────────────────────────────────────

/** 1단계 (엔젤): 청구 생성. 금액 입력 또는 권장 가격표 버튼. */
export function buildCharge(
  fields: { chargeId: string; angelMemberId: string; amountDshv: number; serviceType?: string | null; createdAt: number },
  angelSigner: Signer,
): ChargeMessage {
  if (!Number.isInteger(fields.amountDshv) || fields.amountDshv <= 0) {
    throw new Error('charge: amount must be a positive integer (dSHV)');
  }
  const unsigned = {
    v: 1 as const,
    type: 'shvil/charge' as const,
    chargeId: fields.chargeId,
    angelMemberId: fields.angelMemberId,
    angelPublicKey: angelSigner.publicKeyHex,
    amountDshv: fields.amountDshv,
    serviceType: fields.serviceType ?? null,
    createdAt: fields.createdAt,
  };
  return { ...unsigned, signature: signObject(unsigned, angelSigner) };
}

export function verifyCharge(charge: ChargeMessage): boolean {
  const { signature, ...unsigned } = charge;
  return charge.v === 1 && charge.type === 'shvil/charge' && verifyObject(unsigned, signature, charge.angelPublicKey);
}

/**
 * 2단계 (리스트): 청구 스캔 → 코인에 지불 서명. 합계는 청구액과 정확히
 * 일치해야 한다 (지갑이 필요 시 splitCoin으로 잔돈을 만든 뒤 호출).
 */
export function buildPayment(
  charge: ChargeMessage,
  coins: Coin[],
  payerMemberId: string,
  payerSigner: Signer,
  now: number,
): PaymentMessage {
  if (!verifyCharge(charge)) throw new Error('payment: invalid charge signature');
  const total = coins.reduce((sum, c) => sum + c.amountDshv, 0);
  if (total !== charge.amountDshv) {
    throw new Error(`payment: coin total ${total} != charge amount ${charge.amountDshv} (split first)`);
  }
  const signedCoins = coins.map((coin) => createTransfer(coin, payerSigner, charge.angelPublicKey, now));
  const unsigned = {
    v: 1 as const,
    type: 'shvil/payment' as const,
    chargeId: charge.chargeId,
    payerMemberId,
    payerPublicKey: payerSigner.publicKeyHex,
    coins: signedCoins,
    createdAt: now,
  };
  return { ...unsigned, signature: signObject(unsigned, payerSigner) };
}

export interface AcceptResult {
  /** 양측 서명이 완결된 코인들 — 엔젤 지갑에 저장. */
  coins: Coin[];
  /** 3단계: 지불자에게 역제시할 확인 메시지. */
  confirm: ConfirmMessage;
}

/**
 * 수령 거부 문구 — ★이 문자열이 그대로 사람의 화면에 뜬다
 * (ReceiveScreen의 `Alert.alert('수령 거부', e.message)`).
 *
 * 예전에는 이유가 무엇이든 `forged or invalid coin`이었다. 그래서 키 회전 직후이거나
 * 오프라인 첫 실행이라 키 목록이 빈 엔젤이 **정직한 종주자의 코인**을 스캔하면 화면에
 * "forged"라는 단어가 떴다. 같은 상황을 두고 코드의 다른 곳(types.ts·authenticity.ts)은
 * "코인의 흠이 아니다"라고 적어 두었으니, 코드가 서로 반대로 말하고 있었던 것이다.
 * 어휘를 나눴으면 사람이 보는 자리까지 나눠야 한다(제3조).
 */
function rejectionMessage(coin: Coin, reasons: readonly CoinRejectReason[]): string {
  const tag = `${coin.id.slice(0, 12)}… [${reasons.join(',')}]`;
  if (isUnprovenOnly(reasons)) {
    // 서명·ID·이전 체인은 전부 온전하다. 받지는 않지만 위조라고 부르지 않는다.
    return (
      `수령을 보류했습니다: 이 코인의 발행 자격을 지금 확인할 수 없습니다 ${tag}. ` +
      `서명과 계보 자체는 온전합니다 — 위조라는 뜻이 아닙니다. ` +
      `온라인에 한 번 연결해 신뢰 키 목록을 갱신한 뒤 다시 시도해 보십시오.`
    );
  }
  return `수령 거부: 서명 또는 계보가 손상된 코인입니다 ${tag}`;
}

/**
 * 3단계 (엔젤): 지불 역스캔 → 계보 로컬 검증(위조 검사) → 확인 서명으로 완결.
 * 검증은 승인이 아니다 — 밀리초 단위 로컬 위조 검사다.
 */
export function acceptPayment(
  charge: ChargeMessage,
  payment: PaymentMessage,
  angelSigner: Signer,
  verifyOptions: VerifyCoinOptions = {},
): AcceptResult {
  if (payment.chargeId !== charge.chargeId) throw new Error('accept: charge mismatch');
  const { signature, ...unsignedPayment } = payment;
  if (!verifyObject(unsignedPayment, signature, payment.payerPublicKey)) {
    throw new Error('accept: invalid payment signature');
  }
  const total = payment.coins.reduce((sum, c) => sum + c.amountDshv, 0);
  if (total !== charge.amountDshv) throw new Error('accept: amount mismatch');

  const angelAddress = addressFromPublicKey(angelSigner.publicKeyHex);
  for (const coin of payment.coins) {
    const verdict = verifyCoin(coin, { ...verifyOptions, allowPendingLastLink: true });
    if (!verdict.valid) {
      throw new Error(rejectionMessage(coin, verdict.reasons));
    }
    if (currentOwnerAddress(coin) !== angelAddress) {
      throw new Error('accept: coin is not addressed to this angel');
    }
  }

  const completed = payment.coins.map((coin) => acknowledgeTransfer(coin, angelSigner));
  const unsigned = {
    v: 1 as const,
    type: 'shvil/confirm' as const,
    chargeId: charge.chargeId,
    coinIds: completed.map((c) => c.id),
    createdAt: payment.createdAt,
  };
  return { coins: completed, confirm: { ...unsigned, signature: signObject(unsigned, angelSigner) } };
}

/** 4단계 (리스트): 확인 메시지 검증 — 영수증으로 저장하고 지불 코인을 지갑에서 제거. */
export function verifyConfirm(confirm: ConfirmMessage, charge: ChargeMessage): boolean {
  const { signature, ...unsigned } = confirm;
  return (
    confirm.type === 'shvil/confirm' &&
    confirm.chargeId === charge.chargeId &&
    verifyObject(unsigned, signature, charge.angelPublicKey)
  );
}
