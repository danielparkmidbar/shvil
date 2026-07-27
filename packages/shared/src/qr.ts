/**
 * QR 왕복 지불 스키마 (지시서 2.3).
 *
 * 수령자(엔젤) 청구 QR 제시 → 지불자(리스트) 스캔·서명 → 지불 QR 제시 →
 * 엔젤 역스캔·확인 서명 → 완결. 서버 개입 0회, 통신 불요, 승인 불요.
 * 광야 한복판에서도 동작한다.
 *
 * ★용량 (2026-07-27 실측으로 갱신):
 *  - 청구·확인 QR은 원래 여유롭다(515~591자).
 *  - 지불 QR만 넘쳤다. `SHV2.` 압축 전송으로 45~81% 줄어, 불곡산 이전 3회까지,
 *    이스라엘 60일 코인, 소액 코인 4개 묶음(식사 5 SHV)까지 **한 장에 들어간다**.
 *  - 그래도 **상한이 사라진 것은 아니다.** 이전 5회 이상 / 코인 5개 이상 묶음은
 *    여전히 한 장을 넘는다. 헌법 제7조(순환)는 손바뀜이 계속되는 것을 전제하므로,
 *    **분할 프레임 QR(animated QR)이 유일한 영구 해법이다 — 아직 미구현.**
 *  - BLE/NFC 폴백은 조사 결과 플랫폼이 막고 있다(iOS HCE 비공개·ble-plx 폰↔폰 불가).
 *    스키마 자체는 전송 수단 중립이므로 언제든 다른 전송 위에 얹을 수 있다.
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
import { compressPayload, decompressPayload } from './qrCompress';

/**
 * 옛 형식 — `SHV1.` + base64url(JSON). **읽기는 영원히 지원한다.**
 *
 * base64url이 JSON을 33% 부풀리기만 할 뿐 아무것도 줄이지 않아, 증서를 받은
 * 정상 지갑의 지불 QR이 이전 0회에도 2,941자였다(실측). QR 바이트 모드 상한
 * 2,953자 바로 아래이고 version 40이라 폰 화면에서 사실상 스캔되지 않는다.
 */
const QR_PREFIX_V1 = 'SHV1.';

/**
 * 새 형식 — `SHV2.` + base64url(압축(JSON)).
 *
 * ★바뀐 것은 **전송 인코딩뿐**이다. 서명 대상 바이트(정준 직렬화)도, 코인 구조도,
 *  필드 이름도 그대로다. 그래서 이미 발행된 코인은 한 개도 무효가 되지 않는다.
 *  옛 형식 QR도 계속 읽히므로, 새 지갑은 옛 지갑이 띄운 QR을 그대로 받는다.
 *  (반대 방향 — 옛 지갑이 새 지갑의 SHV2 QR을 읽는 것 — 은 앱 갱신이 필요하다.
 *   코인의 유효성 문제가 아니라 앱 버전 문제이며, 배포 전에 정리해야 한다.)
 */
const QR_PREFIX_V2 = 'SHV2.';

/**
 * QR 바이트 모드 한 장의 실제 수용 상한 (문자 수, 오류정정 L).
 * node-qrcode 이진 탐색 실측값 — version 40에서 2,953자다.
 * ※이 값을 통과한다고 실기기에서 스캔된다는 뜻이 아니다. 2,900자대는 version 40
 *  (177×177 모듈)이라 280dp 화면에서 모듈당 1.6dp뿐이다. 크기 검사는 필요조건일 뿐이다.
 */
export const QR_BYTE_MODE_MAX_CHARS = 2953;

export interface EncodeQrOptions {
  /**
   * 'auto'(기본) — 두 형식을 다 만들어 **짧은 쪽**을 낸다. 압축이 이론상 데이터를
   *   늘릴 수 있으므로(압축 불가능한 입력), 이 선택이 "새 형식이 절대 손해가 아니다"를
   *   보장한다. 결정적이다 — 같은 메시지는 언제나 같은 문자열이 된다.
   * 'legacy' — 옛 형식 강제. 옛 지갑과의 호환 시험용.
   */
  format?: 'auto' | 'legacy';
}

export function encodeQr(message: QrMessage, options: EncodeQrOptions = {}): string {
  const bytes = utf8Encode(JSON.stringify(message));
  const legacy = QR_PREFIX_V1 + base64urlEncode(bytes);
  if (options.format === 'legacy') return legacy;
  const compressed = QR_PREFIX_V2 + base64urlEncode(compressPayload(bytes));
  return compressed.length <= legacy.length ? compressed : legacy;
}

/**
 * QR 페이로드처럼 생겼는가 — **접두사 판정의 단일 출처.**
 *
 * ★2026-07-27 적대검증에서 잡힌 것: `checkerInput.ts`가 `'SHV1.'`을 자기 손으로 적어
 *  두고 있어서, 여기에 `SHV2.`가 생기자 **오프라인 위폐 감지기가 새 지불 QR을 아예
 *  못 읽게 됐다.** 게다가 사용자에게는 "JSON을 읽을 수 없습니다 … 지불 QR 내용을
 *  붙여넣어 주세요"라고 떴다 — 방금 붙여넣은 것이 바로 그 지불 QR인데도.
 *  접두사를 두 군데 적어 두면 반드시 이렇게 갈라진다. 이 함수만 보게 한다.
 */
export function isQrPayload(text: string): boolean {
  return text.startsWith(QR_PREFIX_V1) || text.startsWith(QR_PREFIX_V2);
}

export function decodeQr(text: string): QrMessage {
  let json: string;
  if (text.startsWith(QR_PREFIX_V2)) {
    json = utf8Decode(decompressPayload(base64urlDecode(text.slice(QR_PREFIX_V2.length))));
  } else if (text.startsWith(QR_PREFIX_V1)) {
    json = utf8Decode(base64urlDecode(text.slice(QR_PREFIX_V1.length)));
  } else {
    throw new Error('qr: unknown prefix');
  }
  const parsed = JSON.parse(json) as QrMessage;
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
