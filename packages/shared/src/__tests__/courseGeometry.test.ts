/**
 * 코스 기하 검증 — **코인이 생성되는 땅의 크기**를 데이터가 정하지 못하게 한다.
 *
 * 재현된 발행 누수(적대검증 2, 2026-07-27): 커뮤니티 코스 제안의 `segments`가
 * 검증 없이 저장·배포돼, 200m짜리 코스에 `corridorHalfWidthM: 50000`을 실으면
 * 반경 50km 안 어디서나(트레일에서 45km 떨어진 도심 포함) ON_COURSE가 됐다.
 *
 * 방어는 두 겹이다.
 *  (1) 접수 경계에서 **거부** — validateCoursePolyline / validateCourseSegments.
 *  (2) 읽는 쪽에서 **클램프** — corridorHalfWidthAt. 옛 DB 행·조작된 캐시·다른
 *      배포자를 통해 검사를 우회한 데이터가 들어와도 회랑은 150m를 넘지 않는다.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CORRIDOR_HALF_WIDTH_M,
  MAX_CORRIDOR_HALF_WIDTH_M,
  MIN_CORRIDOR_HALF_WIDTH_M,
  MAX_COURSE_POLYLINE_POINTS,
  SHVIL_ISRAEL,
  BUNDANG_BULGOKSAN_SAMPLE,
  SHVIL_ISRAEL_NORTH_SAMPLE,
  corridorHalfWidthAt,
  segmentMetaAt,
  validateCoursePolyline,
  validateCourseSegments,
  type CourseData,
} from '../index';

const LINE = [
  { lat: 37.5, lon: 127.0 },
  { lat: 37.51, lon: 127.01 },
];

function course(segments: unknown): CourseData {
  return {
    courseId: 'x',
    name: 'x',
    version: 1,
    polyline: LINE,
    segments: segments as CourseData['segments'],
  };
}

describe('회랑 반폭 클램프 — 데이터가 화폐 규칙을 정하지 못한다', () => {
  it('★반폭 50km를 실은 코스도 회랑은 150m를 넘지 않는다 (재현된 누수 봉쇄)', () => {
    const c = course([{ fromIdx: 0, toIdx: 1, terrain: 'OPEN', corridorHalfWidthM: 50_000, difficultyTenths: 10 }]);
    expect(corridorHalfWidthAt(c, 0)).toBe(MAX_CORRIDOR_HALF_WIDTH_M);
    expect(corridorHalfWidthAt(c, 0)).toBeLessThan(50_000);
  });

  it('반폭 0을 실어 그 코스를 걷는 사람을 전원 탈락시킬 수도 없다', () => {
    const c = course([{ fromIdx: 0, toIdx: 1, terrain: 'OPEN', corridorHalfWidthM: 0, difficultyTenths: 10 }]);
    expect(corridorHalfWidthAt(c, 0)).toBe(MIN_CORRIDOR_HALF_WIDTH_M);
  });

  it('숫자가 아닌 값·알 수 없는 지형은 개활지 기본값(50m)으로 떨어진다', () => {
    const nan = course([{ fromIdx: 0, toIdx: 1, terrain: 'OPEN', corridorHalfWidthM: Number.NaN, difficultyTenths: 10 }]);
    expect(corridorHalfWidthAt(nan, 0)).toBe(50);
    const weird = course([{ fromIdx: 0, toIdx: 1, terrain: 'MOON', difficultyTenths: 10 }]);
    expect(corridorHalfWidthAt(weird, 0)).toBe(50);
  });

  it('구간 메타가 비어 있어도 던지지 않는다 — 데이터로 걷기를 멈출 수 없다', () => {
    const empty = course([]);
    expect(() => corridorHalfWidthAt(empty, 0)).not.toThrow();
    expect(corridorHalfWidthAt(empty, 0)).toBe(50);
    expect(segmentMetaAt(empty, 0).difficultyTenths).toBe(10);
  });

  it('배포 중인 실물 코스의 회랑은 클램프 전후가 같다 (정상 데이터는 건드리지 않는다)', () => {
    for (const c of [SHVIL_ISRAEL, BUNDANG_BULGOKSAN_SAMPLE, SHVIL_ISRAEL_NORTH_SAMPLE]) {
      for (const seg of c.segments) {
        const w = corridorHalfWidthAt(c, seg.fromIdx);
        expect(w).toBeGreaterThanOrEqual(MIN_CORRIDOR_HALF_WIDTH_M);
        expect(w).toBeLessThanOrEqual(MAX_CORRIDOR_HALF_WIDTH_M);
      }
    }
    expect(corridorHalfWidthAt(SHVIL_ISRAEL, 0)).toBe(50); // 전 구간 OPEN
    expect(corridorHalfWidthAt(BUNDANG_BULGOKSAN_SAMPLE, 0)).toBe(150); // 시가지 구간 = URBAN 기본
    expect(corridorHalfWidthAt(BUNDANG_BULGOKSAN_SAMPLE, 40)).toBe(120); // 산악 구간 명시값 유지
  });
});

/**
 * ★회랑 반폭을 **좁히는 변경을 막는 바닥선**.
 *
 * docs/소급무효화_경로.md 의 확인된 경로: 회랑을 좁히면 그 코스에서 이미 발행된
 * 코인이 "지금 규칙으로는 만들어질 수 없는 코인"이 된다. 검증기가 기하를 다시 보지
 * 않으므로 오늘 당장 무효가 되지는 않지만, 사후 감사·소명 절차가 옛 코인을 의심하게
 * 만든다 — 새 규칙이 옛 화폐를 가짜로 만드는 방향이다.
 *
 * 그래서 **표의 값과 배포 코스의 명시값을 여기 못박는다.** 넓히는 변경(값이 커지는
 * 방향)은 이 시험을 고치면서 통과시키면 되고, 좁히는 변경은 반드시 여기서 걸린다.
 * 지형 표를 늘리는 것(새 TerrainType)도 여기서 알아차리게 된다.
 */
