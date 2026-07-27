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

/**
 * 회랑 반폭 허용 대역 (m) — **코인이 생성되는 땅의 크기다. 데이터가 정하게 두지 않는다.**
 *
 * 상한 150 = 위 표의 가장 넓은 값(URBAN). 하한 10 = 최소 회랑(50)의 1/5.
 * 커뮤니티 코스 제안은 `segments`를 통째로 받아 배포한다(server/src/community.ts).
 * 검증이 없으면 `corridorHalfWidthM: 50000`을 실어 제안·승격시켜 **반경 50km 안
 * 어디서나 기준 요율**을 받을 수 있었다 — 실행으로 확인된 발행 누수다.
 * 반대로 `0`을 실으면 그 코스를 걷는 사람이 전원 코스 밖이 된다(정직한 사람 차단).
 * 그래서 양쪽을 다 막는다.
 *
 * 이것은 통화정책 결정이 아니다 — 위 표에 이미 있는 값의 범위를 강제할 뿐이다.
 * 대역 자체를 바꾸는 것은 다니엘 쌤 결정 사항이다.
 */
export const MIN_CORRIDOR_HALF_WIDTH_M = 10;
export const MAX_CORRIDOR_HALF_WIDTH_M = 150;

/** 난이도 계수(×10 정수) 허용 대역 — 하한 ×1.0, 상한 ×4.0(확정 파라미터). */
export const MIN_DIFFICULTY_TENTHS = 10;
export const MAX_DIFFICULTY_TENTHS = 40;

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

// ── 코스 기하 검증 (커뮤니티 제안 → 배포 경계) ──────────────────────────────
//
// 코스 폴리라인과 구간 메타는 **코인이 어디서 얼마나 생성되는지**를 그대로 정한다.
// 커뮤니티 제안 경로(POST /courses/proposals → 100명 완주 → 자동 공식 승격)에는
// 사람의 검토가 없으므로, 접수 경계에서 형태를 검사하지 않으면 임의의 숫자가
// 그대로 화폐 규칙이 된다. 아래 검사는 값을 고쳐 주지 않고 **거부**한다 —
// 조용히 클램프하면 제안자가 자기가 낸 코스와 다른 코스를 배포받게 된다.

export type CourseGeometryError =
  | 'POLYLINE_TOO_SHORT'
  | 'POLYLINE_TOO_LONG'
  | 'POLYLINE_BAD_POINT'
  | 'SEGMENTS_NOT_ARRAY'
  | 'SEGMENTS_EMPTY'
  | 'SEGMENT_BAD_RANGE'
  | 'SEGMENT_BAD_TERRAIN'
  | 'SEGMENT_BAD_DIFFICULTY'
  | 'SEGMENT_BAD_CORRIDOR';

/** 폴리라인 점 수 상한 — 실물 쉬빌 이스라엘이 5,569점이다. 메모리·번들 방어선. */
export const MAX_COURSE_POLYLINE_POINTS = 100_000;

const TERRAINS: readonly string[] = ['OPEN', 'FOREST', 'MOUNTAIN', 'URBAN'];

/** 폴리라인 검증: 2점 이상, 각 점이 실제 지구 좌표. 반환 null = 통과. */
export function validateCoursePolyline(polyline: unknown): CourseGeometryError | null {
  if (!Array.isArray(polyline) || polyline.length < 2) return 'POLYLINE_TOO_SHORT';
  if (polyline.length > MAX_COURSE_POLYLINE_POINTS) return 'POLYLINE_TOO_LONG';
  for (const p of polyline as unknown[]) {
    if (typeof p !== 'object' || p === null) return 'POLYLINE_BAD_POINT';
    const { lat, lon } = p as { lat?: unknown; lon?: unknown };
    if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      return 'POLYLINE_BAD_POINT';
    }
    if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      return 'POLYLINE_BAD_POINT';
    }
  }
  return null;
}

/**
 * 구간 메타 검증: 인덱스 범위·지형·난이도·회랑 반폭이 전부 허용 대역 안인지.
 * `polylineLength`는 선분 인덱스의 상한을 정한다 (선분 i = polyline[i]~polyline[i+1]).
 */
