/**
 * 코스 회랑 판정 엔진 (지시서 2.2).
 *
 * 위치 비저장 원칙의 핵심 구현부:
 *  - GPS 좌표는 이 클래스의 #휘발성 버퍼(메모리)에만 존재한다.
 *  - 창(window)이 닫히는 순간 거리·걸음·판정(tier)만 담긴 WalkSample을 방출하고
 *    좌표 버퍼를 즉시 비운다. 어떤 반환값·이벤트에도 좌표가 포함되지 않는다.
 *  - 예외는 창 경계 이월점(#carryFix) **한 점**뿐이다. 창이 닫힌 뒤 다음 픽스가
 *    도착할 때까지(≈5초) 메모리에 살고, 거리(미터)로 환산되는 즉시 폐기된다.
 *    창 안의 좌표들보다 짧게 산다 — 왜 필요한지는 closeWindow 주석 참조.
 *  - 이 클래스는 직렬화 대상이 아니다 (# private 필드 — JSON에 노출되지 않음).
 *
 * 판정 규칙:
 *  - 회랑 판정은 포인트 단위가 아니라 창 단위 이탈률(기본 30%)로 한다 —
 *    순간 GPS 오차 1~2 포인트로 기각하지 않는다 (프로토콜 설계 1.5절).
 *  - 코스 이탈 vs 일상 걸음: 코스에서 offCourseMaxDistanceM(제안 2km) 이내면
 *    "순례 중 이탈", 그 밖이면 "일상 걸음" 미세 요율.
 *  - 엔젤 우회: 회랑 밖이지만 등록 엔젤 포인트에 접근 중이고 그 거리가
 *    우회 한도(제안 편도 5km) 이내면 잠정 카운트 tier.
 */
import type { WalkSample, WalkTier } from '@shvil/shared';
import { haversineM, nearestOnPolyline, type GeoPoint } from './geo';
import { corridorHalfWidthAt, segmentMetaAt, type AngelPoint, type CourseData } from './courses';

export interface GpsFix {
  lat: number;
  lon: number;
  /** epoch ms. */
  timestamp: number;
  /** 수평 정확도 (m). */
  accuracy?: number | undefined;
  /** Android mock location 플래그 — true면 세션 차단 (프로토콜 A단계). */
  mocked?: boolean | undefined;
}

export interface CorridorParams {
  /** 창 이탈률 임계 (기본 0.3 — 30% 이상 회랑 밖이면 이탈 창). */
  offCorridorRatioThreshold: number;
  /** 코스 이탈(감액)과 일상 걸음(미세)의 경계 거리 (m). 제안 2,000 — 결정 대기. */
  offCourseMaxDistanceM: number;
  /** 엔젤 우회 인정 한도 (편도 m). 제안 5,000 — 결정 대기 2번. */
  angelDetourMaxMeters: number;
  /** 창 판정에 필요한 최소 픽스 수. */
  minFixesPerWindow: number;
  /** 이 정확도(m)보다 나쁜 픽스는 판정에서 제외. */
  maxAccuracyM: number;
  /** 엔젤 접근 판정: 창 동안 이만큼(m) 이상 가까워져야 "접근 중". */
  angelApproachMinM: number;
  /**
   * 창 경계 이월 한도 (초). 직전 창의 마지막 픽스와 이번 창의 첫 픽스 사이가
   * 이보다 벌어지면 연속한 걸음으로 보지 않는다 (GPS 두절·앱 재시작·이동수단).
   */
  maxBridgeGapS: number;
}

export const DEFAULT_CORRIDOR_PARAMS: CorridorParams = {
  offCorridorRatioThreshold: 0.3,
  offCourseMaxDistanceM: 2_000,
  angelDetourMaxMeters: 5_000,
  minFixesPerWindow: 3,
  maxAccuracyM: 50,
  angelApproachMinM: 30,
  maxBridgeGapS: 30,
};

/** UI 표시용 실시간 상태 — 파생 지표만, 좌표 없음. */
export interface LiveWalkStatus {
  tier: WalkTier | 'IDLE';
  courseId: string | null;
  courseName: string | null;
  /** 최근접 코스까지 거리 (m). */
  distanceToCourseM: number | null;
  /** 최근접 엔젤 (파생 거리만). */
  nearestAngel: { memberId: string; name: string; distanceM: number } | null;
  /** mock location 감지 여부 — true면 걷기 기록 차단 상태. */
  mockLocationDetected: boolean;
}

interface FixJudgement {
  inCorridor: boolean;
  courseIdx: number;
  segmentIndex: number;
  distanceToCourseM: number;
}

export class CorridorEngine {
  readonly #courses: CourseData[];
  readonly #angels: AngelPoint[];
  readonly #params: CorridorParams;

