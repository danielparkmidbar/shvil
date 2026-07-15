/**
 * 몸 인증 · 보물 마이닝 코어 (M9 — docs/몸인증_보물마이닝_설계.md).
 *
 * 운영자가 트레일 특별 존에 보물(코인 또는 무보상 인증 스탬프)을 숨긴다.
 * 걷는 사람이 존에 들어서면 이동 지시("북쪽으로 10걸음 → …")가 뜨고,
 * 몸으로 정확히 수행하면 보물을 얻는다.
 *
 * 아키텍처 (2026-07-15 확정):
 *  - **이동 검증은 100% 폰 로컬.** 서버는 걸음·방향·좌표를 전혀 받지 않는다.
 *  - 획득 시 서버 왕복은 1회뿐 (POST /treasures/claim) — 수량 한정 발행의 회계 때문.
 *    서버가 받는 것은 memberId + treasureId + transcriptHash(성공 요약의 해시)뿐이다.
 *  - 판정에 쓰는 것은 존 진입 시점 대비 **상대 변위**(Δ북/Δ동)와 걸음 증분뿐이며,
 *    측정은 휘발성 버퍼에서만 이루어지고 즉시 폐기된다 (위치 비저장 원칙).
 *
 * 이 모듈은 순수 함수만 담는다 — 센서 연동·세션 상태는 앱(walk/treasureSession)이,
 * 발행 회계·수량 한정은 서버(server/src/treasure.ts)가 맡는다.
 */
import { hashObject } from './crypto';
import type { GeoPoint } from './courses';

// ── 타입 ──────────────────────────────────────────────────────────

/** 이동 지시의 방향 — 나침반 4방위. */
export type MovementDir = 'N' | 'E' | 'S' | 'W';

/** 이동 지시 한 다리: "북쪽으로 10걸음". */
export interface MovementLeg {
  dir: MovementDir;
  /** 지시 걸음 수 (LEG_STEPS_MIN~LEG_STEPS_MAX). */
  steps: number;
}

export const LEG_STEPS_MIN = 3;
export const LEG_STEPS_MAX = 50;

/** 보물이 숨겨진 존 — 공개 트레일 위 운영자 공개 좌표 (사용자 좌표 아님). */
export interface TreasureZone {
  center: GeoPoint;
  radiusM: number;
}

/**
 * 보물 명세 — 운영자가 발행·서버가 배포한다 (기존 /courses 배포 패턴).
 * 지시(legs)가 공개되어도 존에 도착해 몸으로 수행하지 않으면 소용없다.
 */
export interface TreasureSpec {
  treasureId: string;
  /** 소속 트레일 지역 (regions.ts). */
  regionId: string;
  zone: TreasureZone;
  /** 보상 (dSHV). 0 = 무보상 인증 미션(구간 인증 스탬프). */
  amountDshv: number;
  /** 수량 한정 발행 총량 (1인 1회와 별개의 전체 한도). */
  totalCount: number;
  validFrom: number;
  validUntil: number;
  legs: MovementLeg[];
}

// ── 판정 관용치 ───────────────────────────────────────────────────

/**
 * 다리 판정 관용치. 근거:
 *  - 보폭 대역 0.5~0.9 m: 걷기 필터(DEFAULT_WALK_FILTER_PARAMS)와 동일한 인간 보폭 가정.
 *  - 방향 허용 ±35°: 4방위 지시(서로 90° 간격)를 겹침 없이 구분하면서, 손에 든 폰의
 *    나침반 없이 GPS 변위만으로 판정하는 오차(도심 5~15 m)를 흡수한다.
 *  - 걸음 수 허용 ±40% 또는 최소 ±3걸음: 만보기 지연·시작/끝 경계 오차 흡수.
 *  - 짧은 다리(<8걸음)는 걸음 수 위주 판정: 8걸음 × 0.9 m ≈ 7 m는 도심 GPS 정확도
 *    (5~15 m)에 묻히므로 변위·방향 검사가 무의미하다 — 걸음 검사만 적용.
 *  - gpsNoiseM 12 m: 도심 GPS 정확도 중앙값 근사. 변위 대역을 이만큼 완충한다.
 *  - headingMinDistanceM 5 m: 측정 변위가 이보다 작으면 방향은 노이즈다 — 방향 검사 생략
 *    (거리 대역 검사가 실이동 부재를 잡는다).
 */