export function validateCourseSegments(
  segments: unknown,
  polylineLength: number,
): CourseGeometryError | null {
  if (!Array.isArray(segments)) return 'SEGMENTS_NOT_ARRAY';
  if (segments.length === 0) return 'SEGMENTS_EMPTY';
  const maxSegmentIdx = Math.max(1, polylineLength - 1);
  for (const s of segments as unknown[]) {
    if (typeof s !== 'object' || s === null) return 'SEGMENT_BAD_RANGE';
    const seg = s as Partial<CourseSegmentMeta>;
    if (
      !Number.isInteger(seg.fromIdx) ||
      !Number.isInteger(seg.toIdx) ||
      seg.fromIdx! < 0 ||
      seg.toIdx! <= seg.fromIdx! ||
      seg.toIdx! > maxSegmentIdx
    ) {
      return 'SEGMENT_BAD_RANGE';
    }
    if (typeof seg.terrain !== 'string' || !TERRAINS.includes(seg.terrain)) {
      return 'SEGMENT_BAD_TERRAIN';
    }
    if (
      !Number.isInteger(seg.difficultyTenths) ||
      seg.difficultyTenths! < MIN_DIFFICULTY_TENTHS ||
      seg.difficultyTenths! > MAX_DIFFICULTY_TENTHS
    ) {
      return 'SEGMENT_BAD_DIFFICULTY';
    }
    if (seg.corridorHalfWidthM !== undefined) {
      const w = seg.corridorHalfWidthM;
      if (
        typeof w !== 'number' ||
        !Number.isFinite(w) ||
        w < MIN_CORRIDOR_HALF_WIDTH_M ||
        w > MAX_CORRIDOR_HALF_WIDTH_M
      ) {
        return 'SEGMENT_BAD_CORRIDOR';
      }
    }
  }
  return null;
}

/** 구간 메타가 하나도 없을 때의 안전 기본값 — 가장 좁은 회랑·기준 요율. */
const FALLBACK_SEGMENT: CourseSegmentMeta = {
  fromIdx: 0,
  toIdx: Number.MAX_SAFE_INTEGER,
  terrain: 'OPEN',
  difficultyTenths: MIN_DIFFICULTY_TENTHS,
};

/**
 * 선분 인덱스가 속한 구간 메타 (없으면 마지막 구간으로 폴백).
 *
 * ★`segments`가 빈 배열이면 예전에는 `undefined`를 반환해 `corridorHalfWidthAt`이
 *  던졌다 — 그런 코스가 배포되면 지갑의 회랑 판정이 **픽스마다** 예외를 내서
 *  걷기 자체가 멈춘다(0층 붕괴). 데이터로 앱을 죽일 수 없게 안전값으로 떨어진다.
 */
export function segmentMetaAt(course: CourseData, segmentIndex: number): CourseSegmentMeta {
  for (const seg of course.segments) {
    if (segmentIndex >= seg.fromIdx && segmentIndex < seg.toIdx) return seg;
  }
  return course.segments[course.segments.length - 1] ?? FALLBACK_SEGMENT;
}

/**
 * 회랑 반폭 (m) — 배포 데이터를 그대로 믿지 않고 허용 대역으로 **클램프**한다.
 *
 * 서버가 제안 접수 시점에 이미 거부하지만(community.ts), 지갑은 서버가 준 것을
 * 오프라인 캐시로도 쓴다. 검사가 한 곳뿐이면 그 한 곳을 우회하는 경로(옛 DB 행,
 * 다른 배포자, 캐시 조작)에서 회랑이 무한정 넓어진다. 화폐가 생성되는 땅의 크기이므로
 * 읽는 쪽에서도 잠근다 (fail-closed).
 */
export function corridorHalfWidthAt(course: CourseData, segmentIndex: number): number {
  const meta = segmentMetaAt(course, segmentIndex);
  const raw = meta.corridorHalfWidthM ?? DEFAULT_CORRIDOR_HALF_WIDTH_M[meta.terrain];
  if (!Number.isFinite(raw)) return DEFAULT_CORRIDOR_HALF_WIDTH_M.OPEN;
  return Math.min(MAX_CORRIDOR_HALF_WIDTH_M, Math.max(MIN_CORRIDOR_HALF_WIDTH_M, raw));
}

