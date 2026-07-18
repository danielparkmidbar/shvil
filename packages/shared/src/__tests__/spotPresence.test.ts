/**
 * 스팟 현장 결속 (R-스팟-현장결속) 코어 테스트.
 *
 * 서버가 좌표 없이 할 수 있는 검증만 여기 있다: 지시 일치(위조·재사용 차단),
 * 최소 소요 시간(자동 응답 차단), 걸음 대역. 변위·방향 판정은 폰 로컬(verifyLeg)의
 * 몫이며 이 모듈의 책임이 아니다.
 */
import { describe, expect, it } from 'vitest';
import {
  SPOT_PRESENCE_CHALLENGE_TTL_MS,
  SPOT_PRESENCE_LEG_COUNT,
  SPOT_PRESENCE_LEG_STEPS_MAX,
  SPOT_PRESENCE_LEG_STEPS_MIN,
  SPOT_PRESENCE_MIN_MS_PER_STEP,
  presenceMinDurationMs,
  randomPresenceLegs,
  spotPresenceTranscriptHash,
  verifyPresenceTranscript,
  type SpotPresenceLegReport,
} from '../spotPresence';
import { DEFAULT_LEG_TOLERANCE, type MovementLeg } from '../treasure';

/** 결정적 난수 — 주어진 수열을 순환한다. */
function seqRandom(values: number[]): (max: number) => number {
  let i = 0;
  return (max) => values[i++ % values.length]! % max;
}

/** 지시를 정확히 수행한 보고 (측정=지시). */
function perfectReport(legs: MovementLeg[]): SpotPresenceLegReport[] {
  return legs.map((l) => ({ dir: l.dir, steps: l.steps, measuredSteps: l.steps }));
}

describe('randomPresenceLegs — 1회용 랜덤 지시', () => {
  it('기본 다리 수와 걸음 대역을 지킨다', () => {
    const legs = randomPresenceLegs(seqRandom([0, 1, 2, 3, 5, 7]));
    expect(legs).toHaveLength(SPOT_PRESENCE_LEG_COUNT);
    for (const l of legs) {
      expect(l.steps).toBeGreaterThanOrEqual(SPOT_PRESENCE_LEG_STEPS_MIN);
      expect(l.steps).toBeLessThanOrEqual(SPOT_PRESENCE_LEG_STEPS_MAX);
      expect(['N', 'E', 'S', 'W']).toContain(l.dir);
    }
  });

  it('★걸음 하한이 폰 로컬 변위·방향 검사 문턱(stepOnlyBelowSteps) 위다', () => {
    // 이 불변식이 깨지면 폰이 걸음 수만 보고 통과시켜 현장 결속이 무의미해진다.
    expect(SPOT_PRESENCE_LEG_STEPS_MIN).toBeGreaterThan(DEFAULT_LEG_TOLERANCE.stepOnlyBelowSteps);
  });

  it('★걸음 하한에서 "제자리 부정"을 잡는 변위 하한이 양수다', () => {
    // verifyLeg의 하한 = steps × strideMinM − gpsNoiseM/2.
    // 이것이 0이면 가만히 서서 걸음만 흔들어도 통과한다 — 현장 결속이 무너진다.
    const lowerBoundM =
      SPOT_PRESENCE_LEG_STEPS_MIN * DEFAULT_LEG_TOLERANCE.strideMinM - DEFAULT_LEG_TOLERANCE.gpsNoiseM / 2;
    expect(lowerBoundM).toBeGreaterThan(0);
  });

  it('연속한 다리가 정반대·동일 방향이 되지 않는다 (제자리 왕복 방지)', () => {
    const opposite: Record<string, string> = { N: 'S', S: 'N', E: 'W', W: 'E' };
    for (let seed = 0; seed < 40; seed++) {
      const legs = randomPresenceLegs(seqRandom([seed, seed + 1, seed + 2, seed + 3]), 6);
      for (let i = 1; i < legs.length; i++) {
        expect(legs[i]!.dir).not.toBe(opposite[legs[i - 1]!.dir]);
        expect(legs[i]!.dir).not.toBe(legs[i - 1]!.dir);
      }
    }
  });
});

describe('presenceMinDurationMs', () => {
  it('지시 총 걸음에 비례한다', () => {
    const legs: MovementLeg[] = [
      { dir: 'N', steps: 10 },
      { dir: 'E', steps: 20 },
    ];
    expect(presenceMinDurationMs(legs)).toBe(30 * SPOT_PRESENCE_MIN_MS_PER_STEP);
  });
});

