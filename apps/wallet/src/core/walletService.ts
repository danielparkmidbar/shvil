/**
 * 지갑 서비스 — 잠정 원장, 코인 보관, QR 왕복 지불의 오케스트레이션.
 *
 * 핵심 흐름 (지시서 0-6, 2.3):
 *  - 걷기 창 샘플 → 잠정 누적 (recordSample)
 *  - 정산은 지불(payCharge 내부의 settleOnSpend) 또는 "여기서 정산"(settleManual)뿐
 *  - 지불·수령 전 과정은 로컬 서명 — 서버 개입 0회, 오프라인 완결
 */
import { useSyncExternalStore } from 'react';
import {
  PendingWalkLedger,
  acceptPayment,
  buildCharge,
  buildPayment,
  buildWalkSegmentProof,
  checkHumanLimits,
  decodeQr,
  mintWalkCoin,
  splitCoin,
  verifyConfirm,
  type ChargeMessage,
  type Coin,
  type ConfirmMessage,
  type PaymentMessage,
  type PendingSnapshot,
  type WalkSample,
  type WalkSampleVerdict,
} from '@shvil/shared';
import type { LiveWalkStatus } from '../walk/corridorEngine';
import { loadOrCreateIdentity, type Identity } from './identity';
import {
  isKnownCoinId,
  loadOwnedCoins,
  loadPendingState,
  openDb,
  saveCoin,
  savePendingState,
  saveReceipt,
  setCoinStatus,
  type CoinOrigin,
  type StoredCoin,
} from './db';

export interface WalletState {
  ready: boolean;
  memberId: string;
  address: string;
  pending: PendingSnapshot;
  coins: StoredCoin[];
  /** 걸어서 생성한 코인 잔액 (dSHV) — 계보상 영구 구분. */
  walkedBalanceDshv: number;
  /** 받은·구매한 코인 잔액 (dSHV). */
  receivedBalanceDshv: number;
  /** 보너스·격려 등 승인서 코인 잔액 (dSHV). */
  bonusBalanceDshv: number;
  liveStatus: LiveWalkStatus | null;
  walkTracking: boolean;
}

const EMPTY_PENDING: PendingSnapshot = {
  pendingDshvEstimate: 0,
  detourPendingByAngel: {},
  distanceM: 0,
  stepCount: 0,
  startedAt: null,
};

function randomId(prefix: string): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** 코인의 뿌리 계보로 표시 구분을 정한다 (분할은 뿌리를 따른다). */
function rootOriginOf(coin: Coin, myMemberId: string): CoinOrigin {
  let root = coin;
  while (root.provenance.kind === 'SPLIT') root = root.provenance.parent;
  if (root.provenance.kind === 'GRANT') return 'BONUS';
  return coin.memberId === myMemberId ? 'WALK_SELF' : 'RECEIVED';
}

