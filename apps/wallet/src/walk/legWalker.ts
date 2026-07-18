/**
 * 이동 지시 수행 엔진 (M9 보물 · R-스팟-현장결속 공용).
 *
 * CorridorEngine과 같은 **위치 비저장 원칙**:
 *  - GPS 좌표는 이 클래스의 # private 필드(휘발성 메모리)에만 존재한다.
 *  - 판정에 쓰는 것은 **다리 시작 시점 대비 상대 변위**(Δ북/Δ동)와 걸음 증분뿐이며,
 *    다리가 끝나면 기준점을 갈아끼워 이전 좌표는 즉시 버려진다.
 *  - 노출하는 것은 파생 지표(걸음 수·다리 진행·판정 상태)와 성공 요약(지시 + 측정
 *    걸음)뿐 — 어떤 반환값에도 좌표·변위가 포함되지 않는다. 직렬화 대상이 아니다.
 *
 * 이 엔진은 보물(M9)과 스팟 현장 결속이 **같은 측정·판정 코드를 공유**하게 한다 —
 * 한쪽만 고쳐지는 표류를 막는다. 각 기능의 껍데기(보상 회계·서버 왕복)는 바깥에 있다.
 */
import { verifyLeg, type LegRejectReason, type LegTranscript, type MovementLeg } from '@shvil/shared';

const DEG_TO_RAD = Math.PI / 180;
const METERS_PER_DEG_LAT = 111_320;

/** 판정에서 제외할 GPS 정확도 하한 (m) — 회랑 엔진과 동일. */
export const MAX_ACCURACY_M = 50;

export interface LegFix {
  lat: number;
  lon: number;
  timestamp: number;
  accuracy?: number | undefined;
  /** Android mock location — true면 세션 차단. */
  mocked?: boolean | undefined;
}

export type LegWalkState = 'ACTIVE' | 'SUCCESS' | 'FAILED' | 'BLOCKED';

/**
 * 지시 목록을 순서대로 수행하며 판정하는 휘발성 엔진.
 * 지시 걸음 수에 도달하는 순간 verifyLeg(순수 함수)로 자동 판정한다.
 */
export class LegWalker {
  readonly #legs: MovementLeg[];

  /** 휘발성 기준점·최근 좌표 — 다리 전환 시 즉시 교체, 외부 노출 금지. */
  #anchor: { lat: number; lon: number } | null = null;
  #last: { lat: number; lon: number } | null = null;
  #stepsInLeg = 0;
  #legIndex = 0;
  #state: LegWalkState = 'ACTIVE';
  #failedReason: LegRejectReason | null = null;
  /** 성공 요약 (지시 + 측정 걸음뿐 — 좌표·변위 없음). */
  #transcript: LegTranscript[] = [];

  constructor(legs: MovementLeg[]) {
    if (legs.length === 0) throw new Error('legWalker: legs required');
    this.#legs = legs;
  }

  get state(): LegWalkState {
    return this.#state;
  }

  get legIndex(): number {
    return this.#legIndex;
  }

  get legCount(): number {
    return this.#legs.length;
  }

  get stepsInLeg(): number {
    return this.#stepsInLeg;
  }

  get failedReason(): LegRejectReason | null {
    return this.#failedReason;
  }

  /** 현재(또는 마지막) 다리 지시 — 화면 문구의 재료. */
  get currentLeg(): MovementLeg {
    return this.#legs[Math.min(this.#legIndex, this.#legs.length - 1)]!;
  }

  /** 성공 요약 — SUCCESS일 때만 의미가 있다. 좌표·변위가 없다. */
  get transcript(): readonly LegTranscript[] {
    return this.#transcript;
  }

  /** GPS 픽스 공급 (휘발성). mock이면 세션 차단. */
  addFix(fix: LegFix): void {
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
    if (this.#stepsInLeg >= this.#legs[this.#legIndex]!.steps) this.#judgeCurrentLeg();
  }

  /** 현재 다리 판정 — 상대 변위 계산 → verifyLeg → 통과 시 다음 다리로. */
  #judgeCurrentLeg(): void {
    const leg = this.#legs[this.#legIndex]!;
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
    if (this.#legIndex >= this.#legs.length) {
      this.#state = 'SUCCESS';
      this.#anchor = null;
      this.#last = null;
    }
  }
}
