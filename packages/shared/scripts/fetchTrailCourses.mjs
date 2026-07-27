/**
 * 세계 트레일 코스 데이터 생성기 (M14 — docs/세계코스_활성화_계획.md).
 *
 * OpenStreetMap Overpass API에서 **사람이 확인한 관계 ID**의 실측 경로를 받아
 * CourseData(폴리라인 + 구간 메타)로 변환한다.
 *
 * ── 왜 매니페스트 주도인가 (자동 이름 검색 금지) ─────────────────────────
 * 조사에서 "Inca Trail" 검색이 **볼리비아의 Takesi Inca Trail**을 잡았다 — 페루
 * 마추픽추 잉카 트레일이 아니다. 이름 검색에 맡기면 엉뚱한 대륙의 경로로 코인 생성이
 * 열린다. 그래서 이 스크립트는 검색하지 않는다: 아래 MANIFEST의 relationId는
 * **사람이 osm.org에서 경로를 눈으로 확인하고 적은 값**만 받는다.
 *
 * ── 왜 단순화가 필수인가 ────────────────────────────────────────────────
 * Milford Track 54km가 원본 2,068점(약 26m 간격)이다. 10개 트레일 총 2,000km면
 * 7~8만 점이라 오프라인 번들에 들어갈 수 없다. Douglas–Peucker로 줄이되, 허용 오차는
 * **최소 회랑 반폭(개활지 50m)의 1/2.5인 20m**를 기본으로 한다 — 이보다 크면 단순화
 * 자체가 회랑 판정을 왜곡한다(곧은 선분이 실제 길에서 벗어난다).
 *
 * ── 검증 원칙 ───────────────────────────────────────────────────────────
 * 생성 결과는 **알려진 총 연장과 대조**한다(expectedKm). ±15%를 벗어나면 way를 잘못
 * 이어붙였거나 다른 트레일을 받은 것이므로 경고한다 — 좌표를 눈으로 다 볼 수는 없으니
 * 이 대조가 가장 값싼 오류 검출기다.
 *
 * 사용:
 *   node packages/shared/scripts/fetchTrailCourses.mjs            # 매니페스트 전체
 *   node packages/shared/scripts/fetchTrailCourses.mjs milford-track
 *
 * 출처 표기: 이 데이터는 OpenStreetMap 기여자들의 것이며 ODbL로 제공된다.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'src', 'worldCourses.ts');
const CACHE_DIR = join(HERE, 'osm-cache');

/**
 * Overpass 엔드포인트 — **전역 데이터베이스만** 쓴다. 순서대로 시도한다.
 *
 * ★overpass.osm.ch 를 절대 넣지 마라. 이름과 달리 전역 미러가 아니라 **스위스 지역
 *  추출본**이고, 스위스 밖을 물으면 오류가 아니라 `{"elements":[]}` 를 HTTP 200 +
 *  정상 JSON 으로 돌려준다. 2026-07-27 조사에서 이것 때문에 페루 잉카(rel 15703494),
 *  킬리만자로 7개 루트, 코르시카 GR20 이 전부 "OSM에 없음"으로 잘못 결론날 뻔했고,
 *  TMB 는 way 726개 중 325개만 와서 -58%로 탈락 판정이 났다가 뒤집혔다.
 *  "응답이 '{' 로 시작하는가" 검사로는 이 함정이 걸러지지 않는다 — 정상 JSON 이다.
 */
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const UA = 'shvil-dev/0.1 (world trail course catalog; contact via github.com/danielparkmidbar/shvil)';

/**
 * 트레일 매니페스트 — relationId는 **사람이 확인한 값만** 넣는다.
 *
 * 확인 방법: https://www.openstreetmap.org/relation/<ID> 를 열어 (1) 이름·나라가 맞는지
 * (2) 경로가 실제 트레일을 따르는지 (3) 변형이 의도한 것인지 눈으로 본다.
 *
 * relationId: null = 아직 미확인 (이 항목은 생성에서 건너뛴다).
 *
 * ── ★난이도 계수(difficultyTenths)는 전부 10(×1.0)에서 출발한다 (2026-07-27 방침) ──
 * 이전 판은 산악 트레일에 20~30(×2.0~×3.0)을 임의로 매겨 두었다. 근거가 없었다.
 * 계수는 곧 **통화정책**이다 — ×1.0을 ×1.5로 올리면 같은 거리를 걷고 받는 1 SHV의
 * 가치가 33% 흔들린다(발행량이 1.5배가 되므로). 산정 공식(표고 누적·노면·고도)이
 * 확정되고 커뮤니티 검증을 거치기 전까지는 **아무도 올리지 않는다.** 내리는 것은
 * 과다발행을 막는 쪽이므로 안전하고, 올리는 것은 되돌릴 수 없다(이미 발행된 코인).
 * 근거: 권장가 풀패키지 18 SHV가 이스라엘 60일 완주 페이스(1,100÷60 = 18.3 SHV/일)와
 * 맞는 것이 ×1.0에서다(docs/SHV_달러가치_2026-07-27.md).
 * ★상향 후보로 지목된 것(기록만 해 둔다, 올리지 않았다): GR20·프리미티보·안나푸르나.
 */
