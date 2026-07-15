/**
 * 보물 챌린지 세션 (M9) — 몸 인증의 휘발성 측정 엔진.
 *
 * CorridorEngine과 같은 위치 비저장 원칙:
 *  - GPS 좌표는 이 클래스의 # private 필드(휘발성 메모리)에만 존재한다.
 *  - 판정에 쓰는 것은 **다리 시작 시점 대비 상대 변위**(Δ북/Δ동)와 걸음 증분뿐이며,
 *    다리가 끝나면 기준점을 갈아끼워 이전 좌표는 즉시 버려진다.
 *  - getStatus()가 노출하는 것은 파생 지표(걸음 수·다리 진행·판정 상태)뿐 —
 *    어떤 반환값에도 좌표·변위가 포함되지 않는다. 직렬화 대상이 아니다.
 *
 * 판정: 다리의 지시 걸음 수에 도달하는 순간 verifyLeg(순수 함수, @shvil/shared)로
 * 자동 판정한다 — 걸음 관용(±40%/±3걸음)은 만보기 지연·경계 오차를 흡수한다.
 * mock location 감지 시 세션은 BLOCKED로 차단된다 (기존 mockDetected 패턴).
 */
import {
  treasureTranscriptHash,
  verifyLeg,
  type LegRejectReason,
  type LegTranscript,
  type MovementLeg,
  type TreasureSpec,
} from '@shvil/shared';
import { haversineM, type GeoPoint } from './geo';

const DEG_TO_RAD = Math.PI / 180;
const METERS_PER_DEG_LAT = 111_320;

/** 판정에서 제외할 GPS 정확도 하한 (m) — 회랑 엔진과 동일. */
const MAX_ACCURACY_M = 50;

export interface TreasureFix {
  lat: number;
  lon: number;
  timestamp: number;
  accuracy?: number | undefined;
  /** Android mock location — true면 세션 차단. */
  mocked?: boolean | undefined;
}

export type TreasureSessionState = 'ACTIVE' | 'SUCCESS' | 'FAILED' | 'BLOCKED';

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

  /** 휘발성 기준점·최근 좌표 — 다리 전환 시 즉시 교체, 외부 노출 금지. */
  #anchor: GeoPoint | null = null;
  #last: GeoPoint | null = null;
  #stepsInLeg = 0;
  #legIndex = 0;
  #state: TreasureSessionState = 'ACTIVE';
  #failedReason: LegRejectReason | null = null;
  /** 성공 요약 (지시 + 측정 걸음뿐 — 좌표·변위 없음). */
  #transcript: LegTranscript[] = [];

  constructor(spec: TreasureSpec) {
    this.#spec = spec;
  }

  get state(): TreasureSessionState {
    return this.#state;
  }

  /** GPS 픽스 공급 (휘발성). mock이면 세션 차단. */
  addFix(fix: TreasureFix): void {
    if (this.#state !== 'ACTIVE') return;
    if (fix.mocked) {
      this.#state = 'BLOCKED';
      this.#anchor = null;
      this.#last = null;
      return;
    }
    if (fix.accuracy !== undefined && fix.accuracy > MAX_ACCURACY_M) return;
    const point = { lat: fix.lat, lon: fix.lon };
    if (!this.#anchor) this.#anchor = point;
    this.#last = point;
  }

  /** 만보기 걸음 증가분 공급. 지시 걸음 수 도달 시 자동 판정. */
  addSteps(delta: number): void {
    if (this.#state !== 'ACTIVE' || !Number.isInteger(delta) || delta <= 0) return;
    this.#stepsInLeg += delta;
    const leg = this.#spec.legs[this.#legIndex]!;
    if (this.#stepsInLeg >= leg.steps) this.#judgeCurrentLeg();
  }

  /** 현재 다리 판정 — 상대 변위 계산 → verifyLeg → 통과 시 다음 다리로. */
  #judgeCurrentLeg(): void {
    const leg = this.#spec.legs[this.#legIndex]!;
    // 상대 변위 (m): 기준점 대비 Δ북/Δ동 — 국지 등장방형 근사 (수십 m 스케일 충분).
    let dxNorthM = 0;
    let dxEastM = 0;
    if (this.#anchor && this.#last) {
      dxNorthM = (this.#last.lat - this.#anchor.lat) * METERS_PER_DEG_LAT;
      dxEastM = (this.#last.lon - this.#anchor.lon) * METERS_PER_DEG_LAT * Math.cos(this.#anchor.lat * DEG_TO_RAD);
    }
    const verdict = verifyLeg(dxNorthM, dxEastM, this.#stepsInLeg, leg);
    if (!verdict.ok) {
      this.#state = 'FAILED';
      this.#failedReason = verdict.reason ?? null;
      this.#anchor = null;
      this.#last = null;
      return;
    }
    this.#transcript.push({ dir: leg.dir, steps: leg.steps, measuredSteps: this.#stepsInLeg });
    this.#legIndex += 1;
    this.#stepsInLeg = 0;
    // 다음 다리의 기준점은 현재 위치 — 이전 기준점 좌표는 여기서 버려진다.
    this.#anchor = this.#last;
    if (this.#legIndex >= this.#spec.legs.length) {
      this.#state = 'SUCCESS';
      this.#anchor = null;
      this.#last = null;
    }
  }

  /** 성공 요약 해시 — SUCCESS일 때만. 서버로 가는 유일한 수행 증빙이다. */
  transcriptHash(memberId: string): string {
    if (this.#state !== 'SUCCESS') throw new Error('treasure session is not complete');
    return treasureTranscriptHash(this.#spec.treasureId, memberId, this.#transcript);
  }

  getStatus(): TreasureSessionStatus {
    const legIndex = Math.min(this.#legIndex, this.#spec.legs.length - 1);
    return {
      treasureId: this.#spec.treasureId,
      amountDshv: this.#spec.amountDshv,
      state: this.#state,
      legIndex,
      legCount: this.#spec.legs.length,
      currentLeg: this.#spec.legs[legIndex]!,
      stepsInLeg: this.#stepsInLeg,
      failedReason: this.#failedReason,
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
