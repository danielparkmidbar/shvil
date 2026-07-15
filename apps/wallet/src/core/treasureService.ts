/**
 * 보물 마이닝 서비스 (M9) — 존 진입 감지 · 챌린지 세션 · 획득 청구의 오케스트레이션.
 *
 * 제1원칙 (몸인증_보물마이닝_설계 0장): 보물이 없으면 걷기 화면은 지금과 완전히
 * 동일해야 한다. 이 서비스는 walkService의 라이브 센서 흐름에 얹힌 선택 계층이며,
 * 모든 실패는 무해하다 — 걷기·코인 생성에 어떤 영향도 주지 않는다.
 *
 * 위치 비저장: 존 진입 판정과 이동 측정은 휘발성 경로(onFix → TreasureSession의
 * # private 버퍼)에서만 이루어진다. 구독자에게 노출되는 것은 거리(m)·걸음 수·
 * 판정 상태 같은 파생 지표뿐이고, 디스크(kv)에 남는 것은 획득한 보물 ID와
 * 대기 중인 청구(treasureId + 성공 요약 해시)뿐이다.
 *
 * 서버 왕복은 획득 시 1회 (POST /treasures/claim — 수량 한정 발행의 회계).
 * 오프라인이면 큐(kv)에 저장했다가 통신 복구 시 자동 청구한다.
 */
import { useSyncExternalStore } from 'react';
import { ApiError, type TreasureListEntry } from './api';
import { kvGet, kvSet } from './db';
import { wallet } from './walletService';
import {
  TreasureSession,
  detectNearbyTreasure,
  type NearbyTreasure,
  type TreasureFix,
  type TreasureSessionStatus,
} from '../walk/treasureSession';

const CLAIMED_IDS_KEY = 'treasure.claimedIds.v1';
const PENDING_CLAIMS_KEY = 'treasure.pendingClaims.v1';

/** 오프라인 큐 항목 — 성공 요약 해시뿐, 이동 원자료 없음. */
interface PendingClaim {
  treasureId: string;
  transcriptHash: string;
  amountDshv: number;
}

/** 획득 결과 피드백 (화면 표시용). */
export interface TreasureResult {
  treasureId: string;
  amountDshv: number;
  /** 승인서를 받아 코인 민팅까지 끝났는가. */
  minted: boolean;
  /** 통신 불가로 큐에 저장 — 통신 복구 시 자동 청구된다. */
  queued: boolean;
  /** 무보상 인증 미션 (구간 인증 스탬프). */
  stamp: boolean;
}

export interface TreasureState {
  /** 존 근접 보물 (거리만 — 좌표 없음). 없으면 null → 걷기 화면은 기존과 동일. */
  nearby: NearbyTreasure | null;
  /** 진행 중(또는 방금 끝난) 챌린지 세션 상태. */
  session: TreasureSessionStatus | null;
  /** 최근 획득 결과. */
  lastResult: TreasureResult | null;
}

const EMPTY: TreasureState = { nearby: null, session: null, lastResult: null };

class TreasureService {
  #listeners = new Set<() => void>();
  #state: TreasureState = EMPTY;

  /** 캐시에서 올린 지역 보물 명세 (공개 지도 데이터 — 사용자 좌표 아님). */
  #treasures: TreasureListEntry[] = [];
  #claimedIds = new Set<string>();
  #session: TreasureSession | null = null;
  #sessionSpec: TreasureListEntry | null = null;
  #mockDetected = false;
  #watching = false;
  #finalizing = false;

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getState = (): TreasureState => this.#state;

  #set(partial: Partial<TreasureState>): void {
    this.#state = { ...this.#state, ...partial };
    for (const fn of this.#listeners) fn();
  }

  /** 걷기 추적 시작 시 호출 — 캐시 로드 + (기회적) 서버 갱신·대기 청구 처리. */
  async startWatching(): Promise<void> {
    this.#watching = true;
    this.#mockDetected = false;
    try {
      const { loadCachedTreasures, syncTreasures } = await import('./directory');
      // 서버 갱신은 기회적 — 실패해도 캐시로 동작한다 (오프라인 우선).
      await syncTreasures().catch(() => {});
      this.#treasures = await loadCachedTreasures();
      this.#claimedIds = new Set(JSON.parse((await kvGet(CLAIMED_IDS_KEY)) ?? '[]') as string[]);
      void this.flushPendingClaims().catch(() => {});
    } catch {
      this.#treasures = [];
    }
  }

  /** 걷기 추적 종료 — 휘발 상태 전부 폐기. */
  stopWatching(): void {
    this.#watching = false;
    this.#session = null;
    this.#sessionSpec = null;
    this.#set({ nearby: null, session: null });
  }