export const MANIFEST = [
  // ── 0순위: 쉬빌 이스라엘 본진 (다니엘 쌤 2026-07-27) ────────────────────
  // ★이 항목이 없어서 등록 코스가 8.27 km(손으로 찍은 샘플)뿐이었다.
  //   M14를 "세계 10대 코스"로 잡으면서 정작 본진을 이미 된 것으로 착각했다.
  //   기존 SHVIL_ISRAEL_NORTH_SAMPLE(11점·6.72 km)은 개발 초기 테스트 데이터이며
  //   실제 트레일이 아니다 — 이 항목이 그것을 대체한다.
  {
    regionId: 'shvil-israel',
    courseId: 'shvil-israel',
    name: 'שביל ישראל (Israel National Trail)',
    // ✅ 확인됨 (2026-07-27): OSM relation 282071 "שביל ישראל" / name:en "Israel National
    //    Trail", type=route, route=hiking, network=nwn, operator=itc(이스라엘 트레일 위원회).
    //    Overpass에서 이 이름 패턴으로 잡히는 관계가 **이것 하나뿐**이다(동명이 없다).
    //    실측: way 2,470개 / 원본 44,161점 / 총 연장 1,080.7 km — 기대 1,100 km 대비 -1.8%.
    //    카미노(+93% 초과)와 달리 데이터가 깨끗하다. 이스라엘 OSM 커뮤니티
    //    (israelhiking.osm.org.il)가 관리해온 결과다 — 다니엘 쌤이 지목한 출처.
    relationId: 282071,
    expectedKm: 1100,
    // 난이도는 보수적으로 ×1.0(기준 요율 1 km = 1 SHV)에서 출발한다.
    // 근거: 권장가 풀패키지 18 SHV가 60일 완주 페이스(1,100÷60 = 18.3 SHV/일)와
    // 일치하는 것이 ×1.0에서다(docs/SHV_달러가치_2026-07-27.md). 구간별 난이도는
    // 산정 공식이 확정된 뒤에 올린다 — 계수는 곧 통화정책이므로 임의로 정하지 않는다.
    defaultTerrain: 'OPEN',
    difficultyTenths: 10,
    priority: 0,
  },
  // ── 1차 대상 (다니엘 쌤 결정 2026-07-22: 자유 도보 가능 트레일만) ──────
  // 변형은 "가장 많은 사람이 다니는 길"을 택한다 (결정 1).
  {
    regionId: 'camino-de-santiago',
    courseId: 'camino-frances',
    // 결정 1: 카미노 여러 갈래 중 **Camino Francés**가 압도적 다수(순례자 통계상
    // 절반 이상)가 걷는 본선이다. 생 장 피에드포르 → 산티아고 데 콤포스텔라.
    name: 'Camino de Santiago (Camino Francés)',
    // ✅ 확인됨 (2026-07-22): OSM superroute 2163573 "Camiño Francés", distance=750,
    //    from=Saint-Jean-pied-de-port / to=Santiago de Compostela, network=iwn,
    //    wikidata=Q1029584. 구간 관계 6개 + 대체 경로 1개를 묶는 상위 관계.
    //    하위 구간(예: 2163558 = 03 Logroño→Burgos)만 받으면 일부만 나오므로
    //    반드시 이 상위 ID를 쓴다.
    // ✅ 생성 검증 (2026-07-27): 본선 6개 구간 way 2,973개 / 원본 32,611점 /
    //    767.5 km → 단순화 2,794점 756.9 km. 기대 780 km 대비 -3.0% → 통과.
    //    구간 이음 직선 0.00 km, way 이음 직선 0.00 km, 버린 조각 0개.
    //    시작 43.16234,-1.23723(생장피에드포르) 끝 42.88049,-8.54575(산티아고).
    //    ★1,518.6 km(+95%)로 탈락하던 원인은 데이터가 아니라 **구간 정렬 버그**였다 —
    //      extractWayGroups 주석 참조. 관계 자체는 깨끗하다.
    //    ★구간 02·05는 상위 관계에 없다. 빠진 것이 아니라 인접 구간에 흡수된 것이다:
    //      01이 생장→로그로뇨(163.3 km), 04가 부르고스→레온이다. 실측으로 확인했다 —
    //      01·03·04·06·07·08 여섯 구간의 이음이 전부 0.00 km로 연속한다.
    relationId: 2163573,
    expectedKm: 780,
    defaultTerrain: 'OPEN',
    difficultyTenths: 10,
    priority: 1, // 순차 활성화 순서 (결정 3) — 가장 많이 걷고 엔젤 문화가 이미 있다
  },
  {
    regionId: 'tour-du-mont-blanc',
    courseId: 'tour-du-mont-blanc',
    name: 'Tour du Mont Blanc',
    // ✅ 확인됨 (2026-07-27): OSM relation 9678362 "Tour du Mont Blanc - Itinéraire principal",
    //    type=route, route=hiking, network=rwn, ref=TMB-IP. name:en 없음.
    //    관리주체: 관계 자체엔 operator가 없으나 같은 way를 쓰는 하이킹 관계 211개의
    //    operator 집계가 Valrando(발레주 도보협회) 12 / Wanderland Schweiz 4 /
    //    Regione Autonoma Valle d'Aosta 4 / Comune di Courmayeur 4 / CCPMB 3 —
    //    3개국 모두 관공서·공식 협회가 관리한다(이스라엘 operator=itc에 준하는 신뢰도).
    //    실측: way 724개 / 17,002점 / 166.0 km — 기대 170 km 대비 -2.4%.
    //    미연결 조각 0개, 최대 이음간격 0 m. 시작=끝 45.80173,6.98407(쿠르마유르) 닫힌 순환로.
    //    나라: lat 45.6965~46.0585 / lon 6.7066~7.1283. FR+IT+CH 밖 way 0개
    //    (Overpass 경계검사 + Nominatim 14점 역지오코딩 IT4/FR7/CH3). 3국 순환로라 정상.
    // ★함정: rel 6436417 "Tour du Mont-Blanc CCW"를 절대 쓰지 마라 — 하위 41개가
    //   **이름 없는** 관계라 변형 필터가 못 거르고, 구간마다 본선+대안을 함께 담아
    //   265.9 km(+56%)가 나온다. 9678362는 하위 관계가 없는 평면 route라 필터에
    //   의존하지 않고 결정적으로 동작한다.
    relationId: 9678362,
    expectedKm: 170,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 10,
    priority: 2,
  },
  {
    regionId: 'annapurna-circuit',
    courseId: 'annapurna-circuit',
    // 결정 1: 서킷 본선(베시사하르 → 토롱라 → 좀솜). 우회 변형은 제외.
    name: 'Annapurna Circuit',
    // ✅ 확인됨 (2026-07-27): OSM relation 1187310 "Annapurna Circuit", type=route,
    //    route=hiking, network=nwn, ref=AC, distance=250,
    //    operator=Annapurna Conservation Area Project (ACAP — 허가를 발급하는 공식
    //    관리기관, NTNC 산하. 이스라엘 operator=itc와 같은 성격). v268, 2026-06-04 수정.
    //    실측: way 422개 / 11,638점 / 223.7 km — 기대 200 km 대비 +11.9%,
    //    단순화 1,261점 214.9 km 기준 +7.4%. OSM distance 태그 250 km 기준으로는 -4.4%.
    //    경유지 실측 최근접: Chame 0.14 / Manang 0.29 / Thorong La 0.02 /
    //    Muktinath 0.00 / Jomsom 0.76 / Tatopani 0.26 / Ghorepani 0.92 km — 고전 본선 통과.
    //    나라: lat 28.2542~28.8352 / lon 83.5939~84.4096, 전 구간 네팔 간다키주.
    //    티베트(중국)·인도 국경에 닿는 점 0개. ABC 트레일과 최근접 20.2 km로 혼입 없음.
    // ★노면 구성: path 49.0% / unclassified 21.7% / track 11.3% / primary 10.6% —
    //   **약 48%가 차량 통행 가능한 도로다.** 도로 건설로 경로가 바뀌어 온 것이
    //   데이터에 그대로 남아 있다. 회랑 위를 차로 달릴 수 있다는 뜻이므로,
    //   활성화 전에 노면별 요율(또는 도로 구간 제외)이 필요한지 다니엘 쌤 검토 사항.
    // ★결정 2 관련(사실만 보고, 임의로 excluded 붙이지 않았다): 네팔 관광청은
    //   에베레스트·안나푸르나 포함 44개 코스에 **가이드 동반 의무**를 두고 TIMS를
    //   등록 에이전시 경유로만 발급한다. 이 관계의 OSM description 태그 자체가
    //   "Annapurna Circuit Trekking Route, permit required"다. 결정 2 기준에 걸릴
    //   가능성이 크다 — 1차 활성화 여부는 다니엘 쌤 결정 사항이다.
    relationId: 1187310,
    expectedKm: 200,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 10,
    priority: 3,
  },
  {
    regionId: 'everest-base-camp',
    courseId: 'everest-base-camp',
    // 결정 1: 루클라 → EBC 표준 경로 (가장 많이 걷는 길).
    name: 'Everest Base Camp Trek',
    // ⛔ relationId를 채우지 않는다 — **연장 검증을 통과하지 못했다**(규칙 1).
    //    후보: OSM relation 1189003 "Everest Base Camp Trek", type=superroute,
    //    route=hiking, network=nwn, ref=EBC (하위 route 4개: Lukla→Namche 18.1 /
    //    Dingboche→Namche 19.0 / Dingboche→Lobuche 8.1 / Lobuche→EBC 8.6 km).
    //    이름·나라는 통과했다: 경유지 8곳(Lukla·Phakding·Namche·Tengboche·Dingboche·
    //    Lobuche·Gorak Shep·EBC) 최근접 0.03~0.31 km, lat 27.6879~28.0029 /
    //    lon 86.7097~86.8557 전 구간 네팔 쿰부, 중국 국경과 7.00 km 이격,
    //    노면 96.3% path, 버린 조각 0개 — 데이터 품질 자체는 이스라엘보다 깨끗하다.
    // ★탈락 원인은 관계가 아니라 **이 expectedKm=130이다.** 실측 편도 53.8 km
    //    (단순화 51.2), 왕복 환산 107.6 km. 130 km는 고소적응 왕복(남체→에베레스트뷰,
    //    딩보체→낭카르창)과 칼라파타르 왕복이 얹힌 트레킹 상품 수치이고, OSM 관계에는
    //    그 지선들이 없다(칼라파타르 최근접 1.31 km). 왕복으로 봐도 -17.2%로 밖이다.
    //    → expectedKm을 편도 54로 고칠지 왕복 108로 볼지는 **다니엘 쌤 결정 사항**이다.
    //      결정이 나면 relationId 1189003을 그대로 넣으면 된다. 지금 130 그대로 넣으면
    //      -60.6%로 fail-closed 되어 어차피 산출물에서 빠진다.
    // ★결정 2 관련: 네팔은 44개 트레킹 코스에 가이드 동반 의무. 안나푸르나 항목 주석 참조.
    relationId: null,
    expectedKm: 130,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 10,
    priority: 4,
  },
  {
    regionId: 'gr20',
    courseId: 'gr20',
    name: 'GR20 (Corsica)',
    // ✅ 확인됨 (2026-07-27): OSM relation 12484370 "GR 20 Principale", type=route,
    //    route=hiking, network=nwn, ref="GR 20". 상위 superroute 101692 "GR 20"의
    //    operator=**FFRP**(Fédération Française de la Randonnée Pédestre — 프랑스
    //    도보연맹, GR 경로의 공식 관리주체). way를 공유하는 관계의 operator에
    //    Collectivité de Corse 3(코르시카 지방정부)·ONF 1(국유림청)도 나온다.
    //    실측: way 159개(중복 제외) / 8,854점 / 182.7 km — 기대 180 km 대비 +1.5%.
    //    미연결 조각 0개, 최대 이음간격 0 m.
    //    나라: lat 41.7348~42.5082 / lon 8.8497~9.3340. 159개 way 전부 Corse
    //    (admin_level=4) 안, 밖 0개. 프랑스 본토 GR 혼입 없음.
    //    편도 확인: 시작 42.50815,8.85485(칼렌자나) → 끝 41.73478,9.33400(콩카) —
    //    알려진 기점·종점과 일치.
    // ★확인하지 않은 것: GR20은 산장(refuge) 예약 관행이 있다. **도보 자체**의 허가
    //   필요 여부는 조사 범위 밖이었다. 결정 2에 걸리는지는 별도 확인이 필요할 수 있다.
    relationId: 12484370,
    expectedKm: 180,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 10,
    priority: 5,
  },
  {
    regionId: 'john-muir-trail',
    courseId: 'john-muir-trail',
    name: 'John Muir Trail',
    // ✅ 확인됨 (2026-07-27): OSM relation 1244828 "John Muir Trail", type=route,
    //    route=hiking, network=rwn, ref=JMT, distance=343.9,
    //    operator=**The JMT Wilderness Conservancy**(실제 트레일 관리 단체 —
    //    이스라엘 operator=itc와 같은 등급). 관계의 distance 태그(343.9)와 실측(335.8)이
    //    -2.4%로 서로 맞아 교차검증된다.
    //    실측: way 94개 / 26,966점 / 335.8 km — 기대 340 km 대비 **-1.2%**(조사 4개 중 최상).
    //    나라: lat 36.5589~37.8721 / lon -119.5586~-118.2915, 미국 캘리포니아
    //    시에라네바다(요세미티 북단 → 휘트니산 남단). 미국 밖 점 없음.
    // ★이름 검색 함정: 스코틀랜드 "John Muir Way"(rel 49215, superroute, 215 km,
    //   operator=Green Action Trust)와 그 구간 관계 12개가 함께 잡힌다.
    //   Way(스코틀랜드)와 Trail(캘리포니아)은 다른 트레일이다.
    relationId: 1244828,
    expectedKm: 340,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 10,
    priority: 6,
  },

  // ── 순례길 (2026-07-27 조사 D — 다니엘 쌤 "순례길들도 등록해줘") ──────────
  // 선정 축 4개: 연간 순례자 수 / 자유 도보 가능(결정 2) / 엔젤 문화 / OSM 품질.
  // 아래 4개는 모두 **허가·예약·가이드 의무가 없다** — 결정 2에 걸리지 않는다.
  {
    regionId: 'shikoku-88',
    courseId: 'shikoku-88',
    name: '四国遍路 (Shikoku 88 Temple Pilgrimage)',
    // ✅ 확인됨 (2026-07-27): OSM relation 13653655 "四国遍路" / name:en "Shikoku
    //    Pilgrimage", type=superroute, route=hiking, network=nwn, distance=1145 km.
    //    멤버 88개(1번 霊山寺 → … → 88번 大窪寺 → 1번으로 39.8 km 순환을 닫는다).
    //    실측: way 4,052개 / 47,719점 / 1,106.9 km — distance 태그 1,145 km 대비 -3.3%,
    //    통칭 1,200 km 대비 -7.8%. 변형(alternativ/variant) 이름 구간 0개 —
    //    카미노를 +93%로 부풀린 종류의 오염이 없다.
    //    나라: lat 32.7242~34.3599 / lon 132.4962~134.6059, 시코쿠 섬 안.
    //    혼슈·규슈로 새는 점 없음(고야산 등 섬 밖 별격 사찰 미포함).
    //    지역 커뮤니티: OSMF Japan(osmf.jp, 2021년 OSMF 정식 로컬 챕터) —
    //    88개 구간에 name:en까지 정돈된 것이 그 산물로 보인다.
    // ★쉬빌 생태계 적합성이 가장 높다 (조사 D 1순위 권고): 오셋타이(お接待)가
    //   트레일 엔젤과 사실상 같은 1,200년 된 제도다. 지역 주민이 순례자에게 차·과일·
    //   숙박을 무상으로 건네고 순례자가 거절하는 것은 결례로 여겨지며, 주는 쪽도
    //   공덕을 쌓는 것으로 본다 — 헌법 제5조(감사의 화폐)·제7조(순환의 원리)와 겹친다.
    //   "우리가 엔젤 문화를 만든다"가 아니라 "이미 있는 것에 화폐를 얹는다"가 된다.
    //   연 순례자 약 15만 명. 허가·예약·가이드 의무 없음.
    // ⛔ 2026-07-27 좌표 검증에서 **탈락**했다 — 앞선 주석이 틀렸다.
    //   틀린 주석: "페리(way 393732033 高知県営渡船, 32번↔33번 札所 사이 고치현영
    //   무료 도선)는 route=ferry라 자동 배제되므로 그 자리는 회랑이 끊긴다."
    //   실제: 페리 way를 빼도 이어붙이기가 그 자리를 **직선 한 줄로 다시 메운다.**
    //   산출물에 우라노우치만을 가로지르는 1.88 km 직선이 남아 있었다
    //   (33.50438,133.56300 → 33.50074,133.54320, 중점이 natural=coastline 바깥 바다).
    //   즉 **배 위에서 약 1.9 SHV가 생성된다.** 도버–칼레(34 km)와 같은 종류이고
    //   크기만 작다. 구간 이음 한계 2 km **바로 아래**라 길이 검사로는 잡히지 않았다.
    //   → 이 때문에 checkGeometry에 **물 위 직선 검사**(페리 끝점 좌표 대조, 길이 무관)를
    //     새로 넣었다. 이제 이 코스는 자동으로 fail-closed 된다.
    // ★남는 것은 순수한 결정 사항이다 — 순례자는 실제로 그 배를 탄다(정규 구간).
    //   (가) 이대로 제외한다: 시코쿠 전체(1,124.8 km / 5,459점)가 배포되지 않는다.
    //   (나) 폴리라인에 "코인 생성 없음" 구간을 표시하는 스키마를 만들고 다시 넣는다.
    //   (다) 도선 구간을 뺀 두 토막(1~32번 / 33~88번)을 별개 코스로 등록한다.
    //   (라) 그대로 통과시킨다(바다 위 1.9 SHV를 감수) — 권고하지 않는다.
    //   ★다니엘 쌤 결정 사항. 나는 (가)로 두었다 — 헌법 제3조, 틀린 코스를 남기는
    //     것보다 없는 것이 낫다. relationId는 지웠다가 다시 찾는 일이 없도록 남긴다.
    relationId: 13653655,
    expectedKm: 1145,
    defaultTerrain: 'OPEN', // 산길·마을길 혼재
    difficultyTenths: 10,
    priority: 7,
    excluded: '⛔ 좌표 결함 — 페리 배제 자리에 우라노우치만 바다 위 1.88 km 직선이 남는다 (결정 2 아님)',
  },
  {
    regionId: 'camino-de-santiago',
    courseId: 'camino-portugues',
    name: 'Caminho Português de Santiago (Central)',
    // ✅ 확인됨 (2026-07-27): OSM relation 12786090 "Caminho Português de Santiago" /
    //    name:en "Portuguese Way of St. James", ref=**CP**(=Central), type=route,
    //    route=hiking, network=nwn. way 2,025개를 직접 보유(하위 관계 없음).
    //    실측: 22,262점 / 360.9 km — 기대 370 km(코임브라→포르투 110 + 포르투→산티아고
    //    260, 공개 스테이지 자료 합산) 대비 -2.5%.
    //    나라: lat 40.3041~42.8805 / lon -8.6823~-8.4360. 남단 코임브라 북쪽(포르투갈),
    //    북단 42.88049,-8.54575 = 산티아고 대성당(스페인). 경도 폭 0.24°로 좁은 것은
    //    중앙길이 거의 정북으로만 달리기 때문이다(포르투 -8.61, 투이 -8.64, 폰테베드라 -8.64).
    //    2025년 콤포스텔라 수령 100,835명 — 프란세스 다음으로 많다. 자유 도보 가능.
    // ★동명 함정: rel 12786089도 name이 **똑같이** "Caminho Português de Santiago"인데
    //   ref=CPC(해안길)이고 실측 79.3 km(lat 41.8883~42.2849) 조각에 불과하다.
    //   이름만 보고 고르면 380 km 본선 대신 79 km 조각을 집는다 — ref로 구분해야 한다.
    relationId: 12786090,
    expectedKm: 370,
    defaultTerrain: 'OPEN',
    difficultyTenths: 10,
    priority: 8,
  },
  {
    regionId: 'camino-de-santiago',
    courseId: 'camino-primitivo',
    name: 'Camino Primitivo',
    // ✅ 확인됨 (2026-07-27): OSM relation 19298101 "Camino Primitivo" /
    //    name:en "Primitive Way", type=superroute, route=hiking, network=nwn,
    //    distance=291. 멤버 14개(Etapa 1~, "Etapa 4b: Variante de Hospitales" 포함).
    //    실측: way 884개 / 14,738점 / 전체 286.4 km, 변형 제외 본선 260.4 km.
    //    distance 태그 291 대비 -1.6%.
    //    나라: lat 42.9144~43.4174 / lon -8.0168~-5.8407 — 동단 오비에도(아스투리아스),
    //    서단 멜리데(갈리시아). 두 자치주 안에만 있고 포르투갈·타국 혼입 없음.
    //    2025년 27,868명(+13.9%). 자유 도보 가능.
    // ★알아둘 것 1: 이 관계는 **산티아고에 닿지 않는다** — 멜리데(프란세스 합류점)에서
    //   끝난다. 마지막 약 55 km는 프란세스 구간이므로, 프리미티보만 배포하면 순례
    //   마지막 이틀이 코인 생성 공백이 된다. 프란세스(2163573)와 함께 열어야 메워진다.
    // ★알아둘 것 2: "Variante de Hospitales"(13.8 km)는 실제로 다수가 걷는 유명 변형이라,
    //   결정 1("가장 많은 사람이 다니는 길")을 기계적으로 적용해 잘라내면 오히려 실제
    //   통행과 어긋난다. 지금 생성기는 이름 필터로 배제한다 — 다니엘 쌤 결정 사항.
    // ★난이도: 카미노 중 가장 험한 길로 알려져 있어 나중에 상향 후보다. 그래도 지금은
    //   ×1.0에서 출발한다(계수는 통화정책 — 산정 공식 확정 전에 올리지 않는다).
    relationId: 19298101,
    expectedKm: 291,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 10,
    priority: 9,
  },
  {
    regionId: 'via-francigena',
    courseId: 'via-francigena',
    name: 'Via Francigena',
    // ✅ 관계 확인됨 (2026-07-27): OSM relation 11860709 "Via Francigena",
    //    type=superroute, route=hiking, network=iwn, ref=VF, distance=3268.
    //    직접 멤버 4개가 **전부 하위 superroute**다(그래서 재귀가 3단계여야 한다).
    //    실측: 관계 21개 / 고유 way 13,059개 / 136,036점 / 3,226.6 km —
    //    기대 3,200 km(EAVF 유럽 비아 프란치제나 협회 공식 수치) 대비 +0.8%.
    //    구간: GB 77.0 / France 01~05 982.1 / Switzerland(rel 124582,
    //    operator=SchweizMobil) 207.1 / Valle d'Aosta 93.8 / Piemonte 95.1 /
    //    Lombardia 118.4 / Emilia Romagna 148.7 / Liguria 73.8 / Toscana 314.6 /
    //    Lazio 380.8 / Campania 172.5 / Puglia 532.0 km.
    //    나라: lat 39.7968~51.2792 / lon 1.0811~18.5097 — 캔터베리 대성당(영국) ~
    //    산타 마리아 디 레우카(풀리아). 영·프·스위스·이탈리아(+바티칸) 5개국 밖 점 0개.
    //    로마 도착 증서 2023년 3,319 → 2025년 12,000명 이상(+118%, 희년 효과).
    //    자유 도보 가능(허가·예약 의무 없음).
    // ★★생성이 fail-closed 될 수 있다 — 그것이 옳다. 이 관계에는 way 209213884
    //   "Dover (UK) - Calais (F)" **route=ferry**(도버해협 약 34 km 바다)가 정규
    //   멤버로 들어 있다. 생성기가 페리 way를 배제하므로 그 자리에 회랑이 끊기고,
    //   구간 이음 검사(MAX_SECTION_GAP_M=2 km)가 영국–프랑스 사이를 잡아 산출물에서
    //   제외한다. **배 위에서 코인이 생성되게 두느니 코스를 내지 않는 편이 옳다.**
    //   다니엘 쌤 선택지: (가) 그대로 둔다(배포 안 함) (나) 영국 구간(77 km)을 빼고
    //   칼레→레우카를 별도 코스로 정의한다 — 단 그런 상위 관계가 OSM에 없어 way 단위
    //   작업이 필요하다 (다) 바다 구간을 "코인 생성 없음"으로 표시하는 기능을 만든다.
    // ★통화정책 경고: 1 km = 1 SHV 기준에서 VF 완주는 **3,226 SHV**다.
    //   이스라엘 본진 전체(1,055 SHV)의 3배가 한 코스에서 나온다. 발행량 검토 없이
    //   LIVE로 올리면 안 된다 — 다니엘 쌤 결정 사항.
    // ★로마까지만 자르는 것은 관계 단위로 불가능하다: "07 Lazio"(380.8 km) 하나가
    //   로마 북쪽과 남쪽을 함께 담는다. 남부(캄파니아+풀리아 704.5 km)는 순례자가 훨씬 적다.
    relationId: 11860709,
    expectedKm: 3200,
    defaultTerrain: 'OPEN',
    difficultyTenths: 10,
    priority: 10,
  },

  // ── 1차 제외 (결정 2: 가이드·예약 의무 → 자유 도보 전제와 어긋남) ──────
  // 데이터는 남겨두되 activate=false. 나중에 열 때 매니페스트만 고치면 된다.
  {
    regionId: 'milford-track',
    courseId: 'milford-track',
    name: 'Milford Track',
    // ✅ 관계 확인됨 (2026-07-22): DOC 공식, "GW - 07 Milford Track", 32 way / 2,068점.
    //    생성·검증까지 마쳤으나 **예약제·편도 4일**이라 1차에서 제외한다.
    relationId: 1385121,
    expectedKm: 53.5,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 10,
    excluded: 'booking required, one-way — 결정 2',
  },
  {
    regionId: 'inca-trail',
    courseId: 'inca-trail',
    name: 'Inca Trail to Machu Picchu',
    // ✅ 확인됨 (2026-07-27): OSM relation 15703494 "Camino Inca a Machu Picchu" /
    //    name:en "Inca trail", alt_name "Camino Inka", type=route, route=hiking,
    //    network=rwn, operator=**Ministerio de Cultura**(페루 문화부 — 잉카트레일
    //    허가·관할 공식 기관), distance=38, ascent=4300, descent=4600, roundtrip=no,
    //    wikidata=Q6014019.
    //    실측: way 57개 / 1,702점 / 38.35 km — 기대 43 km 대비 -10.8%(통과).
    //    관계의 distance 태그(38)와 실측(38.35)이 +0.9%로 일치하므로, expectedKm 43이
    //    오히려 느슨한 통칭치이고 38~39가 정확한 값으로 보인다.
    //    나라: lat -13.2647~-13.1613 / lon -72.5440~-72.3820, 페루 쿠스코주. 볼리비아 점 없음.
    // ★함정 2개를 좌표로 실측 배제했다:
    //   (1) rel 3474631 "Qhapaq Ñan" — **name:en이 문자 그대로 "Inca Trail"**인데
    //       실체는 유네스코 안데스 도로망(6개국). 실측 820.1 km,
    //       lat -18.9918~-4.2685 / lon -79.7993~-65.4057로 여러 나라를 관통한다.
    //       영어 이름만 대조하면 100% 이것을 집는다 — 정답보다 오답이 더 그럴듯하다.
    //   (2) rel 3313887 "Takesi Inca Trail" — 볼리비아, 27.1 km. 이전 조사가 오탐한 바로 그것.
    // ★결정 2 유지: 검증은 통과했으나 허가·가이드 의무라 1차 활성화에서 제외한다.
    relationId: 15703494,
    expectedKm: 43,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 10,
    excluded: 'permit + licensed guide, 500/day cap — 결정 2',
  },
  {
    regionId: 'kilimanjaro',
    courseId: 'kilimanjaro-machame',
    name: 'Kilimanjaro (Machame Route)',
    // ⛔ relationId를 채우지 않는다 — **연장 검증을 통과하지 못했다**(규칙 1).
    //    후보: OSM relation 8737224 "Machame"(loc_name="Whiskey"), type=route,
    //    route=hiking, network=nwn, colour=#F57C00, operator 없음.
    //    (이전 주석의 "hiking 관계 없음"은 사실이 아니었다 — 킬리만자로 7개 루트가
    //     전부 route=hiking 관계로 존재한다: 8737224 Machame / 8737225 Mweka /
    //     8737241 Lemosho / 8737242 Northern Circuit / 8737291 Shira /
    //     8737292 Marangu / 8737343 Rongai / 8737371 Umbwe.)
    //    나라는 통과: lat -3.1734~-3.0545 / lon 37.2370~37.3785, 탄자니아.
    // ★탈락 원인: 실측 38.5 km, 기대 62 km 대비 **-37.8%**. OSM이 등정로와 하산로를
    //    별개 관계로 쪼개 놓았기 때문이다 — 표준 마차메 트레킹은 마차메로 올라
    //    **음웨카로 내려온다**. rel 8737225 "Mweka"(20.1 km)를 합치면 58.6 km로
    //    -5.5%가 되어 통과한다. 즉 데이터는 정상이고 경계가 다를 뿐이다.
    //    그러나 이 매니페스트는 항목당 relationId를 **하나만** 받으므로 한 ID로
    //    표현할 수 없다. 8737224 단독으로 넣으면 실제 걷는 거리의 62%만 코인이 생성된다.
    //    → 다니엘 쌤 결정 사항: (가) 스키마를 relationId 배열로 넓힌다(58.6 km, -5.5%)
    //      (나) 8737224 단독 등정 편도로 정의하고 expectedKm을 39로 고친다
    //      (다) 그냥 둔다. 어차피 결정 2로 1차 제외 대상이라 급하지 않다 → 조사 권고는 (다).
    // ★추가 위험: 정상(우후루 피크) 부근에서 마차메·음웨카·기타 루트의 회랑이 서로
    //    포개진다. 활성화한다면 중복 생성 검사가 따로 필요하다.
    // ★데이터 신뢰도 주의: operator 태그가 없고 지역 OSM 커뮤니티 흔적도 없다.
    //    7개 루트의 ID가 연번이고 색상 코드가 일관된 것으로 보아 **한 명의 외부 매퍼가
    //    일괄 등록**한 것으로 보인다. 조사 4개 중 가장 검증이 필요한 데이터다.
    relationId: null,
    expectedKm: 62,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 10,
    excluded: 'guide mandatory by law — 결정 2',
  },
  {
    regionId: 'torres-del-paine-w',
    courseId: 'torres-del-paine-w',
    name: 'Torres del Paine W Trek',
    // ✅ 확인됨 (2026-07-27): OSM relation 2203617 "La Ruta del W" /
    //    name:en "W Trek", type=route, route=hiking, network=rwn, roundtrip=no,
    //    wikidata=Q106577165. operator 태그는 없다(공식 기관 신호 없음 — 중간 품질).
    //    실측: way 186개 / 5,843점 / 72.1 km — 기대 80 km 대비 -9.9%(통과).
    //    나라: lat -51.0714~-50.9414 / lon -73.1838~-72.8739, 칠레 파타고니아
    //    토레스델파이네 국립공원. 이 위도의 아르헨티나 국경(약 -72.3) 서쪽이라 전 구간 칠레.
    //    (이전 주석의 "route 관계가 없다"는 사실이 아니었다 — 현지명이 "La Ruta del W"라
    //     영어 이름 검색으로는 안 잡히고 bbox 검색으로만 나온다.)
    // ★혼동 주의: 같은 공원의 rel 7705906 "Circuito O"(name:en=O Circuit, 실측 93.0 km)는
    //    별개의 더 긴 순환로다.
    // ★결정 2 유지: 검증은 통과했으나 국립공원 예약제라 1차 활성화에서 제외한다.
    relationId: 2203617,
    expectedKm: 80,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 10,
    excluded: '국립공원 예약제(캠프·refugio 사전 예약) — 결정 2',
  },

  // ── 찾았으나 매니페스트에 넣지 못한 것 (규칙 1: 확인 못 한 번호는 적지 않는다) ──
  // 추측으로 번호를 적으면 엉뚱한 땅에서 코인이 생성된다. 아래는 조사에서 관계까지는
  // 찾았으나 **연장 검증을 통과하지 못했거나 단일 관계로 표현할 수 없는** 것들이다.
  //
  // · Camino Inglés — rel 1102966 "Camiño Inglés"/name:en "English Way", network=iwn,
  //   distance=112. 실측 819 way / 147.6 km로 공식 119 km 대비 **+24.1%**.
  //   원인: 페롤 출발(119 km)과 아 코루냐 출발(약 75 km) 두 갈래가 브루마에서 합류하는데
  //   한 관계에 둘 다 들어 있다(초과분 약 28.6 km가 아 코루냐 갈래 고유 구간과 일치).
  //   페롤 본선만 골라내려면 way 단위 분리가 필요하다. 2025년 30,203명.
  //
  // · St. Olav / Gudbrandsdalsleden — rel 1370273은 오슬로→릴레함메르 228.2 km뿐이라
  //   기대 643 km 대비 -64.5%. 나머지는 5659125(릴레함메르→도브레,
  //   operator=Nasjonalt Pilegrimssenter)·5659103(스카운→니다로스) 등에 흩어져 있고
  //   이들만 묶는 중간 superroute가 없다. 상위 1370274 "Pilegrimsleden"은 노르웨이
  //   9개 순례길 + 스웨덴 St. Olavsleden까지 묶은 3,395.5 km 네트워크라 단일 코스가 아니다.
  //   → 매니페스트가 relationId 배열을 받도록 넓히기 전에는 등록 불가.
  //
  // · 熊野古道 中辺路 (Kumano Kodo Nakahechi) — rel 17094646, distance=36, 실측 36.0 km.
  //   기대 68 km 대비 -47%. 오탐이 아니라 매핑 분할이다: 이 관계는 다키지리→혼구까지이고
  //   혼구→나치는 大雲取越(17095001, 15 km)·小雲取越(17097854, 13.0 km) 별도 관계인데
  //   상위 superroute가 없다. 구마노고도는 애초에 6개 갈래의 네트워크다.
  //
  // · Camino del Norte — 자치주별 4개로 쪼개져 있다(360167 칸타브리아, 1116809 바스크,
  //   2201058 아스투리아스, 1554697 갈리시아). 상위 superroute를 못 찾았다. 실측 안 함.
  // · Via de la Plata / 포르투게스 해안 완본 — 상위 관계를 **못 찾았다**.
];

