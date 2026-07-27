/**
 * 서버가 아는 코스의 **단일 진실 원천** (2026-07-26 무제한 발행구 봉쇄).
 *
 * 왜 이 파일이 생겼나: `GET /courses`는 유효한 코스 목록을 이미 알고 있었는데,
 * 발행 라우트(`POST /certificates`·`POST /claims`)가 그 목록과 대조하지 않았다.
 * 그래서 `courseId`를 아무 문자열로 바꾸면 "1인 1코스 1회" 중복 방지
 * (`certificates` UNIQUE(member_id, course_id, kind))가 "1인 1문자열 1회"로
 * 무력화되어 한 계정이 무한히 발행할 수 있었다 (docs/발행경로_실측_2026-07-26.md §2-3).
 *
 * 그러므로 판정 기준은 **배포 목록 그 자체**여야 한다. 별도의 목록을 만들면 언젠가
 * 어긋나고, 어긋나는 순간 앱에는 보이는 코스인데 서버가 거부하는 상황이 생겨
 * **정직하게 걸은 사람이 보상을 못 받는다**(제7조 위반). 그래서 `knownCourseIds`는
 * 자체 질의를 만들지 않고 `distributedCourses`가 실제로 내보내는 것에서 ID를 뽑는다 —
 * 폴리라인 파싱 비용을 감수하더라도 두 경로가 갈라질 여지를 남기지 않는다.
 * (발행 라우트는 저빈도다. 여기서 아끼는 것은 정확성이지 CPU가 아니다.)
 *
 * ★1차 활성화 대상은 이스라엘 국립 트레일 하나다 (docs/세계코스_활성화_계획.md §3-A
 *  결정 2 — 허가·예약제 트레일(밀포드·잉카·킬리만자로·토레스델파이네)은 제외).
 *  `WORLD_TRAILS`(regions.ts)에서도 이스라엘만 LIVE이고 나머지는 COMING_SOON에
 *  courseIds가 비어 있으며, 지갑의 오프라인 폴백도 [shvil-israel, bundang-bulgoksan]
 *  뿐이다(walkService.ts). 즉 **앱이 보여 주지 않는 코스**는 거부해도 정직한
 *  사용자가 막히지 않는다. 활성화는 계획서 M14-3 절차(지역 LIVE 전환 +
 *  courseIds 연결 + 여기 BUILTIN_COURSES 추가)를 따른다.
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  BUNDANG_BULGOKSAN_SAMPLE,
  SHVIL_ISRAEL,
  signDistribution,
  type CourseData,
  type Signed,
  type Signer,
} from '@shvil/shared';

/**
 * 내장 기본 코스 — 코스 등록부(DB) 없이도 항상 배포되는 코스.
 *
 * ★2026-07-27: `shvil-israel`이 손으로 찍은 11점·6.72km 샘플에서 OSM 관계 282071
 *  실측 폴리라인(5,569점·1,055km)으로 교체됐다. 샘플은 실제 트레일에서 1km 이상
 *  떨어져 있어 종주자가 8.27km밖에 인정받지 못했다(정직화 — 제3조).
 *  courseId는 'shvil-israel' 그대로다 — 이미 발행된 코인 계보와 regions.ts의
 *  israel-national.courseIds 연결이 끊기지 않는다. 옛 샘플은
 *  `SHVIL_ISRAEL_NORTH_SAMPLE`(courseId 'shvil-israel-sample')로 테스트에만 남는다.
 *  ★같은 courseId를 두 정의가 동시에 배포하면 같은 자리에서 요율이 갈리므로
 *   (샘플 후반 ×1.5 vs 실물 ×1.0) 배포 목록에는 절대 둘을 함께 넣지 않는다 —
 *   `courseIdUniqueness.test.ts`가 이것을 못박는다.
 *
 * 분당–불곡산은 닫힌 시험용 국내 코스 (다니엘 쌤 지정 — courses.ts 주석).
 */
export const BUILTIN_COURSES: readonly CourseData[] = [SHVIL_ISRAEL, BUNDANG_BULGOKSAN_SAMPLE];

/** 공식 승격된 코스를 CourseData로 변환 (코스 등록부 — 지시서 6장 3절). */
export function officialCourses(db: DatabaseSync): CourseData[] {
  const rows = db
    .prepare("SELECT course_id, name, polyline_json, segments_json FROM course_proposals WHERE status = 'OFFICIAL'")
    .all() as unknown as { course_id: string; name: string; polyline_json: string; segments_json: string }[];
  return rows.map((r) => ({
    courseId: r.course_id,
    name: r.name,
    polyline: JSON.parse(r.polyline_json) as CourseData['polyline'],
    segments: JSON.parse(r.segments_json) as CourseData['segments'],
    version: 1,
  }));
}

