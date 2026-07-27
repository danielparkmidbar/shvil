/**
 * 지불 계획 — **자르기 전에 재 본다.**
 *
 * ── 무엇이 잘못돼 있었나 (2026-07-27 적대검증) ──────────────────────
 * 예전 `payCharge`는 이 순서였다: 코인을 고른다 → **분할해서 DB에 커밋한다** →
 * 지불 메시지를 만든다 → 화면이 QR을 그려 보고 "너무 큽니다"를 띄운다.
 * 즉 실패가 화면에서 밝혀지는데 **되돌릴 수 없는 분할은 이미 끝나 있었다.**
 * 코인 병합 기능이 없으므로 재시도할수록 코인은 잘게 쪼개지고 QR은 더 커졌다.
 * 화면 문구 "더 큰 단위 코인으로 다시 시도하세요"는 실행 불가능한 안내였다.
 *
 * ── 이 모듈이 하는 일 ──────────────────────────────────────────────
 * 서명은 하되 **아무것도 저장하지 않고** 후보 몇 개를 끝까지 만들어 본다. 실제 지불
 * 메시지를 만들어 실제 인코더로 재므로, 여기서 나온 길이는 추정이 아니라 그 QR의
 * 길이다. 고른 뒤에야 호출부가 분할을 커밋한다.
 *
 * `splitCoin`·`buildPayment`는 순수 함수이고 ed25519 서명은 결정적이므로, 여기서
 * 만든 코인과 나중에 커밋되는 코인은 **바이트까지 같다**(같은 timestamp를 쓴다).
 *
 * ── 코인 나이 정책을 바꾸지 않는다 ─────────────────────────────────
 * 기본은 지금까지와 같이 **오래된 것부터**다. 다른 후보를 고르는 경우는 오직
 * "오래된 것부터가 QR 여러 장이 되는데 다른 조합은 한 장으로 끝날 때"뿐이다.
 * 즉 지금 되던 지불의 결과는 한 개도 바뀌지 않고, 지금 안 되던 지불만 살아난다.
 */
import {
  QR_BYTE_MODE_MAX_CHARS,
  QR_FRAME_CHUNK_CHARS,
  buildPayment,
  encodeQr,
  splitCoin,
  type ChargeMessage,
  type Coin,
  type PaymentMessage,
  type Signer,
} from '@shvil/shared';
import { planCoinSelection } from './coinSelection';

/** 분할 실행 계획 — 호출부가 이대로 커밋한다 (여기서는 저장하지 않는다). */
export interface PlannedSplit {
  /** 소비되는 원본 코인 (SPLIT_CONSUMED가 된다). */
  parent: Coin;
  /** 지불에 쓸 몫. */
  pay: Coin;
  /** 지갑에 남는 잔돈. */
  change: Coin;
}

export interface PaymentPlan {
  /** 사람에게 보여 줄 선택 근거 (한국어). */
  strategy: string;
  /** 실제로 이전되는 코인들. */
  coins: Coin[];
  /** 필요하면 분할 계획, 아니면 null. */
  split: PlannedSplit | null;
  /** 서명이 끝난 지불 메시지 — 그대로 쓰면 된다. */
  payment: PaymentMessage;
  /** 이 지불의 QR 텍스트 길이 (문자). */
  qrLength: number;
  /** 필요한 QR 장수 (1이면 한 장). */
  frameCount: number;
}

export interface PaymentPlanInput {
  /** 보유 코인 — 로컬 원장 순서(오래된 것부터). */
  owned: readonly Coin[];
  charge: ChargeMessage;
  payerMemberId: string;
  signer: Signer;
  now: number;
}

/** 한 장짜리 QR에 들어가는가 — 규격 상한(2,953자, 오류정정 L). */
export function fitsOneQr(qrLength: number): boolean {
  return qrLength <= QR_BYTE_MODE_MAX_CHARS;
}

/** 이 길이를 화면에 띄우려면 QR이 몇 장 필요한가. */
export function qrFrameCount(qrLength: number): number {
  return fitsOneQr(qrLength) ? 1 : Math.ceil(qrLength / QR_FRAME_CHUNK_CHARS);
}

/** 코인 하나가 지불 메시지에서 차지하는 대략적 무게 — 짧은 것부터 고르는 후보용. */
function coinWeight(coin: Coin): number {
  return JSON.stringify(coin).length;
}

function buildCandidate(
  strategy: string,
  ordered: readonly Coin[],
  input: PaymentPlanInput,
): PaymentPlan | null {
  let selection;
  try {
    selection = planCoinSelection([...ordered], input.charge.amountDshv);
  } catch {
    return null; // 잔액 부족 — 이 순서로는 못 채운다
  }
  const coins = [...selection.whole];
  let split: PlannedSplit | null = null;
  if (selection.split) {
    const { coin, keepDshv, changeDshv } = selection.split;
    const [pay, change] = splitCoin(coin, input.signer, [keepDshv, changeDshv], input.now);
    split = { parent: coin, pay: pay!, change: change! };
    coins.push(pay!);
  }
  const payment = buildPayment(input.charge, coins, input.payerMemberId, input.signer, input.now);
  const qrLength = encodeQr(payment).length;
  return { strategy, coins, split, payment, qrLength, frameCount: qrFrameCount(qrLength) };
}

/**
 * 지불 계획을 고른다. 잔액이 모자라면 던진다 — 그때는 아무것도 서명되지 않는다.
 *
 * 고르는 규칙은 두 줄이다.
 *  1. 기본은 **오래된 것부터**(지금까지의 정책).
 *  2. 그것이 QR 여러 장이 되는데 한 장으로 끝나는 다른 조합이 있으면 그쪽을 쓴다.
 *     (여러 장도 이제는 보낼 수 있다 — 그래도 한 장이 언제나 빠르고 잘 읽힌다.)
 */
export function planPayment(input: PaymentPlanInput): PaymentPlan {
  const owned = [...input.owned];
  if (owned.length === 0) throw new Error('잔액 부족: 지갑에 코인이 없습니다');

  const byOldest = owned;
  const byLargest = [...owned].sort((a, b) => b.amountDshv - a.amountDshv);
  const bySmallestSerialized = [...owned].sort((a, b) => coinWeight(a) - coinWeight(b));
  // 청구액과 **정확히 같은** 코인 한 장 — 분할이 없으므로 계보가 자라지 않는다.
  const exact = owned.filter((c) => c.amountDshv === input.charge.amountDshv).slice(0, 1);

  const candidates: PaymentPlan[] = [];
  const push = (label: string, ordered: readonly Coin[]) => {
    if (ordered.length === 0) return;
    const c = buildCandidate(label, ordered, input);
    if (c) candidates.push(c);
  };
  push('오래된 것부터', byOldest);
  push('금액이 정확히 맞는 한 장', exact);
  push('큰 것부터 (장수 최소)', byLargest);
  push('짧은 코인부터 (QR 최소)', bySmallestSerialized);

  if (candidates.length === 0) {
    const total = owned.reduce((s, c) => s + c.amountDshv, 0);
    throw new Error(`잔액 부족: ${total / 10} SHV < ${input.charge.amountDshv / 10} SHV`);
  }

  const primary = candidates[0]!;
  if (primary.frameCount === 1) return primary; // 지금 되던 지불은 그대로 둔다
  // 한 장으로 끝나는 후보가 있으면 그것을, 없으면 가장 짧은 것을 고른다.
  let best = primary;
  for (const c of candidates.slice(1)) {
    if (c.frameCount < best.frameCount) best = c;
  }
  return best;
}
