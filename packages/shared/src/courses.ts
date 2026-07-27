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
 *
 * ★2026-07-27 폴리라인 전면 교체 — **이전 8점은 손으로 찍은 직선 근사였고,
 *  실제 등산로가 아니었다.** 실측: 코스선을 10 m 간격으로 재표본해 가장 가까운
 *  OSM 보행로까지 재니 산악 구간 표본의 51.5%가 회랑 120 m **밖**이었고
 *  (중앙 126.2 m / 최대 217.8 m), 실제 등산로를 GPS 오차 0으로 걸어도 창 38개 중
 *  16개만 ON_COURSE였다(0.8 SHV). 즉 **폰을 들고 진짜로 걸으면 앱 잘못이 아니라
 *  좌표 잘못으로 "코스 밖"이 절반 뜬다.** 이전 주석이 이미 "실걷기에서 코스 밖이
 *  잦으면 좌표를 실측 보정"이라고 적어 두었으니, 그 보정을 여기서 한 것이다.
 *
 * 새 좌표 = OSM 보행로 그래프(bbox 37.3480,127.1150–37.3620,127.1400, way 299개)
 * 위에서 이마트→정상 최단 도보 경로를 다익스트라로 뽑은 67점, 1,819.3 m.
 * 67점 전부가 OSM `highway=footway|path` 선 위에 있다(수직거리 0 m 실측).
 * 시점은 이마트 건물에서 가장 가까운 보행로 진입점(약 48 m), 종점은 정상 표기점에서 6 m.
 *
 * ── 구간 나누기 근거 (사람이 눈대중으로 정하지 않았다) ──────────────────
 * 각 점에서 가장 가까운 **차도 계열**(residential/service/tertiary/secondary/primary)
 * 까지의 거리를 재어, 150 m 이내면 URBAN·넘으면 MOUNTAIN으로 갈랐다.
 * 실측 거리는 점 0에서 14 m로 시작해 단조 증가하며 점 32에서 165 m로 문턱을 넘는다
 * (점 31 = 140 m). 그래서 경계는 선분 32다 — 도심 814 m + 산악 1,005 m.
 *
 * 회랑은 **넓히기만 했다**: URBAN 150 m(지형 기본), MOUNTAIN 120 m(명시, 종전과 동일).
 * 좌표가 실제 길 위로 왔으므로 사실 이만큼 필요하지 않지만, 좁히면 이 코스로 이미
 * 발행된 코인이 소급해서 "규칙 밖"이 된다(docs/소급무효화_경로.md). 넓은 쪽만 안전하다.
 *
 * ⚠️ 코스명은 ASCII 고유명사 표기 — 서버 /courses 응답은 UI 문구를 나르지 않는다
 * (noUiStrings — 한글 명칭 표시는 클라이언트 사전/코스 등록부 후속 몫).
 * 출처: OpenStreetMap 기여자 (ODbL) — https://www.openstreetmap.org/copyright
 */
