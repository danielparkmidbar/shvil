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
 * ★MILFORD_TRACK(@shvil/shared worldCourses.ts)은 여기 없다 — 배포 목록에 넣지 않는다.
 *  근거: docs/세계코스_활성화_계획.md §3-A 결정 2 — 허가·예약제 트레일(밀포드·잉카·
 *  킬리만자로·토레스델파이네)은 1차 활성화에서 제외한다. `WORLD_TRAILS`에서도
 *  milford-track은 COMING_SOON이고 courseIds가 비어 있으며(regions.ts), 지갑의
 *  오프라인 폴백도 [shvil-israel, bundang-bulgoksan]뿐이다(walkService.ts). 즉
 *  **앱이 보여 주지 않는 코스**이므로 거부해도 정직한 사용자가 막히지 않는다.
 *  활성화는 계획서 M14-3 절차(지역 LIVE 전환 + courseIds 연결)를 따른다.
 */
import type { DatabaseSync } from 'node:sqlite';
import { BUNDANG_BULGOKSAN_SAMPLE, SHVIL_ISRAEL_NORTH_SAMPLE, type CourseData } from '@shvil/shared';

/**
 * 내장 기본 코스 — 코스 등록부(DB) 없이도 항상 배포되는 코스.
 * 분당–불곡산은 닫힌 시험용 국내 코스 (다니엘 쌤 지정 — courses.ts 주석).
 */
export const BUILTIN_COURSES: readonly CourseData[] = [SHVIL_ISRAEL_NORTH_SAMPLE, BUNDANG_BULGOKSAN_SAMPLE];

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
