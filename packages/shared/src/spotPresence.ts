/**
 * 스팟 현장 결속 (R-스팟-현장결속 — M9 몸-걸음 인증을 M12 스팟 청구에 결합).
 *
 * 문제(V-1): 스팟 청구는 spotId만 알면 **원격으로** 가능했다. `GET /spot`이 위치·
 * 잔여를 공개하므로 벽 QR 스캔은 위치 증명이 아니라 spotId 취득 수단일 뿐이었고,
 * 이는 사업자의 **방문 유인**을 무력화했다(집에서 슬롯 원격 소진).
 *
 * 해법: 청구 전에 서버가 **1회용 랜덤 이동 지시**를 발급하고, 손님이 그 자리에서
 * 몸으로 수행해야 청구가 성립하게 한다.
 *
 * ── 두 겹의 검증 (헌법 제9조와 정합) ──────────────────────────────────
 *  ① 폰 로컬 (서버가 볼 수 없는 것): 스팟 근접 + 상대 변위·방향 판정(treasure.ts
 *     verifyLeg). 좌표는 휘발성 버퍼에만 있고 서버로 가지 않는다.
 *  ② 서버 (좌표 없이 할 수 있는 것): 지시가 **서버가 방금 낸 랜덤 값**인지, 1회용
 *     인지, 만료 전인지, 보고된 걸음 수가 지시 대역 안인지, 그리고 **물리적으로
 *     가능한 시간**이 걸렸는지. 좌표·경로는 여기 어디에도 없다.
 *
 * 이 조합이 막는 것: 원격 청구(폰이 근접을 요구), 사전 계산·재사용(지시가 매번 랜덤
 * 1회용), 즉시 자동 응답(최소 소요 시간), 무의미한 값 제출(걸음 대역 검사).
 *
 * ★막지 못하는 것 (정직화 — 헌법 제3조): 변조 앱은 움직이지 않고도 그럴듯한 걸음 수를
 *  꾸며 보고할 수 있다. 서버는 좌표를 보지 못하므로 이를 구분할 수 없다. 이것은 코인
 *  발행 전체가 지는 것과 **같은** 근본 한계이며, 같은 방어(앱 무결성 인증 + 회원 번호 +
 *  소명 책임)가 맡는다. 현장 결속은 "정직한 앱을 쓰는 원격 사용자"와 "단순 자동화"를
 *  막는 층이지, 변조 앱까지 막는 층이 아니다.
 */
import { hashObject } from './crypto';
import { DEFAULT_LEG_TOLERANCE, type LegTolerance, type MovementDir, type MovementLeg } from './treasure';

// ── 파라미터 ──────────────────────────────────────────────────────

/** 지시 다리 수 — 3개면 방향 조합이 충분히 랜덤하면서 현장 부담이 크지 않다. */
export const SPOT_PRESENCE_LEG_COUNT = 3;

/**
 * 지시 걸음 대역 15~25.
 *
 * ★하한 15의 근거 (두 문턱을 **모두** 넘어야 폰 로컬 판정에 실효가 있다):
 *  ① `stepOnlyBelowSteps`(8) 초과 — 이 아래는 걸음 수만 보고 통과시킨다.
 *  ② **제자리 부정을 잡는 변위 하한이 양수여야 한다.** verifyLeg의 하한은
 *     `steps × strideMinM − gpsNoiseM/2` = `steps × 0.5 − 6`이라, 12걸음 이하에서는
 *     하한이 0으로 무너져 **가만히 서서 흔들어도 통과**한다. 15걸음이면 하한 1.5 m,
 *     25걸음이면 6.5 m가 생겨 "안 움직임"이 실제로 걸린다.
 * 상한 25는 현장 부담(가게 앞 좁은 공간)을 고려한 값 — 3다리 총 45~75걸음.
 */
export const SPOT_PRESENCE_LEG_STEPS_MIN = 15;
export const SPOT_PRESENCE_LEG_STEPS_MAX = 25;

/** 지시 유효 시간 — 그 자리에서 바로 하라는 뜻. 지나면 다시 받아야 한다. */
export const SPOT_PRESENCE_CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * 걸음당 최소 소요 시간(ms). 0.3 s/걸음 = 초당 3.3걸음은 사람이 지속할 수 없는
 * 속도라 오탐이 사실상 없고, 자동화에는 지시 총 걸음에 비례하는 시간 비용을 물린다.
 * (30걸음 → 최소 9초. 버스트 상한과 겹쳐 대량 원격 청구를 느리게 만든다.)
 */
export const SPOT_PRESENCE_MIN_MS_PER_STEP = 300;

// ── 타입 ──────────────────────────────────────────────────────────

/** 서버가 발급한 1회용 이동 지시. */
export interface SpotPresenceChallenge {
  challengeId: string;
  spotId: string;
  legs: MovementLeg[];
  issuedAt: number;
  expiresAt: number;
}

/** 손님이 보고하는 수행 요약 한 다리 — 지시 + 측정 걸음 수. 좌표·변위는 없다. */
export interface SpotPresenceLegReport {
  dir: MovementDir;
  steps: number;
  /** 폰이 측정한 걸음 증분 (위치 정보가 아니다). */
  measuredSteps: number;
}

export type SpotPresenceRejectReason =
  | 'MALFORMED'
  | 'LEGS_MISMATCH' // 보고된 지시가 서버가 발급한 지시와 다르다 (위조·재사용)
  | 'STEPS_OUT_OF_BAND' // 측정 걸음 수가 지시 대역 밖
  | 'TOO_FAST'; // 물리적으로 불가능한 속도 (자동 응답)

export interface SpotPresenceVerdict {
  ok: boolean;
  reason?: SpotPresenceRejectReason;
}

// ── 지시 생성 (서버) ──────────────────────────────────────────────