/** 단순화 허용 오차 (m) — 최소 회랑 반폭 50m의 1/2.5. */
const SIMPLIFY_TOLERANCE_M = 20;

// ── 기하 유틸 ─────────────────────────────────────────────────────

const R_EARTH = 6_371_000;
const toRad = (d) => (d * Math.PI) / 180;

function haversineM(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

function polylineLengthM(pts) {
  let sum = 0;
  for (let i = 1; i < pts.length; i++) sum += haversineM(pts[i - 1], pts[i]);
  return sum;
}

/** 점 p와 선분 ab의 수직 거리 (m). 국지 평면 근사 — 수백 m 스케일에서 충분. */
function perpDistanceM(p, a, b) {
  const latRef = toRad((a.lat + b.lat) / 2);
  const mPerLat = 111_320;
  const mPerLon = 111_320 * Math.cos(latRef);
  const px = (p.lon - a.lon) * mPerLon;
  const py = (p.lat - a.lat) * mPerLat;
  const bx = (b.lon - a.lon) * mPerLon;
  const by = (b.lat - a.lat) * mPerLat;
  const len2 = bx * bx + by * by;
  if (len2 === 0) return Math.hypot(px, py);
  let t = (px * bx + py * by) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - t * bx, py - t * by);
}

/** Douglas–Peucker 단순화 (반복 구현 — 긴 경로에서 스택 넘침 방지). */
function simplify(pts, toleranceM) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let maxD = -1;
    let idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDistanceM(pts[i], pts[lo], pts[hi]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > toleranceM && idx > 0) {
      keep[idx] = 1;
      stack.push([lo, idx], [idx, hi]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

// ── OSM way 이어붙이기 ────────────────────────────────────────────

/**
 * 관계의 멤버 way들을 하나의 연속 폴리라인으로 잇는다.
 *
 * OSM 관계의 멤버는 **순서가 보장되지 않고 방향도 뒤집혀 있을 수 있다.** 끝점을 맞춰
 * 탐욕적으로 이어 붙이고, 이어지지 않는 조각은 버린다(가장 긴 사슬만 취한다) —
 * 접근로·대피소 지선이 본선에 섞이면 경로가 엉뚱해지기 때문이다.
 */
function stitchWays(ways, gapToleranceM = 250) {
  if (ways.length === 0) return { chain: [], jumpM: 0, jumps: [], dropped: 0, droppedM: 0 };
  const remaining = ways.map((w) => w.slice());
  let chain = remaining.shift();
  // 이음마다 생기는 직선 점프의 총합. 이 직선은 실제 길이 아니라 **회랑이 열린 빈 땅**이므로
  // 반드시 계측해서 보고한다 (아래 checkGeometry 참조).
  let jumpM = 0;
  // ★총합만으로는 "어디에" 생겼는지 모른다. 물 위 직선 검사가 페리 끝점과 대조해야
  //   하므로 이음마다 좌표를 남긴다.
  const jumps = [];

  let progress = true;
  while (progress && remaining.length) {
    progress = false;
    const head = chain[0];
    const tail = chain[chain.length - 1];
    let bestIdx = -1;
    let bestMode = '';
    let bestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const w = remaining[i];
      const cands = [
        ['tail-head', haversineM(tail, w[0])],
        ['tail-tail', haversineM(tail, w[w.length - 1])],
        ['head-tail', haversineM(head, w[w.length - 1])],
        ['head-head', haversineM(head, w[0])],
      ];
      for (const [mode, d] of cands) {
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
          bestMode = mode;
        }
      }
    }

    if (bestIdx >= 0 && bestDist <= gapToleranceM) {
      const w = remaining.splice(bestIdx, 1)[0];
      jumpM += bestDist;
      if (bestDist > 0) {
        const from = bestMode.startsWith('tail') ? tail : head;
        const to =
          bestMode === 'tail-head' || bestMode === 'head-head' ? w[0] : w[w.length - 1];
        jumps.push({ from, to, gapM: bestDist });
      }
      if (bestMode === 'tail-head') chain = chain.concat(w.slice(1));
      else if (bestMode === 'tail-tail') chain = chain.concat(w.slice().reverse().slice(1));
      else if (bestMode === 'head-tail') chain = w.slice(0, -1).concat(chain);
      else chain = w.slice().reverse().slice(0, -1).concat(chain);
      progress = true;
    }
  }
  // ★버린 길이도 계측한다. 이 파이프라인은 way 몇 개가 결손되면 탐욕적 이어붙이기가
  //   거기서 끊겨 사슬이 통째로 무너진다(안나푸르나 실측: 연결 way 4개가 빠진 스냅샷에서
  //   223.7 km → 144.0 km, 버린 조각 29개 → 165개). 최종 연장 ±15% 검사만으로는
  //   "우연히 기대치 근처로 떨어지는 결손"을 못 잡으므로 버린 비율을 따로 본다.
  const droppedM = remaining.reduce((s, w) => s + polylineLengthM(w), 0);
  if (remaining.length) {
    console.warn(
      `    ⚠ 이어지지 않은 조각 ${remaining.length}개 / ${(droppedM / 1000).toFixed(1)} km 버림 (지선·접근로로 추정)`,
    );
  }
  return { chain, jumpM, jumps, dropped: remaining.length, droppedM };
}