class WalletService {
  #listeners = new Set<() => void>();
  #state: WalletState = {
    ready: false,
    memberId: '',
    address: '',
    pending: EMPTY_PENDING,
    coins: [],
    walkedBalanceDshv: 0,
    receivedBalanceDshv: 0,
    bonusBalanceDshv: 0,
    liveStatus: null,
    walkTracking: false,
  };

  #identity: Identity | null = null;
  #ledger: PendingWalkLedger | null = null;
  /** 진행 중인 나가는 지불 (확인 QR 대기). */
  #outgoing: { charge: ChargeMessage; payment: PaymentMessage; spentCoinIds: string[] } | null = null;
  /** 진행 중인 들어오는 청구 (엔젤 수령 테스트용). */
  #incomingCharge: ChargeMessage | null = null;

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getState = (): WalletState => this.#state;

  #set(partial: Partial<WalletState>): void {
    this.#state = { ...this.#state, ...partial };
    for (const fn of this.#listeners) fn();
  }

  get identity(): Identity {
    if (!this.#identity) throw new Error('wallet not initialized');
    return this.#identity;
  }

  async init(): Promise<void> {
    if (this.#state.ready) return;
    await openDb();
    this.#identity = await loadOrCreateIdentity();
    const saved = await loadPendingState();
    const config = { memberId: this.#identity.memberId };
    this.#ledger = saved ? PendingWalkLedger.fromState(config, saved) : new PendingWalkLedger(config);
    await this.#reloadCoins();
    this.#set({
      ready: true,
      memberId: this.#identity.memberId,
      address: this.#identity.address,
      pending: this.#ledger.getPending(),
    });
  }

  async #reloadCoins(): Promise<void> {
    const coins = await loadOwnedCoins();
    let walked = 0;
    let received = 0;
    let bonus = 0;
    for (const c of coins) {
      if (c.origin === 'WALK_SELF') walked += c.coin.amountDshv;
      else if (c.origin === 'BONUS') bonus += c.coin.amountDshv;
      else received += c.coin.amountDshv;
    }
    this.#set({ coins, walkedBalanceDshv: walked, receivedBalanceDshv: received, bonusBalanceDshv: bonus });
  }

  // ── 걷기 파이프라인 ────────────────────────────────────────────

  /** 회랑 엔진이 방출한 창 샘플을 잠정 누적한다 (좌표 없음). */
  recordSample(sample: WalkSample): WalkSampleVerdict {
    const verdict = this.#ledger!.recordSample(sample);
    this.#set({ pending: this.#ledger!.getPending() });
    void savePendingState(this.#ledger!.getState());
    return verdict;
  }

  setLiveStatus(liveStatus: LiveWalkStatus, walkTracking: boolean): void {
    this.#set({ liveStatus, walkTracking });
  }

  // ── 정산 (사용 또는 본인 선언뿐 — 자동 정산 없음) ─────────────

  /** "여기서 정산" — 본인 선언 수동 정산. */
  async settleManual(now: number): Promise<Coin | null> {
    return this.#settle(this.#ledger!.settleManual(now), now);
  }

  async #settleOnSpend(now: number, paidAngelMemberId?: string): Promise<Coin | null> {
    return this.#settle(this.#ledger!.settleOnSpend(now, paidAngelMemberId), now);
  }

  async #settle(draft: ReturnType<PendingWalkLedger['settleManual']>, now: number): Promise<Coin | null> {
    await savePendingState(this.#ledger!.getState());
    if (!draft) {
      this.#set({ pending: this.#ledger!.getPending() });
      return null;
    }
    // TODO(M2/보안): Play Integrity / App Attest 실토큰을 여기서 첨부한다 (결정 대기 3번).
    const proof = buildWalkSegmentProof(draft, this.identity.signer);
    const coin = mintWalkCoin(proof);
    await saveCoin(coin, 'WALK_SELF', now);
    await this.#reloadCoins();
    this.#set({ pending: this.#ledger!.getPending() });
    return coin;
  }

  // ── 지불 (리스트 → 엔젤): QR 왕복 ─────────────────────────────

  /**
   * 청구 QR 스캔 후 지불 생성. 잠정 누적을 이 지불로 정산(사용 시 정산)하고,
   * 부족분은 기존 코인에서 채운다 (필요 시 분할).
   */
  async payCharge(charge: ChargeMessage, now: number): Promise<PaymentMessage> {
    // 1) 사용 시 정산 — 이 엔젤로의 우회 잠정분도 여기서 확정된다.
    await this.#settleOnSpend(now, charge.angelMemberId);

    // 2) 코인 선택 (오래된 것부터) + 필요 시 잔돈 분할
    const owned = [...this.getState().coins];
    const picked: Coin[] = [];
    let total = 0;
    for (const { coin } of owned) {
      if (total >= charge.amountDshv) break;
      picked.push(coin);
      total += coin.amountDshv;
    }
    if (total < charge.amountDshv) {
      throw new Error(`잔액 부족: ${total / 10} SHV < ${charge.amountDshv / 10} SHV`);
    }
    if (total > charge.amountDshv) {
      const last = picked.pop()!;
      const excess = total - charge.amountDshv;
      const needed = last.amountDshv - excess;
      const [pay, change] = splitCoin(last, this.identity.signer, [needed, excess], now);
      await setCoinStatus(last.id, 'SPLIT_CONSUMED');
      const origin = rootOriginOf(last, this.identity.memberId);
      await saveCoin(pay!, origin, now);
      await saveCoin(change!, origin, now);
      picked.push(pay!);
    }

    // 3) 지불 서명 (엔젤 앞 미완결 이전 링크)
    const payment = buildPayment(charge, picked, this.identity.memberId, this.identity.signer, now);
    this.#outgoing = { charge, payment, spentCoinIds: picked.map((c) => c.id) };
    await this.#reloadCoins();
    return payment;
  }

  /** 엔젤의 확인 QR 스캔 → 지불 완결 처리 (코인 제거 + 영수증). */
  async applyConfirm(confirmText: string, now: number): Promise<ConfirmMessage> {
    if (!this.#outgoing) throw new Error('진행 중인 지불이 없습니다');
    const msg = decodeQr(confirmText);
    if (msg.type !== 'shvil/confirm') throw new Error('확인 QR이 아닙니다');
    if (!verifyConfirm(msg, this.#outgoing.charge)) throw new Error('확인 서명이 유효하지 않습니다');
    for (const id of this.#outgoing.spentCoinIds) await setCoinStatus(id, 'SPENT');
    await saveReceipt(msg, this.#outgoing.charge.amountDshv, now);
    this.#outgoing = null;
    await this.#reloadCoins();
    return msg;
  }

  // ── 수령 (M1 왕복 테스트용 최소 구현 — 엔젤 모드 전체는 M2) ──

  buildIncomingCharge(amountDshv: number, serviceType: string | null, now: number): ChargeMessage {
    const charge = buildCharge(
      { chargeId: randomId('chg'), angelMemberId: this.identity.memberId, amountDshv, serviceType, createdAt: now },
      this.identity.signer,
    );
    this.#incomingCharge = charge;
    return charge;
  }

  /** 지불 QR 역스캔 → 로컬 위조 검사 → 확인 서명. 승인이 아니라 밀리초 위조 검사다. */
  async acceptIncomingPayment(paymentText: string, now: number): Promise<ConfirmMessage> {
    if (!this.#incomingCharge) throw new Error('진행 중인 청구가 없습니다');
    const msg = decodeQr(paymentText);
    if (msg.type !== 'shvil/payment') throw new Error('지불 QR이 아닙니다');

    // 이중지불 로컬 차단: 이미 아는 코인 ID는 거부
    for (const coin of msg.coins) {
      if (await isKnownCoinId(coin.id)) throw new Error('이미 수령한 코인입니다 (이중 사용 의심)');
    }
    // 인간 한계 프로파일 검증 (지시서 3장): 같은 생성자의 기존 보유 코인과 합산 대조
    const knownCoins = this.getState().coins.map((c) => c.coin);
    for (const coin of msg.coins) {
      const limits = checkHumanLimits(coin, knownCoins);
      if (!limits.ok) {
        const v = limits.violations[0]!;
        throw new Error(`인간 한계 초과 코인 거부: ${v.date} ${v.totalDshv / 10} SHV (${v.kind})`);
      }
    }

    const result = acceptPayment(this.#incomingCharge, msg, this.identity.signer);
    for (const coin of result.coins) {
      await saveCoin(coin, rootOriginOf(coin, this.identity.memberId), now);
    }
    this.#incomingCharge = null;
    await this.#reloadCoins();
    return result.confirm;
  }
}

export const wallet = new WalletService();

export function useWallet(): WalletState {
  return useSyncExternalStore(wallet.subscribe, wallet.getState);
}
