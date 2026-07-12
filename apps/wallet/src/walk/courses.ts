/**
 * 코스 데이터 스키마 (지시서 2.2 "코스 데이터 내장").
 *
 * 원본은 shvilist.org 코스 등록부(M4)이며, 앱은 갱신분을 내려받아 내장한다.
 * 오프라인 동작 필수 — 판정에 서버가 필요 없다.
 * 회랑 폭·난이도 계수는 구간 속성으로 관리해 코드 배포 없이 조정 가능하게 한다.
 */
import type { GeoPoint } from './geo';

export type TerrainType = 'OPEN' | 'FOREST' | 'MOUNTAIN' | 'URBAN';

/** 구간 유형별 회랑 반폭 기본값 (m) — 프로토콜 설계 1.5절 제안, 결정 대기 2번. */
export const DEFAULT_CORRIDOR_HALF_WIDTH_M: Record<TerrainType, number> = {
  OPEN: 50,
  FOREST: 75,
  MOUNTAIN: 100,
  URBAN: 150,
};

export interface CourseSegmentMeta {
  /** 폴리라인 선분 인덱스 범위 [fromIdx, toIdx) — polyline[i]~polyline[i+1] 선분 기준. */
  fromIdx: number;
  toIdx: number;
  terrain: TerrainType;
  /** 회랑 반폭 (m). 생략 시 terrain 기본값. */
  corridorHalfWidthM?: number | undefined;
  /** 난이도 계수 ×10 정수 (10 = ×1.0 ~ 40 = ×4.0). 표고 기반 자동 산출 + 커뮤니티 검증. */
  difficultyTenths: number;
}

export interface CourseData {
  courseId: string;
  name: string;
  /** 공식 트레일 폴리라인. */
  polyline: GeoPoint[];
  segments: CourseSegmentMeta[];
  /** 코스 등록부 배포 버전. */
  version: number;
}

/** 등록 엔젤 포인트 — 엔젤 우회 판정용 (디렉토리 서버가 배포, 오프라인 캐시). */
export interface AngelPoint {
  memberId: string;
  name: string;
  location: GeoPoint;
}

/** 선분 인덱스가 속한 구간 메타 (없으면 마지막 구간으로 폴백). */
export function segmentMetaAt(course: CourseData, segmentIndex: number): CourseSegmentMeta {
  for (const seg of course.segments) {
    if (segmentIndex >= seg.fromIdx && segmentIndex < seg.toIdx) return seg;
  }
  return course.segments[course.segments.length - 1]!;
}

export function corridorHalfWidthAt(course: CourseData, segmentIndex: number): number {
  const meta = segmentMetaAt(course, segmentIndex);
  return meta.corridorHalfWidthM ?? DEFAULT_CORRIDOR_HALF_WIDTH_M[meta.terrain];
}