// ── Overpass 취득 (캐시 — 속도 제한 회피) ─────────────────────────

/**
 * 응답이 **믿을 수 있는 전역 결과인지** 검사한다.
 *
 * Overpass 는 실패를 HTTP 200 + JSON 으로 돌려주는 경우가 많다:
 *  - 타임아웃/부분결과 → `remark` 필드에 사유가 담긴 채 200 OK
 *  - 지역 인스턴스 → `elements: []` 를 아무 표시 없이 200 OK
 * 이 화폐에서 조용히 잘린 폴리라인은 곧 잘린 코인 생성 회랑이므로, 의심스러우면
 * 받아들이지 말고 다음 엔드포인트로 넘어간다.
 */
function validateOverpass(json) {
  if (!json || typeof json !== 'object') return 'JSON이 아니다';
  if (json.remark) return `remark: ${String(json.remark).slice(0, 160)}`;
  if (!Array.isArray(json.elements) || json.elements.length === 0) return 'elements가 비었다';
  const base = json.osm3s?.timestamp_osm_base;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(base ?? ''))) return `timestamp_osm_base 이상: ${base}`;
  return null;
}

async function fetchRelation(relationId) {
  const cachePath = join(CACHE_DIR, `rel-${relationId}.json`);
  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, 'utf-8'));
    console.log(`    (캐시 사용 — osm_base ${cached.osm3s?.timestamp_osm_base ?? '?'})`);
    return cached;
  }
  // ★superroute 대응: 긴 트레일은 구간별 관계로 쪼개져 상위 superroute가 그것들을
  //   묶는다 (Camino Francés = 구간 관계 6개 + superroute 2163573). 관계 자신과
  //   **하위 관계까지 재귀로** 내려가 way 기하를 모두 받는다 — 상위만 받으면
  //   멤버가 관계뿐이라 좌표가 하나도 안 나온다.
  // ★재귀는 3단계다. Via Francigena(rel 11860709)는 직접 멤버 4개가 **전부
  //   superroute**라 way가 2단계 아래에 있다 — 1단계만 내려가면 경로가 통째로 빈다.
  // ★두 번째 질의로 route=ferry way의 id만 따로 받는다. 관계 멤버 기하(`out geom`)에는
  //   way 태그가 실려 오지 않아서, 이것 없이는 바다 위 직선을 구분할 방법이 없다
  //   (VF에 도버–칼레 페리 way 209213884 = 약 34km 해협 직선이 들어 있다).
  const query =
    `[out:json][timeout:900];` +
    `rel(${relationId})->.a;rel(r.a)->.b;rel(r.b)->.c;(.a;.b;.c;)->.rels;` +
    `.rels out geom;` +
    `way(r.rels)[route=ferry];out tags;`;

  let lastErr = '';
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(15 * 60_000),
      });
      if (!res.ok) {
        lastErr = `${ep} → HTTP ${res.status}`;
        console.log(`    ↻ ${lastErr}`);
        continue;
      }
      const text = await res.text();
      if (!text.trimStart().startsWith('{')) {
        lastErr = `${ep} → JSON이 아닌 응답(${text.slice(0, 80).replace(/\s+/g, ' ')})`;
        console.log(`    ↻ ${lastErr}`);
        continue;
      }
      const json = JSON.parse(text);
      const bad = validateOverpass(json);
      if (bad) {
        lastErr = `${ep} → ${bad}`;
        console.log(`    ↻ ${lastErr}`);
        continue;
      }
      // ★재현성: 어느 엔드포인트의 어느 스냅샷을 받았는지 기록한다. kumi.systems는
      //   백엔드마다 osm_base가 달라, 같은 질의가 way 422개(2026-07-02)와
      //   418개(2026-06-12)로 갈리고 그 4개 차이로 사슬이 223.7→144.0 km 무너진 적이 있다.
      json.osm3s = { ...(json.osm3s ?? {}), shvil_endpoint: ep };
      console.log(`    ← ${ep} / osm_base ${json.osm3s.timestamp_osm_base}`);
      try {
        const { mkdirSync } = await import('node:fs');
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(cachePath, JSON.stringify(json), 'utf-8');
      } catch {
        /* 캐시 실패는 무해 */
      }
      return json;
    } catch (e) {
      lastErr = `${ep} → ${e.name}: ${e.message}`;
      console.log(`    ↻ ${lastErr}`);
    }
  }
  throw new Error(`Overpass 전 엔드포인트 실패 (마지막: ${lastErr})`);
}