  /**
   * walkService의 위치 콜백에서 호출된다 (휘발성 경로). 픽스는 여기서 비교에만
   * 쓰이고 저장되지 않는다. 보물이 근처에 없으면 아무 일도 일어나지 않는다.
   */
  onFix(fix: TreasureFix): void {
    if (!this.#watching) return;
    if (fix.mocked) {
      // mock location — 세션 차단 + 배너 숨김 (기존 mockDetected 패턴).
      this.#mockDetected = true;
      this.#session?.addFix(fix);
      this.#set({ nearby: null, session: this.#session?.getStatus() ?? null });
      return;
    }
    this.#mockDetected = false;
    if (this.#session) {
      this.#session.addFix(fix);
      this.#set({ session: this.#session.getStatus() });
      return;
    }
    if (this.#treasures.length === 0) return; // 보물 없음 — 0층 그대로
    const nearby = detectNearbyTreasure(fix, this.#treasures, this.#claimedIds, Date.now());
    const prev = this.#state.nearby;
    if (nearby?.treasureId !== prev?.treasureId || nearby?.distanceM !== prev?.distanceM) {
      this.#set({ nearby });
    }
  }

  /** walkService의 만보기 콜백에서 호출된다. 세션 중에만 의미가 있다. */
  onSteps(delta: number): void {
    if (!this.#session) return;
    this.#session.addSteps(delta);
    const status = this.#session.getStatus();
    this.#set({ session: status });
    if (status.state === 'SUCCESS') void this.#finalize();
  }

  /** 근접 배너에서 "도전" — 챌린지 세션 시작. mock 감지 상태면 시작하지 않는다. */
  startChallenge(): boolean {
    const nearby = this.#state.nearby;
    if (!nearby || this.#mockDetected || this.#session) return false;
    const spec = this.#treasures.find((t) => t.treasureId === nearby.treasureId);
    if (!spec) return false;
    this.#sessionSpec = spec;
    this.#session = new TreasureSession(spec);
    this.#set({ session: this.#session.getStatus(), lastResult: null });
    return true;
  }

  /** 세션 닫기 (취소·실패 확인·결과 확인 공용). */
  dismissChallenge(): void {
    this.#session = null;
    this.#sessionSpec = null;
    this.#set({ session: null });
  }

  /** 결과 배너 닫기. */
  dismissResult(): void {
    this.#set({ lastResult: null });
  }

  /** 성공 세션 마무리 — 로컬 획득 확정 + 서버 청구 1회 (오프라인이면 큐). */
  async #finalize(): Promise<void> {
    if (this.#finalizing || !this.#session || !this.#sessionSpec) return;
    this.#finalizing = true;
    const spec = this.#sessionSpec;
    try {
      const transcriptHash = this.#session.transcriptHash(wallet.identity.memberId);
      // 같은 보물의 배너 재등장 방지 — 청구 성패와 무관하게 로컬로 획득 처리.
      await this.#markClaimed(spec.treasureId);
      const result = await this.#claim({ treasureId: spec.treasureId, transcriptHash, amountDshv: spec.amountDshv });
      this.#set({ lastResult: result });
    } catch {
      // 어떤 실패도 걷기 경험에 영향을 주지 않는다.
    } finally {
      this.#finalizing = false;
    }
  }

  /**
   * 청구 실행: 성공 → grant 민팅(BONUS 계보 — 기존 격려 코인과 동일 경로).
   * 통신 불가·미가입(401) → 큐에 저장 후 통신 복구/가입 후 자동 재청구.
   * 확정 거절(소진·기간 밖·중복)은 큐에 넣지 않는다.
   */
  async #claim(pending: PendingClaim): Promise<TreasureResult> {
    const base = { treasureId: pending.treasureId, amountDshv: pending.amountDshv, stamp: pending.amountDshv === 0 };
    try {
      const { directoryApi, getTrustedIssuerKeys } = await import('./directory');
      const res = await directoryApi.claimTreasure(pending.treasureId, pending.transcriptHash);
      if (res.grant) {
        await wallet.mintFromGrant(res.grant, await getTrustedIssuerKeys(), Date.now());
        return { ...base, amountDshv: res.amountDshv, minted: true, queued: false };
      }
      return { ...base, amountDshv: res.amountDshv, stamp: true, minted: false, queued: false };
    } catch (e) {
      // 네트워크 단절(0)·미가입(401)은 나중에 성공할 수 있다 — 큐 보관.
      if (e instanceof ApiError && e.status !== 0 && e.status !== 401) {
        return { ...base, minted: false, queued: false };
      }
      await this.#enqueue(pending);
      return { ...base, minted: false, queued: true };
    }
  }

  async #markClaimed(treasureId: string): Promise<void> {
    this.#claimedIds.add(treasureId);
    await kvSet(CLAIMED_IDS_KEY, JSON.stringify([...this.#claimedIds]));
  }

  async #enqueue(pending: PendingClaim): Promise<void> {
    const queue = await this.#loadQueue();
    if (!queue.some((q) => q.treasureId === pending.treasureId)) {
      await kvSet(PENDING_CLAIMS_KEY, JSON.stringify([...queue, pending]));
    }
  }

  async #loadQueue(): Promise<PendingClaim[]> {
    return JSON.parse((await kvGet(PENDING_CLAIMS_KEY)) ?? '[]') as PendingClaim[];
  }

  /**
   * 대기 청구 자동 처리 — 앱 시작·걷기 시작 시 호출 (기회적, 실패 무해).
   * 성공하거나 확정 거절된 항목만 큐에서 내린다. 반환: 처리(제거)된 항목 수.
   */
  async flushPendingClaims(): Promise<number> {
    const queue = await this.#loadQueue();
    if (queue.length === 0) return 0;
    const remain: PendingClaim[] = [];
    let done = 0;
    for (const pending of queue) {
      const result = await this.#claim(pending);
      if (result.queued) remain.push(pending);
      else {
        done += 1;
        if (result.minted) this.#set({ lastResult: result });
      }
    }
    await kvSet(PENDING_CLAIMS_KEY, JSON.stringify(remain));
    return done;
  }
}

export const treasureService = new TreasureService();

export function useTreasure(): TreasureState {
  return useSyncExternalStore(treasureService.subscribe, treasureService.getState);
}