/**
 * 쉬빌 이스라엘 북부 구간 — **테스트 전용 합성 폴리라인. 배포하지 않는다.**
 *
 * ★2026-07-27: 실물 코스가 들어오면서 이 상수는 배포 목록에서 빠졌다
 *  (`server/src/courses.ts` BUILTIN_COURSES). 손으로 찍은 11점·6.72km이며,
 *  실측 결과 실제 트레일에서 최소 961m / 중앙 1,793m 떨어져 있어 회랑 50m 안에
 *  드는 점이 하나도 없다 — 즉 이것을 배포하면 (가) 진짜 트레일을 걷는 사람이
 *  "코스 밖" 판정을 받고 (나) 트레일이 아닌 선 위에서 코인이 생성된다(제3조 위반).
 *
 * ★courseId가 'shvil-israel'에서 'shvil-israel-sample'로 바뀌었다.
 *  'shvil-israel'은 **실물**(worldCourses.ts SHVIL_ISRAEL)이 가져간다 —
 *  이미 발행된 코인의 계보에 새겨진 courseId가 'shvil-israel'이므로, 그 ID가
 *  계속 배포 목록에 있어야 옛 코인이 아는 코스로 남는다(소급 무효화 금지).
 *  'shvil-israel-sample'은 이번에 처음 생긴 ID라 이것으로 발행된 코인은 없다.
 *
 * 회랑 판정 엔진의 단위 테스트에는 여전히 이 작고 예측 가능한 기하가 필요하다
 * (5,569점 실물로는 "개활지 구간 ×1.0 / 산악 구간 ×1.5" 같은 구간 경계 검증이
 *  불가능하다). 그래서 지우지 않고 테스트 픽스처로 남긴다.
 * 전반 개활지(회랑 50m, ×1.0), 후반 산악(회랑 100m, ×1.5).
 */
export const SHVIL_ISRAEL_NORTH_SAMPLE: CourseData = {
  courseId: 'shvil-israel-sample',
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

/**
 * 분당 이마트 → 불곡산 정상 — 닫힌 시험용 국내 코스 (다니엘 쌤 지정, 2026-07-18).
 * 시점: 이마트 분당점(정자동 불정로, OSM 37.35876/127.11971) → 정자동 주택가 동측
 * → 등산로 진입 → 남동 능선 → 불곡산 정상(성남·광주 경계, OSM 37.35170/127.13439).
 * 편도 약 1.6km. 폴리라인은 실제 등산로의 직선 근사이므로 회랑을 넉넉히 잡는다
 * (도심 150m 기본, 산악 120m 명시). 실걷기에서 "코스 밖"이 잦으면 좌표를 실측 보정.
 * ⚠️ 코스명은 ASCII 고유명사 표기 — 서버 /courses 응답은 UI 문구를 나르지 않는다
 * (noUiStrings — 한글 명칭 표시는 클라이언트 사전/코스 등록부 후속 몫).
 */
export const BUNDANG_BULGOKSAN_SAMPLE: CourseData = {
  courseId: 'bundang-bulgoksan',
  name: 'Bundang E-mart - Bulgoksan Peak (pilot)',
  version: 1,
  polyline: [
    { lat: 37.35876, lon: 127.11971 }, // 이마트 분당점
    { lat: 37.3581, lon: 127.1225 }, // 불정로 동측 횡단
    { lat: 37.3572, lon: 127.1258 }, // 정자동 주택가 동단 — 등산로 입구
    { lat: 37.356, lon: 127.1282 }, // 산자락 진입
    { lat: 37.3549, lon: 127.1305 }, // 능선 오르막
    { lat: 37.3538, lon: 127.1322 }, // 중턱 쉼터
    { lat: 37.3527, lon: 127.1334 }, // 능선길
    { lat: 37.3517, lon: 127.13439 }, // 불곡산 정상 (344m)
  ],
  segments: [
    { fromIdx: 0, toIdx: 2, terrain: 'URBAN', difficultyTenths: 10 },
    { fromIdx: 2, toIdx: 7, terrain: 'MOUNTAIN', difficultyTenths: 15, corridorHalfWidthM: 120 },
  ],
};

/** 샘플 엔젤 포인트 — 서버 미가동·오프라인 시 폴백. */
export const SAMPLE_ANGELS: AngelPoint[] = [
  { memberId: 'angel-dafna', name: '다프나의 집 (샘플)', location: { lat: 33.229, lon: 35.655 } },
  { memberId: 'angel-hagoshrim', name: '하고쉬림 정원 (샘플)', location: { lat: 33.218, lon: 35.625 } },
];