/**
 * `GET /courses`가 배포하는 코스 전체. **이 함수가 "서버가 아는 코스"의 정의다** —
 * 배포 라우트도, 발행 라우트도 여기만 본다.
 */
export function distributedCourses(db: DatabaseSync): CourseData[] {
  return [...BUILTIN_COURSES, ...officialCourses(db)];
}

/** 배포 중인 코스 ID 집합 (배포 목록에서 직접 유도 — 별도 질의를 만들지 않는다). */
export function knownCourseIds(db: DatabaseSync): Set<string> {
  return new Set(distributedCourses(db).map((c) => c.courseId));
}

/**
 * 발행 라우트의 코스 대조 (fail-closed). 문자열이 아니거나 배포 목록에 없으면 false.
 *
 * ★소급 무효화 금지: 이 검사는 **앞으로의 발행**만 막는다. 이미 발행된 보상 코인과
 *  이미 저장된 certificates·claims 레코드는 그대로 유효하다 (새 규칙이 옛 화폐를
 *  가짜로 만들지 않는다 — 다니엘 쌤 원칙).
 */
export function isKnownCourse(db: DatabaseSync, courseId: unknown): boolean {
  if (typeof courseId !== 'string' || courseId.length === 0) return false;
  return knownCourseIds(db).has(courseId);
}

/**
 * 코스 등록부 상태 지문 — 배포 응답 캐시의 무효화 키.
 *
 * `BUILTIN_COURSES`는 컴파일 시각 상수라 런타임에 변하지 않는다. 변할 수 있는 것은
 * 공식 승격된 코스뿐이고, `course_proposals` 행은 CANDIDATE로 INSERT된 뒤
 * status만 OFFICIAL로 UPDATE된다 (community.ts — polyline_json·name은 삽입 후
 * 수정되지 않는다). 그러므로 "공식 코스의 ID 목록"이 곧 배포 본문의 지문이다.
 * 폴리라인을 읽지 않으므로 비용이 승격 수에만 비례한다.
 *
 * ★코스 데이터를 나중에 **수정 가능**하게 만든다면 이 지문에 수정 시각을 반드시
 *  넣어야 한다. 지문이 안 변하면 캐시가 옛 폴리라인을 계속 배포하고, 코스가 바뀐
 *  줄 모르는 사람이 "코스 밖" 판정을 받는다 (제7조 — 순환이 끊긴다).
 */
function registryFingerprint(db: DatabaseSync): string {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n, COALESCE(GROUP_CONCAT(course_id, ''), '') AS ids " +
        "FROM course_proposals WHERE status = 'OFFICIAL'",
    )
    .get() as unknown as { n: number; ids: string };
  return `${row.n}:${row.ids}`;
}

/**
 * `GET /courses` 본문 생성기 (앱 인스턴스마다 하나 — 캐시가 DB·서명키에 묶인다).
 *
 * 왜 캐시가 필요한가: 실물 이스라엘 트레일(5,569점)이 배포 목록에 들어오면서 응답
 * 본문이 1.1KB → 178KB가 됐고, 요청마다 정규(canonical) 직렬화 + ed25519 서명을
 * 다시 하면 약 13ms가 든다(측정치). 지갑이 갱신 폴링을 하면 그대로 곱해진다.
 * 코스 등록부는 승격이 있을 때만 바뀌므로 그때만 다시 서명한다.
 *
 * 캐시가 **틀리면** 앱에 안 보이는 코스가 생겨 정직한 사람이 막히므로, 무효화 키는
 * 등록부 상태에서 직접 유도한다 (`registryFingerprint`). 승격 즉시 새 본문이 나가는
 * 것은 `courseIdUniqueness.test.ts`가 확인한다.
 */
export function createCoursesDistributor(
  db: DatabaseSync,
  distSigner: Signer,
  distKeyId: string,
): () => Signed<{ courses: CourseData[] }> {
  let cachedKey: string | null = null;
  let cached: Signed<{ courses: CourseData[] }> | null = null;
  return () => {
    const key = registryFingerprint(db);
    if (cached && cachedKey === key) return cached;
    cached = signDistribution({ courses: distributedCourses(db) }, distSigner, distKeyId, Date.now());
    cachedKey = key;
    return cached;
  };
}