export const BUNDANG_BULGOKSAN_SAMPLE: CourseData = {
  courseId: 'bundang-bulgoksan',
  name: 'Bundang E-mart - Bulgoksan Peak (pilot)',
  // 좌표가 통째로 바뀌었으므로 배포 버전을 올린다 — 옛 캐시를 든 지갑이 갱신을 알아채야 한다.
  version: 2,
  polyline: [
    // 0~32: 정자동 시가지 보행로 (이마트 → 주택가 동단)
    { lat: 37.3590527, lon: 127.1193043 }, { lat: 37.3590773, lon: 127.1202396 }, { lat: 37.3590814, lon: 127.1204033 },
    { lat: 37.3590466, lon: 127.1204431 }, { lat: 37.3589028, lon: 127.1206952 }, { lat: 37.3588288, lon: 127.1207391 },
    { lat: 37.3587852, lon: 127.1208213 }, { lat: 37.3587155, lon: 127.1208322 }, { lat: 37.3585587, lon: 127.1208048 },
    { lat: 37.3584585, lon: 127.1208816 }, { lat: 37.3583801, lon: 127.1210131 }, { lat: 37.3582106, lon: 127.1212095 },
    { lat: 37.3580102, lon: 127.1212041 }, { lat: 37.3578609, lon: 127.121188 }, { lat: 37.3577586, lon: 127.1211559 },
    { lat: 37.3575795, lon: 127.121129 }, { lat: 37.3574004, lon: 127.1212149 }, { lat: 37.3572171, lon: 127.121349 },
    { lat: 37.3570934, lon: 127.1214777 }, { lat: 37.3571787, lon: 127.1216655 }, { lat: 37.3572597, lon: 127.1219391 },
    { lat: 37.3572256, lon: 127.1223468 }, { lat: 37.357136, lon: 127.1226686 }, { lat: 37.3569314, lon: 127.1231407 },
    { lat: 37.3565135, lon: 127.1236288 }, { lat: 37.356279, lon: 127.123881 }, { lat: 37.3560146, lon: 127.1240848 },
    { lat: 37.3557889, lon: 127.1244418 }, { lat: 37.3557161, lon: 127.1245569 }, { lat: 37.3555626, lon: 127.1247715 },
    { lat: 37.3553451, lon: 127.124868 }, { lat: 37.3552257, lon: 127.1250665 }, { lat: 37.3550509, lon: 127.1254206 },
    // 32~66: 불곡산 등산로 (능선 오르막 → 정상)
    { lat: 37.3549315, lon: 127.1256727 }, { lat: 37.3543431, lon: 127.1264559 }, { lat: 37.3540318, lon: 127.1267724 },
    { lat: 37.3538271, lon: 127.1268421 }, { lat: 37.353648, lon: 127.1270513 }, { lat: 37.3535243, lon: 127.1272069 },
    { lat: 37.3533282, lon: 127.1275985 }, { lat: 37.3532833, lon: 127.1276647 }, { lat: 37.3531278, lon: 127.1278936 },
    { lat: 37.3527568, lon: 127.1283388 }, { lat: 37.3524924, lon: 127.1286875 }, { lat: 37.3521385, lon: 127.1295565 },
    { lat: 37.351921, lon: 127.1302271 }, { lat: 37.3518058, lon: 127.1304363 }, { lat: 37.3516734, lon: 127.1306196 },
    { lat: 37.3513666, lon: 127.1308118 }, { lat: 37.3512323, lon: 127.130973 }, { lat: 37.35113, lon: 127.1312425 },
    { lat: 37.3511278, lon: 127.1315038 }, { lat: 37.3512003, lon: 127.1317989 }, { lat: 37.3511918, lon: 127.1320295 },
    { lat: 37.3510937, lon: 127.1324211 }, { lat: 37.3510553, lon: 127.1327537 }, { lat: 37.3510551, lon: 127.1330772 },
    { lat: 37.3511587, lon: 127.1331775 }, { lat: 37.3512352, lon: 127.1331838 }, { lat: 37.3513005, lon: 127.1332526 },
    { lat: 37.3513391, lon: 127.1334098 }, { lat: 37.3514187, lon: 127.1336045 }, { lat: 37.3514735, lon: 127.1338407 },
    { lat: 37.3515274, lon: 127.1339922 }, { lat: 37.3515989, lon: 127.13423 }, { lat: 37.3516427, lon: 127.1343428 },
    { lat: 37.3517496, lon: 127.1343971 }, // 불곡산 정상 (344m)
  ],
  segments: [
    { fromIdx: 0, toIdx: 32, terrain: 'URBAN', difficultyTenths: 10 },
    { fromIdx: 32, toIdx: 66, terrain: 'MOUNTAIN', difficultyTenths: 15, corridorHalfWidthM: 120 },
  ],
};

/** 샘플 엔젤 포인트 — 서버 미가동·오프라인 시 폴백. */
export const SAMPLE_ANGELS: AngelPoint[] = [
  { memberId: 'angel-dafna', name: '다프나의 집 (샘플)', location: { lat: 33.229, lon: 35.655 } },
  { memberId: 'angel-hagoshrim', name: '하고쉬림 정원 (샘플)', location: { lat: 33.218, lon: 35.625 } },
];