describe('회랑 반폭 바닥선 — 좁히는 변경은 여기서 걸린다 (소급무효화 방지)', () => {
  /** 2026-07-27 기준값. 값을 **내리는** 수정은 하지 마라. */
  const FLOOR: Record<string, number> = { OPEN: 50, FOREST: 75, MOUNTAIN: 100, URBAN: 150 };

  it('지형별 기본 회랑이 기준값 이상이다', () => {
    for (const [terrain, floor] of Object.entries(FLOOR)) {
      const actual = DEFAULT_CORRIDOR_HALF_WIDTH_M[terrain as keyof typeof DEFAULT_CORRIDOR_HALF_WIDTH_M];
      expect(actual, `${terrain} 회랑이 ${floor}m 아래로 내려갔다 — 옛 코인이 소급 의심을 받는다`).toBeGreaterThanOrEqual(
        floor,
      );
    }
    // 표에 지형이 추가·삭제되면 바닥선을 다시 정해야 한다.
    expect(Object.keys(DEFAULT_CORRIDOR_HALF_WIDTH_M).sort()).toEqual(Object.keys(FLOOR).sort());
  });

  it('대역 상한/하한 자체도 좁아지지 않았다', () => {
    expect(MAX_CORRIDOR_HALF_WIDTH_M).toBeGreaterThanOrEqual(150);
    expect(MIN_CORRIDOR_HALF_WIDTH_M).toBeLessThanOrEqual(10);
  });

  it('배포 중인 코스의 실효 회랑이 기준값 이상이다', () => {
    // 2026-07-27 실효값. 코스 데이터를 고치다가 조용히 좁아지는 것을 막는다.
    const expected: [CourseData, number, number][] = [
      [SHVIL_ISRAEL, 0, 50],
      [BUNDANG_BULGOKSAN_SAMPLE, 0, 150],
      [BUNDANG_BULGOKSAN_SAMPLE, 40, 120],
    ];
    for (const [c, idx, floor] of expected) {
      expect(corridorHalfWidthAt(c, idx), `${c.courseId} 선분 ${idx}의 회랑이 좁아졌다`).toBeGreaterThanOrEqual(floor);
    }
  });
});