const DIRS: readonly MovementDir[] = ['N', 'E', 'S', 'W'];

/**
 * 랜덤 이동 지시 생성. 난수는 주입한다(테스트 결정성) — `randomInt(maxExclusive)`.
 * 연속한 두 다리가 **정반대 방향이 되지 않게** 한다: 제자리 왕복(N 10걸음 → S 10걸음)은
 * 변위가 상쇄돼 폰 판정이 무의미해지고, 좁은 공간에서 되돌아오기만 반복하게 된다.
 */
export function randomPresenceLegs(
  randomInt: (maxExclusive: number) => number,
  legCount: number = SPOT_PRESENCE_LEG_COUNT,
): MovementLeg[] {
  const opposite: Record<MovementDir, MovementDir> = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const legs: MovementLeg[] = [];
  let prev: MovementDir | null = null;
  for (let i = 0; i < legCount; i++) {
    const last = prev;
    const choices: readonly MovementDir[] =
      last === null ? DIRS : DIRS.filter((d) => d !== opposite[last] && d !== last);
    const dir: MovementDir = choices[randomInt(choices.length)] ?? DIRS[0]!;
    const span = SPOT_PRESENCE_LEG_STEPS_MAX - SPOT_PRESENCE_LEG_STEPS_MIN + 1;
    legs.push({ dir, steps: SPOT_PRESENCE_LEG_STEPS_MIN + randomInt(span) });
    prev = dir;
  }
  return legs;
}

/**
 * 이 지시를 사람이 수행하는 데 물리적으로 필요한 최소 시간(ms).
 * minMsPerStep은 운영 상수가 기본이며, 테스트가 실시간 대기 없이 흐름을 검증할 수
 * 있도록 주입 가능하다 (서버 컨텍스트의 다른 시간 파라미터들과 같은 방식).
 */
export function presenceMinDurationMs(
  legs: MovementLeg[],
  minMsPerStep: number = SPOT_PRESENCE_MIN_MS_PER_STEP,
): number {
  const totalSteps = legs.reduce((s, l) => s + l.steps, 0);
  return totalSteps * minMsPerStep;
}

/** verifyPresenceTranscript 조정값 (전부 선택 — 미지정 시 운영 기본값). */
export interface PresenceVerifyOptions {
  tolerance?: LegTolerance;
  /** 걸음당 최소 소요 시간(ms). 기본 SPOT_PRESENCE_MIN_MS_PER_STEP. */
  minMsPerStep?: number;
}

// ── 수행 검증 (서버 — 좌표 없이 할 수 있는 것만) ──────────────────

/**
 * 보고된 수행 요약을 **서버가 발급한 지시**와 대조한다.
 *
 * 검사 순서: 형식 → 지시 일치(위조·재사용 차단) → 최소 소요 시간(자동 응답 차단)
 * → 걸음 수 대역(무의미한 값 차단). 변위·방향은 여기서 볼 수 없다(좌표 비수신) —
 * 그것은 폰 로컬 판정(verifyLeg)의 몫이다.
 */
export function verifyPresenceTranscript(
  issued: MovementLeg[],
  reported: SpotPresenceLegReport[],
  elapsedMs: number,
  options: PresenceVerifyOptions = {},
): SpotPresenceVerdict {
  const tolerance = options.tolerance ?? DEFAULT_LEG_TOLERANCE;
  if (!Array.isArray(issued) || !Array.isArray(reported) || issued.length === 0) {
    return { ok: false, reason: 'MALFORMED' };
  }
  if (reported.length !== issued.length) return { ok: false, reason: 'LEGS_MISMATCH' };
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return { ok: false, reason: 'MALFORMED' };

  for (const [i, want] of issued.entries()) {
    const got = reported[i]!;
    if (got === null || typeof got !== 'object') return { ok: false, reason: 'MALFORMED' };
    if (!Number.isInteger(got.measuredSteps) || got.measuredSteps < 0) {
      return { ok: false, reason: 'MALFORMED' };
    }
    // 지시 일치 — 서버가 낸 그 지시를 그대로 수행했다고 보고해야 한다.
    if (got.dir !== want.dir || got.steps !== want.steps) return { ok: false, reason: 'LEGS_MISMATCH' };
  }

  // 물리적 최소 시간 — 지시 총 걸음에 비례. 즉시 자동 응답을 막는다.
  if (elapsedMs < presenceMinDurationMs(issued, options.minMsPerStep)) return { ok: false, reason: 'TOO_FAST' };

  // 걸음 수 대역 — M9와 동일한 관용치(만보기 지연·경계 오차 흡수).
  for (const [i, want] of issued.entries()) {
    const got = reported[i]!;
    const band = Math.max(tolerance.stepMinToleranceSteps, Math.round(want.steps * tolerance.stepRatioTolerance));
    if (Math.abs(got.measuredSteps - want.steps) > band) {
      return { ok: false, reason: 'STEPS_OUT_OF_BAND' };
    }
  }

  return { ok: true };
}

/**
 * 수행 요약의 해시 — 청구 대장에 남기는 감사 흔적이다.
 * 이동 원자료(좌표·변위)가 아니라 "이 회원이 이 지시를 이렇게 완수했다"는 요약의
 * 해시이므로, 서버는 이것으로 이동을 복원할 수 없다 (M9 transcriptHash와 같은 성격).
 */
export function spotPresenceTranscriptHash(
  challengeId: string,
  spotId: string,
  memberId: string,
  legs: SpotPresenceLegReport[],
): string {
  return hashObject({
    t: 'shvil-spot-presence-transcript-v1',
    challengeId,
    spotId,
    memberId,
    legs: legs.map((l) => ({ dir: l.dir, steps: l.steps, measuredSteps: l.measuredSteps })),
  });
}
