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
  acknowledgeTransfer,
  buildCharge,
  buildPayment,
  buildWalkSegmentProof,
  certificateCoversMint,
  checkHumanLimits,
  createTransfer,
  currentOwnerAddress,
  decodeQr,
  decryptBackup,
  encryptBackup,
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
  type TravelMode,
  type WalkSample,
  type WalkSampleVerdict,
  type WalletBackup,
} from '@shvil/shared';
import type { LiveWalkStatus } from '../walk/corridorEngine';
import type { SpotDepositResult } from './api';
import { planCoinSelection, type CoinSelectionPlan } from './coinSelection';
import { planPayment, type PaymentPlan } from './paymentPlan';
import { FLAGGED_CACHE_KEY, parseFlaggedCache } from './flagged';
import { acceptReviewedPayment, buildReceiveReview, type ReceiveReview } from './receiveReview';
import { loadRulePacks } from './rulePackStore';
import {
  isProvisionalMemberId,
  loadOrCreateIdentity,
  persistMemberId,
  restoreFromMnemonic,
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
  restoreCoins,
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
/** 이동 수단 선언 (M11) — 지갑 로컬 설정. 서버 불필요. 기본 WALK. */
const TRAVEL_MODE_KEY = 'travelMode.v1';
const SALES_KEY = 'market.sales.v1';
/**
 * 회원 증서 필수화 게이트 (보안 감사 C-2). 기본 false — 점진 전환:
 * 기존 사용자가 아직 증서 없는 코인을 보유하므로, 지금은 증서가 있으면 검증만 하고
 * 필수로 요구하지 않는다. 파일럿 전환 시 이 kv를 'true'로 켜면 증서 없는(또는
 * integrity≠VERIFIED) WALK 코인 수령이 거부된다 (결정 대기 3번 — 필수화 확정).
 */
const REQUIRE_INTEGRITY_KEY = 'requireIntegrity';
/** 수령 빠른 길 (제8조) — 기본 켜짐. 끄면 모든 수령이 검토 화면에서 멈춘다. */
const RECEIVE_FAST_PATH_KEY = 'receiveFastPath.v1';

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
  /** 이동 수단 선언 (M11) — 기본 WALK. 자전거면 요율 ×0.5 + 자전거 속도 필터. */
  travelMode: TravelMode;
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
  /**
   * ★걷기 시작이 실패한 사유 (2026-07-27). 예전에는 `console.warn`으로만 흘려서
   * 위치 권한을 거부한 사용자의 화면에는 **아무 일도 일어나지 않았다** — 버튼 라벨도
   * 그대로였다. 실패를 화면에 내보내지 않는 것은 제3조 위반이다.
   */
  walkStartError: string | null;
  /**
   * ★만보기(걸음 센서)를 쓸 수 있는가. null = 아직 모름(걷기 시작 전).
   * false면 걸어도 창이 전부 NO_STEPS로 기각되어 **하루 걷고 0 SHV**가 된다.
   * 그 사실이 화면 어디에도 없었다.
   */
  pedometerAvailable: boolean | null;
  /**
   * ★수령 빠른 길 (제8조). true(기본)면 검토에서 아무것도 걸리지 않은 평범한 지불은
   * 확인 화면 없이 바로 완결한다. false면 언제나 검토 화면에서 멈춘다.
   * 어느 쪽이든 **결정은 엔젤의 것**이다 — 이 스위치 자체가 그 결정이다(제9조).
   */
  receiveFastPath: boolean;
  /**
   * ★마지막 정산에서 회원 증서를 붙이지 못했는가 (2026-07-26).
   *
   * 증서가 이 정산 시각을 덮지 못하면 지갑이 스스로 증서를 떼고 민팅한다 — 붙이면
   * 그 코인이 태어나자마자 거부되기 때문이다(#settle 주석 참조). 그런데 이 일이
   * **아무 말 없이** 일어나고 있었다. 증서 없는 코인은 필수화 스위치를 켠 상대(운영
   * 서버의 신뢰 뱃지·스팟 예치)에게 받아들여지지 않으므로, 사용자는 자기 코인이 왜
   * 반쪽인지 알 길이 없었다. 화면이 이 값을 보고 "온라인에 한 번 연결하십시오"를
   * 안내할 수 있게 상태로 내보낸다(제3조 — 안 한 일을 한 것처럼 두지 않는다).
   */
  lastMintMissedCertificate: boolean;
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
    travelMode: 'WALK',
    pending: EMPTY_PENDING,
    coins: [],
    walkedBalanceDshv: 0,
    receivedBalanceDshv: 0,
    bonusBalanceDshv: 0,
    liveStatus: null,
    walkTracking: false,
    walkStartError: null,
    pedometerAvailable: null,
    receiveFastPath: true,
    lastMintMissedCertificate: false,
  };

  #identity: Identity | null = null;
  #ledger: PendingWalkLedger | null = null;
  /** 진행 중인 나가는 지불 (확인 QR 대기). */
  #outgoing: { charge: ChargeMessage; payment: PaymentMessage; spentCoinIds: string[] } | null = null;
  /** 진행 중인 들어오는 청구 (엔젤 수령 테스트용). */
  #incomingCharge: ChargeMessage | null = null;
  /**
   * ★검토는 끝났지만 **아직 아무것도 서명하지 않은** 들어오는 지불 (제9조).
   * 여기 머무는 동안 지불자의 코인은 그의 지갑에서 OWNED 그대로다 — 거부해도 죽지 않는다.
   */
  #incomingReview: { charge: ChargeMessage; payment: PaymentMessage; review: ReceiveReview } | null = null;
  #lastPaymentPlan: PaymentPlan | null = null;

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
    const savedTravelMode = await kvGet(TRAVEL_MODE_KEY);
    const savedFastPath = await kvGet(RECEIVE_FAST_PATH_KEY);
    // 규칙 팩을 미리 읽어 둔다 — 수령은 광야에서 일어나므로 그때 kv를 기다리지 않는다.
    await loadRulePacks().catch(() => ({ packs: [], errors: [] }));
    this.#set({
      ready: true,
      memberId: this.#identity.memberId,
      address: this.#identity.address,
      mode: savedMode === 'ANGEL' ? 'ANGEL' : 'LIST',
      travelMode: savedTravelMode === 'BIKE' ? 'BIKE' : 'WALK',
      receiveFastPath: savedFastPath !== 'false',
      pending: this.#ledger.getPending(),
    });
  }

  /** 수령 빠른 길 on/off — 엔젤이 스스로 정하는 검사 강도(제9조). */
  async setReceiveFastPath(on: boolean): Promise<void> {
    await kvSet(RECEIVE_FAST_PATH_KEY, on ? 'true' : 'false');
    this.#set({ receiveFastPath: on });
  }

  /** 모드 전환 — 토글 한 번. 걷기 추적·지갑 상태는 그대로 유지된다. */
  async setMode(mode: WalletMode): Promise<void> {
    await kvSet(MODE_KEY, mode);
    this.#set({ mode });
  }

  /**
   * 이동 수단 선언 전환 (M11) — 사용자가 스스로 도보/자전거를 고른다(감시 아님).
   * 로컬 설정일 뿐 서버로 가지 않는다. 전환은 이후 걷기 창부터 새 요율로 반영된다
   * ("새 구간부터" — 이미 누적된 잠정분은 그 시점 요율을 유지). 기본 WALK.
   */
  async setTravelMode(travelMode: TravelMode): Promise<void> {
    await kvSet(TRAVEL_MODE_KEY, travelMode);
    this.#set({ travelMode });
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

  // ── 니모닉 백업·복구 (지시서 2.1·2.3, 보안 감사 L-2) ─────────────

  /**
   * 확정 코인(OWNED)을 니모닉 파생 백업 키로 암호화해 서버에 업로드한다.
   * 잠정 누적은 백업하지 않는다(지시서: 니모닉 백업은 확정 코인만). 레거시 지갑
   * (니모닉 없음)·미가입이면 skip. 온라인 전용·실패 무해.
   */
  async backupWallet(now: number): Promise<boolean> {
    const backupKeyHex = this.identity.backupKeyHex;
    if (!backupKeyHex || isProvisionalMemberId(this.identity.memberId)) return false;
    const owned = this.getState().coins.filter((c) => c.status === 'OWNED');
    if (owned.length === 0) return false;
    const backup: WalletBackup = {
      v: 1,
      memberId: this.identity.memberId,
      coins: owned.map((c) => c.coin),
      createdAt: now,
    };
    // origin은 뿌리 계보로 복원 시 재판정하므로 blob에 별도 저장 불필요.
    const { directoryApi } = await import('./directory');
    await directoryApi.uploadBackup(encryptBackup(backup, backupKeyHex));
    return true;
  }

  /**
   * 복구 문구로 새 폰에서 지갑을 되살린다: 니모닉 → 키 복원 → 서버 백업 blob 조회 →
   * 복호화 → 확정 코인 복원 → 회원 번호 복원. 반환: 복원된 코인 수.
   */
  async restoreWallet(mnemonic: string, now: number): Promise<number> {
    const { backupKeyHex, devicePublicKey } = await restoreFromMnemonic(mnemonic);
    void devicePublicKey;
    // 니모닉을 진실의 원천으로 재초기화 (레거시 랜덤 키는 restoreFromMnemonic이 제거).
    this.#identity = await loadOrCreateIdentity();

    const { directoryApi } = await import('./directory');
    const { blob } = await directoryApi.fetchBackup(this.identity.signer);
    const backup = decryptBackup(blob, backupKeyHex);

    // 확정 코인 복원 — 뿌리 계보로 origin 재판정. 잠정 누적은 백업에 없다.
    const origins: Record<string, CoinOrigin> = {};
    for (const coin of backup.coins) origins[coin.id] = rootOriginOf(coin, backup.memberId);
    const restored = await restoreCoins(backup.coins, origins, now);

    // 회원 번호 복원 (백업에 담긴 정식 번호로).
    if (!isProvisionalMemberId(backup.memberId)) await this.updateMemberId(backup.memberId);
    await this.#reloadCoins();
    return restored;
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

  /**
   * 회랑 엔진이 방출한 창 샘플을 잠정 누적한다 (좌표 없음).
   * 회랑 엔진은 이동 수단을 모르므로, 현재 선언된 이동 수단(travelMode)을 여기서
   * 창에 각인해 원장에 넘긴다 — 자전거면 요율 ×0.5 + 자전거 속도 필터가 적용된다.
   * 창이 이미 mode를 지정했다면 그대로 존중한다(테스트·미래 확장 대비).
   */
  recordSample(sample: WalkSample): WalkSampleVerdict {
    const stamped: WalkSample = sample.mode ? sample : { ...sample, mode: this.#state.travelMode };
    const verdict = this.#ledger!.recordSample(stamped);
    this.#set({ pending: this.#ledger!.getPending() });
    void savePendingState(this.#ledger!.getState());
    return verdict;
  }

  setLiveStatus(liveStatus: LiveWalkStatus, walkTracking: boolean): void {
    this.#set({ liveStatus, walkTracking });
  }

  /**
   * ★걷기 추적 상태를 화면에 그대로 내보낸다 (2026-07-27).
   * 시작 실패·만보기 부재는 조용히 넘어가면 안 되는 것들이다 — 사용자는 하루를 걷고
   * 나서야 0 SHV를 발견하게 된다(제3조).
   */
  setWalkRuntime(partial: {
    walkTracking?: boolean;
    walkStartError?: string | null;
    pedometerAvailable?: boolean | null;
  }): void {
    this.#set(partial);
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
    //
    // ★2026-07-26: 첨부 전에 "이 증서가 이 정산 시각을 덮는가"를 묻는다.
    //   덮지 못하는 증서를 붙이면 그 코인은 `MEMBERSHIP_OUT_OF_WINDOW`로
    //   **태어나자마자 수령 거부**된다 — 넉 달 넘게 오프라인이던 종주자가 정확히
    //   그렇게 된다(증서 갱신은 온라인 전용). 붙이지 않으면 "증서 없는 코인"이 되어
    //   최소한 완전히 죽지는 않는다. 0층 불변: 걷기와 정산 자체는 그대로 된다.
    const covers =
      this.identity.membership !== null && certificateCoversMint(this.identity.membership, draft.settledAt);
    const membership = covers ? this.identity.membership : null;
    const proof = buildWalkSegmentProof(draft, this.identity.signer, {
      membership,
      appIntegrityToken: this.identity.integrityToken,
    });
    const coin = mintWalkCoin(proof);
    await saveCoin(coin, 'WALK_SELF', now);
    await this.#reloadCoins();
    // ★증서를 갖고 있는데도 못 붙였다면 조용히 넘기지 않는다 — 화면이 안내할 수 있게
    //   상태로 내보낸다. (증서가 아예 없는 미가입 상태는 여기 해당하지 않는다.)
    this.#set({
      pending: this.#ledger!.getPending(),
      lastMintMissedCertificate: this.identity.membership !== null && !covers,
    });
    return coin;
  }

  // ── 지불 (리스트 → 엔젤): QR 왕복 ─────────────────────────────

  /**
   * 청구 QR 스캔 후 지불 생성. 잠정 누적을 이 지불로 정산(사용 시 정산)하고,
   * 부족분은 기존 코인에서 채운다 (필요 시 분할).
   *
   * ★순서가 중요하다: **재 보고 나서 자른다.** 예전에는 먼저 분할을 DB에 커밋한 뒤
   * 화면이 QR을 그려 보고 "용량 초과"를 띄웠는데, 분할은 되돌릴 수 없고 코인 병합
   * 기능도 없어서 **재시도할수록 코인이 잘게 부서졌다.** 지금은 후보를 전부 만들어
   * 재 본 뒤, 고른 하나만 커밋한다. 실패해도 지갑은 그대로다.
   */
  async payCharge(charge: ChargeMessage, now: number): Promise<PaymentMessage> {
    // 1) 사용 시 정산 — 이 엔젤로의 우회 잠정분도 여기서 확정된다.
    await this.#settleOnSpend(now, charge.angelMemberId);

    // 2) 계획 (서명은 하되 저장하지 않는다). 잔액이 모자라면 여기서 던진다.
    const plan = planPayment({
      owned: this.getState().coins.map((c) => c.coin),
      charge,
      payerMemberId: this.identity.memberId,
      signer: this.identity.signer,
      now,
    });

    // 3) 고른 계획만 커밋한다.
    if (plan.split) {
      const { parent, pay, change } = plan.split;
      await setCoinStatus(parent.id, 'SPLIT_CONSUMED');
      const origin = rootOriginOf(parent, this.identity.memberId);
      await saveCoin(pay, origin, now);
      await saveCoin(change, origin, now);
    }

    this.#outgoing = { charge, payment: plan.payment, spentCoinIds: plan.coins.map((c) => c.id) };
    this.#lastPaymentPlan = plan;
    await this.#reloadCoins();
    return plan.payment;
  }

  /** 방금 만든 지불의 계획 (화면이 QR 장수·선택 근거를 보여 주는 데 쓴다). */
  get lastPaymentPlan(): PaymentPlan | null {
    return this.#lastPaymentPlan;
  }

  /**
   * 아직 완결되지 않은 내 지불 (화면 복원용).
   *
   * ★거래 탭의 지불/수령 세그먼트는 조건부 렌더라, 세그먼트를 한 번 누르면 PayScreen이
   * 언마운트되고 화면 단계가 초기화된다. 그때 이 값이 없으면 사람은 "지불이 사라졌다"고
   * 느끼고 **처음부터 다시 낸다** — 그런데 엔젤 쪽은 이미 확인 서명을 만들었을 수 있다.
   * 화면이 이 값을 보고 제자리로 돌아오게 해서 그 갈림을 줄인다.
   * (앱을 완전히 껐다 켜면 메모리 전용이라 사라진다 — 남는 위험으로 문서에 적어 두었다.)
   */
  get outgoingPayment(): { charge: ChargeMessage; payment: PaymentMessage } | null {
    return this.#outgoing ? { charge: this.#outgoing.charge, payment: this.#outgoing.payment } : null;
  }

  /** 지불 제시를 그만둔다 — 확인 서명을 받지 않았으므로 코인은 그대로 남는다. */
  cancelOutgoingPayment(): void {
    this.#outgoing = null;
    this.#lastPaymentPlan = null;
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

  /**
   * ★1단계 (검증): 지불 QR 역스캔 → 로컬 검사 → **리포트만** 만든다.
   *
   * 여기서는 아무것도 서명하지 않고 아무것도 저장하지 않는다. 그래서 이 시점에
   * 엔젤이 등을 돌려도 지불자의 코인은 그의 지갑에 그대로 살아 있다 —
   * `createTransfer`가 만든 서명은 지불 QR 안의 **사본**에만 붙어 있고, 지불자의 DB
   * 원본은 손대지 않았기 때문이다. 그것이 "거부해도 코인이 죽지 않는다"의 근거다.
   *
   * 검사는 승인이 아니다 — 밀리초 단위 로컬 위조 검사이고, 결과를 보고 결정하는 것은
   * 사람이다(헌법 제9조).
   */
  async reviewIncomingPayment(paymentText: string, now: number): Promise<ReceiveReview> {
    if (!this.#incomingCharge) throw new Error('진행 중인 청구가 없습니다');
    const msg = decodeQr(paymentText);
    if (msg.type !== 'shvil/payment') throw new Error('지불 QR이 아닙니다');

    // 이중 수령 대조 — 이미 아는 코인 ID.
    const knownCoinIds = new Set<string>();
    for (const coin of msg.coins) {
      if (await isKnownCoinId(coin.id)) knownCoinIds.add(coin.id);
    }
    // 소명 대기 목록 (지시서 3장 5절): 소명 대기 중인 회원이 "생성한" 코인.
    // ★이제 자동 거절이 아니라 **엔젤에게 보여 주고 결정하게 한다**(제9조).
    //   이미 보유한 코인·타인의 거래는 여전히 영향받지 않는다.
    const flagged = parseFlaggedCache(await kvGet(FLAGGED_CACHE_KEY));

    // 회원 증서 검증 (보안 감사 C-2): 캐시된 신뢰 루트로 WALK 코인의 증서를 검증한다.
    // 오프라인 지불 수령 경로이므로 네트워크 없이 캐시만 읽는다.
    const { loadCachedTrustedRootKeys, loadCachedTrustedIssuerKeys } = await import('./directory');
    const trustedRootKeys = await loadCachedTrustedRootKeys();
    // ★발행 키 캐시도 넘긴다: 넘기지 않으면 verifyCoin이 GRANT 계보를 무조건
    //   UNTRUSTED_ISSUER로 거부해, 엔젤 보너스·보물 코인을 대면으로 받을 수 없었다.
    const trustedIssuerKeys = await loadCachedTrustedIssuerKeys();
    const requireIntegrityToken = await this.#requireIntegrity();
    const { packs } = await loadRulePacks();

    const review = buildReceiveReview({
      charge: this.#incomingCharge,
      payment: msg,
      angelAddress: this.identity.address,
      knownCoinIds,
      flaggedMemberIds: flagged.map((f) => f.memberId),
      knownCoins: this.getState().coins.map((c) => c.coin),
      trustedRootKeys,
      trustedIssuerKeys,
      requireIntegrityToken,
      rulePacks: packs,
      now,
    });
    this.#incomingReview = { charge: this.#incomingCharge, payment: msg, review };
    return review;
  }

  /** 검토 중인 지불 (화면 복원용). */
  get pendingReview(): ReceiveReview | null {
    return this.#incomingReview?.review ?? null;
  }

  /**
   * ★2단계 (확정): 엔젤이 "받는다"를 고른 뒤에만 확인 서명을 만들고 저장한다.
   * 수령을 막는 발견(BLOCK)이 하나라도 있으면 여기까지 오지 못한다.
   */
  async acceptReviewedPayment(now: number): Promise<ConfirmMessage> {
    const pending = this.#incomingReview;
    if (!pending) throw new Error('검토 중인 지불이 없습니다');
    // BLOCK 검사와 "검토한 그 지불인가" 대조는 acceptReviewedPayment 안에 있다 —
    // 호출부의 관습이 아니라 함수 자신이 지키게 해 두었다.
    const { coins, confirm } = acceptReviewedPayment(
      pending.review,
      pending.charge,
      pending.payment,
      this.identity.signer,
    );
    for (const coin of coins) {
      await saveCoin(coin, rootOriginOf(coin, this.identity.memberId), now);
    }
    this.#incomingCharge = null;
    this.#incomingReview = null;
    await this.#reloadCoins();
    return confirm;
  }

  /**
   * ★2단계 (거부): 엔젤이 "안 받겠다"를 골랐다.
   *
   * 아무것도 서명하지 않고 아무것도 저장하지 않으므로 **지불자의 코인은 그대로 산다.**
   * 청구는 유지한다 — 같은 자리에서 다른 코인으로 다시 받을 수 있어야 한다.
   */
  declineReviewedPayment(): void {
    this.#incomingReview = null;
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

  // ── 스팟 보물 예치 (M12): 자기 코인을 보물 리저브로 소각(재배포) ──
  //
  // 사업자는 발행 주체가 아니다 — 마켓에서 구매/생성한 자기 코인을 리저브로 소각한
  // 만큼만 서버가 재배포한다(총량 보존). 무기명 베어러가 아니라 서버 회계다(M10 폐기).
  // 소각 = 리저브 앞 미완결 이전(createTransfer): 리저브는 절대 확인하지 않으므로
  // 코인은 리저브에 영구 봉인된다. 대면 지불(payCharge)과 같은 로컬 서명 경로다.

  /**
   * 스팟 보물 예치 (사업자) — 오래된 것부터 선택하고 필요하면 분할해 amountDshv를
   * 정확히 맞춘 뒤, 리저브 앞 이전(소각)을 만들어 서버에 제출한다. 서버가 소각을
   * 검증하고 동량을 예치 잔고로 등록하면(발행이 아니라 재배포), 그 코인들을 SPENT로
   * 정리한다(지갑에서 빠짐). 서버 제출 실패 시 분할 잔돈은 남고 코인은 소각되지 않는다.
   */
  async depositToSpot(
    spotId: string,
    reservePublicKey: string,
    amountDshv: number,
    now: number,
  ): Promise<SpotDepositResult> {
    if (!Number.isInteger(amountDshv) || amountDshv <= 0) {
      throw new Error('예치 수량이 올바르지 않습니다 (0.1 SHV 단위의 양수)');
    }
    // 잔액 검사 겸 선택 가능성 확인 — 부족하면 서버 호출 전에 여기서 던진다.
    planCoinSelection(this.getState().coins.map((c) => c.coin), amountDshv);

    const { directoryApi } = await this.#directory();
    // 선택·분할 실행 후 리저브 앞 미완결 이전(소각) 생성.
    const plan = planCoinSelection(this.getState().coins.map((c) => c.coin), amountDshv);
    const picked = await this.#executeSelection(plan, now);
    const burned = picked.map((coin) => createTransfer(coin, this.identity.signer, reservePublicKey, now));

    const result = await directoryApi.depositSpot(spotId, burned);
    // 소각 확정 — 이 코인들은 리저브로 넘어가 지갑에서 사라진다(영구 봉인).
    for (const coin of picked) await setCoinStatus(coin.id, 'SPENT');
    await this.#reloadCoins();
    return result;
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