describe('폴리라인 검증', () => {
  it('점이 2개 미만이면 거부', () => {
    expect(validateCoursePolyline([])).toBe('POLYLINE_TOO_SHORT');
    expect(validateCoursePolyline([{ lat: 1, lon: 1 }])).toBe('POLYLINE_TOO_SHORT');
    expect(validateCoursePolyline('nope')).toBe('POLYLINE_TOO_SHORT');
  });

  it('지구 밖 좌표·NaN·문자열은 거부', () => {
    expect(validateCoursePolyline([{ lat: 91, lon: 0 }, { lat: 0, lon: 0 }])).toBe('POLYLINE_BAD_POINT');
    expect(validateCoursePolyline([{ lat: 0, lon: 181 }, { lat: 0, lon: 0 }])).toBe('POLYLINE_BAD_POINT');
    expect(validateCoursePolyline([{ lat: Number.NaN, lon: 0 }, { lat: 0, lon: 0 }])).toBe('POLYLINE_BAD_POINT');
    expect(validateCoursePolyline([{ lat: '1', lon: 0 }, { lat: 0, lon: 0 }])).toBe('POLYLINE_BAD_POINT');
  });

  it('실물 코스는 통과한다', () => {
    expect(validateCoursePolyline(SHVIL_ISRAEL.polyline)).toBeNull();
    expect(SHVIL_ISRAEL.polyline.length).toBeLessThan(MAX_COURSE_POLYLINE_POINTS);
  });
});

describe('구간 메타 검증', () => {
  it('빈 배열·비배열은 거부', () => {
    expect(validateCourseSegments([], 2)).toBe('SEGMENTS_EMPTY');
    expect(validateCourseSegments(null, 2)).toBe('SEGMENTS_NOT_ARRAY');
  });

  it('★반폭이 허용 대역(10~150m) 밖이면 거부', () => {
    const bad = (w: number) => validateCourseSegments([{ fromIdx: 0, toIdx: 1, terrain: 'OPEN', difficultyTenths: 10, corridorHalfWidthM: w }], 2);
    expect(bad(50_000)).toBe('SEGMENT_BAD_CORRIDOR');
    expect(bad(151)).toBe('SEGMENT_BAD_CORRIDOR');
    expect(bad(9)).toBe('SEGMENT_BAD_CORRIDOR');
    expect(bad(150)).toBeNull();
    expect(bad(10)).toBeNull();
  });

  it('★난이도 계수가 ×1.0~×4.0 밖이면 거부 (99 배포 차단)', () => {
    const d = (t: number) => validateCourseSegments([{ fromIdx: 0, toIdx: 1, terrain: 'OPEN', difficultyTenths: t }], 2);
    expect(d(99)).toBe('SEGMENT_BAD_DIFFICULTY');
    expect(d(41)).toBe('SEGMENT_BAD_DIFFICULTY');
    expect(d(9)).toBe('SEGMENT_BAD_DIFFICULTY');
    expect(d(40)).toBeNull();
    expect(d(10)).toBeNull();
  });

  it('인덱스 범위가 폴리라인 밖이거나 뒤집혀 있으면 거부', () => {
    expect(validateCourseSegments([{ fromIdx: 0, toIdx: 99, terrain: 'OPEN', difficultyTenths: 10 }], 3)).toBe('SEGMENT_BAD_RANGE');
    expect(validateCourseSegments([{ fromIdx: 2, toIdx: 1, terrain: 'OPEN', difficultyTenths: 10 }], 5)).toBe('SEGMENT_BAD_RANGE');
    expect(validateCourseSegments([{ fromIdx: -1, toIdx: 1, terrain: 'OPEN', difficultyTenths: 10 }], 5)).toBe('SEGMENT_BAD_RANGE');
  });

  it('알 수 없는 지형은 거부', () => {
    expect(validateCourseSegments([{ fromIdx: 0, toIdx: 1, terrain: 'MOON', difficultyTenths: 10 }], 2)).toBe('SEGMENT_BAD_TERRAIN');
  });

  it('배포 중인 실물 코스의 구간 메타는 통과한다', () => {
    for (const c of [SHVIL_ISRAEL, BUNDANG_BULGOKSAN_SAMPLE, SHVIL_ISRAEL_NORTH_SAMPLE]) {
      expect(validateCourseSegments(c.segments, c.polyline.length)).toBeNull();
    }
  });
});
