/**
 * 스팟 현장 결속 세션 (R-스팟-현장결속) — 폰 로컬 판정 테스트.
 *
 * 서버가 볼 수 없는 층을 여기서 고정한다: 스팟 근접 요구(원격 개시 차단),
 * 변위·방향 판정(M9 엔진 공유), 그리고 보고에 좌표·변위가 없다는 것.
 */
import { describe, expect, it } from 'vitest';
import type { MovementLeg } from '@shvil/shared';
import { SPOT_PRESENCE_START_RADIUS_M, SpotPresenceSession } from '../spotPresenceSession';

const SPOT = { lat: 33.2, lon: 35.6 };
/** 실제 발급 대역(15~25걸음)을 대표하는 지시. */
const LEGS: MovementLeg[] = [
  { dir: 'N', steps: 20 },
  { dir: 'E', steps: 15 },
];

const METERS_PER_DEG = 111_320;

/** 스팟 기준 북쪽 dN m, 동쪽 dE m 지점. */
function at(dNorthM: number, dEastM: number) {
  return {
    lat: SPOT.lat + dNorthM / METERS_PER_DEG,
    lon: SPOT.lon + dEastM / (METERS_PER_DEG * Math.cos(SPOT.lat * (Math.PI / 180))),
    timestamp: Date.now(),
  };
}

function session(): SpotPresenceSession {
  return new SpotPresenceSession('spot-1', 'spc-abc', LEGS);
}

describe('근접 요구 — 원격 개시 차단 (서버가 할 수 없는 판정)', () => {
  it('스팟 반경 안이면 시작할 수 있다', () => {
    expect(SpotPresenceSession.isWithinSpot(at(10, 0), SPOT)).toBe(true);
    expect(SpotPresenceSession.isWithinSpot(at(0, SPOT_PRESENCE_START_RADIUS_M - 5), SPOT)).toBe(true);
  });

  it('★반경 밖(집·길 건너)이면 시작할 수 없다', () => {
    expect(SpotPresenceSession.isWithinSpot(at(SPOT_PRESENCE_START_RADIUS_M + 40, 0), SPOT)).toBe(false);
    expect(SpotPresenceSession.isWithinSpot(at(5000, 0), SPOT)).toBe(false);
  });

  it('TOO_FAR로 막으면 이후 픽스·걸음이 무시된다', () => {
    const s = session();
    s.markTooFar();
    s.addFix(at(0, 0));
    s.addSteps(12);
    expect(s.state).toBe('TOO_FAR');
    expect(() => s.report()).toThrow();
  });
});

describe('수행 판정 — M9 엔진 공유', () => {
  it('지시대로 걸으면 SUCCESS + 보고가 나온다', () => {
    const s = session();
    s.addFix(at(0, 0));
    // 1다리: 북쪽 20걸음 ≈ 14 m (보폭 0.7 m 가정 — 대역 4~30 m 안)
    s.addFix(at(14, 0));
    s.addSteps(20);
    expect(s.state).toBe('ACTIVE');
    // 2다리: 동쪽 15걸음 ≈ 11 m (기준점은 직전 위치로 갈아끼워졌다)
    s.addFix(at(14, 11));
    s.addSteps(15);
    expect(s.state).toBe('SUCCESS');

    const report = s.report();
    expect(report).toEqual([
      { dir: 'N', steps: 20, measuredSteps: 20 },
      { dir: 'E', steps: 15, measuredSteps: 15 },
    ]);
  });

  it('★보고에 좌표·변위 필드가 없다 (요약뿐)', () => {
    const s = session();
    s.addFix(at(0, 0));
    s.addFix(at(14, 0));
    s.addSteps(20);
    s.addFix(at(14, 11));
    s.addSteps(15);
    for (const leg of s.report()) {
      expect(Object.keys(leg).sort()).toEqual(['dir', 'measuredSteps', 'steps']);
    }
  });

  it('방향이 틀리면 FAILED (북쪽 지시에 남쪽 이동)', () => {
    const s = session();
    s.addFix(at(0, 0));
    s.addFix(at(-14, 0));
    s.addSteps(20);
    expect(s.state).toBe('FAILED');
    expect(s.getStatus().failedReason).toBe('HEADING_OFF');
  });

  it('★걸음만 흔들고 제자리면 FAILED (변위 하한이 실효 — 걸음 하한 15의 근거)', () => {
    const s = session();
    s.addFix(at(0, 0));
    s.addFix(at(0, 0));
    s.addSteps(20);
    expect(s.state).toBe('FAILED');
    expect(s.getStatus().failedReason).toBe('DISTANCE_OUT_OF_BAND');
  });

  it('mock location이면 BLOCKED', () => {
    const s = session();
    s.addFix({ ...at(0, 0), mocked: true });
    expect(s.state).toBe('BLOCKED');
  });

  it('상태 노출에 좌표·변위가 없다 (파생 지표뿐)', () => {
    const s = session();
    s.addFix(at(0, 0));
    s.addSteps(3);
    const status = s.getStatus();
    expect(Object.keys(status).sort()).toEqual([
      'currentLeg',
      'failedReason',
      'legCount',
      'legIndex',
      'spotId',
      'state',
      'stepsInLeg',
    ]);
    expect(JSON.stringify(status)).not.toMatch(/lat|lon/i);
  });

  it('완료 전에는 보고를 꺼낼 수 없다', () => {
    const s = session();
    expect(() => s.report()).toThrow();
  });
});