describe('verifyPresenceTranscript', () => {
  const issued: MovementLeg[] = [
    { dir: 'N', steps: 12 },
    { dir: 'E', steps: 18 },
    { dir: 'S', steps: 15 },
  ];
  const enough = presenceMinDurationMs(issued);

  it('정확히 수행하면 통과한다', () => {
    expect(verifyPresenceTranscript(issued, perfectReport(issued), enough)).toEqual({ ok: true });
  });

  it('관용치 안의 걸음 오차는 통과한다 (만보기 지연 흡수)', () => {
    const report = perfectReport(issued);
    report[0]!.measuredSteps = 12 + DEFAULT_LEG_TOLERANCE.stepMinToleranceSteps; // 하드 실패 아님
    expect(verifyPresenceTranscript(issued, report, enough).ok).toBe(true);
  });

  it('★다른 지시를 보고하면 거부한다 (위조·재사용 차단)', () => {
    const forged = perfectReport(issued);
    forged[1] = { dir: 'W', steps: 18, measuredSteps: 18 }; // 방향 바꿔치기
    expect(verifyPresenceTranscript(issued, forged, enough).reason).toBe('LEGS_MISMATCH');

    const wrongSteps = perfectReport(issued);
    wrongSteps[2] = { dir: 'S', steps: 11, measuredSteps: 11 }; // 걸음 지시 바꿔치기
    expect(verifyPresenceTranscript(issued, wrongSteps, enough).reason).toBe('LEGS_MISMATCH');
  });

  it('다리 수가 다르면 거부한다', () => {
    expect(verifyPresenceTranscript(issued, perfectReport(issued).slice(0, 2), enough).reason).toBe('LEGS_MISMATCH');
  });

  it('★물리적으로 불가능한 속도는 거부한다 (즉시 자동 응답 차단)', () => {
    expect(verifyPresenceTranscript(issued, perfectReport(issued), 0).reason).toBe('TOO_FAST');
    expect(verifyPresenceTranscript(issued, perfectReport(issued), enough - 1).reason).toBe('TOO_FAST');
  });

  it('걸음 수가 대역을 벗어나면 거부한다 (제자리에서 흔들기)', () => {
    const lazy = perfectReport(issued);
    lazy[0]!.measuredSteps = 0; // 안 걸었다
    expect(verifyPresenceTranscript(issued, lazy, enough).reason).toBe('STEPS_OUT_OF_BAND');

    const wild = perfectReport(issued);
    wild[1]!.measuredSteps = 200;
    expect(verifyPresenceTranscript(issued, wild, enough).reason).toBe('STEPS_OUT_OF_BAND');
  });

  it('형식 불량은 거부한다', () => {
    expect(verifyPresenceTranscript(issued, [], enough).reason).toBe('LEGS_MISMATCH');
    expect(verifyPresenceTranscript([], [], enough).reason).toBe('MALFORMED');
    const bad = perfectReport(issued);
    (bad[0] as { measuredSteps: unknown }).measuredSteps = 'x';
    expect(verifyPresenceTranscript(issued, bad, enough).reason).toBe('MALFORMED');
  });
});

describe('spotPresenceTranscriptHash — 감사 흔적 (이동 원자료 아님)', () => {
  const legs: SpotPresenceLegReport[] = [{ dir: 'N', steps: 12, measuredSteps: 12 }];

  it('같은 입력은 같은 해시, 다른 입력은 다른 해시', () => {
    const a = spotPresenceTranscriptHash('ch-1', 'spot-1', 'SHV-1', legs);
    expect(spotPresenceTranscriptHash('ch-1', 'spot-1', 'SHV-1', legs)).toBe(a);
    expect(spotPresenceTranscriptHash('ch-2', 'spot-1', 'SHV-1', legs)).not.toBe(a);
    expect(spotPresenceTranscriptHash('ch-1', 'spot-2', 'SHV-1', legs)).not.toBe(a);
    expect(spotPresenceTranscriptHash('ch-1', 'spot-1', 'SHV-2', legs)).not.toBe(a);
  });

  it('해시에 좌표·변위가 들어갈 자리가 없다 (요약 필드만)', () => {
    // 필드는 dir·steps·measuredSteps뿐 — 위치를 복원할 수 없다.
    const withExtra = [{ ...legs[0]!, lat: 33.2, lon: 35.6 } as SpotPresenceLegReport];
    expect(spotPresenceTranscriptHash('ch-1', 'spot-1', 'SHV-1', withExtra)).toBe(
      spotPresenceTranscriptHash('ch-1', 'spot-1', 'SHV-1', legs),
    );
  });
});

describe('TTL 파라미터', () => {
  it('지시 유효 시간이 현장 수행에 충분하고 과하지 않다', () => {
    const legs = randomPresenceLegs(seqRandom([3, 1, 2]));
    expect(SPOT_PRESENCE_CHALLENGE_TTL_MS).toBeGreaterThan(presenceMinDurationMs(legs));
    expect(SPOT_PRESENCE_CHALLENGE_TTL_MS).toBeLessThanOrEqual(10 * 60 * 1000);
  });
});
