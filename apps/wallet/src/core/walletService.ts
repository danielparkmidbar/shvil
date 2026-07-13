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
  acknowledgeTransfer,
  buildCharge,
  buildPayment,
  buildWalkSegmentProof,
  checkHumanLimits,
  createTransfer,
  currentOwnerAddress,
  decodeQr,
  mintGrantCoin,
  mintWalkCoin,
  splitCoin,
  verifyCoin,
  verifyConfirm,
  type ChargeMessage,
  type Coin,
  type ConfirmMessage,
  type MembershipCertificate,
  type PaymentMessage,
  type PendingSnapshot,
  type SignedGrant,
  type WalkSample,
  type WalkSampleVerdict,
} from '@shvil/shared';
import type { LiveWalkStatus } from '../walk/corridorEngine';
import { planCoinSelection, type CoinSelectionPlan } from './coinSelection';
import { FLAGGED_CACHE_KEY, findFlaggedProducer, parseFlaggedCache } from './flagged';
import {
  loadOrCreateIdentity,
  persistMemberId,
  saveIntegrityToken,
  saveMembershipCertificate,
  type Identity,
} from './identity';
import {
  isKnownCoinId,
  kvGet,
  kvSet,
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

/** 하나의 앱, 두 모드 — "오늘의 엔젤이 내일의 쉬빌리스트" (지시서 1장). */
export type WalletMode = 'LIST' | 'ANGEL';

const MODE_KEY = 'walletMode.v1';
const SALES_KEY = 'market.sales.v1';
/**
 * 회원 증서 필수화 게이트 (보안 감사 C-2). 기본 false — 점진 전환:
 * 기존 사용자가 아직 증서 없는 코인을 보유하므로, 지금은 증서가 있으면 검증만 하고
 * 필수로 요구하지 않는다. 파일럿 전환 시 이 kv를 'true'로 켜면 증서 없는(또는
 * integrity≠VERIFIED) WALK 코인 수령이 거부된다 (결정 대기 3번 — 필수화 확정).
 */
const REQUIRE_INTEGRITY_KEY = 'requireIntegrity';

/** 내 마켓 판매 기록 (로컬 kv) — 리스팅 → 승인 → 에스크로 → 완료 추적용. */
export interface SaleRecord {
  listingId: number;
  amountDshv: number;
  createdAt: number;
  /**
   * 리스팅 시점에 선택해 둔 코인 ID — 기록일 뿐, 상태는 OWNED 유지.
   * 잠금(ESCROWED)은 승인 후 이전 서명을 제출하는 시점에만 이루어진다.
   */
  reservedCoinIds: string[];
  /** 승인 후 붙는 에스크로 ID. */
  escrowId: number | null;
  /** 에스크로에 이전 서명을 제출해 잠근 코인 ID — COMPLETED 확인 시 SPENT 처리. */
  escrowCoinIds: string[];
  /** COMPLETED 확인·정리(finalizeEscrowSale) 완료 여부. */
  settled: boolean;
}

export interface WalletState {
  ready: boolean;
  memberId: string;
  address: string;
  /** 모드 전환은 토글 한 번 — 지갑·코인·키는 두 모드가 공유한다. */
  mode: WalletMode;
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
    mode: 'LIST',
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
    const savedMode = await kvGet(MODE_KEY);
    this.#set({
      ready: true,
      memberId: this.#identity.memberId,
      address: this.#identity.address,
      mode: savedMode === 'ANGEL' ? 'ANGEL' : 'LIST',
      pending: this.#ledger.getPending(),
    });
  }

  /** 모드 전환 — 토글 한 번. 걷기 추적·지갑 상태는 그대로 유지된다. */
  async setMode(mode: WalletMode): Promise<void> {
    await kvSet(MODE_KEY, mode);
    this.#set({ mode });
  }

  /**
   * 가입 성공 시 서버 발급 회원 번호("SHV-123456")로 갱신.
   * 잠정 원장도 새 번호로 이어받는다 — 이후 정산 코인에는 정식 번호가 새겨진다.
   */
  async updateMemberId(memberId: string): Promise<void> {
    await persistMemberId(memberId);
    this.#identity = { ...this.identity, memberId };
    this.#ledger = PendingWalkLedger.fromState({ memberId }, this.#ledger!.getState());
    await savePendingState(this.#ledger.getState());
    this.#set({ memberId });
  }

  /**
   * 서버 발급 회원 증서를 반영한다 (보안 감사 C-2) — 가입·갱신 시. 증서·무결성
   * 토큰은 SecureStore(기기 결속)에 저장하고, 이후 민팅 증명에 첨부된다.
   */
  async applyMembership(cert: MembershipCertificate, integrityToken?: string): Promise<void> {
    await saveMembershipCertificate(cert);
    if (integrityToken !== undefined) await saveIntegrityToken(integrityToken);
    this.#identity = {
      ...this.identity,
      membership: cert,
      integrityToken: integrityToken ?? this.identity.integrityToken,
    };
  }

  /** 증서 필수화 여부 (kv 게이트, 기본 false — 점진 전환). */
  async #requireIntegrity(): Promise<boolean> {
    return (await kvGet(REQUIRE_INTEGRITY_KEY)) === 'true';
  }

  /**
   * 발행 승인서(SignedGrant)로 코인 민팅 — 엔젤 보너스(등록 20 / 첫 접대 30 SHV,
   * 지시서 2.4)와 클레임 구제·격려 코인(지시서 2.5·2.6)이 같은 경로를 쓴다.
   * 신뢰 발행 키 대조 포함 로컬 검증 후 지갑에 저장한다 (origin: BONUS).
   */
  async mintFromGrant(grant: SignedGrant, trustedIssuerKeys: Record<string, string>, now: number): Promise<Coin> {
    if (grant.recipientPublicKey !== this.identity.signer.publicKeyHex) {
      throw new Error('이 기기 앞으로 발행된 승인서가 아닙니다');
    }
    const coin = mintGrantCoin(grant);
    const verdict = verifyCoin(coin, { trustedIssuerKeys });
    if (!verdict.valid) {
      throw new Error(`승인서 검증 실패: ${verdict.reasons.join(', ')}`);
    }
    if (await isKnownCoinId(coin.id)) {
      throw new Error('이미 이 승인서로 발행된 코인입니다');
    }
    await saveCoin(coin, 'BONUS', now);
    await this.#reloadCoins();
    return coin;
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
    // 회원 증서·무결성 토큰 첨부 (보안 감사 C-2) — 회원 번호↔기기 키 결속을
    // 계보에 각인한다. 증서는 서명 대상에 포함되어 바꿔치기 불가. 미가입·오프라인
    // 가입이면 null이며, 증서 없이도 민팅은 그대로 동작한다 (점진 전환).
    const proof = buildWalkSegmentProof(draft, this.identity.signer, {
      membership: this.identity.membership,
      appIntegrityToken: this.identity.integrityToken,
    });
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
    // 소명 대기 목록 대조 (지시서 3장 5절): 소명 대기 중인 회원이 "생성한" 코인은
    // 수령 보류. 이미 보유한 코인·타인의 거래는 영향받지 않는다 — 새 수령만 막는다.
    const flagged = parseFlaggedCache(await kvGet(FLAGGED_CACHE_KEY));
    const flaggedProducer = findFlaggedProducer(
      msg.coins,
      flagged.map((f) => f.memberId),
    );
    if (flaggedProducer) {
      throw new Error(`생성 회원 ${flaggedProducer}는 소명 대기 중입니다 — 소명 통과 후 수령할 수 있습니다`);
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

    // 회원 증서 검증 (보안 감사 C-2): 캐시된 신뢰 루트로 WALK 코인의 증서를 검증한다.
    // 오프라인 지불 수령 경로이므로 네트워크 없이 캐시만 읽는다. requireIntegrity 게이트가
    // 켜지면 증서 없는(또는 integrity≠VERIFIED) 코인 수령을 거부한다 (기본 off — 점진 전환).
    const { loadCachedTrustedRootKeys } = await import('./directory');
    const trustedRootKeys = await loadCachedTrustedRootKeys();
    const requireIntegrityToken = await this.#requireIntegrity();

    const result = acceptPayment(this.#incomingCharge, msg, this.identity.signer, {
      trustedRootKeys,
      requireIntegrityToken,
      now,
    });
    for (const coin of result.coins) {
      await saveCoin(coin, rootOriginOf(coin, this.identity.memberId), now);
    }
    this.#incomingCharge = null;
    await this.#reloadCoins();
    return result.confirm;
  }

  // ── 마켓 (M3): 리스팅·에스크로 코인 커스터디 (지시서 0-8, 5장 4절) ──
  //
  // 서버의 역할은 에스크로 상태 관리뿐 — SHV 이전 자체는 판매자의 지불 서명
  // (createTransfer)과 구매자의 확인 서명(acknowledgeTransfer)으로 완결된다.
  // 마켓은 온라인 전용 서버 기능이다 (대면 지불과 달리 통신을 전제한다).

  /**
   * directory.ts가 이 모듈의 wallet을 정적 참조하므로, 순환 import를 피해
   * 마켓 경로에서만 지연 로드한다. 마켓은 온라인 전용이라 지연 비용이 없다.
   */
  async #directory(): Promise<typeof import('./directory')> {
    return import('./directory');
  }

  async loadSales(): Promise<SaleRecord[]> {
    const json = await kvGet(SALES_KEY);
    return json ? (JSON.parse(json) as SaleRecord[]) : [];
  }

  async #saveSales(sales: SaleRecord[]): Promise<void> {
    await kvSet(SALES_KEY, JSON.stringify(sales));
  }

  async #updateSale(listingId: number, patch: Partial<SaleRecord>): Promise<void> {
    const sales = await this.loadSales();
    await this.#saveSales(sales.map((s) => (s.listingId === listingId ? { ...s, ...patch } : s)));
  }

  /** 선택 계획 실행 — 필요하면 잔돈 분할 (payCharge의 분할 패턴과 동일). */
  async #executeSelection(plan: CoinSelectionPlan, now: number): Promise<Coin[]> {
    if (!plan.split) return plan.whole;
    const { coin, keepDshv, changeDshv } = plan.split;
    const [keep, change] = splitCoin(coin, this.identity.signer, [keepDshv, changeDshv], now);
    await setCoinStatus(coin.id, 'SPLIT_CONSUMED');
    const origin = rootOriginOf(coin, this.identity.memberId);
    await saveCoin(keep!, origin, now);
    await saveCoin(change!, origin, now);
    return [...plan.whole, keep!];
  }

  /**
   * 마켓 리스팅 (엔젤): 수량만 올린다 — 가격은 정하지 않는다 (무정가).
   * 보유 코인에서 오래된 것부터 선택하고 필요하면 분할해 정확히 맞춘 뒤,
   * 코인 ID를 리스팅과 함께 기록만 한다. 상태는 OWNED 유지 — 리스팅 단계에서는
   * 잠그지 않고, 잠금은 승인 후 이전 서명 제출 시점(submitEscrowCoins)이다.
   */
  async listCoinsForSale(amountDshv: number, now: number): Promise<SaleRecord> {
    if (!Number.isInteger(amountDshv) || amountDshv <= 0) {
      throw new Error('판매 수량이 올바르지 않습니다 (0.1 SHV 단위)');
    }
    // 잔액 검사 겸 선택 가능성 확인 — 부족하면 서버 호출 전에 여기서 던진다.
    planCoinSelection(this.getState().coins.map((c) => c.coin), amountDshv);

    const { directoryApi } = await this.#directory();
    const { listingId } = await directoryApi.createListing(amountDshv);

    // 서버 등록 성공 후 실제 선택·분할 실행 (상태는 OWNED 유지).
    const plan = planCoinSelection(this.getState().coins.map((c) => c.coin), amountDshv);
    const picked = await this.#executeSelection(plan, now);
    await this.#reloadCoins();

    const record: SaleRecord = {
      listingId,
      amountDshv,
      createdAt: now,
      reservedCoinIds: picked.map((c) => c.id),
      escrowId: null,
      escrowCoinIds: [],
      settled: false,
    };
    await this.#saveSales([record, ...(await this.loadSales())]);
    return record;
  }

  /** 가격 제시 승인 후 판매 기록에 에스크로 ID를 연결한다. */
  async attachEscrowToSale(listingId: number, escrowId: number): Promise<void> {
    await this.#updateSale(listingId, { escrowId });
  }

  /**
   * 에스크로 코인 이전 서명 제출 (판매자): 구매자 USDC 입금 확인(DEPOSITED)
   * 후에만. 구매자 앞 미완결 이전(createTransfer)을 만들어 올리고, 해당 코인을
   * ESCROWED로 잠근다. 완결은 구매자의 확인 서명 — 서버는 운반·상태 전이만 한다.
   */
  async submitEscrowCoins(escrowId: number, now: number): Promise<Coin[]> {
    const { directoryApi } = await this.#directory();
    const escrow = await directoryApi.getEscrow(escrowId);
    if (escrow.status !== 'DEPOSITED') {
      throw new Error(`구매자 입금 확인 후에 제출할 수 있습니다 (현재 상태: ${escrow.status})`);
    }

    // 리스팅 때 기록해 둔 코인이 아직 전부 보유 중이면 우선 사용, 아니면 새로 선택.
    const owned = this.getState().coins;
    const sale = (await this.loadSales()).find((s) => s.escrowId === escrowId);
    const reserved = sale
      ? owned.filter((c) => sale.reservedCoinIds.includes(c.coin.id)).map((c) => c.coin)
      : [];
    let picked: Coin[];
    if (reserved.reduce((sum, c) => sum + c.amountDshv, 0) === escrow.amountDshv) {
      picked = reserved;
    } else {
      const plan = planCoinSelection(owned.map((c) => c.coin), escrow.amountDshv);
      picked = await this.#executeSelection(plan, now);
    }

    const transferred = picked.map((coin) =>
      createTransfer(coin, this.identity.signer, escrow.buyerDevicePublicKey, now),
    );
    await directoryApi.submitEscrowCoins(escrowId, transferred);

    // 제출 성공 — 이 코인들은 이제 에스크로에 잠긴다 (잔액에서 제외).
    for (const coin of picked) await setCoinStatus(coin.id, 'ESCROWED');
    if (sale) await this.#updateSale(sale.listingId, { escrowCoinIds: picked.map((c) => c.id) });
    await this.#reloadCoins();
    return transferred;
  }

  /**
   * 판매 마무리 (판매자): 에스크로가 COMPLETED로 확인되면 ESCROWED 코인을
   * SPENT로 정리한다. USDC 방출은 ack 시점에 서버 에스크로가 이미 수행했다.
   * COMPLETED가 아니면 null — 자동으로 어떤 것도 정산하지 않는다.
   */
  async finalizeEscrowSale(escrowId: number): Promise<{ releasedUsdcMicro: number; feeUsdcMicro: number } | null> {
    const { directoryApi } = await this.#directory();
    const escrow = await directoryApi.getEscrow(escrowId);
    if (escrow.status !== 'COMPLETED') return null;
    const sale = (await this.loadSales()).find((s) => s.escrowId === escrowId);
    if (sale && !sale.settled) {
      for (const id of sale.escrowCoinIds) await setCoinStatus(id, 'SPENT');
      await this.#updateSale(sale.listingId, { settled: true });
      await this.#reloadCoins();
    }
    return {
      releasedUsdcMicro: escrow.totalUsdcMicro - escrow.feeUsdcMicro,
      feeUsdcMicro: escrow.feeUsdcMicro,
    };
  }

  /**
   * 구매 수령 확인 (구매자): 판매자가 제출한 코인을 로컬에서 위조 검사
   * (계보 서명 + 신뢰 발행 키 + 인간 한계 + 이중 수령)한 뒤 확인 서명으로
   * 완결하고, ack 제출로 USDC 방출을 트리거한다. 코인은 'RECEIVED'로 저장된다
   * — 구매 코인은 계보상 걸음 코인과 영구 구분된다 (확정 파라미터).
   */
  async ackEscrowPurchase(
    escrowId: number,
    now: number,
  ): Promise<{ coins: Coin[]; amountDshv: number; releasedUsdcMicro: number; feeUsdcMicro: number }> {
    const { directoryApi, getTrustedIssuerKeys, getTrustedRootKeys } = await this.#directory();
    const escrow = await directoryApi.getEscrow(escrowId);
    if (escrow.status !== 'COINS_SUBMITTED' || !escrow.coins || escrow.coins.length === 0) {
      throw new Error(`판매자의 코인 제출을 기다리는 중입니다 (현재 상태: ${escrow.status})`);
    }

    // 마켓은 온라인 경로 — 신뢰 발행 키·회원 증서 루트를 함께 갱신해 검증한다 (C-2).
    const trustedIssuerKeys = await getTrustedIssuerKeys();
    const trustedRootKeys = await getTrustedRootKeys();
    const requireIntegrityToken = await this.#requireIntegrity();
    const verifyOpts = { trustedIssuerKeys, trustedRootKeys, requireIntegrityToken, now };
    const knownCoins = this.getState().coins.map((c) => c.coin);
    const acked: Coin[] = [];
    for (const coin of escrow.coins) {
      // 이중 수령 로컬 차단 — 이미 아는 코인 ID는 거부.
      if (await isKnownCoinId(coin.id)) throw new Error('이미 수령한 코인입니다 (이중 수령 차단)');
      // 위조 검사: 미완결 마지막 링크(나에게 오는 지불 서명)를 허용한 계보 검증.
      const pending = verifyCoin(coin, { ...verifyOpts, allowPendingLastLink: true });
      if (!pending.valid) throw new Error(`코인 검증 실패: ${pending.reasons.join(', ')}`);
      // 인간 한계 프로파일 검증 (지시서 3장) — 수신 시 로컬 대조.
      const limits = checkHumanLimits(coin, knownCoins);
      if (!limits.ok) {
        const v = limits.violations[0]!;
        throw new Error(`인간 한계 초과 코인 거부: ${v.date} ${v.totalDshv / 10} SHV (${v.kind})`);
      }
      // 확인 서명으로 완결 → 완결 상태 재검증.
      const done = acknowledgeTransfer(coin, this.identity.signer);
      const final = verifyCoin(done, verifyOpts);
      if (!final.valid || currentOwnerAddress(done) !== this.identity.address) {
        throw new Error(`완결 검증 실패: ${final.reasons.join(', ')}`);
      }
      acked.push(done);
    }

    const res = await directoryApi.ackEscrow(escrowId, acked);
    // 구매 코인 — 계보상 영구 구분 ('RECEIVED', 걸음 코인으로 둔갑 불가).
    for (const coin of acked) await saveCoin(coin, 'RECEIVED', now);
    await this.#reloadCoins();
    return {
      coins: acked,
      amountDshv: escrow.amountDshv,
      releasedUsdcMicro: res.releasedUsdcMicro,
      feeUsdcMicro: res.feeUsdcMicro,
    };
  }
}

export const wallet = new WalletService();

export function useWallet(): WalletState {
  return useSyncExternalStore(wallet.subscribe, wallet.getState);
}