/** 이름으로 드러나는 대체 경로 표식. */
const VARIANT_RE = /alternativ|variant|option|bypass|detour|우회|대체/i;
/** OSM 멤버 role 로 드러나는 대체·접근·연결 구간 (본선이 아니다). */
const VARIANT_ROLE_RE = /^(alternative|variant|excursion|approach|connection|link|detour)/i;

/**
 * 관계별로 way를 묶어 돌려준다 (구간 순서 보존).
 *
 * ★긴 트레일은 구간 관계로 쪼개져 있다 (Camino Francés = "01 …" ~ "08 …").
 * 모든 way를 한 자루에 쏟고 탐욕적으로 이으면 3,742개 조각 중 32km만 연결되는
 * 참사가 난다(실측). 구간 안에서 먼저 잇고, 구간을 **올바른 순서로** 이어야 한다.
 *
 * ── 구간 순서를 무엇으로 정하는가 (2026-07-27 수리) ──────────────────────
 * 이전 판은 (ref || name)에서 첫 숫자를 뽑아 정렬했다. 이것이 카미노를 망가뜨렸다:
 * 04·07 구간의 ref가 스페인 도로 번호 **"66261"**이라 662로 읽혀 맨 뒤로 밀렸고,
 * 순서가 01→03→06→08→04→07이 되었다. 구간을 이어붙일 때마다 끝점과 다음 구간
 * 시작점 사이에 **직선**이 그어지므로 151.7 + 101.2 + 249.2 + 249.0 km,
 * 합계 **751.0 km의 가짜 직선**이 폴리라인에 들어갔다 — 실제 767.5 km + 751.0 =
 * 1,518.6 km. 기대 780 km의 1.95배가 나온 원인이 전부 이것이다.
 *
 * ★이 직선은 단순히 숫자가 틀린 것이 아니다. 산티아고에서 부르고스까지 249 km의
 *  직선 회랑이 열린다는 뜻이며, 그 선을 따라 **차로 달려도 코인이 생성된다.**
 *  연장 검사(±15%)가 막아준 것은 운이 좋았을 뿐이다 — 아래 checkGeometry가
 *  연장과 무관하게 이 직선 자체를 잡는다.
 *
 * 그래서 순서는 **상위 관계(superroute)의 멤버 순서**를 1순위로 쓴다. OSM에서
 * 경로 관계의 멤버 순서는 진행 방향으로 정렬되며, 카미노 2163573의 멤버 순서는
 * 01→03→04→06→07→08로 정확하다. 이름의 숫자는 상위 관계가 없을 때만 쓴다.
 */
function extractWayGroups(overpassJson, rootRelationId) {
  // ★route=ferry way 배제 — 배 위에는 걷는 길이 없다.
  //   Via Francigena(11860709)에 도버–칼레 페리 way 209213884가 정규 멤버로 들어 있다.
  //   이 way는 "가짜 직선"이 아니라 **실제 기하가 있는 way**라서 이음 간격 검사
  //   (checkGeometry)로는 절대 잡히지 않는다 — 태그로 걸러내는 수밖에 없다.
  //   남겨두면 영불해협 34km 직선 위에서 코인이 생성된다.
  const ferryWayIds = new Set(
    (overpassJson.elements ?? [])
      .filter((e) => e.type === 'way' && e.tags?.route === 'ferry')
      .map((e) => e.id),
  );
  let ferryDropped = 0;
  // ★배제한 페리의 **양 끝점**을 기억해 둔다. 페리를 빼면 그 자리에 구멍이 생기고,
  //   이어붙이기가 그 구멍을 **직선 한 줄로 메운다** — 즉 배제해도 바다 위 회랑이
  //   그대로 남는다(시코쿠 우라노우치만 실측 1.88 km). 아래 checkGeometry가 이
  //   끝점들과 이음 직선의 위치를 대조해 "물 위 직선"을 정확히 집어낸다.
  //   길이 문턱(MAX_SECTION_GAP_M)에 기대지 않는다 — 짧은 도선은 문턱 아래로 숨는다.
  const ferryEndpoints = [];

  const groups = [];
  for (const el of overpassJson.elements ?? []) {
    if (el.type !== 'relation') continue;
    // ★경로 관계만 구간으로 인정한다. 재귀를 3단계로 내리면서 **경로가 아닌 관계**가
    //   딸려 온다: Camino Primitivo의 "Etapa 4"가 `type=site` 관계 19968654(숙소·시설
    //   묶음)를 멤버로 갖고 있어, 그 way들이 12번째 "구간"으로 끼어들며 9.1 km짜리
    //   가짜 직선 두 개(총 18.3 km)를 만들었다. 실측으로 확인하고 막았다.
    //   type 태그가 아예 없는 관계는 통과시킨다(기존 동작 보존).
    if (el.tags?.type && el.tags.type !== 'route' && el.tags.type !== 'superroute') continue;
    const ways = [];
    for (const mem of el.members ?? []) {
      if (mem.type === 'way' && Array.isArray(mem.geometry) && mem.geometry.length >= 2) {
        if (ferryWayIds.has(mem.ref)) {
          ferryDropped++;
          ferryEndpoints.push(
            { lat: mem.geometry[0].lat, lon: mem.geometry[0].lon },
            {
              lat: mem.geometry[mem.geometry.length - 1].lat,
              lon: mem.geometry[mem.geometry.length - 1].lon,
            },
          );
          continue;
        }
        ways.push(mem.geometry.map((g) => ({ lat: g.lat, lon: g.lon })));
      }
    }
    if (ways.length > 0) {
      groups.push({ id: el.id, name: el.tags?.name ?? '', ref: el.tags?.ref ?? '', ways });
    }
  }
  if (ferryDropped > 0) {
    console.log(
      `    ⛴ 페리 way ${ferryDropped}개 배제 — 끊긴 자리에 직선이 다시 그어지는지 ` +
        `아래 물 위 직선 검사가 끝점 좌표로 대조한다`,
    );
  }

  // 상위 관계에서 하위 관계로 **깊이 우선**으로 내려가며 순서와 role을 읽는다.
  // ★1단계만 읽던 이전 판은 3단 중첩(Via Francigena: 상위 → 나라별 superroute →
  //   구간 route)에서 손자 관계의 순서를 놓쳤다. 손자까지 읽어야 캔터베리→레우카
  //   진행 순서가 나온다. role은 부모의 것을 물려준다(대체 경로 아래의 구간도 대체다).
  const orderById = new Map();
  const roleById = new Map();
  {
    const byId = new Map();
    for (const e of overpassJson.elements ?? []) if (e.type === 'relation') byId.set(e.id, e);
    const seen = new Set();
    let i = 0;
    const visit = (id, depth, inheritedRole) => {
      if (seen.has(id)) return;
      seen.add(id);
      // 상위 관계가 자기 way도 직접 들고 있으면(혼합형) 그것이 본선의 시작이다 → -1.
      if (depth === 0) orderById.set(id, -1);
      else {
        orderById.set(id, i++);
        if (inheritedRole) roleById.set(id, inheritedRole);
      }
      for (const mem of byId.get(id)?.members ?? []) {
        if (mem.type !== 'relation') continue;
        visit(mem.ref, depth + 1, mem.role || inheritedRole);
      }
    };
    visit(rootRelationId, 0, '');
  }

  // ★대체 경로(variant) 배제 — 결정 1 "가장 많은 사람이 다니는 길"의 실행.
  //   Camino Francés superroute에는 "Camiño Francés (Rutas alternativas)"(769 way,
  //   325.0 km)가 본선과 함께 들어 있다. 이름 표식과 **멤버 role** 둘 다로 거른다 —
  //   TMB rel 6436417의 하위처럼 **이름이 없는** 변형 관계는 이름 검사로 못 잡는데,
  //   role은 남아 있는 경우가 많다(카미노 대체 경로의 role이 실제로 "alternative"다).
  const isVariant = (g) =>
    VARIANT_RE.test(g.name) || VARIANT_ROLE_RE.test(roleById.get(g.id) ?? '');
  const mainline = groups.filter((g) => !isVariant(g));
  const droppedCount = groups.length - mainline.length;
  if (droppedCount > 0) console.log(`    대체 경로 ${droppedCount}개 제외 (본선만 사용 — 결정 1)`);

  // 1순위: 상위 관계가 정한 멤버 순서. 2순위: 이름 안의 구간 번호. 3순위: 이름 사전순.
  // ★ref는 순서 근거로 쓰지 않는다 — 도로 번호(카미노 "66261")가 섞여 있다.
  //   이름에 번호가 없을 때만, ref 전체가 1~3자리 숫자인 경우에 한해 인정한다.
  const seq = (g) => {
    const m = g.name.match(/\b(\d{1,3})\b/) ?? (g.ref || '').match(/^(\d{1,3})$/);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  };
  const order = (g) => (orderById.has(g.id) ? orderById.get(g.id) : Number.MAX_SAFE_INTEGER);
  mainline.sort(
    (a, b) => order(a) - order(b) || seq(a) - seq(b) || a.name.localeCompare(b.name),
  );
  if (mainline.length > 1) {
    const src = orderById.size > 1 ? '상위 관계 멤버 순서' : '이름 안의 구간 번호';
    console.log(`    구간 정렬 근거: ${src}`);
  }
  mainline.ferryEndpoints = ferryEndpoints;
  return mainline;
}

