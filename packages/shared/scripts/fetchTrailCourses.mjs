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

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const UA = 'shvil-dev/0.1 (world trail course catalog; contact via github.com/danielparkmidbar/shvil)';

/**
 * 트레일 매니페스트 — relationId는 **사람이 확인한 값만** 넣는다.
 *
 * 확인 방법: https://www.openstreetmap.org/relation/<ID> 를 열어 (1) 이름·나라가 맞는지
 * (2) 경로가 실제 트레일을 따르는지 (3) 변형이 의도한 것인지 눈으로 본다.
 *
 * relationId: null = 아직 미확인 (이 항목은 생성에서 건너뛴다).
 */
export const MANIFEST = [
  // ── 1차 대상 (다니엘 쌤 결정 2026-07-22: 자유 도보 가능 트레일만) ──────
  // 변형은 "가장 많은 사람이 다니는 길"을 택한다 (결정 1).
  {
    regionId: 'camino-de-santiago',
    courseId: 'camino-frances',
    // 결정 1: 카미노 여러 갈래 중 **Camino Francés**가 압도적 다수(순례자 통계상
    // 절반 이상)가 걷는 본선이다. 생 장 피에드포르 → 산티아고 데 콤포스텔라.
    name: 'Camino de Santiago (Camino Francés)',
    // ✅ 확인됨 (2026-07-22): OSM superroute 2163573 "Camiño Francés", distance=750,
    //    구간 관계 6개를 묶는 상위 관계. 하위 구간(예: 2163558 = 03 Logroño→Burgos)만
    //    받으면 일부만 나오므로 반드시 이 상위 ID를 쓴다.
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
    relationId: null,
    expectedKm: 170,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 20,
    priority: 2,
  },
  {
    regionId: 'annapurna-circuit',
    courseId: 'annapurna-circuit',
    // 결정 1: 서킷 본선(베시사하르 → 토롱라 → 좀솜). 우회 변형은 제외.
    name: 'Annapurna Circuit',
    relationId: null,
    expectedKm: 200,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 25,
    priority: 3,
  },
  {
    regionId: 'everest-base-camp',
    courseId: 'everest-base-camp',
    // 결정 1: 루클라 → EBC 표준 경로 (가장 많이 걷는 길).
    name: 'Everest Base Camp Trek',
    relationId: null,
    expectedKm: 130,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 25,
    priority: 4,
  },
  {
    regionId: 'gr20',
    courseId: 'gr20',
    name: 'GR20 (Corsica)',
    relationId: null,
    expectedKm: 180,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 30,
    priority: 5,
  },
  {
    regionId: 'john-muir-trail',
    courseId: 'john-muir-trail',
    name: 'John Muir Trail',
    relationId: null,
    expectedKm: 340,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 20,
    priority: 6,
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
    difficultyTenths: 15,
    excluded: 'booking required, one-way — 결정 2',
  },
  {
    regionId: 'inca-trail',
    courseId: 'inca-trail',
    name: 'Inca Trail to Machu Picchu',
    // 자동 검색이 볼리비아 Takesi Inca Trail을 오탐했다 — 페루 경로는 사람 확인 필요.
    relationId: null,
    expectedKm: 43,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 25,
    excluded: 'permit + licensed guide, 500/day cap — 결정 2',
  },
  {
    regionId: 'kilimanjaro',
    courseId: 'kilimanjaro-machame',
    name: 'Kilimanjaro (Machame Route)',
    // hiking 관계 없음 + 등정 루트 7종. Machame가 가장 많이 쓰이나 가이드 의무라 제외.
    relationId: null,
    expectedKm: 62,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 30,
    excluded: 'guide mandatory by law — 결정 2',
  },
  {
    regionId: 'torres-del-paine-w',
    courseId: 'torres-del-paine-w',
    name: 'Torres del Paine W Trek',
    // route 관계가 없다 — 개별 way 지정 또는 GPX 경로가 필요하다.
    relationId: null,
    expectedKm: 80,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 20,
    excluded: 'OSM route 관계 부재 + 국립공원 예약제 — 데이터 확보 후 재검토',
  },
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
  if (ways.length === 0) return [];
  const remaining = ways.map((w) => w.slice());
  let chain = remaining.shift();

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
      if (bestMode === 'tail-head') chain = chain.concat(w.slice(1));
      else if (bestMode === 'tail-tail') chain = chain.concat(w.slice().reverse().slice(1));
      else if (bestMode === 'head-tail') chain = w.slice(0, -1).concat(chain);
      else chain = w.slice().reverse().slice(0, -1).concat(chain);
      progress = true;
    }
  }
  if (remaining.length) {
    console.warn(`    ⚠ 이어지지 않은 조각 ${remaining.length}개 버림 (지선·접근로로 추정)`);
  }
  return chain;
}