export interface LegTolerance {
  strideMinM: number;
  strideMaxM: number;
  headingToleranceDeg: number;
  /** 걸음 수 허용 비율 (±). */
  stepRatioTolerance: number;
  /** 걸음 수 최소 허용 폭 (±걸음). */
  stepMinToleranceSteps: number;
  /** 이 미만 걸음 지시는 걸음 수 위주 판정 (변위·방향 생략). */
  stepOnlyBelowSteps: number;
  /** GPS 오차 완충 (m) — 변위 대역에 가감. */
  gpsNoiseM: number;
  /** 측정 변위가 이(m) 미만이면 방향 판정 생략 (노이즈). */
  headingMinDistanceM: number;
}

export const DEFAULT_LEG_TOLERANCE: LegTolerance = {
  strideMinM: 0.5,
  strideMaxM: 0.9,
  headingToleranceDeg: 35,
  stepRatioTolerance: 0.4,
  stepMinToleranceSteps: 3,
  stepOnlyBelowSteps: 8,
  gpsNoiseM: 12,
  headingMinDistanceM: 5,
};

export type LegRejectReason =
  | 'MALFORMED' // 지시·측정값이 형식에 안 맞음
  | 'STEPS_OUT_OF_BAND' // 걸음 수가 허용 대역 밖
  | 'DISTANCE_OUT_OF_BAND' // GPS 상대 변위 크기가 보폭 대역 밖
  | 'HEADING_OFF'; // 이동 방향이 지시 방향에서 허용각 초과

export interface LegVerdict {
  ok: boolean;
  reason?: LegRejectReason;
}

/** 지시 다리 형식 검사 (서버 시드·배포 수신 방어). */
export function isMovementLeg(v: unknown): v is MovementLeg {
  if (v === null || typeof v !== 'object') return false;
  const leg = v as { dir?: unknown; steps?: unknown };
  return (
    (leg.dir === 'N' || leg.dir === 'E' || leg.dir === 'S' || leg.dir === 'W') &&
    typeof leg.steps === 'number' &&
    Number.isInteger(leg.steps) &&
    leg.steps >= LEG_STEPS_MIN &&
    leg.steps <= LEG_STEPS_MAX
  );
}

/** 보물 명세 형식 검사 — 서버 등록·클라이언트 캐시 수신의 공용 방어선. */
export function isValidTreasureSpec(v: unknown): v is TreasureSpec {
  if (v === null || typeof v !== 'object') return false;
  const s = v as Partial<TreasureSpec>;
  return (
    typeof s.treasureId === 'string' &&
    /^[a-z0-9-]{3,64}$/.test(s.treasureId) &&
    typeof s.regionId === 'string' &&
    s.regionId.length > 0 &&
    s.zone !== null &&
    typeof s.zone === 'object' &&
    typeof s.zone.center?.lat === 'number' &&
    typeof s.zone.center?.lon === 'number' &&
    typeof s.zone.radiusM === 'number' &&
    s.zone.radiusM > 0 &&
    typeof s.amountDshv === 'number' &&
    Number.isInteger(s.amountDshv) &&
    s.amountDshv >= 0 &&
    typeof s.totalCount === 'number' &&
    Number.isInteger(s.totalCount) &&
    s.totalCount > 0 &&
    typeof s.validFrom === 'number' &&
    typeof s.validUntil === 'number' &&
    s.validUntil > s.validFrom &&
    Array.isArray(s.legs) &&
    s.legs.length >= 1 &&
    s.legs.every(isMovementLeg)
  );
}

// ── 다리 판정 (순수 함수 — 폰 로컬 전용) ──────────────────────────

/** 방향별 단위 벡터 (북=+N, 동=+E). */
const DIR_UNIT: Record<MovementDir, { n: number; e: number }> = {
  N: { n: 1, e: 0 },
  E: { n: 0, e: 1 },
  S: { n: -1, e: 0 },
  W: { n: 0, e: -1 },
};

