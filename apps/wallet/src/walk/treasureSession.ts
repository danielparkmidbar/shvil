/**
 * 보물 챌린지 세션 (M9) — 몸 인증의 보상 회계 껍데기.
 *
 * 측정·판정은 LegWalker(walk/legWalker.ts)가 맡는다 — 스팟 현장 결속
 * (R-스팟-현장결속)과 **같은 엔진을 공유**해 한쪽만 고쳐지는 표류를 막는다.
 * 위치 비저장 원칙(휘발성 좌표·상대 변위만 판정·노출은 파생 지표뿐)은 그 엔진의
 * 문서를 참조하라. 이 클래스가 더하는 것은 보물 명세 결속과 성공 요약 해시다.
 */
import { treasureTranscriptHash, type LegRejectReason, type MovementLeg, type TreasureSpec } from '@shvil/shared';
import { LegWalker, type LegFix, type LegWalkState } from './legWalker';
import { haversineM, type GeoPoint } from './geo';

/** M9 공개 계약 유지 — 엔진의 픽스·상태 타입을 그대로 재노출한다. */
export type TreasureFix = LegFix;
export type TreasureSessionState = LegWalkState;

/** UI 표시용 상태 — 파생 지표만, 좌표·변위 없음. */
export interface TreasureSessionStatus {
  treasureId: string;
  amountDshv: number;
  state: TreasureSessionState;
  legIndex: number;
  legCount: number;
  /** 현재 다리 지시 ("북쪽으로 10걸음"의 재료). SUCCESS/FAILED면 마지막 다리. */
  currentLeg: MovementLeg;
  /** 현재 다리에서 지금까지 센 걸음. */
  stepsInLeg: number;
  /** FAILED일 때의 사유 코드 (문구는 화면이 조립). */
  failedReason: LegRejectReason | null;
}

export class TreasureSession {
  readonly #spec: TreasureSpec;
  readonly #walker: LegWalker;

  constructor(spec: TreasureSpec) {
    this.#spec = spec;
    this.#walker = new LegWalker(spec.legs);
  }

  get state(): TreasureSessionState {
    return this.#walker.state;
  }

  /** GPS 픽스 공급 (휘발성). mock이면 세션 차단. */
  addFix(fix: TreasureFix): void {
    this.#walker.addFix(fix);
  }

  /** 만보기 걸음 증가분 공급. 지시 걸음 수 도달 시 자동 판정. */
  addSteps(delta: number): void {
    this.#walker.addSteps(delta);
  }

  /** 성공 요약 해시 — SUCCESS일 때만. 서버로 가는 유일한 수행 증빙이다. */
  transcriptHash(memberId: string): string {
    if (this.#walker.state !== 'SUCCESS') throw new Error('treasure session is not complete');
    return treasureTranscriptHash(this.#spec.treasureId, memberId, [...this.#walker.transcript]);
  }

  getStatus(): TreasureSessionStatus {
    return {
      treasureId: this.#spec.treasureId,
      amountDshv: this.#spec.amountDshv,
      state: this.#walker.state,
      legIndex: Math.min(this.#walker.legIndex, this.#spec.legs.length - 1),
      legCount: this.#walker.legCount,
      currentLeg: this.#walker.currentLeg,
      stepsInLeg: this.#walker.stepsInLeg,
      failedReason: this.#walker.failedReason,
    };
  }
}

/** 존 근접 요약 — 좌표가 아니라 거리(m)와 명세 식별 정보만 노출한다. */
export interface NearbyTreasure {
  treasureId: string;
  amountDshv: number;
  distanceM: number;
}

/**
 * 존 진입 감지 (휘발성 경로 전용) — 현재 픽스가 유효한(기간 내·미획득·잔여 있음)
 * 보물 존 안에 있으면 가장 가까운 것을 돌려준다. 반환값에 좌표는 없다.
 */
export function detectNearbyTreasure(
  fix: GeoPoint,
  treasures: (TreasureSpec & { remaining?: number })[],
  claimedIds: ReadonlySet<string>,
  now: number,
): NearbyTreasure | null {
  let best: NearbyTreasure | null = null;
  for (const t of treasures) {
    if (claimedIds.has(t.treasureId)) continue;
    if (now < t.validFrom || now > t.validUntil) continue;
    if (t.remaining !== undefined && t.remaining <= 0) continue;
    const d = haversineM(fix, t.zone.center);
    if (d <= t.zone.radiusM && (!best || d < best.distanceM)) {
      best = { treasureId: t.treasureId, amountDshv: t.amountDshv, distanceM: Math.round(d) };
    }
  }
  return best;
}