// ── Overpass 취득 (캐시 — 속도 제한 회피) ─────────────────────────

async function fetchRelation(relationId) {
  const cachePath = join(CACHE_DIR, `rel-${relationId}.json`);
  if (existsSync(cachePath)) {
    console.log('    (캐시 사용)');
    return JSON.parse(readFileSync(cachePath, 'utf-8'));
  }
  // ★superroute 대응: 긴 트레일은 구간별 관계로 쪼개져 상위 superroute가 그것들을
  //   묶는다 (Camino Francés = 구간 관계 6개 + superroute 2163573). 관계 자신과
  //   **하위 관계까지 재귀로** 내려가 way 기하를 모두 받는다 — 상위만 받으면
  //   멤버가 관계뿐이라 좌표가 하나도 안 나온다.
  const query = `[out:json][timeout:600];rel(${relationId});rel(r)->.kids;(rel(${relationId});.kids;);out geom;`;
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query }),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status} — 속도 제한일 수 있다. 잠시 후 재시도.`);
  const json = await res.json();
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cachePath, JSON.stringify(json), 'utf-8');
  } catch {
    /* 캐시 실패는 무해 */
  }
  return json;
}

/**
 * 관계별로 way를 묶어 돌려준다 (구간 순서 보존).
 *
 * ★긴 트레일은 구간 관계로 쪼개져 있다 (Camino Francés = "01 …" ~ "06 …").
 * 모든 way를 한 자루에 쏟고 탐욕적으로 이으면 3,742개 조각 중 32km만 연결되는
 * 참사가 난다(실측). 구간 안에서 먼저 잇고, 구간을 이름순(01, 02, …)으로 이어야
 * 실제 경로가 나온다.
 */
function extractWayGroups(overpassJson) {
  const groups = [];
  for (const el of overpassJson.elements ?? []) {
    const ways = [];
    for (const mem of el.members ?? []) {
      if (mem.type === 'way' && Array.isArray(mem.geometry) && mem.geometry.length >= 2) {
        ways.push(mem.geometry.map((g) => ({ lat: g.lat, lon: g.lon })));
      }
    }
    if (ways.length > 0) {
      groups.push({ id: el.id, name: el.tags?.name ?? '', ref: el.tags?.ref ?? '', ways });
    }
  }

  // ★대체 경로(variant) 배제 — 결정 1 "가장 많은 사람이 다니는 길"의 실행.
  //   Camino Francés superroute에는 "Camiño Francés (Rutas alternativas)"(769 way)가
  //   본선과 함께 들어 있어, 그대로 이으면 연장이 2배(1,584km)로 부풀었다(실측).
  //   본선만 남긴다 — 이름에 대체/변형 표식이 있는 구간은 버린다.
  const VARIANT_RE = /alternativ|variant|option|bypass|detour|우회|대체/i;
  const mainline = groups.filter((g) => !VARIANT_RE.test(g.name));
  const dropped = groups.length - mainline.length;
  if (dropped > 0) console.log(`    대체 경로 ${dropped}개 제외 (본선만 사용 — 결정 1)`);
  // 구간 이름의 선두 번호(01, 02, …)로 정렬 — 없으면 이름 사전순.
  const seq = (g) => {
    const m = (g.ref || g.name).match(/(\d{1,3})/);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  };
  mainline.sort((a, b) => seq(a) - seq(b) || a.name.localeCompare(b.name));
  return mainline;
}

// ── 본체 ──────────────────────────────────────────────────────────

const only = process.argv[2];
// 제외 항목(결정 2: 가이드·예약 의무)은 명시 지정할 때만 생성한다 — 실수로 열지 않기 위해.
const targets = MANIFEST.filter((m) => (only ? m.regionId === only : !m.excluded)).sort(
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
    const groups = extractWayGroups(json);
    if (groups.length === 0) {
      console.log('    ❌ way 기하가 없다 (관계 ID 확인 필요)');
      continue;
    }

    // 구간 안에서 먼저 잇고, 구간을 순서대로 이어붙인다 (extractWayGroups 주석 참조).
    let stitched = [];
    let wayCount = 0;
    for (const g of groups) {
      wayCount += g.ways.length;
      const part = stitchWays(g.ways);
      if (part.length < 2) continue;
      if (stitched.length === 0) {
        stitched = part;
        continue;
      }
      // 이전 구간 끝과 이 구간의 어느 끝이 가까운지 보고 방향을 맞춘다.
      const tail = stitched[stitched.length - 1];
      const oriented = haversineM(tail, part[0]) <= haversineM(tail, part[part.length - 1])
        ? part
        : part.slice().reverse();
      stitched = stitched.concat(oriented);
    }
    if (groups.length > 1) console.log(`    구간 ${groups.length}개를 순서대로 연결`);
    const rawKm = polylineLengthM(stitched) / 1000;
    const simplified = simplify(stitched, SIMPLIFY_TOLERANCE_M);
    const km = polylineLengthM(simplified) / 1000;

    const deviation = Math.abs(km - t.expectedKm) / t.expectedKm;
    const flag = deviation > 0.15 ? '⚠ 연장 불일치' : '✓';
    console.log(
      `    ${flag} way ${wayCount}개 → ${stitched.length}점 (${rawKm.toFixed(1)}km) ` +
        `→ 단순화 ${simplified.length}점 (${km.toFixed(1)}km) / 기대 ${t.expectedKm}km`,
    );
    if (deviation > 0.15) {
      console.log('       → way 이어붙이기 실패이거나 다른 트레일일 수 있다. 사람 검수 필요.');
      // ★fail-closed: 연장 검사를 통과하지 못한 경로는 **파일에 쓰지 않는다.**
      //   이 폴리라인이 곧 코인 생성 기준이므로, 의심스러운 좌표를 산출물에 남기면
      //   나중에 누군가 그대로 LIVE로 올릴 위험이 있다. --force로만 강제 기록한다.
      if (!process.argv.includes('--force')) {
        console.log('       ⛔ 산출물에서 제외 (강제하려면 --force)');
        continue;
      }
    }

    built.push({ ...t, polyline: simplified, actualKm: km });
  } catch (e) {
    console.log(`    ❌ ${e.message}`);
  }
}

if (built.length === 0) {
  console.log('\n생성할 코스가 없다 — 매니페스트에 확인된 relationId를 채워라.');
  process.exit(0);
}

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
 */
import type { CourseData } from './courses';

`;

