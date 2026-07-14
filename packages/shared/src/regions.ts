/**
 * 세계 트레일 지역 카탈로그 (다니엘 쌤 방향 2026-07-13).
 *
 * 쉬빌은 이스라엘에서 모티브를 얻고 이스라엘 국립 트레일에서 먼저 런칭하지만,
 * 처음부터 전 세계 트레일로 확장하는 것을 전제로 한다. 쉬빌리스트(걷는 사람)도
 * 쉬빌엔젤도 어느 트레일/지역에서 활동할지 선택할 수 있어야 한다.
 *
 * - 이 카탈로그는 "어느 지역이 열려 있는가"의 메뉴다. LIVE는 실제 코스 데이터가
 *   연결되어 코인 생성·엔젤 활동이 가능한 지역, COMING_SOON은 확장 예정 지역.
 * - 트레일 "정보"(상세 코스 가이드) 자체는 별도 서비스(Shvil List)에서 다룬다.
 *   여기서는 지역 선택과 시스템 코스 연결만 담당한다.
 * - 목표는 150개국 확장. 아래는 대표 트레일 시드 목록이며, 커뮤니티 승격(코스 등록부)
 *   으로 지역·코스가 계속 추가된다.
 */

export type TrailStatus =
  | 'LIVE' // 코스 데이터 연결 — 코인 생성·엔젤 활동 가능
  | 'COMING_SOON'; // 확장 예정 — 관심 등록만

export interface TrailRegion {
  /** 안정적 슬러그. */
  regionId: string;
  /** 트레일 고유명 (영문 — 고유명사). 국가명은 표시 계층에서 로케일별로. */
  trailName: string;
  /** ISO 3166-1 alpha-2 국가 코드 (표시·국기·그룹핑용). */
  countryCode: string;
  status: TrailStatus;
  /** 연결된 시스템 코스 ID (LIVE만). 회랑 판정·배포 코스와 연결된다. */
  courseIds: string[];
}

/**
 * 대표 트레일 시드. 이스라엘 국립 트레일이 먼저 런칭(LIVE)하고, 세계 대표 트레일은
 * 확장 예정(COMING_SOON)으로 노출한다. 전 세계 150개국 확장의 출발점이다.
 */
export const WORLD_TRAILS: TrailRegion[] = [
  { regionId: 'israel-national', trailName: 'Israel National Trail', countryCode: 'IL', status: 'LIVE', courseIds: ['shvil-israel'] },
  { regionId: 'camino-de-santiago', trailName: 'Camino de Santiago', countryCode: 'ES', status: 'COMING_SOON', courseIds: [] },
  { regionId: 'inca-trail', trailName: 'Inca Trail', countryCode: 'PE', status: 'COMING_SOON', courseIds: [] },
  { regionId: 'annapurna-circuit', trailName: 'Annapurna Circuit', countryCode: 'NP', status: 'COMING_SOON', courseIds: [] },
  { regionId: 'everest-base-camp', trailName: 'Everest Base Camp', countryCode: 'NP', status: 'COMING_SOON', courseIds: [] },
  { regionId: 'torres-del-paine-w', trailName: 'Torres del Paine W Trek', countryCode: 'CL', status: 'COMING_SOON', courseIds: [] },
  { regionId: 'tour-du-mont-blanc', trailName: 'Tour du Mont Blanc', countryCode: 'FR', status: 'COMING_SOON', courseIds: [] },
  { regionId: 'milford-track', trailName: 'Milford Track', countryCode: 'NZ', status: 'COMING_SOON', courseIds: [] },
  { regionId: 'gr20', trailName: 'GR20', countryCode: 'FR', status: 'COMING_SOON', courseIds: [] },
  { regionId: 'john-muir-trail', trailName: 'John Muir Trail', countryCode: 'US', status: 'COMING_SOON', courseIds: [] },
  { regionId: 'kilimanjaro', trailName: 'Kilimanjaro', countryCode: 'TZ', status: 'COMING_SOON', courseIds: [] },
];

/** 확장 목표 국가 수 — UI가 "150개국으로 확장" 비전을 표기하는 데 쓴다. */
export const TARGET_COUNTRY_COUNT = 150;

/** 코인 생성·엔젤 활동이 실제 가능한(LIVE) 지역만. */
export function liveRegions(catalog: TrailRegion[] = WORLD_TRAILS): TrailRegion[] {
  return catalog.filter((r) => r.status === 'LIVE');
}

export function regionById(regionId: string, catalog: TrailRegion[] = WORLD_TRAILS): TrailRegion | undefined {
  return catalog.find((r) => r.regionId === regionId);
}

/** 코스 ID로 소속 지역을 찾는다 (엔젤·코인의 지역 귀속 판정용). */
export function regionByCourseId(courseId: string, catalog: TrailRegion[] = WORLD_TRAILS): TrailRegion | undefined {
  return catalog.find((r) => r.courseIds.includes(courseId));
}

/** 기본 선택 지역 — 먼저 런칭한 지역(이스라엘). */
export const DEFAULT_REGION_ID = 'israel-national';
