/**
 * courseId는 배포 목록 전체에서 유일하다 (2026-07-27 실물 코스 연결).
 *
 * 왜 이 파일이 생겼나: `shvil-israel`이 두 곳에 정의돼 있었다 —
 * `packages/shared/src/courses.ts`의 손으로 찍은 11점 샘플(전반 개활지 ×1.0 /
 * 후반 산악 ×1.5)과 `packages/shared/src/worldCourses.ts`의 OSM 실측 5,569점
 * (전 구간 ×1.0). 둘이 동시에 배포 목록에 들어가면 `CorridorEngine.#judgeFix`가
 * 같은 ID의 코스 두 개를 훑어 **가까운 쪽**의 난이도 계수를 매긴다. 같은 자리를
 * 걸어도 사람마다 요율이 갈린다 — 위폐가 아니라 요율 위조이고, 제3조(정직화)
 * 위반이다.
 *
 * 그래서 여기서 못박는 것은 두 가지다.
 *  (1) `distributedCourses`가 내보내는 courseId에 중복이 없다 — 내장 코스끼리도,
 *      커뮤니티가 승격시킨 코스가 섞인 뒤에도.
 *  (2) 그 불변식이 라우트에서 지켜진다 — 배포 중인 ID로는 코스 제안이 접수되지
 *      않는다(`POST /courses/proposals` → 409). 상수 검사만 두면 커뮤니티 경로로
 *      뚫린다.
 *
 * ★소급 무효화 금지: `shvil-israel`은 실물이 그대로 물려받는다. 이미 발행된
 *  코인의 계보(`proof.courseIds`)에 새겨진 ID가 계속 배포 목록에 있어야 옛 코인이
 *  "아는 코스"로 남는다. 새로 생긴 `shvil-israel-sample`로 발행된 코인은 없다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUNDANG_BULGOKSAN_SAMPLE, SHVIL_ISRAEL, SHVIL_ISRAEL_NORTH_SAMPLE, regionByCourseId } from '@shvil/shared';
import { buildApp } from '../src/app';
import { BUILTIN_COURSES, distributedCourses } from '../src/courses';
import { register, signedInject, type TestIdentity } from './utils';

// 승격 기준 2명 — 커뮤니티 승격까지 거친 뒤에도 유일성이 지켜지는지 보려고 낮춘다.
const app = buildApp({ dbPath: ':memory:', promotionThreshold: 2, devMode: true });

let proposer: TestIdentity;
let walker: TestIdentity;

beforeAll(async () => {
  await app.ready();
  proposer = await register(app, '+82-10-8800', 'uniq-proposer@example.org', '제안자');
  walker = await register(app, '+82-10-8801', 'uniq-walker@example.org', '걷는이');
});

afterAll(async () => {
  await app.close();
});

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return [...dup];
}

describe('courseId 유일성 — 배포 목록 전체', () => {
  it('내장 코스의 courseId에 중복이 없다', () => {
    expect(duplicates(BUILTIN_COURSES.map((c) => c.courseId))).toEqual([]);
  });

  it('GET /courses가 내보내는 courseId에 중복이 없다', async () => {
    const body = (await app.inject({ method: 'GET', url: '/courses' })).json() as {
      courses: { courseId: string }[];
    };
    expect(duplicates(body.courses.map((c) => c.courseId))).toEqual([]);
    expect(duplicates(distributedCourses(app.db).map((c) => c.courseId))).toEqual([]);
  });

  it('★배포 중인 courseId로는 코스 제안이 접수되지 않는다 (요율 위조 차단)', async () => {
    for (const taken of distributedCourses(app.db).map((c) => c.courseId)) {
      const res = await signedInject(app, proposer, 'POST', '/courses/proposals', {
        courseId: taken,
        // 실제 트레일과 무관한 자기 집 앞 좌표 + ×4.0 — 이것이 통과하면 요율이 위조된다.
        name: 'Rate Forgery Attempt',
        polyline: [
          { lat: 37.5, lon: 127.0 },
          { lat: 37.51, lon: 127.01 },
        ],
        segments: [{ fromIdx: 0, toIdx: 1, terrain: 'MOUNTAIN', difficultyTenths: 40 }],
      });
      expect(res.statusCode).toBe(409);
    }
    // 거부는 등록부에 흔적을 남기지 않는다.
    const proposals = (await app.inject({ method: 'GET', url: '/courses/proposals' })).json() as {
      proposals: unknown[];
    };
    expect(proposals.proposals).toHaveLength(0);
  });

  it('커뮤니티 코스가 공식 승격된 뒤에도 배포 목록의 유일성이 유지된다', async () => {
    await signedInject(app, proposer, 'POST', '/courses/proposals', {
      courseId: 'uniq-olle',
      name: 'Uniq Olle (proposal)',
      polyline: [
        { lat: 33.4996, lon: 126.9089 },
        { lat: 33.4922, lon: 126.9257 },
      ],
    });
    for (const who of [proposer, walker]) {
      await signedInject(app, who, 'POST', '/courses/uniq-olle/completions', { distanceM: 15_000, days: 1 });
    }
    const ids = distributedCourses(app.db).map((c) => c.courseId);
    expect(ids).toContain('uniq-olle');
    expect(duplicates(ids)).toEqual([]);
  });
});

/**
 * 서명된 /courses 본문은 등록부가 바뀔 때까지 재사용된다(178KB·13ms → 재서명 회피).
 * 캐시가 옛 목록을 붙들면 앱에 안 보이는 코스가 생겨 정직한 사람이 막히므로,
 * "승격 즉시 반영"과 "본문 동일성"을 함께 못박는다.
 */