const body = built
  .map((b) => {
    const pts = b.polyline.map((p) => `{lat:${p.lat.toFixed(5)},lon:${p.lon.toFixed(5)}}`).join(',');
    const varName = b.courseId.toUpperCase().replace(/-/g, '_');
    return `/** ${b.name} — 약 ${b.actualKm.toFixed(0)}km, ${b.polyline.length}점 (OSM rel ${b.relationId}). */
export const ${varName}: CourseData = {
  courseId: ${JSON.stringify(b.courseId)},
  name: ${JSON.stringify(b.name)},
  version: 1,
  polyline: [${pts}],
  segments: [{ fromIdx: 0, toIdx: ${b.polyline.length - 1}, terrain: ${JSON.stringify(b.defaultTerrain)}, difficultyTenths: ${b.difficultyTenths} }],
};
`;
  })
  .join('\n');

const index = `
/** 생성된 세계 트레일 코스 전체 — 서버 /courses 배포·지갑 오프라인 폴백용. */
export const WORLD_COURSES: CourseData[] = [${built
  .map((b) => b.courseId.toUpperCase().replace(/-/g, '_'))
  .join(', ')}];
`;

writeFileSync(OUT, header + body + index, 'utf-8');
console.log(`\n생성 완료: ${OUT}`);
console.log(`코스 ${built.length}개 / 총 ${built.reduce((s, b) => s + b.polyline.length, 0)}점`);
console.log('\n다음: 지도에 겹쳐 시작·끝·분기점을 눈으로 검수한 뒤 WORLD_TRAILS를 LIVE로 올린다.');