/**
 * 한 다리 수행 판정.
 *
 * @param dxNorthM 다리 시작 시점 대비 북쪽 상대 변위 (m, 남쪽이면 음수)
 * @param dxEastM  다리 시작 시점 대비 동쪽 상대 변위 (m, 서쪽이면 음수)
 * @param stepDelta 다리 시작 이후 걸음 증분
 *
 * 입력은 상대 변위뿐이다 — 절대 좌표는 이 함수에 닿지 않는다.
 * 판정 순서: 걸음 대역 → (짧은 다리면 여기서 종료) → 변위 크기 대역 → 방향 각도.
 */
export function verifyLeg(
  dxNorthM: number,
  dxEastM: number,
  stepDelta: number,
  leg: MovementLeg,
  tolerance: LegTolerance = DEFAULT_LEG_TOLERANCE,
): LegVerdict {
  if (!isMovementLeg(leg)) return { ok: false, reason: 'MALFORMED' };
  if (!Number.isInteger(stepDelta) || stepDelta < 0 || !Number.isFinite(dxNorthM) || !Number.isFinite(dxEastM)) {
    return { ok: false, reason: 'MALFORMED' };
  }

  // 1) 걸음 수 대역: ±max(최소 허용, 지시 걸음 × 비율).
  const stepBand = Math.max(tolerance.stepMinToleranceSteps, Math.round(leg.steps * tolerance.stepRatioTolerance));
  if (Math.abs(stepDelta - leg.steps) > stepBand) {
    return { ok: false, reason: 'STEPS_OUT_OF_BAND' };
  }

  // 2) 짧은 다리는 걸음 수 위주 판정 — 기대 변위(<8걸음 × 0.9 m ≈ 7 m)가
  //    도심 GPS 정확도(5~15 m)에 묻혀 변위·방향 검사가 무의미하다.
  if (leg.steps < tolerance.stepOnlyBelowSteps) {
    return { ok: true };
  }

  // 3) 변위 크기 대역: 보폭 0.5~0.9 m 가정 + GPS 오차 완충.
  //    하한은 완충의 절반만 뺀다 — "걸음만 흔들고 제자리"를 잡는 하한을 너무 무르게 하지 않기 위해.
  const distanceM = Math.hypot(dxNorthM, dxEastM);
  const lowerM = Math.max(0, leg.steps * tolerance.strideMinM - tolerance.gpsNoiseM / 2);
  const upperM = leg.steps * tolerance.strideMaxM + tolerance.gpsNoiseM;
  if (distanceM < lowerM || distanceM > upperM) {
    return { ok: false, reason: 'DISTANCE_OUT_OF_BAND' };
  }

  // 4) 방향 각도: 측정 변위가 노이즈 바닥(headingMinDistanceM)을 넘을 때만 판정.
  if (distanceM >= tolerance.headingMinDistanceM) {
    const unit = DIR_UNIT[leg.dir];
    const cos = (dxNorthM * unit.n + dxEastM * unit.e) / distanceM;
    const angleDeg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    if (angleDeg > tolerance.headingToleranceDeg) {
      return { ok: false, reason: 'HEADING_OFF' };
    }
  }

  return { ok: true };
}

// ── 성공 요약 해시 (서버 전달용 — 이동 원자료가 아니다) ───────────

/** 다리별 성공 요약 — 지시 내용 + 측정 걸음 수뿐. 변위·좌표는 넣지 않는다. */
export interface LegTranscript {
  dir: MovementDir;
  steps: number;
  /** 판정 시점의 측정 걸음 증분 (위치 정보가 아니다). */
  measuredSteps: number;
}

/**
 * 챌린지 성공 요약의 해시 — POST /treasures/claim에 실려 가는 유일한 수행 증빙.
 * 이동 원자료(좌표·변위)가 아니라 "이 회원이 이 보물의 지시를 이렇게 완수했다"는
 * 요약의 해시다. 서버는 이 해시로 이동 데이터를 복원할 수 없다.
 */
export function treasureTranscriptHash(treasureId: string, memberId: string, legs: LegTranscript[]): string {
  return hashObject({
    t: 'shvil-treasure-transcript-v1',
    treasureId,
    memberId,
    legs: legs.map((l) => ({ dir: l.dir, steps: l.steps, measuredSteps: l.measuredSteps })),
  });
}