  /** 휘발성 좌표 버퍼 — closeWindow()에서 즉시 폐기된다. 디스크 기록 금지. */
  #fixes: GpsFix[] = [];
  #stepsInWindow = 0;
  #mockDetected = false;
  /**
   * 창 경계 이월 좌표 — **딱 한 점**, 다음 픽스가 도착하는 즉시(≈5초) 폐기된다.
   * 창 안의 버퍼(#fixes)보다 짧게 산다. 이것이 필요한 이유는 아래 closeWindow 주석 참조.
   */
  #carryFix: GpsFix | null = null;
  /** 이월된 것: 좌표가 아니라 **미터·초 스칼라뿐**이다 (창 경계 구간의 길이·시간). */
  #bridgeM = 0;
  #bridgeS = 0;
  /** 마지막 판정 상태 (파생 지표만 보관 — 좌표 아님). */
  #lastStatus: LiveWalkStatus = {
    tier: 'IDLE',
    courseId: null,
    courseName: null,
    distanceToCourseM: null,
    nearestAngel: null,
    mockLocationDetected: false,
  };

  constructor(courses: CourseData[], angels: AngelPoint[], params: Partial<CorridorParams> = {}) {
    this.#courses = courses;
    this.#angels = angels;
    this.#params = { ...DEFAULT_CORRIDOR_PARAMS, ...params };
  }

  /** GPS 픽스 추가 (휘발성). mock location이면 창 전체를 오염 처리. */
  addFix(fix: GpsFix): void {
    if (fix.mocked) {
      this.#mockDetected = true;
      return;
    }
    if (fix.accuracy !== undefined && fix.accuracy > this.#params.maxAccuracyM) return;
    // 창 경계 이월: 직전 창의 마지막 좌표와의 거리를 여기서 재고 **좌표는 즉시 버린다**.
    // 다음 창이 들고 가는 것은 미터·초 두 숫자뿐이다 (좌표 아님 — 제9조).
    const carry = this.#carryFix;
    if (carry) {
      this.#carryFix = null;
      const gapS = (fix.timestamp - carry.timestamp) / 1000;
      if (gapS > 0 && gapS <= this.#params.maxBridgeGapS) {
        this.#bridgeM = haversineM(carry, fix);
        this.#bridgeS = gapS;
      }
    }
    this.#fixes.push(fix);
    this.#updateLiveStatus(fix);
  }

  /** 만보기 걸음 증가분 추가. */
  addSteps(delta: number): void {
    if (Number.isInteger(delta) && delta > 0) this.#stepsInWindow += delta;
  }

  getLiveStatus(): LiveWalkStatus {
    return { ...this.#lastStatus, nearestAngel: this.#lastStatus.nearestAngel && { ...this.#lastStatus.nearestAngel } };
  }

  /**
   * 창 마감: 거리·걸음·판정만 담은 WalkSample을 방출하고 좌표를 폐기한다.
   * mock location이 감지된 창은 null (카운트 없음).
   *
   * ── 창 경계 이월 (2026-07-27 수정) ───────────────────────────────────────
   * 이전에는 **이 창 안의 픽스 사이**만 합산하고 버퍼를 비웠다. 그래서 "직전 창의
   * 마지막 픽스 → 이번 창의 첫 픽스" 구간이 어느 창에도 들어가지 않았다 —
   * walkService 설정(픽스 5초·창 60초)에서 창당 1구간 = **걸은 거리의 8.33%**다.
   * 느리게 걸을수록(픽스 간격이 벌어질수록) 손해가 커져 2.5 km/h 순례자는 12.7%를
   * 잃었다. 실제로 걸은 거리이므로 이것은 정량적 인정의 누락이다(제6조).
   *
   * 이월 규칙 — 세 겹으로 잠근다:
   *  1) 시간 한도: 경계 간격이 maxBridgeGapS(30초)를 넘으면 이월하지 않는다.
   *     GPS 두절·앱 재시작·차량 이동 뒤의 재개를 걸음으로 세지 않기 위해서다.
   *  2) **자기 속도 상한**: 이월 거리는 `이 창의 평균 속도 × 경계 시간`을 넘지 못한다.
   *     그래서 이월은 창의 평균 속도를 **절대 올리지 않는다**(수식: (D+p·Δt)/(T+Δt) ≤ D/T).
   *     즉 GPS가 경계에서 튀어도 멀쩡한 창이 TOO_FAST/VEHICLE로 뒤집히는 일이 없고,
   *     걷지 않은 거리가 이월로 새로 생기지도 않는다.
   *  3) 무효 창(mock·픽스 부족)은 이월을 끊는다 — 오염된 구간을 건너뛰어 잇지 않는다.
   */
  closeWindow(): WalkSample | null {
    const fixes = this.#fixes;
    const steps = this.#stepsInWindow;
    const mock = this.#mockDetected;
    const bridgeM = this.#bridgeM;
    const bridgeS = this.#bridgeS;
    // 좌표 즉시 폐기 — 어떤 경로로도 이 창의 좌표는 다시 읽을 수 없다.
    this.#fixes = [];
    this.#stepsInWindow = 0;
    this.#mockDetected = false;
    this.#bridgeM = 0;
    this.#bridgeS = 0;
    this.#carryFix = null;

    if (mock || fixes.length < this.#params.minFixesPerWindow) return null;

    const first = fixes[0]!;
    const last = fixes[fixes.length - 1]!;
    const ownDurationS = Math.max(1, (last.timestamp - first.timestamp) / 1000);

    let distanceM = 0;
    for (let i = 1; i < fixes.length; i++) distanceM += haversineM(fixes[i - 1]!, fixes[i]!);

    // 이월분 정산 (위 2번 규칙 — 자기 속도 상한).
    const paceMps = distanceM / ownDurationS;
    const creditedBridgeM = Math.min(bridgeM, paceMps * bridgeS);
    distanceM += creditedBridgeM;
    const durationS = ownDurationS + bridgeS;
    // 이번 창이 유효하므로 다음 창이 이어붙일 수 있게 마지막 좌표 하나만 남긴다.
    // (다음 addFix에서 거리로 환산되고 즉시 폐기된다 — addFix 주석 참조.)
    this.#carryFix = last;

    const judgements = fixes.map((f) => this.#judgeFix(f));
    const outside = judgements.filter((j) => !j.inCorridor).length;
    const offRatio = outside / judgements.length;

    let tier: WalkTier;
    let courseId: string | undefined;
    let difficultyTenths: number | undefined;
    let detourAngelMemberId: string | undefined;

    if (offRatio < this.#params.offCorridorRatioThreshold) {
      tier = 'ON_COURSE';
      // 창의 대표 판정: 회랑 안 픽스의 중앙값 위치 구간 기준.
      const inside = judgements.filter((j) => j.inCorridor);
      const median = inside[Math.floor(inside.length / 2)]!;
      const course = this.#courses[median.courseIdx]!;
      courseId = course.courseId;
      difficultyTenths = segmentMetaAt(course, median.segmentIndex).difficultyTenths;
    } else {
      const detourAngel = this.#detectAngelApproach(first, last);
      if (detourAngel) {
        tier = 'ANGEL_DETOUR';
        detourAngelMemberId = detourAngel;
      } else {
        const minCourseDist = Math.min(...judgements.map((j) => j.distanceToCourseM));
        tier = minCourseDist <= this.#params.offCourseMaxDistanceM ? 'OFF_COURSE' : 'DAILY_LIFE';
      }
    }

    return {
      durationS: Math.round(durationS),
      distanceM: Math.round(distanceM),
      steps,
      tier,
      timestamp: last.timestamp,
      difficultyTenths,
      detourAngelMemberId,
      courseId,
    };
  }

  #judgeFix(fix: GpsFix): FixJudgement {
    let best: FixJudgement = { inCorridor: false, courseIdx: 0, segmentIndex: 0, distanceToCourseM: Number.POSITIVE_INFINITY };
    for (let c = 0; c < this.#courses.length; c++) {
      const course = this.#courses[c]!;
      const near = nearestOnPolyline(fix, course.polyline);
      if (near.distanceM < best.distanceToCourseM) {
        best = {
          inCorridor: near.distanceM <= corridorHalfWidthAt(course, near.segmentIndex),
          courseIdx: c,
          segmentIndex: near.segmentIndex,
          distanceToCourseM: near.distanceM,
        };
      }
    }
    return best;
  }

  /** 엔젤 접근 판정: 창 시작 대비 끝에서 특정 엔젤에 유의미하게 가까워졌고 한도 이내. */
  #detectAngelApproach(first: GeoPoint, last: GeoPoint): string | undefined {
    let bestAngel: string | undefined;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const angel of this.#angels) {
      const startDist = haversineM(first, angel.location);
      const endDist = haversineM(last, angel.location);
      if (
        endDist <= this.#params.angelDetourMaxMeters &&
        startDist - endDist >= this.#params.angelApproachMinM &&
        endDist < bestDist
      ) {
        bestDist = endDist;
        bestAngel = angel.memberId;
      }
    }
    return bestAngel;
  }

  #updateLiveStatus(fix: GpsFix): void {
    const j = this.#judgeFix(fix);
    const course = this.#courses[j.courseIdx] ?? null;

    let nearestAngel: LiveWalkStatus['nearestAngel'] = null;
    for (const angel of this.#angels) {
      const d = haversineM(fix, angel.location);
      if (!nearestAngel || d < nearestAngel.distanceM) {
        nearestAngel = { memberId: angel.memberId, name: angel.name, distanceM: Math.round(d) };
      }
    }

    let tier: LiveWalkStatus['tier'];
    if (j.inCorridor) tier = 'ON_COURSE';
    else if (nearestAngel && nearestAngel.distanceM <= this.#params.angelDetourMaxMeters) tier = 'ANGEL_DETOUR';
    else if (j.distanceToCourseM <= this.#params.offCourseMaxDistanceM) tier = 'OFF_COURSE';
    else tier = 'DAILY_LIFE';

    this.#lastStatus = {
      tier,
      courseId: j.inCorridor && course ? course.courseId : null,
      courseName: j.inCorridor && course ? course.name : null,
      distanceToCourseM: Number.isFinite(j.distanceToCourseM) ? Math.round(j.distanceToCourseM) : null,
      nearestAngel,
      mockLocationDetected: this.#mockDetected,
    };
  }
}
