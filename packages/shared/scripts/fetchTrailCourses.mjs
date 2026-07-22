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
  {
    regionId: 'milford-track',
    courseId: 'milford-track',
    name: 'Milford Track',
    // ✅ 확인됨 (2026-07-22): DOC 공식 운영, "GW - 07 Milford Track", 32 way / 2,068점.
    relationId: 1385121,
    expectedKm: 53.5,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 15,
    // ⚠ 예약제·편도 4일 — 활성화 여부는 다니엘 쌤 결정 (계획 §4-2).
    note: 'booking required, one-way',
  },
  {
    regionId: 'everest-base-camp',
    courseId: 'everest-base-camp',
    name: 'Everest Base Camp Trek',
    relationId: null, // ⏳ 검색에 잡혔으나 ID 미확인 — 사람 확인 필요
    expectedKm: 130,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 25,
  },
  {
    regionId: 'john-muir-trail',
    courseId: 'john-muir-trail',
    name: 'John Muir Trail',
    relationId: null, // ⏳ 검색에 잡혔으나 ID 미확인
    expectedKm: 340,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 20,
  },
  {
    regionId: 'camino-de-santiago',
    courseId: 'camino-frances',
    name: 'Camino de Santiago (Camino Francés)',
    relationId: null, // ⏳ 변형 결정 필요 (계획 §4-1) — Francés 권장
    expectedKm: 780,
    defaultTerrain: 'OPEN',
    difficultyTenths: 10,
  },
  {
    regionId: 'tour-du-mont-blanc',
    courseId: 'tour-du-mont-blanc',
    name: 'Tour du Mont Blanc',
    relationId: null, // ⏳ Overpass 속도 제한으로 미확인
    expectedKm: 170,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 20,
  },
  {
    regionId: 'gr20',
    courseId: 'gr20',
    name: 'GR20 (Corsica)',
    relationId: null, // ⏳ 미확인
    expectedKm: 180,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 30,
  },
  {
    regionId: 'annapurna-circuit',
    courseId: 'annapurna-circuit',
    name: 'Annapurna Circuit',
    relationId: null, // ⏳ 미확인 + 변형 결정 필요
    expectedKm: 200,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 25,
  },
  {
    regionId: 'inca-trail',
    courseId: 'inca-trail',
    name: 'Inca Trail to Machu Picchu',
    // ❌ 자동 검색이 볼리비아 Takesi Inca Trail을 오탐했다. 페루 경로를 사람이 확인해야 한다.
    relationId: null,
    expectedKm: 43,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 25,
    note: 'permit + licensed guide required, 500/day cap',
  },
  {
    regionId: 'torres-del-paine-w',
    courseId: 'torres-del-paine-w',
    name: 'Torres del Paine W Trek',
    // ❌ route 관계가 없다 — 개별 way 목록 지정 또는 GPX 경로가 필요하다.
    relationId: null,
    expectedKm: 80,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 20,
  },
  {
    regionId: 'kilimanjaro',
    courseId: 'kilimanjaro-machame',
    name: 'Kilimanjaro (Machame Route)',
    // ❌ hiking 관계 없음 + 등정 루트 7종 중 선택 필요 (계획 §4-1).
    relationId: null,
    expectedKm: 62,
    defaultTerrain: 'MOUNTAIN',
    difficultyTenths: 30,
    note: 'guide mandatory by law',
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
function stitchWays(ways, gapToleranceM = 60) {
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
  const query = `[out:json][timeout:180];relation(${relationId});out geom;`;
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

function extractWays(overpassJson) {
  const ways = [];
  for (const el of overpassJson.elements ?? []) {
    for (const mem of el.members ?? []) {
      if (mem.type === 'way' && Array.isArray(mem.geometry) && mem.geometry.length >= 2) {
        ways.push(mem.geometry.map((g) => ({ lat: g.lat, lon: g.lon })));
      }
    }
  }
  return ways;
}

// ── 본체 ──────────────────────────────────────────────────────────

const only = process.argv[2];
const targets = MANIFEST.filter((m) => (only ? m.regionId === only : true));
const built = [];

for (const t of targets) {
  console.log(`\n[${t.regionId}] ${t.name}`);
  if (!t.relationId) {
    console.log('    ⏭ relationId 미확인 — 건너뜀 (사람이 osm.org에서 확인 후 매니페스트에 기입)');
    continue;
  }
  try {
    const json = await fetchRelation(t.relationId);
    const ways = extractWays(json);
    if (ways.length === 0) {
      console.log('    ❌ way 기하가 없다 (관계 ID 확인 필요)');
      continue;
    }
    const stitched = stitchWays(ways);
    const rawKm = polylineLengthM(stitched) / 1000;
    const simplified = simplify(stitched, SIMPLIFY_TOLERANCE_M);
    const km = polylineLengthM(simplified) / 1000;

    const deviation = Math.abs(km - t.expectedKm) / t.expectedKm;
    const flag = deviation > 0.15 ? '⚠ 연장 불일치' : '✓';
    console.log(
      `    ${flag} way ${ways.length}개 → ${stitched.length}점 (${rawKm.toFixed(1)}km) ` +
        `→ 단순화 ${simplified.length}점 (${km.toFixed(1)}km) / 기대 ${t.expectedKm}km`,
    );
    if (deviation > 0.15) {
      console.log('       → way 이어붙이기 실패이거나 다른 트레일일 수 있다. 사람 검수 필요.');
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
