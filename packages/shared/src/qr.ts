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
import { addressFromPublicKey, signObject, verifyObject, type Signer } from './crypto.js';
import {
  acknowledgeTransfer,
  createTransfer,
  currentOwnerAddress,
  verifyCoin,
  type VerifyCoinOptions,
} from './coin.js';
import type { Coin } from './types.js';

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

const QR_PREFIX = 'SHV1.';
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return Uint8Array.from(out);
}

function utf8Decode(bytes: Uint8Array): string {
  let s = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i]!;
    let cp: number;
    if (b < 0x80) { cp = b; i += 1; }
    else if (b < 0xe0) { cp = ((b & 0x1f) << 6) | (bytes[i + 1]! & 0x3f); i += 2; }
    else if (b < 0xf0) { cp = ((b & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f); i += 3; }
    else { cp = ((b & 0x07) << 18) | ((bytes[i + 1]! & 0x3f) << 12) | ((bytes[i + 2]! & 0x3f) << 6) | (bytes[i + 3]! & 0x3f); i += 4; }
    s += String.fromCodePoint(cp);
  }
  return s;
}

function base64urlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64URL[b0 >> 2]!;
    out += B64URL[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)]!;
    if (b1 !== undefined) out += B64URL[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)]!;
    if (b2 !== undefined) out += B64URL[b2 & 0x3f]!;
  }
  return out;
}

function base64urlDecode(s: string): Uint8Array {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of s) {
    const val = B64URL.indexOf(ch);
    if (val < 0) throw new Error('qr: invalid base64url character');
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

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
      throw new Error(`accept: forged or invalid coin ${coin.id.slice(0, 12)}… [${verdict.reasons.join(',')}]`);
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