describe('배포 응답 캐시 — 승격은 즉시 반영되고, 그 사이에는 재서명하지 않는다', () => {
  it('승격 직후 GET /courses에 새 코스가 바로 나타난다 (캐시 스테일 금지)', async () => {
    const before = (await app.inject({ method: 'GET', url: '/courses' })).json() as {
      courses: { courseId: string }[];
    };
    expect(before.courses.map((c) => c.courseId)).not.toContain('cache-olle');

    await signedInject(app, proposer, 'POST', '/courses/proposals', {
      courseId: 'cache-olle',
      name: 'Cache Olle (proposal)',
      polyline: [
        { lat: 35.1, lon: 129.0 },
        { lat: 35.11, lon: 129.01 },
      ],
    });
    // 후보 단계에서는 아직 배포되지 않는다.
    const candidate = (await app.inject({ method: 'GET', url: '/courses' })).json() as {
      courses: { courseId: string }[];
    };
    expect(candidate.courses.map((c) => c.courseId)).not.toContain('cache-olle');

    for (const who of [proposer, walker]) {
      await signedInject(app, who, 'POST', '/courses/cache-olle/completions', { distanceM: 9_000, days: 1 });
    }
    const after = (await app.inject({ method: 'GET', url: '/courses' })).json() as {
      courses: { courseId: string }[];
    };
    expect(after.courses.map((c) => c.courseId)).toContain('cache-olle');
    expect(duplicates(after.courses.map((c) => c.courseId))).toEqual([]);
  });

  it('등록부가 그대로면 연속 요청의 본문이 바이트 단위로 같다 (재서명 없음)', async () => {
    const a = await app.inject({ method: 'GET', url: '/courses' });
    const b = await app.inject({ method: 'GET', url: '/courses' });
    expect(a.body).toBe(b.body);
  });
});

describe('실물 교체 — 배포되는 것은 실물이고, 옛 샘플은 배포되지 않는다', () => {
  it('배포 목록은 [실물 이스라엘, 분당–불곡산]이다', () => {
    expect(BUILTIN_COURSES.map((c) => c.courseId)).toEqual(['shvil-israel', 'bundang-bulgoksan']);
    expect(BUILTIN_COURSES[0]).toBe(SHVIL_ISRAEL);
    expect(BUILTIN_COURSES[1]).toBe(BUNDANG_BULGOKSAN_SAMPLE);
  });

  it("'shvil-israel'은 실물 폴리라인이다 — 11점 샘플이 아니다", () => {
    expect(SHVIL_ISRAEL.courseId).toBe('shvil-israel');
    // 손으로 찍은 샘플은 11점·6.72km였다. 실물은 1,000km 규모라 점 수가 자릿수가 다르다.
    expect(SHVIL_ISRAEL.polyline.length).toBeGreaterThan(5_000);
    expect(SHVIL_ISRAEL_NORTH_SAMPLE.polyline.length).toBeLessThan(20);
  });

  it('테스트 픽스처 샘플은 별도 ID를 가지며 배포되지 않는다', () => {
    expect(SHVIL_ISRAEL_NORTH_SAMPLE.courseId).toBe('shvil-israel-sample');
    expect(SHVIL_ISRAEL_NORTH_SAMPLE.courseId).not.toBe(SHVIL_ISRAEL.courseId);
    expect(BUILTIN_COURSES.map((c) => c.courseId)).not.toContain('shvil-israel-sample');
  });

  it('소급 무효화 금지 — 옛 코인이 새긴 courseId가 배포 목록에 그대로 남아 있다', async () => {
    // 이미 유통 중인 걷기 증명의 courseIds는 'shvil-israel'이다. 이 ID로 발행이 계속
    // 가능해야 하고(제7조 — 순환), 지역 귀속도 끊기지 않아야 한다.
    const res = await signedInject(app, walker, 'POST', '/certificates', {
      courseId: 'shvil-israel',
      kind: 'FULL',
      photos: ['photo'],
      data: { distanceM: 1_055_000, days: 45 },
    });
    expect(res.statusCode).toBe(200);
    expect(regionByCourseId('shvil-israel')?.regionId).toBe('israel-national');
    expect(regionByCourseId('shvil-israel')?.status).toBe('LIVE');
  });
});
