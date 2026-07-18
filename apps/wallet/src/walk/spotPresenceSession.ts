/**
 * 스팟 현장 결속 세션 (R-스팟-현장결속) — 그 자리에서 몸으로 지시를 수행한다.
 *
 * M9 보물과 **같은 측정 엔진**(LegWalker)을 쓴다 — 휘발성 좌표·상대 변위만으로
 * 판정하고, 노출·전송되는 것은 파생 지표와 성공 요약(지시 + 측정 걸음)뿐이다.
 * 서버로 가는 보고에도 좌표·변위가 없다 (헌법 제9조·제10조).
 *
 * 보물과 다른 점 두 가지:
 *  ① 지시가 명세에 박혀 있지 않고 **서버가 즉석에서 낸 1회용 랜덤 값**이다
 *     (POST /spot/challenge) — 사전 계산·재사용을 막는다.
 *  ② **스팟 근접**을 시작 조건으로 요구한다. 서버는 위치를 볼 수 없으므로(제9조)
 *     "그 자리에 있는가"를 판단할 수 있는 것은 이 폰뿐이다. 이 검사가 원격 청구를
 *     막는 실질적 층이며, 서버 검사(지시 일치·소요 시간·걸음 대역)가 그 위를 덮는다.
 *
 * ★정직화: 변조 앱은 이 검사를 통째로 건너뛸 수 있다. 그것은 코인 발행 전체가 지는
 *  것과 같은 근본 한계이며 앱 무결성 인증·소명 책임이 맡는다 (spotPresence.ts 주석).
 */
import type { MovementLeg, SpotPresenceLegReport } from '@shvil/shared';
import { LegWalker, type LegFix, type LegWalkState } from './legWalker';
import { haversineM, type GeoPoint } from './geo';

/**
 * 시작 허용 반경 (m) — 이 안에 있어야 지시 수행을 시작할 수 있다.
 * 사업장 앞 보도·주차장까지 포함하되(GPS 오차 5~15 m 흡수), 길 건너 원격 개시는
 * 막는 크기. 스팟 위치는 공개 데이터라 폰이 스스로 대조할 수 있다.
 */
export const SPOT_PRESENCE_START_RADIUS_M = 60;

export type SpotPresenceState = LegWalkState | 'TOO_FAR';

/** UI 표시용 상태 — 파생 지표만, 좌표·변위 없음. */
export interface SpotPresenceStatus {
  spotId: string;
  state: SpotPresenceState;
  legIndex: number;
  legCount: number;
  currentLeg: MovementLeg;
  stepsInLeg: number;
  failedReason: string | null;
}

export class SpotPresenceSession {
  readonly #spotId: string;
  readonly #challengeId: string;
  readonly #walker: LegWalker;
  #tooFar = false;

  constructor(spotId: string, challengeId: string, legs: MovementLeg[]) {
    this.#spotId = spotId;
    this.#challengeId = challengeId;
    this.#walker = new LegWalker(legs);
  }

  get challengeId(): string {
    return this.#challengeId;
  }

  get state(): SpotPresenceState {
    return this.#tooFar ? 'TOO_FAR' : this.#walker.state;
  }

  /**
   * 시작 가능 여부 — 지금 위치가 스팟 반경 안인가 (폰 로컬 판단, 좌표는 여기서만).
   * 서버는 이 판단에 관여하지 않고 알 수도 없다.
   */
  static isWithinSpot(fix: GeoPoint, spotLocation: GeoPoint): boolean {
    return haversineM(fix, spotLocation) <= SPOT_PRESENCE_START_RADIUS_M;
  }

  /** 스팟에서 너무 멀어 시작할 수 없음을 표시한다 (화면이 안내 문구를 조립). */
  markTooFar(): void {
    this.#tooFar = true;
  }

  addFix(fix: LegFix): void {
    if (this.#tooFar) return;
    this.#walker.addFix(fix);
  }

  addSteps(delta: number): void {
    if (this.#tooFar) return;
    this.#walker.addSteps(delta);
  }

  /**
   * 서버에 보낼 수행 보고 — SUCCESS일 때만. 지시와 측정 걸음뿐이며 좌표·변위가 없다.
   * 서버는 이것을 자기가 낸 지시와 대조한다(verifyPresenceTranscript).
   */
  report(): SpotPresenceLegReport[] {
    if (this.#walker.state !== 'SUCCESS') throw new Error('spot presence session is not complete');
    return this.#walker.transcript.map((l) => ({
      dir: l.dir,
      steps: l.steps,
      measuredSteps: l.measuredSteps,
    }));
  }

  getStatus(): SpotPresenceStatus {
    return {
      spotId: this.#spotId,
      state: this.state,
      legIndex: this.#walker.legIndex,
      legCount: this.#walker.legCount,
      currentLeg: this.#walker.currentLeg,
      stepsInLeg: this.#walker.stepsInLeg,
      failedReason: this.#walker.failedReason,
    };
  }
}