/**
 * 폴리라인에 섞인 **가짜 직선**을 잡는 기하 검사 — 연장 검사와 독립이다.
 *
 * 연장 검사(±15%)는 "총합이 맞는가"만 본다. 구간 순서가 틀려도 왕복이 상쇄되면
 * 총합은 그럴듯하게 나올 수 있다. 이 화폐에서 폴리라인은 **코인 생성 회랑**이므로,
 * 길이가 맞더라도 실제 길이 아닌 직선이 한 줄이라도 들어가면 안 된다.
 *
 * 판정: (1) 배제한 페리 자리에 직선이 다시 그어졌다 → 불합격 (길이 무관)
 *       (2) 구간 이음 직선 하나라도 MAX_SECTION_GAP_M 초과 → 불합격
 *       (3) way 이음 직선의 총합이 전체 연장의 GAP_RATIO_MAX 초과 → 불합격
 */
const MAX_SECTION_GAP_M = 2_000;
const GAP_RATIO_MAX = 0.02;
/**
 * 이음 직선의 끝점이 **배제한 페리의 끝점**과 이만큼 안에 있으면 물 위 직선으로 본다.
 * ★이 검사는 길이를 보지 않는다. 도버–칼레(34 km)는 길이 문턱에도 걸리지만
 *  시코쿠 우라노우치만 도선(1.88 km)은 MAX_SECTION_GAP_M=2 km **바로 아래**로
 *  숨는다 — 실제로 숨어서 통과했다. 물 위 회랑은 1.9 km라도 배 위에서 코인을
 *  만들므로 길이가 아니라 **위치**로 잡아야 한다.
 */
const FERRY_MATCH_M = 400;
/**
 * 버린 조각 비율 상한. 넘으면 받은 데이터가 잘렸거나 관계가 여러 갈래라는 뜻이다.
 * ★근거는 실측뿐이다(이스라엘·카미노 0%, 안나푸르나 정상 스냅샷 6.4%, 결손 스냅샷 39.8%).
 *  이 문턱은 **화폐 회랑에 무엇이 들어오는가**를 가르므로 다니엘 쌤 검토 대상이다.
 */
const DROP_RATIO_MAX = 0.15;

function checkGeometry({ sectionGapsM, wayJumpM, totalM, droppedM, gapSegments = [], ferryEndpoints = [] }) {
  const problems = [];

  // ── 검사 0: 물 위 직선 ────────────────────────────────────────────
  // 페리 way를 뺐는데 이어붙이기가 그 자리를 직선으로 메웠다면, 배제는 무효다.
  // 양 끝이 모두 어떤 페리의 끝점 근처인 이음 = 그 페리가 건너던 물 위 직선이다.
  if (ferryEndpoints.length > 0) {
    const nearFerry = (p) => ferryEndpoints.some((f) => haversineM(p, f) <= FERRY_MATCH_M);
    const water = gapSegments.filter((g) => nearFerry(g.from) && nearFerry(g.to));
    for (const w of water) {
      problems.push(
        `배제한 페리 자리에 ${(w.gapM / 1000).toFixed(2)} km 직선이 다시 그어졌다 ` +
          `(${w.from.lat.toFixed(5)},${w.from.lon.toFixed(5)} → ${w.to.lat.toFixed(5)},${w.to.lon.toFixed(5)}) — ` +
          `물 위에 회랑이 열린다. 배 위에서 코인이 생성된다.`,
      );
    }
  }

  const dropRatio = totalM + droppedM > 0 ? droppedM / (totalM + droppedM) : 0;
  if (dropRatio > DROP_RATIO_MAX) {
    problems.push(
      `이어지지 않아 버린 구간이 ${(droppedM / 1000).toFixed(1)} km — 관계 전체의 ` +
        `${(dropRatio * 100).toFixed(1)}% (허용 ${(DROP_RATIO_MAX * 100).toFixed(0)}%). ` +
        `받은 데이터가 잘렸거나(엔드포인트 스냅샷 차이) 관계가 여러 갈래다.`,
    );
  }
  const worst = sectionGapsM.reduce((m, g) => Math.max(m, g.gapM), 0);
  for (const g of sectionGapsM) {
    if (g.gapM > MAX_SECTION_GAP_M) {
      problems.push(
        `구간 이음에 ${(g.gapM / 1000).toFixed(1)} km 직선이 생겼다 → "${g.toName}" ` +
          `(구간 순서가 틀렸거나 중간 구간이 빠졌다)`,
      );
    }
  }
  const totalJumpM = wayJumpM + sectionGapsM.reduce((s, g) => s + g.gapM, 0);
  const ratio = totalM > 0 ? totalJumpM / totalM : 0;
  if (ratio > GAP_RATIO_MAX) {
    problems.push(
      `직선 이음이 전체 연장의 ${(ratio * 100).toFixed(1)}% (${(totalJumpM / 1000).toFixed(1)} km) — ` +
        `허용 ${(GAP_RATIO_MAX * 100).toFixed(0)}% 초과`,
    );
  }
  return { problems, totalJumpM, ratio, worstSectionGapM: worst, dropRatio };
}

// ── 구간 지형 자동 분할 (OSM highway 태그) ────────────────────────
//
// ★2026-07-27까지 이 스크립트는 코스 전체에 매니페스트의 `defaultTerrain` 하나를
//  통째로 찍었다. 그래서 쉬빌 이스라엘 1,055.3 km 전 구간이 회랑 메타 **1개**
//  (OPEN 50 m)였다. 사람이 손으로 구간을 나누게 하는 것은 답이 아니다 — 어디를
//  URBAN(150 m)으로 정하느냐가 곧 **어디서 코인이 더 쉽게 생성되는가**이고,
//  그것을 사람의 눈대중에 맡기면 화폐 규칙이 권력이 된다(제3조).
//
// 그래서 OSM 자신의 `highway` 태그가 나누게 한다. 우리는 태그를 읽을 뿐이다.
//
// ── 왜 URBAN만 넓히고 나머지는 그대로 두는가 ──────────────────────────
// 실측(2026-07-27): 이스라엘 관계 282071의 way 2,468개에 highway 태그가 있고,
// 배포 폴리라인 5,568선분에 매핑하면 track 51.1% / path 38.1% / footway 3.6% /
// unclassified 2.1% / residential 1.6% / tertiary 1.5% / service 0.9% … 이다.
// ★"텔아비브~하이파 도시대 148.6 km"라는 통설은 틀렸다 — 그 위도대 259.6 km 중
//  실제 시가지 태그는 **26 km(2.5%)뿐**이다. 이스라엘 국립 트레일은 도시를 피해 간다.
//  148 km에 150 m 회랑을 주면 근거 없이 발행 회랑 면적이 3배가 된다.
//
// 시가지(residential/service/living_street/pedestrian)만 URBAN(150 m)으로 올린다.
// 근거: 단순화 오차 최대 20.3 m + 도심 다중경로 횡방향 p95 22.8~34.1 m ≈ 55 m가
// 필요한데 OPEN 50 m로는 모자란다(실측). 나머지(트레일·차도)는 **건드리지 않는다** —
// 태그만으로 FOREST/MOUNTAIN을 가를 근거가 없고(고도 데이터 필요), 근거 없이 넓히면
// 그만큼 발행이 늘어난다. 모르는 것은 넓히지 않는다.
//
// ★회랑은 **넓히는 방향으로만** 바꾼다. 좁히면 그 코스에서 이미 발행된 코인이
//  소급해서 "규칙 밖"이 된다(docs/소급무효화_경로.md). 아래 widerTerrain가 강제한다.

/** 시가지 표식 — 이 태그가 붙은 길 옆은 건물·차량이 있다고 본다. */
const URBAN_HIGHWAY = new Set(['residential', 'living_street', 'pedestrian', 'service']);

/** 회랑 반폭 순위 (좁은 → 넓은). packages/shared/src/courses.ts 의 표와 같은 순서다. */
const TERRAIN_RANK = { OPEN: 0, FOREST: 1, MOUNTAIN: 2, URBAN: 3 };

/** 두 지형 중 **회랑이 넓은 쪽**. 자동 분할이 기존 값을 좁히지 못하게 한다. */
function widerTerrain(a, b) {
  return (TERRAIN_RANK[a] ?? 0) >= (TERRAIN_RANK[b] ?? 0) ? a : b;
}

function terrainFromHighway(tag) {
  if (!tag) return null;
  return URBAN_HIGHWAY.has(tag) ? 'URBAN' : 'OPEN';
}

/**
 * way 태그 질의 — 기하 질의(`out geom`)와 **캐시를 따로 둔다.**
 * 관계 멤버 기하에는 way 태그가 실려 오지 않으므로 한 번 더 물어야 하는데,
 * 같은 캐시 파일에 넣으면 기존 기하 캐시가 통째로 무효가 된다(1,000km 재취득).
 * 태그 질의는 응답이 작아 따로 받는 편이 싸다.
 */
async function fetchWayTags(relationId) {
  const cachePath = join(CACHE_DIR, `waytags-${relationId}.json`);
  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, 'utf-8'));
    console.log(`    (태그 캐시 사용 — way ${(cached.elements ?? []).length}개)`);
    return cached;
  }
  const query =
    `[out:json][timeout:900];` +
    `rel(${relationId})->.a;rel(r.a)->.b;rel(r.b)->.c;(.a;.b;.c;)->.rels;` +
    `way(r.rels);out tags;`;
  let lastErr = '';
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(15 * 60_000),
      });
      if (!res.ok) { lastErr = `${ep} → HTTP ${res.status}`; continue; }
      const text = await res.text();
      if (!text.trimStart().startsWith('{')) { lastErr = `${ep} → JSON이 아닌 응답`; continue; }
      const json = JSON.parse(text);
      const bad = validateOverpass(json);
      if (bad) { lastErr = `${ep} → ${bad}`; continue; }
      try {
        const { mkdirSync } = await import('node:fs');
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(cachePath, JSON.stringify(json), 'utf-8');
      } catch { /* 캐시 실패는 무해 */ }
      console.log(`    ← 태그 ${ep} / way ${(json.elements ?? []).length}개`);
      return json;
    } catch (e) {
      lastErr = `${ep} → ${e.name}: ${e.message}`;
    }
  }
  console.log(`    ⚠ way 태그 취득 실패 (${lastErr}) — 지형 자동 분할을 건너뛴다`);
  return null;
}

