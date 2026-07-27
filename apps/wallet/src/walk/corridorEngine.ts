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
 *
 * ── 2026-07-27 GPS 품질 개정 (실측 C 반영) ────────────────────────────
 * 두 가지를 바꿨다. 둘은 한 몸이며 **순서가 중요하다.**
 *
 * ① **회랑 안 창의 거리를 폴리라인 투영 이동량으로 잰다** (geo.ts 주석 참조).
 *    haversine 합은 오차를 절댓값으로 누적해 σ10 다중경로에서 +36%, σ15 협곡에서
 *    +67%를 만들었다. 부푼 거리는 보폭 검사(strideMax)를 터뜨려 정직한 사람의 창을
 *    통째로 기각시키기도 했다 — 같은 노이즈가 먼저 도둑질을 하고 그다음 정직한
 *    사람을 죽인다. 투영은 오차를 코스 선에 상쇄시켜 이 둘을 한 수로 없앤다.
 *
 * ② **정확도가 나쁜 픽스를 버리는 대신 회랑을 그만큼 넓혀서 다룬다.**
 *    예전에는 accuracy > 50 m 픽스를 통째로 버렸고, 그 결과 51 m 하나 차이로
 *    창이 0개가 됐다(실측: 45 m → 0.5 SHV / 51 m → 0 SHV). 숲 하부·협곡·iOS Wi-Fi
 *    폴백이 흔히 내놓는 값이 이 대역이라, 정직한 사람의 하루가 조용히 사라졌다.
 *
 *    ★①이 먼저 있어야 ②가 안전하다. 정확도가 나쁜 픽스는 회랑 판정만 헐거운 게
 *    아니라 **거리 자체를 부풀린다**(실측 accuracy 50 m: 1.551 km 걷고 2.896 km 방출).
 *    투영을 쓰면 계측이 정확도와 분리되므로(45~80 m 전부 1.551 km) 회랑을 넓혀도
 *    발행이 흔들리지 않는다. 회랑 확대는 "코인이 나는 땅"을 넓히는 일이므로
 *    maxAccuracySlackM으로 상한을 못박는다.
 */
import type { WalkSample, WalkTier } from '@shvil/shared';
import {
  buildPolylineIndex,
  haversineM,
  projectOnPolyline,
  type GeoPoint,
  type PolylineIndex,
} from './geo';
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
  /**
   * **완전 신뢰 정확도** (m). 이 값 이하의 픽스는 회랑을 넓히지 않는다.
   * (2026-07-27 이전에는 "이보다 나쁘면 폐기"였다 — 이제 폐기는 hardMaxAccuracyM이 한다.)
   */
  maxAccuracyM: number;
  /**
   * ★폐기 임계 (m). 이보다 나쁜 픽스는 아무것도 말해 주지 않으므로 판정에서 뺀다.
   * 200 m는 도시 Wi-Fi 폴백(수십~백여 m)은 살리고, 기지국 단위 추정(수백 m~km)은
   * 버리는 선이다. 살아남은 픽스도 회랑 확대 상한(maxAccuracySlackM)에 묶인다.
   */
  hardMaxAccuracyM: number;
  /**
   * ★정확도 초과분으로 넓힐 수 있는 회랑 여유의 상한 (m).
   * 회랑은 코인이 생성되는 땅이다 — 데이터(정확도 필드)가 무한히 넓히게 두지 않는다.
   * 100 m는 실측 GPS 횡방향 p95(σ25 아파트+숲 54.9 m)에 여유를 얹은 값이다.
   */
  maxAccuracySlackM: number;
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
  hardMaxAccuracyM: 200,
  maxAccuracySlackM: 100,
  angelApproachMinM: 30,
  maxBridgeGapS: 30,
};

/**
 * 국지 투영 후보 반경을 정하는 속도 (m/s). 자전거 상한(≈30 km/h)에 여유를 얹었다 —
 * 관대해도 자기교차 급소(코스상 0.74 km 뜀)는 확실히 잘린다.
 */
