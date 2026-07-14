/**
 * 코스 데이터 스키마 + 배포 데이터 (앱·서버 공유).
 *
 * 여기의 좌표는 "공개 트레일 폴리라인"과 "엔젤이 자발 공개한 포인트"다 —
 * 사용자의 이동 궤적이 아니다. 위치 비저장 원칙(지시서 0-10)은 사용자 좌표에
 * 관한 것이며, 공개 지도 데이터는 그 대상이 아니다.
 *
 * 원본은 shvilist.org 코스 등록부(M4)이며, 디렉토리 서버가 배포하고
 * 앱은 갱신분을 내려받아 내장한다 (오프라인 동작 필수).
 */

/** 공개 지도 데이터의 좌표 (트레일·엔젤 포인트 전용). */
export interface GeoPoint {
  lat: number;
  lon: number;
}

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
  polyline: GeoPoint[];
  segments: CourseSegmentMeta[];
  /** 코스 등록부 배포 버전. */
  version: number;
}

/** 등록 엔젤 포인트 — 엔젤 우회 판정·지도 표시용 (본인이 공개 설정한 위치). */
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

/**
 * 쉬빌 이스라엘 북부 구간 — 파일럿용 샘플 폴리라인.
 * ⚠️ 예시 좌표다. 실제 파일럿 구간·초기 엔젤 포인트는 결정 대기 6번.
 * 전반 4km 개활지(회랑 50m, ×1.0), 후반 4km 산악(회랑 100m, ×1.5).
 */
export const SHVIL_ISRAEL_NORTH_SAMPLE: CourseData = {
  courseId: 'shvil-israel',
  // 코스명은 현지 공식 명칭(고유명사)으로 둔다 — 서버·데이터 계층은 UI 문구를 나르지 않는다.
  name: 'Israel National Trail (north sample section)',
  version: 1,
  polyline: [
    { lat: 33.2485, lon: 35.6523 },
    { lat: 33.2432, lon: 35.6489 },
    { lat: 33.2378, lon: 35.6455 },
    { lat: 33.2325, lon: 35.6420 },
    { lat: 33.2271, lon: 35.6386 },
    { lat: 33.2218, lon: 35.6352 },
    { lat: 33.2169, lon: 35.6310 },
    { lat: 33.2121, lon: 35.6266 },
    { lat: 33.2073, lon: 35.6223 },
    { lat: 33.2024, lon: 35.6180 },
    { lat: 33.1976, lon: 35.6137 },
  ],
  segments: [
    { fromIdx: 0, toIdx: 5, terrain: 'OPEN', difficultyTenths: 10 },
    { fromIdx: 5, toIdx: 10, terrain: 'MOUNTAIN', difficultyTenths: 15 },
  ],
};

/** 샘플 엔젤 포인트 — 서버 미가동·오프라인 시 폴백. */
export const SAMPLE_ANGELS: AngelPoint[] = [
  { memberId: 'angel-dafna', name: '다프나의 집 (샘플)', location: { lat: 33.229, lon: 35.655 } },
  { memberId: 'angel-hagoshrim', name: '하고쉬림 정원 (샘플)', location: { lat: 33.218, lon: 35.625 } },
];