/**
 * 원본 way 선분을 격자(약 1.1 km)에 담아 최근접 조회를 상수 시간에 가깝게 만든다.
 * 격자 없이 하면 5,568선분 × 44,161점 = 2.5억 회다.
 */
function buildWaySegmentIndex(overpassJson) {
  const grid = new Map();
  const cell = (lat, lon) => `${Math.floor(lat * 100)}:${Math.floor(lon * 100)}`;
  let segCount = 0;
  for (const el of overpassJson.elements ?? []) {
    if (el.type !== 'relation') continue;
    for (const mem of el.members ?? []) {
      if (mem.type !== 'way' || !Array.isArray(mem.geometry)) continue;
      const g = mem.geometry;
      for (let i = 0; i + 1 < g.length; i++) {
        const rec = { wayId: mem.ref, a: g[i], b: g[i + 1] };
        segCount++;
        for (const k of new Set([cell(g[i].lat, g[i].lon), cell(g[i + 1].lat, g[i + 1].lon)])) {
          let bucket = grid.get(k);
          if (!bucket) grid.set(k, (bucket = []));
          bucket.push(rec);
        }
      }
    }
  }
  return {
    segCount,
    nearestWayId(p) {
      const ci = Math.floor(p.lat * 100);
      const cj = Math.floor(p.lon * 100);
      let best = Infinity;
      let bestId = null;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const bucket = grid.get(`${ci + di}:${cj + dj}`);
          if (!bucket) continue;
          for (const rec of bucket) {
            const d = perpDistanceM(p, rec.a, rec.b);
            if (d < best) { best = d; bestId = rec.wayId; }
          }
        }
      }
      return { wayId: bestId, distanceM: best };
    },
  };
}

/**
 * 선분별 지형 → 런렝스 구간 메타.
 *
 * ── 왜 "짧은 런 흡수"가 아니라 "팽창"인가 (실측으로 갈아엎었다) ─────────
 * 처음에는 짧은 런을 이웃에 흡수시키되 **넓은 쪽 지형을 남기게** 했다. 그것이
 * 이스라엘에서 URBAN을 25.9 km → **226.3 km로 부풀렸다**(실측). 60 m짜리 서비스
 * 도로 하나가 옆의 5 km 트레일을 통째로 URBAN(회랑 150 m)으로 만들었기 때문이다.
 * 즉 잡음 하나가 발행 회랑을 3배로 여는 지렛대가 됐다 — 정확히 반대의 실패다.
 *
 * 그래서 흡수를 버리고 **팽창(dilation)** 을 쓴다: URBAN 선분의 앞뒤 dilateM 만큼을
 * 함께 URBAN으로 본다. 근거는 물리다 — 주택가 도로 옆을 지나면 그 직전·직후에도
 * 건물 반사(다중경로)가 남는다. 부작용도 예측 가능하다: 늘어나는 양이 URBAN 런 수 ×
 * 2 × dilateM 로 **상한이 있다**(흡수는 상한이 없었다).
 * 팽창이 끝나면 인접한 같은 지형이 자연히 합쳐져 구간 수도 함께 준다.
 */
function runLengthSegments(terrains, polyline, difficultyTenths, dilateM = 150) {
  const n = terrains.length;
  const segLenM = new Array(n);
  for (let i = 0; i < n; i++) segLenM[i] = haversineM(polyline[i], polyline[i + 1]);

  // 좁은 지형 위에 넓은 지형을 dilateM 만큼 번지게 한다 (넓히는 방향으로만 바뀐다).
  const out = terrains.slice();
  for (let i = 0; i < n; i++) {
    if ((TERRAIN_RANK[terrains[i]] ?? 0) <= 0) continue;
    let d = 0;
    for (let j = i - 1; j >= 0 && d < dilateM; j--) {
      out[j] = widerTerrain(out[j], terrains[i]);
      d += segLenM[j];
    }
    d = 0;
    for (let j = i + 1; j < n && d < dilateM; j++) {
      out[j] = widerTerrain(out[j], terrains[i]);
      d += segLenM[j];
    }
  }

  const runs = [];
  for (let i = 0; i < n; i++) {
    const last = runs[runs.length - 1];
    if (last && last.terrain === out[i]) last.toIdx = i + 1;
    else runs.push({ fromIdx: i, toIdx: i + 1, terrain: out[i] });
  }
  return runs.map((r) => ({ fromIdx: r.fromIdx, toIdx: r.toIdx, terrain: r.terrain, difficultyTenths }));
}

/**
 * 배포 폴리라인의 구간 메타를 만든다.
 * 태그를 못 받았거나 매핑이 실패하면 **종전 그대로** defaultTerrain 하나를 낸다.
 */
async function buildTerrainSegments(t, geomJson, polyline) {
  const single = [{ fromIdx: 0, toIdx: polyline.length - 1, terrain: t.defaultTerrain, difficultyTenths: t.difficultyTenths }];
  const tagsJson = await fetchWayTags(t.relationId);
  if (!tagsJson) return { segments: single, note: '태그 미취득 — 단일 구간' };
  const tagById = new Map();
  for (const el of tagsJson.elements ?? []) {
    if (el.type === 'way' && el.tags) tagById.set(el.id, el.tags.highway ?? null);
  }
  if (tagById.size === 0) return { segments: single, note: 'highway 태그 없음 — 단일 구간' };

  const index = buildWaySegmentIndex(geomJson);
  const terrains = [];
  const dists = [];
  let matched = 0;
  for (let i = 0; i + 1 < polyline.length; i++) {
    const mid = { lat: (polyline[i].lat + polyline[i + 1].lat) / 2, lon: (polyline[i].lon + polyline[i + 1].lon) / 2 };
    const { wayId, distanceM } = index.nearestWayId(mid);
    const auto = wayId != null ? terrainFromHighway(tagById.get(wayId)) : null;
    if (auto) { matched++; dists.push(distanceM); }
    // ★자동 판정은 매니페스트 기본값을 **넓히기만** 한다.
    terrains.push(widerTerrain(t.defaultTerrain, auto ?? t.defaultTerrain));
  }
  if (matched === 0) return { segments: single, note: '매핑 실패 — 단일 구간' };
  const segments = runLengthSegments(terrains, polyline, t.difficultyTenths);
  const counts = {};
  for (const s of segments) {
    let m = 0;
    for (let i = s.fromIdx; i < s.toIdx && i + 1 < polyline.length; i++) m += haversineM(polyline[i], polyline[i + 1]);
    counts[s.terrain] = (counts[s.terrain] ?? 0) + m;
  }
  dists.sort((a, b) => a - b);
  const note =
    `구간 ${segments.length}개 / 매핑 ${matched}/${terrains.length}선분 ` +
    `(중앙 ${dists.length ? dists[dists.length >> 1].toFixed(1) : '?'} m) / ` +
    Object.entries(counts).map(([k, m]) => `${k} ${(m / 1000).toFixed(1)}km`).join(' · ');
  return { segments, note };
}

// ── 본체 ──────────────────────────────────────────────────────────

const only = process.argv[2];
// 제외 항목(결정 2: 가이드·예약 의무)은 명시 지정할 때만 생성한다 — 실수로 열지 않기 위해.
// ★regionId 하나에 코스가 여럿일 수 있다(camino-de-santiago = 프란세스·포르투게스·
//   프리미티보). courseId로도 지정할 수 있게 둔다.
const targets = MANIFEST.filter((m) =>
  only ? m.regionId === only || m.courseId === only : !m.excluded,
).sort(
  (a, b) => (a.priority ?? 99) - (b.priority ?? 99),
);
const built = [];

for (const t of targets) {
  console.log(`\n[${t.regionId}] ${t.name}`);
  if (t.excluded) console.log(`    ⚠ 1차 제외 대상: ${t.excluded}`);
  if (!t.relationId) {
    console.log('    ⏭ relationId 미확인 — 건너뜀 (사람이 osm.org에서 확인 후 매니페스트에 기입)');
    continue;
  }
  try {
    const json = await fetchRelation(t.relationId);
    const groups = extractWayGroups(json, t.relationId);
    if (groups.length === 0) {
      console.log('    ❌ way 기하가 없다 (관계 ID 확인 필요)');
      continue;
    }

    // 구간 안에서 먼저 잇고, 구간을 순서대로 이어붙인다 (extractWayGroups 주석 참조).
    let stitched = [];
    let wayCount = 0;
    let wayJumpM = 0;
    let droppedM = 0;
    const sectionGapsM = [];
    // 이음 직선의 **위치** 목록 (way 이음 + 구간 이음). 물 위 직선 검사가 쓴다.
    const gapSegments = [];
    for (const g of groups) {
      wayCount += g.ways.length;
      const { chain: part, jumpM, jumps, droppedM: dM } = stitchWays(g.ways);
      droppedM += dM;
      if (part.length < 2) continue;
      wayJumpM += jumpM;
      gapSegments.push(...jumps);
      if (stitched.length === 0) {
        stitched = part;
        continue;
      }
      // 이전 구간 끝과 이 구간의 어느 끝이 가까운지 보고 방향을 맞춘다.
      const tail = stitched[stitched.length - 1];
      const dFwd = haversineM(tail, part[0]);
      const dRev = haversineM(tail, part[part.length - 1]);
      const oriented = dFwd <= dRev ? part : part.slice().reverse();
      // ★이 이음은 폴리라인에 **직선 한 줄**을 넣는다. 반드시 계측한다.
      sectionGapsM.push({ toName: g.name || String(g.id), gapM: Math.min(dFwd, dRev) });
      gapSegments.push({ from: tail, to: oriented[0], gapM: Math.min(dFwd, dRev) });
      stitched = stitched.concat(oriented);
    }
    if (groups.length > 1) console.log(`    구간 ${groups.length}개를 순서대로 연결`);
    const rawKm = polylineLengthM(stitched) / 1000;
    const simplified = simplify(stitched, SIMPLIFY_TOLERANCE_M);
    const km = polylineLengthM(simplified) / 1000;

    // ── 검사 1: 기하 (가짜 직선) — 연장과 무관하게 먼저 본다 ──────────────
    const geo = checkGeometry({
      sectionGapsM,
      wayJumpM,
      totalM: rawKm * 1000,
      droppedM,
      gapSegments,
      ferryEndpoints: groups.ferryEndpoints ?? [],
    });
    console.log(
      `    직선 이음 총 ${(geo.totalJumpM / 1000).toFixed(2)} km (${(geo.ratio * 100).toFixed(2)}%)` +
        (sectionGapsM.length
          ? ` / 구간 이음 최대 ${(geo.worstSectionGapM / 1000).toFixed(2)} km`
          : '') +
        ` / 버린 조각 ${(droppedM / 1000).toFixed(1)} km (${(geo.dropRatio * 100).toFixed(1)}%)`,
    );
    // 나라 확인용 위경도 범위 — 사람이 눈으로 대조한다 (볼리비아 오탐 재발 방지).
    const bbox = stitched.reduce(
      (b, p) => ({
        minLat: Math.min(b.minLat, p.lat),
        maxLat: Math.max(b.maxLat, p.lat),
        minLon: Math.min(b.minLon, p.lon),
        maxLon: Math.max(b.maxLon, p.lon),
      }),
      { minLat: 90, maxLat: -90, minLon: 180, maxLon: -180 },
    );
    console.log(
      `    범위 lat ${bbox.minLat.toFixed(4)}~${bbox.maxLat.toFixed(4)} / ` +
        `lon ${bbox.minLon.toFixed(4)}~${bbox.maxLon.toFixed(4)} / ` +
        `시작 ${stitched[0].lat.toFixed(5)},${stitched[0].lon.toFixed(5)} → ` +
        `끝 ${stitched[stitched.length - 1].lat.toFixed(5)},${stitched[stitched.length - 1].lon.toFixed(5)}`,
    );

    // ── 검사 2: 연장 ─────────────────────────────────────────────────────
    const deviation = Math.abs(km - t.expectedKm) / t.expectedKm;
    const flag = geo.problems.length ? '⛔ 가짜 직선' : deviation > 0.15 ? '⚠ 연장 불일치' : '✓';
    console.log(
      `    ${flag} way ${wayCount}개 → ${stitched.length}점 (${rawKm.toFixed(1)}km) ` +
        `→ 단순화 ${simplified.length}점 (${km.toFixed(1)}km) / 기대 ${t.expectedKm}km`,
    );
    // ★fail-closed: 두 검사 중 하나라도 떨어지면 **파일에 쓰지 않는다.**
    //   이 폴리라인이 곧 코인 생성 기준이므로, 의심스러운 좌표를 산출물에 남기면
    //   나중에 누군가 그대로 LIVE로 올릴 위험이 있다. --force로만 강제 기록한다.
    let failed = false;
    if (geo.problems.length) {
      for (const p of geo.problems) console.log(`       → ${p}`);
      console.log('       ★실제 길이 아닌 직선 위에서도 코인이 생성된다 — 연장이 맞아도 통과 불가.');
      failed = true;
    }
    if (deviation > 0.15) {
      console.log('       → way 이어붙이기 실패이거나 다른 트레일일 수 있다. 사람 검수 필요.');
      failed = true;
    }
    if (failed) {
      if (!process.argv.includes('--force')) {
        console.log('       ⛔ 산출물에서 제외 (강제하려면 --force)');
        continue;
      }
    }

    // ── 구간 지형 자동 분할 (사람이 손으로 정하지 않는다) ────────────────
    const terrain = await buildTerrainSegments(t, json, simplified);
    console.log(`    지형: ${terrain.note}`);

    built.push({
      ...t,
      polyline: simplified,
      segments: terrain.segments,
      terrainNote: terrain.note,
      actualKm: km,
      rawKm,
      wayCount,
      bbox,
      osmBase: json.osm3s?.timestamp_osm_base ?? '?',
      endpoint: json.osm3s?.shvil_endpoint ?? '(캐시)',
    });
  } catch (e) {
    console.log(`    ❌ ${e.message}`);
  }
}