const PROJECTION_MAX_SPEED_MPS = 12;
/** 국지 투영 최소 반경 (m) — 픽스 간격이 아주 짧아도 GPS 오차만큼은 봐 준다. */
const PROJECTION_MIN_RADIUS_M = 60;

/** 이번 창의 거리를 무엇으로 쟀는가 — 화면이 사용자에게 그대로 설명한다. */
export type DistanceMeasure = 'PROJECTED' | 'DIRECT';

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
  // ── ★GPS 품질 (2026-07-27) — "왜 안 쌓이는지"를 사용자가 볼 수 있게 ──
  /** 마지막 픽스의 수평 정확도 (m). 폰이 주지 않으면 null. */
  accuracyM: number | null;
  /** 마지막 픽스가 판정에 쓰였는가. false면 정확도가 폐기 임계를 넘었다. */
  lastFixAccepted: boolean;
  /** 이번 창에 쌓인(판정에 쓰인) 픽스 수. */
  windowFixes: number;
  /** 이번 창에서 정확도가 나빠 버려진 픽스 수. */
  droppedFixes: number;
  /** 창이 성립하는 데 필요한 최소 픽스 수 — windowFixes와 함께 보여 준다. */
  minFixesPerWindow: number;
  /** 정확도 때문에 넓혀 준 회랑 여유 (m). 0이면 완전 신뢰 상태. */
  corridorSlackM: number;
  /** 지금 이 자리의 거리 계측 방식. 회랑 안이면 투영, 밖이면 직선 합. */
  distanceMeasure: DistanceMeasure;
}

interface FixJudgement {
  inCorridor: boolean;
  courseIdx: number;
  segmentIndex: number;
  distanceToCourseM: number;
  /** 대표 코스 위 진행 좌표 (m). 코스가 없으면 null. */
  alongM: number | null;
  /** 정확도 때문에 넓힌 회랑 여유 (m). */
  slackM: number;
}

interface BufferedFix {
  fix: GpsFix;
  j: FixJudgement;
}

const IDLE_STATUS: LiveWalkStatus = {
  tier: 'IDLE',
  courseId: null,
  courseName: null,
  distanceToCourseM: null,
  nearestAngel: null,
  mockLocationDetected: false,
  accuracyM: null,
  lastFixAccepted: true,
  windowFixes: 0,
  droppedFixes: 0,
  minFixesPerWindow: DEFAULT_CORRIDOR_PARAMS.minFixesPerWindow,
  corridorSlackM: 0,
  distanceMeasure: 'DIRECT',
};

export class CorridorEngine {
  readonly #courses: CourseData[];
  readonly #index: PolylineIndex[];
  readonly #angels: AngelPoint[];
  readonly #params: CorridorParams;

  /** 휘발성 좌표 버퍼 — closeWindow()에서 즉시 폐기된다. 디스크 기록 금지. */
  #fixes: BufferedFix[] = [];
  #stepsInWindow = 0;
  #mockDetected = false;
  #droppedInWindow = 0;
  /**
   * 창 경계 이월 좌표 — **딱 한 점**, 다음 픽스가 도착하는 즉시(≈5초) 폐기된다.
   * 창 안의 버퍼(#fixes)보다 짧게 산다. 이것이 필요한 이유는 아래 closeWindow 주석 참조.
   */
  #carryFix: GpsFix | null = null;
  /** 이월점의 대표 코스·진행 좌표 (좌표가 아니라 코스 위 스칼라 하나). */
  #carryCourseIdx: number | null = null;
  #carryAlongM: number | null = null;
  /** 이월된 것: 좌표가 아니라 **미터·초 스칼라뿐**이다 (창 경계 구간의 길이·시간). */
  #bridgeM = 0;
  #bridgeS = 0;
  /** 이월 구간을 투영으로 잰 값 (같은 코스일 때만). 회랑 안 창에서 이쪽을 쓴다. */
  #bridgeProjM: number | null = null;
  #bridgeCourseIdx: number | null = null;
  /**
   * 국지 투영의 기준점 — 직전 픽스의 (코스, 진행 좌표). 좌표가 아니라 스칼라이며
   * 다음 픽스를 사영할 후보 선분을 좁히는 데만 쓰인다. 창 마감 시 이월점과 함께 갱신된다.
   */
  #lastCourseIdx: number | null = null;
  #lastAlongM: number | null = null;
  #lastFixTs: number | null = null;
  /** 마지막 판정 상태 (파생 지표만 보관 — 좌표 아님). */
  #lastStatus: LiveWalkStatus;

