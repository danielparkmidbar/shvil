/**
 * 커뮤니티 코스 제안이 **코인이 생성되는 땅**을 정하지 못하게 한다 (2026-07-27).
 *
 * 재현된 발행 누수 (적대검증 2): `POST /courses/proposals`의 `segments`는
 * `unknown[]`으로 받아 검증 없이 저장·배포됐다. 그래서 200m짜리 코스에
 * `corridorHalfWidthM: 50000`을 실어 제안하고 승격시키면, 회랑 판정이 그 값을
 * 그대로 써서 **반경 50km 안 어디서나 ON_COURSE**가 됐다. 승격에는 사람 검토가
 * 없다(완주 기록은 자기신고 정수이고, 기준 인원만 모이면 자동 OFFICIAL이다).
 *
 * 이것은 위폐가 아니라 **트레일 밖 발행**이다 — 걷지 않은 사람이 아니라, 트레일이
 * 아닌 곳을 걸은 사람에게 기준 요율이 나간다. 제3조(정직화) 위반이므로 막는다.
 *
 * 두 겹으로 못박는다.
 *  (1) 접수 경계에서 거부한다 (400 + 코드).
 *  (2) 검사를 우회한 데이터(옛 DB 행 등)가 배포돼도 `corridorHalfWidthAt`이
 *      클램프해서 회랑이 150m를 넘지 않는다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_CORRIDOR_HALF_WIDTH_M, corridorHalfWidthAt, type CourseData } from '@shvil/shared';
import { buildApp } from '../src/app';
import { distributedCourses } from '../src/courses';
import { register, signedInject, type TestIdentity } from './utils';

const app = buildApp({ dbPath: ':memory:', promotionThreshold: 2, devMode: true });

let attacker: TestIdentity;
let walker: TestIdentity;

/** 서울 시청 앞 200m 직선 — 실제 트레일이 아니다. */
const HOME_LINE = [
  { lat: 37.5665, lon: 126.978 },
  { lat: 37.5683, lon: 126.978 },
];

beforeAll(async () => {
  await app.ready();
  attacker = await register(app, '+82-10-9900', 'geo-attacker@example.org', '제안자');
  walker = await register(app, '+82-10-9901', 'geo-walker@example.org', '걷는이');
});

afterAll(async () => {
  await app.close();
});

function propose(who: TestIdentity, courseId: string, body: Record<string, unknown>) {
  return signedInject(app, who, 'POST', '/courses/proposals', {
    courseId,
    name: 'Geometry Guard Probe',
    polyline: HOME_LINE,
    ...body,
  });
}

describe('★코스 제안 기하 검증 — 트레일 밖 발행 차단', () => {
  it('반폭 50km를 실은 제안은 접수되지 않는다', async () => {
    const res = await propose(attacker, 'wide-corridor', {
      segments: [{ fromIdx: 0, toIdx: 1, terrain: 'OPEN', corridorHalfWidthM: 50_000, difficultyTenths: 10 }],
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('SEGMENT_BAD_CORRIDOR');
  });

  it('난이도 계수 99를 실은 제안은 접수되지 않는다', async () => {
    const res = await propose(attacker, 'huge-difficulty', {
      segments: [{ fromIdx: 0, toIdx: 1, terrain: 'MOUNTAIN', difficultyTenths: 99 }],
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('SEGMENT_BAD_DIFFICULTY');
  });

  it('구간 메타가 빈 배열이면 접수되지 않는다 (지갑 회랑 판정이 죽는 입력)', async () => {
    const res = await propose(attacker, 'empty-segments', { segments: [] });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('SEGMENTS_EMPTY');
  });

  it('지구 밖 좌표는 접수되지 않는다', async () => {
    const res = await propose(attacker, 'off-earth', {
      polyline: [
        { lat: 999, lon: 126.978 },
        { lat: 37.5683, lon: 126.978 },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('POLYLINE_BAD_POINT');
  });

  it('구간 인덱스가 폴리라인 밖이면 접수되지 않는다', async () => {
    const res = await propose(attacker, 'bad-range', {
      segments: [{ fromIdx: 0, toIdx: 9_999, terrain: 'OPEN', difficultyTenths: 10 }],
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('SEGMENT_BAD_RANGE');
  });

  it('거부된 제안은 등록부에 흔적을 남기지 않는다 — 재시도로 승격시킬 수 없다', async () => {
    const proposals = (await app.inject({ method: 'GET', url: '/courses/proposals' })).json() as {
      proposals: { courseId: string }[];
    };
    const ids = proposals.proposals.map((p) => p.courseId);
    for (const rejected of ['wide-corridor', 'huge-difficulty', 'empty-segments', 'off-earth', 'bad-range']) {
      expect(ids).not.toContain(rejected);
    }
  });

  it('정상 제안은 그대로 통과한다 (검증이 정직한 제안자를 막지 않는다)', async () => {
    const res = await propose(walker, 'good-course', {
      segments: [{ fromIdx: 0, toIdx: 1, terrain: 'URBAN', corridorHalfWidthM: 150, difficultyTenths: 12 }],
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('★2차 방어 — 검사를 우회한 데이터가 배포돼도 회랑은 150m를 넘지 않는다', () => {
  it('DB에 직접 심은 반폭 50km 코스도 판정에서는 150m로 잘린다', () => {
    // 접수 경계를 건너뛰고 등록부에 바로 넣는다 — 이 검사가 생기기 전에 저장된 행,
    // 또는 다른 배포자를 통해 들어온 코스를 흉내낸다.
    app.db
      .prepare(
        `INSERT INTO course_proposals (course_id, name, proposer_member, polyline_json, segments_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'OFFICIAL', ?)`,
      )
      .run(
        'legacy-wide',
        'Legacy Wide Corridor',
        attacker.memberId,
        JSON.stringify(HOME_LINE),
        JSON.stringify([
          { fromIdx: 0, toIdx: 1, terrain: 'OPEN', corridorHalfWidthM: 50_000, difficultyTenths: 10 },
        ]),
        Date.now(),
      );

    const course = distributedCourses(app.db).find((c: CourseData) => c.courseId === 'legacy-wide');
    expect(course).toBeDefined();
    // 저장된 원본 값은 그대로 보인다 (소급 수정하지 않는다) —
    expect(course!.segments[0]!.corridorHalfWidthM).toBe(50_000);
    // 그러나 회랑 판정이 쓰는 값은 클램프된다.
    expect(corridorHalfWidthAt(course!, 0)).toBe(MAX_CORRIDOR_HALF_WIDTH_M);
    // 45km 밖은 이제 어떤 경우에도 회랑 안이 아니다.
    expect(corridorHalfWidthAt(course!, 0)).toBeLessThan(45_000);
  });
});