if (built.length === 0) {
  console.log('\n생성할 코스가 없다 — 매니페스트에 확인된 relationId를 채워라.');
  process.exit(0);
}

// ── 기존 산출물 보존 (2026-07-27) ─────────────────────────────────
//
// ★이 스크립트는 worldCourses.ts를 **통째로 덮어쓴다**. 그래서
//   `node fetchTrailCourses.mjs gr20` 처럼 한 트레일만 생성하면 나머지가 전부
//   사라졌다 — 실제로 그 한 줄로 `SHVIL_ISRAEL`(배포 중인 1,055km 코스)이
//   지워졌고, server/src/courses.ts가 그것을 import 하므로 서버가 빌드되지
//   않는 상태가 됐다. 즉 **명령 한 줄로 등록 코스가 통째로 없어진다.**
//   (앞선 세션이 남긴 "사라진 MILFORD_TRACK" 스테일 주석도 같은 원인이다.)
//
//   화폐 시스템에서 코스가 조용히 사라지는 것은 걷는 사람의 인정이 사라지는
//   것이다(제6조). 그래서 이번 실행이 만들지 않은 코스는 **있는 그대로 보존**한다.
//   정말로 지우려면 worldCourses.ts를 삭제하고 전체 재생성하면 된다.
const builtIds = new Set(built.map((b) => b.courseId));
/**
 * 생성 파일에서 코스 블록을 courseId → 소스 문자열로 뽑는다.
 * `WORLD_COURSES`는 `CourseData[]`라 이 패턴에 걸리지 않는다.
 * 앞줄의 한 줄짜리 doc 주석만 함께 가져온다 — 여러 줄을 훑으면 파일 머리말과
 * `import` 줄까지 딸려 와 중복 선언이 생긴다(실제로 한 번 발생).
 */
function extractCourseBlocks(src) {
  const out = new Map();
  const re = /export const ([A-Z0-9_]+): CourseData = \{\n([\s\S]*?)\n\};\n/g;
  for (const m of src.matchAll(re)) {
    const idMatch = /courseId:\s*"([^"]+)"/.exec(m[2]);
    if (!idMatch) continue;
    const docMatch = /(\/\*\*[^\n]*\*\/)\n$/.exec(src.slice(0, m.index));
    out.set(idMatch[1], {
      varName: m[1],
      code: `${docMatch ? `${docMatch[1]}\n` : ''}export const ${m[1]}: CourseData = {\n${m[2]}\n};\n`,
    });
  }
  return out;
}
const preserved = [];
if (existsSync(OUT)) {
  const prev = readFileSync(OUT, 'utf-8');
  const blocks = extractCourseBlocks(prev);
  const ledgerLines = new Map();
  for (const m of prev.matchAll(/^ \* ([a-z0-9-]+) +rel .*$/gm)) ledgerLines.set(m[1], m[0]);
  for (const [courseId, block] of blocks) {
    if (builtIds.has(courseId)) continue; // 이번 실행이 새로 만들었다 — 새 것을 쓴다
    preserved.push({ courseId, ...block, ledgerLine: ledgerLines.get(courseId) ?? null });
  }
  if (preserved.length > 0) {
    console.log(`\n기존 산출물 보존: ${preserved.map((p) => p.courseId).join(', ')}`);
    for (const p of preserved) {
      if (!p.ledgerLine) console.log(`    ⚠ ${p.courseId}: 출처 원장 줄을 찾지 못했다 — 전체 재생성 권장`);
    }
  }
}

/** 최종 배열 순서: 매니페스트 순서 → 매니페스트에 없는 것은 뒤에. */
const manifestOrder = new Map(MANIFEST.map((m, i) => [m.courseId, i]));
const emitted = [
  ...built.map((b) => ({
    courseId: b.courseId,
    varName: b.courseId.toUpperCase().replace(/-/g, '_'),
    fresh: b,
  })),
  ...preserved.map((p) => ({ courseId: p.courseId, varName: p.varName, code: p.code, ledgerLine: p.ledgerLine })),
].sort((a, b) => (manifestOrder.get(a.courseId) ?? 999) - (manifestOrder.get(b.courseId) ?? 999));

// ── TS 모듈 출력 ──────────────────────────────────────────────────

const header = `/**
 * 세계 트레일 코스 데이터 — 생성 파일. 직접 수정 금지.
 *
 * 재생성: node packages/shared/scripts/fetchTrailCourses.mjs
 * 출처: OpenStreetMap 기여자 — 데이터는 ODbL(Open Database License)로 제공된다.
 *       https://www.openstreetmap.org/copyright
 * 취득: ${new Date().toISOString().slice(0, 10)}
 *
 * ★이 폴리라인이 코인 생성의 기준이다 (회랑 반폭 50~150m 안에서만 기준 요율).
 *  단순화 허용 오차 ${SIMPLIFY_TOLERANCE_M}m — 최소 회랑(개활지 50m)의 1/2.5.
 *  좌표가 실제 길과 어긋나면 걷는 사람이 "코스 밖" 판정을 받으므로, 실제 걸은
 *  사람의 보고로 계속 보정한다 (docs/세계코스_활성화_계획.md §5).
 *
 * ── 출처 원장 (재현용) ──────────────────────────────────────────────────
 * 같은 relationId·같은 질의라도 Overpass 백엔드의 스냅샷(osm_base)이 다르면 way 몇
 * 개가 갈리고, 그 몇 개 때문에 사슬이 무너져 연장이 수십 % 튄다(실측). 그래서 어느
 * 스냅샷에서 무엇이 나왔는지를 산출물에 박아 둔다 — 이 표가 없으면 재현이 불가능하다.
${emitted
  .map((e) =>
    e.fresh
      ? ` * ${e.fresh.courseId.padEnd(20)} rel ${String(e.fresh.relationId).padEnd(9)} way ${String(e.fresh.wayCount).padEnd(6)} ` +
        `원본 ${e.fresh.rawKm.toFixed(1)}km → ${e.fresh.actualKm.toFixed(1)}km / ${e.fresh.polyline.length}점 / osm_base ${e.fresh.osmBase}`
      : (e.ledgerLine ?? ` * ${e.courseId.padEnd(20)} (이전 실행에서 보존 — 출처 원장 유실, 전체 재생성 권장)`),
  )
  .join('\n')}
 */
import type { CourseData } from './courses';

`;

const body = emitted
  .map((e) => {
    if (!e.fresh) return e.code; // 이번 실행이 만들지 않은 코스 — 있는 그대로 보존
    const b = e.fresh;
    const pts = b.polyline.map((p) => `{lat:${p.lat.toFixed(5)},lon:${p.lon.toFixed(5)}}`).join(',');
    const segs = (b.segments ?? [
      { fromIdx: 0, toIdx: b.polyline.length - 1, terrain: b.defaultTerrain, difficultyTenths: b.difficultyTenths },
    ])
      .map(
        (s) =>
          `{fromIdx:${s.fromIdx},toIdx:${s.toIdx},terrain:${JSON.stringify(s.terrain)},difficultyTenths:${s.difficultyTenths}}`,
      )
      .join(',');
    // ★doc 주석은 **한 줄**로 유지한다 — extractCourseBlocks가 한 줄짜리만 보존한다.
    return `/** ${b.name} — 약 ${b.actualKm.toFixed(0)}km, ${b.polyline.length}점 (OSM rel ${b.relationId}) / 지형: ${b.terrainNote ?? '단일 구간'} */
export const ${e.varName}: CourseData = {
  courseId: ${JSON.stringify(b.courseId)},
  name: ${JSON.stringify(b.name)},
  version: 1,
  polyline: [${pts}],
  segments: [${segs}],
};
`;
  })
  .join('\n');

const index = `
/** 생성된 세계 트레일 코스 전체 — 서버 /courses 배포·지갑 오프라인 폴백용. */
export const WORLD_COURSES: CourseData[] = [${emitted.map((e) => e.varName).join(', ')}];
`;

writeFileSync(OUT, header + body + index, 'utf-8');
console.log(`\n생성 완료: ${OUT}`);
console.log(`코스 ${built.length}개 / 총 ${built.reduce((s, b) => s + b.polyline.length, 0)}점`);
console.log('\n다음: 지도에 겹쳐 시작·끝·분기점을 눈으로 검수한 뒤 WORLD_TRAILS를 LIVE로 올린다.');