  constructor(courses: CourseData[], angels: AngelPoint[], params: Partial<CorridorParams> = {}) {
    this.#courses = courses;
    this.#index = courses.map((c) => buildPolylineIndex(c.polyline));
    this.#angels = angels;
    this.#params = { ...DEFAULT_CORRIDOR_PARAMS, ...params };
    this.#lastStatus = { ...IDLE_STATUS, minFixesPerWindow: this.#params.minFixesPerWindow };
  }

  /** GPS 픽스 추가 (휘발성). mock location이면 창 전체를 오염 처리. */
  addFix(fix: GpsFix): void {
    if (fix.mocked) {
      this.#mockDetected = true;
      this.#lastStatus = { ...this.#lastStatus, mockLocationDetected: true, lastFixAccepted: false };
      return;
    }
    // ★폐기는 "아무것도 말해 주지 않는 픽스"에만 적용한다. 그 아래는 버리지 않고
    //   회랑을 넓혀서 다룬다 — 정확도 1 m 차이로 하루가 사라지지 않게 (실측 3위).
    if (fix.accuracy !== undefined && fix.accuracy > this.#params.hardMaxAccuracyM) {
      this.#droppedInWindow += 1;
      this.#lastStatus = {
        ...this.#lastStatus,
        accuracyM: Math.round(fix.accuracy),
        lastFixAccepted: false,
        droppedFixes: this.#droppedInWindow,
      };
      return;
    }

    const j = this.#judgeFix(fix);

    // 창 경계 이월: 직전 창의 마지막 좌표와의 거리를 여기서 재고 **좌표는 즉시 버린다**.
    // 다음 창이 들고 가는 것은 미터·초 두 숫자뿐이다 (좌표 아님 — 제9조).
    const carry = this.#carryFix;
    if (carry) {
      const carryCourseIdx = this.#carryCourseIdx;
      const carryAlongM = this.#carryAlongM;
      this.#carryFix = null;
      this.#carryCourseIdx = null;
      this.#carryAlongM = null;
      const gapS = (fix.timestamp - carry.timestamp) / 1000;
      if (gapS > 0 && gapS <= this.#params.maxBridgeGapS) {
        this.#bridgeM = haversineM(carry, fix);
        this.#bridgeS = gapS;
        // 투영 이월은 같은 코스 위일 때만 성립한다 — 코스가 바뀌면 잴 선이 다르다.
        if (carryAlongM !== null && carryCourseIdx !== null && j.alongM !== null && j.courseIdx === carryCourseIdx) {
          this.#bridgeProjM = Math.abs(j.alongM - carryAlongM);
          this.#bridgeCourseIdx = carryCourseIdx;
        }
      }
    }

    this.#fixes.push({ fix, j });
    this.#lastCourseIdx = j.alongM === null ? null : j.courseIdx;
    this.#lastAlongM = j.alongM;
    this.#lastFixTs = fix.timestamp;
    this.#updateLiveStatus(fix, j);
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
   *
   * ── 거리 계측 (2026-07-27) ──────────────────────────────────────────────
   * 회랑 안 창(ON_COURSE)은 **대표 코스 위 진행 좌표의 변화량 합**으로 잰다.
   * 회랑 밖 창(OFF_COURSE·ANGEL_DETOUR·DAILY_LIFE)은 투영할 선이 없으므로
   * 예전 그대로 픽스 사이 haversine 합이다. 계측기가 둘이라는 사실 자체가
   * 이 변경의 남는 위험이며, 화면에 distanceMeasure로 그대로 드러낸다(제3조).
   */
  closeWindow(): WalkSample | null {
    const buffered = this.#fixes;
    const steps = this.#stepsInWindow;
    const mock = this.#mockDetected;
    const bridgeM = this.#bridgeM;
    const bridgeS = this.#bridgeS;
    const bridgeProjM = this.#bridgeProjM;
    const bridgeCourseIdx = this.#bridgeCourseIdx;
    // 좌표 즉시 폐기 — 어떤 경로로도 이 창의 좌표는 다시 읽을 수 없다.
    this.#fixes = [];
    this.#stepsInWindow = 0;
    this.#mockDetected = false;
    this.#droppedInWindow = 0;
    this.#bridgeM = 0;
    this.#bridgeS = 0;
    this.#bridgeProjM = null;
    this.#bridgeCourseIdx = null;
    this.#carryFix = null;
    this.#carryCourseIdx = null;
    this.#carryAlongM = null;

    if (mock || buffered.length < this.#params.minFixesPerWindow) {
      this.#lastCourseIdx = null;
      this.#lastAlongM = null;
      this.#lastFixTs = null;
      return null;
    }

    const first = buffered[0]!.fix;
    const last = buffered[buffered.length - 1]!.fix;
    const ownDurationS = Math.max(1, (last.timestamp - first.timestamp) / 1000);

    const judgements = buffered.map((b) => b.j);
    const outside = judgements.filter((j) => !j.inCorridor).length;
    const offRatio = outside / judgements.length;
    const onCourse = offRatio < this.#params.offCorridorRatioThreshold;

    let tier: WalkTier;
    let courseId: string | undefined;
    let difficultyTenths: number | undefined;
    let detourAngelMemberId: string | undefined;
    /** 투영 계측의 기준 코스. ON_COURSE일 때만 정해진다. */
    let repCourseIdx: number | null = null;

    if (onCourse) {
      tier = 'ON_COURSE';
      // 창의 대표 판정: 회랑 안 픽스의 중앙값 위치 구간 기준.
      const inside = judgements.filter((j) => j.inCorridor);
      const median = inside[Math.floor(inside.length / 2)]!;
      const course = this.#courses[median.courseIdx]!;
      courseId = course.courseId;
      difficultyTenths = segmentMetaAt(course, median.segmentIndex).difficultyTenths;
      repCourseIdx = median.courseIdx;
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

    let distanceM = this.#measureDistance(buffered, repCourseIdx);

    // 이월분 정산 (위 2번 규칙 — 자기 속도 상한).
    // 회랑 안 창이고 이월 구간도 같은 코스 위였다면 이월도 투영으로 잰다.
    const projectedBridge = repCourseIdx !== null && bridgeProjM !== null && bridgeCourseIdx === repCourseIdx;
    const rawBridgeM = projectedBridge ? bridgeProjM! : bridgeM;
    /**
     * ★상한 배수 (2026-07-27).
     *
     * haversine 이월은 예전 그대로 **자기 평균 속도 1배**로 묶는다 — 횡방향 튐이 그대로
     * 거리로 들어오기 때문이다(경계에서 500 m 튀는 경우가 실제로 있다).
     *
     * 투영 이월은 다르다. 코스 선 위 이동량이므로 횡방향 튐은 이미 상쇄돼 있고, 남는 것은
     * 방향이 대칭인 종방향 노이즈뿐이다. 여기에 1배 상한을 걸면 **위로 튄 것은 잘리고
     * 아래로 튄 것은 그대로** 남아, 대칭 오차가 한쪽으로만 손해로 바뀐다(실측 −4.8%).
     * 정직한 사람이 걸은 거리를 깎는 것도 제6조 위반이므로 2배까지 열어 대칭을 회복한다.
     * 2배여도 이월은 창당 한 구간(≈5초)이라 상한은 여전히 좁다.
     */
    const paceMps = distanceM / ownDurationS;
    const creditedBridgeM = Math.min(rawBridgeM, paceMps * bridgeS * (projectedBridge ? 2 : 1));
    distanceM += creditedBridgeM;
    const durationS = ownDurationS + bridgeS;
    // 이번 창이 유효하므로 다음 창이 이어붙일 수 있게 마지막 좌표 하나만 남긴다.
    // (다음 addFix에서 거리로 환산되고 즉시 폐기된다 — addFix 주석 참조.)
    const lastJ = buffered[buffered.length - 1]!.j;
    this.#carryFix = last;
    this.#carryCourseIdx = lastJ.alongM === null ? null : lastJ.courseIdx;
    this.#carryAlongM = lastJ.alongM;

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

  /**
   * 창 거리 계측.
   *
   * `repCourseIdx`가 있으면(회랑 안 창) 그 코스 위 진행 좌표의 **순이동**으로 잰다.
   * repCourseIdx가 없으면 전부 예전 그대로 haversine 합이다.
   *
   * ── 왜 "합"이 아니라 "순이동"인가 (실측으로 갈렸다) ──────────────────
   * 처음에는 사영점 변화량의 **절댓값 합**(Σ|Δs|)으로 쟀다. 그런데 픽스가 5초마다
   * 오는데 보행 속도가 1.2 m/s면 한 걸음 사이의 진짜 이동은 6 m뿐이다. σ25 노이즈의
   * 한 스텝 변동은 13 m — **노이즈가 실제 이동보다 크다.** 절댓값 합은 그 노이즈를
   * 그대로 더해 σ15에서 +11.8%, σ25에서 +87.1%를 만들었다(실측). 방향을 지운 합은
   * haversine 합이 가진 병을 축만 바꿔서 그대로 물려받는다.
   *
   * 순이동(마지막 사영점 − 첫 사영점)은 노이즈가 **양변에서 상쇄**되므로 노이즈 크기와
   * 무관하다. 물리적으로도 이쪽이 옳다 — 회랑 안이라면 1분 동안 나아간 거리는 코스
   * 위에서 얼마나 전진했는가다.
   *
   * 대가: **창 안에서 되돌아 걸으면 그만큼 깎인다.** 다만 스위치백은 폴리라인 자체가
   * 꺾여 있어 s가 단조 증가하므로 해당하지 않고, 진짜 U턴은 그 U턴이 든 창 하나에서만
   * 손해가 난다(60초 = 약 70 m 이내). 회랑 밖으로 나갔다 들어온 구간은 아래처럼 잘라서
   * 각각 순이동으로 재고, 그 사이는 직선으로 잇는다.
   */
  #measureDistance(buffered: BufferedFix[], repCourseIdx: number | null): number {
    if (repCourseIdx === null) {
      let sum = 0;
      for (let i = 1; i < buffered.length; i++) sum += haversineM(buffered[i - 1]!.fix, buffered[i]!.fix);
      return sum;
    }
    let total = 0;
    let runStart: number | null = null;
    let runLast = 0;
    let prevFix: GpsFix | null = null;
    let prevOnCourse = false;
    for (const { fix, j } of buffered) {
      const onCourse = j.courseIdx === repCourseIdx && j.alongM !== null;
      if (onCourse) {
        if (runStart === null) {
          runStart = j.alongM!;
          // 회랑 밖에 있다가 돌아온 자리 — 그 한 구간은 잴 기준선이 없어 직선으로 잇는다.
          if (prevFix !== null && !prevOnCourse) total += haversineM(prevFix, fix);
        }
        runLast = j.alongM!;
      } else {
        if (runStart !== null) {
          total += Math.abs(runLast - runStart);
          runStart = null;
        }
        if (prevFix !== null) total += haversineM(prevFix, fix);
      }
      prevFix = fix;
      prevOnCourse = onCourse;
    }
    if (runStart !== null) total += Math.abs(runLast - runStart);
    return total;
  }

  /**
   * 정확도로 넓혀 주는 회랑 여유 (m).
   * 완전 신뢰 정확도(maxAccuracyM)까지는 0이고, 그 초과분만큼 넓히되
   * maxAccuracySlackM에서 멈춘다 — 발행되는 땅의 크기에 상한을 둔다.
   */
  #slackFor(fix: GpsFix): number {
    if (fix.accuracy === undefined) return 0;
    const over = fix.accuracy - this.#params.maxAccuracyM;
    if (over <= 0) return 0;
    return Math.min(over, this.#params.maxAccuracySlackM);
  }

  #judgeFix(fix: GpsFix): FixJudgement {
    const slackM = this.#slackFor(fix);
    let best: FixJudgement = {
      inCorridor: false,
      courseIdx: 0,
      segmentIndex: 0,
      distanceToCourseM: Number.POSITIVE_INFINITY,
      alongM: null,
      slackM,
    };
    for (let c = 0; c < this.#courses.length; c++) {
      const course = this.#courses[c]!;
      const index = this.#index[c]!;
      // 국지 투영: 직전 픽스가 같은 코스 위에 있었다면 그 주변 선분만 본다.
      // 자기교차 구간에서 사영점이 멀리 뛰는 것을 구조적으로 막는다 (geo.ts 주석).
      const hint = this.#hintFor(c, fix.timestamp);
      const local = hint ? projectOnPolyline(fix, index, hint) : null;
      // 국지 후보가 이미 회랑 안이면 그것을 믿는다(전역 탐색을 생략해 5,569점 코스에서도
      // 픽스당 비용이 일정하다). 회랑 밖이면 — 코스를 크게 벗어났거나 차를 탔거나 —
      // 전역 사영으로 되돌아가 코스까지의 진짜 최단 거리를 다시 잡는다.
      const near =
        local && local.distanceM <= corridorHalfWidthAt(course, local.segmentIndex) + slackM
          ? local
          : projectOnPolyline(fix, index);
      if (near.distanceM < best.distanceToCourseM) {
        best = {
          inCorridor: near.distanceM <= corridorHalfWidthAt(course, near.segmentIndex) + slackM,
          courseIdx: c,
          segmentIndex: near.segmentIndex,
          distanceToCourseM: near.distanceM,
          alongM: near.alongM,
          slackM,
        };
      }
    }
    return best;
  }

  /** 국지 투영 힌트 — 직전 픽스와 같은 코스이고 시간 간격이 짧을 때만. */
  #hintFor(courseIdx: number, timestamp: number): { alongM: number; radiusM: number } | undefined {
    if (this.#lastCourseIdx !== courseIdx || this.#lastAlongM === null || this.#lastFixTs === null) return undefined;
    const gapS = (timestamp - this.#lastFixTs) / 1000;
    if (gapS < 0 || gapS > this.#params.maxBridgeGapS) return undefined;
    return {
      alongM: this.#lastAlongM,
      radiusM: Math.max(PROJECTION_MIN_RADIUS_M, gapS * PROJECTION_MAX_SPEED_MPS),
    };
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

  #updateLiveStatus(fix: GpsFix, j: FixJudgement): void {
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
      accuracyM: fix.accuracy === undefined ? null : Math.round(fix.accuracy),
      lastFixAccepted: true,
      windowFixes: this.#fixes.length,
      droppedFixes: this.#droppedInWindow,
      minFixesPerWindow: this.#params.minFixesPerWindow,
      corridorSlackM: Math.round(j.slackM),
      distanceMeasure: j.inCorridor ? 'PROJECTED' : 'DIRECT',
    };
  }
}
