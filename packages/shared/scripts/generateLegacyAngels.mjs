/**
 * INT 기존 트레일 엔젤 명단 생성기 (다니엘 쌤 build.py의 Node 이식).
 *
 * 입력: int-trail-angels-source.txt (INT 커뮤니티 위키의 공개 명단을 정리한 원문)
 *   출처: https://shvil.fandom.com/wiki/INT_Trail_Angels (최종 갱신 2024-11-11)
 * 출력: ../src/legacyAngels.ts — 타입된 데이터 모듈 (서버·웹·지갑 공용)
 *
 * ── 데이터 성격·책무 (중요) ─────────────────────────────────────────
 * 이 명단의 사람들은 쉬빌 회원이 아니다 — INT 하이커 커뮤니티가 수십 년 운영해 온
 * 공개 명단이며, 연락처는 하이커의 연락을 받으려고 본인들이 공개한 것이다. 우리는
 * 참고 명단으로 재게시하며 출처를 명기한다. 본인 요청 시 즉시 삭제한다(소스에서
 * 지우고 이 스크립트 재실행). 서비스 표기는 원문 자유 텍스트에서 추정한 코드라
 * 부정확할 수 있다 — 원문(details)이 항상 우선이다.
 *
 * 재생성: node packages/shared/scripts/generateLegacyAngels.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'int-trail-angels-source.txt');
const OUT = join(HERE, '..', 'src', 'legacyAngels.ts');

// ── build.py 이식: 전화번호 추출 ──────────────────────────────────
function extractPhones(text) {
  const noTimes = text.replace(/\d{1,2}:\d{2}/g, ' '); // 시각 표기 제거
  const cands = noTimes.match(/0\d[\d\-\s]{4,12}\d/g) ?? [];
  const out = [];
  for (const c of cands) {
    const d = c.replace(/\D/g, '');
    if (d.length >= 9 && d.length <= 10 && d.startsWith('0') && !out.includes(d)) out.push(d);
  }
  return out;
}

// ── build.py 이식: 서비스 태그 (언어 중립 코드로 — 문구는 각 클라이언트 몫) ──
const CODE_MAP = { L: 'LAUNDRY', I: 'INTERNET', S: 'SHOWER', M: 'MEAL', GS: 'GROCERY', 'PU/DO': 'PICKUP', MD: 'MAIL' };

function abbrevCodes(text) {
  const found = new Set();
  for (const m of text.matchAll(/\b(?:GS|MD|PU\/DO|[LISM])\b(?:\s*,\s*\b(?:GS|MD|PU\/DO|[LISM])\b)+/g)) {
    for (const tok of m[0].match(/GS|MD|PU\/DO|[LISM]/g) ?? []) found.add(tok);
  }
  for (const m of text.matchAll(/SHO\s+(GS|[LISM])\b/g)) found.add(m[1]);
  return found;
}

function services(text) {
  const t = text.toLowerCase();
  const has = (...kw) => kw.some((k) => t.includes(k));
  const tags = [];
  if (has('sleep', 'bed', 'mattress', 'matress', 'matt', 'tent', 'sleeping bag', 'room', 'lawn', 'porch', 'yard', 'hut', 'apartment', 'caravan', 'mobile')) tags.push('SLEEP');
  if (t.includes('shower')) tags.push('SHOWER');
  if (has('meal', 'meals', 'dinner', 'supper', 'breakfast', 'food', 'cook', 'eat', 'vegan', 'vegetarian')) tags.push('MEAL');
  if (has('laundry', 'wash-machine', 'dryer')) tags.push('LAUNDRY');
  if (has('internet', 'wifi', 'wi-fi')) tags.push('INTERNET');
  if (has('grocery', 'supermarket', 'minimarket', 'super market', 'market')) tags.push('GROCERY');
  if (has('pu/do', 'pickup', 'pick up', 'drop off', 'dropoff', 'drop-off', 'pick-up', 'pu / do')) tags.push('PICKUP');
  if (has('kitchen', 'kitchenette', 'cook')) tags.push('KITCHEN');
  if (has('refill water', 'water from', 'refill', 'water,', 'water.')) tags.push('WATER');
  for (const code of abbrevCodes(text)) {
    const tag = CODE_MAP[code];
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  const order = ['SLEEP', 'SHOWER', 'MEAL', 'LAUNDRY', 'INTERNET', 'GROCERY', 'KITCHEN', 'PICKUP', 'WATER', 'MAIL'];
  return order.filter((x) => tags.includes(x));
}

// ── 구조 파싱 (##REGION## / @위치| / 호스트 줄) ────────────────────
const rows = [];
let region = '';
let location = '';
for (const raw of readFileSync(SRC, 'utf-8').split('\n')) {
  const line = raw.replace(/\r$/, '');
  if (!line.trim()) continue;
  if (line.startsWith('##REGION##')) {
    region = line.replace('##REGION##', '').trim();
    location = '';
    continue;
  }
  if (line.startsWith('@')) {
    const body = line.slice(1);
    const bar = body.indexOf('|');
    if (bar >= 0) {
      location = body.slice(0, bar).trim();
      const rest = body.slice(bar + 1).trim();
      if (rest) rows.push([region, location, rest]);
    } else {
      location = body.trim();
    }
    continue;
  }
  rows.push([region, location, line.trim()]);
}

const entries = rows.map(([reg, loc, detail], i) => ({
  order: i,
  region: reg,
  location: loc,
  details: detail,
  phones: extractPhones(detail),
  sho: /\bSHO\b/.test(detail),
  services: services(detail),
}));

// ── TS 모듈 출력 ──────────────────────────────────────────────────
const header = `/**
 * INT 기존 트레일 엔젤 명단 — 생성 파일. 직접 수정 금지.
 *
 * 재생성: node packages/shared/scripts/generateLegacyAngels.mjs
 * 원본: scripts/int-trail-angels-source.txt
 * 출처: https://shvil.fandom.com/wiki/INT_Trail_Angels (INT 하이커 커뮤니티 공개 명단)
 *
 * ── 데이터 성격 (중요 — 표시하는 모든 화면이 지켜야 한다) ────────────────
 *  - 이 사람들은 쉬빌 **회원이 아니다**: 회원 번호·E2E 메시지·코인 수령이 없다.
 *    쉬빌 엔젤 디렉토리와 절대 섞지 말고 "기존 트레일 엔젤(참고)"로 구분 표시한다.
 *  - 연락처는 하이커의 연락을 받으려고 본인들이 공개 명단에 올린 것이다. 재게시에는
 *    출처를 명기하고, 본인 요청 시 소스에서 삭제 후 재생성한다.
 *  - details는 원문 그대로(영어, 사용자 콘텐츠 — 번역·검사 대상 아님). services는
 *    원문에서 추정한 코드라 부정확할 수 있다 — 원문이 우선이다.
 *  - SHO = 안식일·유대 명절 준수 가정: 금요일 일몰 전~토요일 일몰 후 전화 금지.
 *  - 이용 예절(원본 명단 규칙): 도착 48시간 전 연락, 21:00 이후 전화 금지.
 *  - 배열은 원본과 같은 북(단)→남(에일라트) 지리 순서다 (order 필드).
 */

/** 제공 서비스 코드 — 문구는 각 클라이언트 사전이 조립한다. */
export type LegacyAngelService =
  | 'SLEEP'
  | 'SHOWER'
  | 'MEAL'
  | 'LAUNDRY'
  | 'INTERNET'
  | 'GROCERY'
  | 'KITCHEN'
  | 'PICKUP'
  | 'WATER'
  | 'MAIL';

export interface LegacyAngelEntry {
  /** 북→남 지리 순서 (원본 명단 순서). */
  order: number;
  /** 구간 (원본 4구간, 영어 고유명). */
  region: string;
  /** 마을·지점 (영어 고유명). */
  location: string;
  /** 원문 상세 (영어, 사용자 콘텐츠) — 항상 이것이 우선이다. */
  details: string;
  /** 전화번호 (숫자만, 이스라엘 국내형 0…). 국제 발신은 0→+972. */
  phones: string[];
  /** 안식일·명절 준수 가정 (금요일 일몰~토요일 일몰 전화 금지). */
  sho: boolean;
  /** 원문에서 추정한 서비스 코드 (부정확할 수 있음). */
  services: LegacyAngelService[];
}

export const INT_TRAIL_ANGELS_SOURCE = 'https://shvil.fandom.com/wiki/INT_Trail_Angels';
export const INT_TRAIL_ANGELS_UPDATED = '2024-11-11';

/** 원본 4구간 (북→남). */
export const INT_TRAIL_ANGEL_REGIONS: readonly string[] = ${JSON.stringify([...new Set(entries.map((e) => e.region))])};

export const INT_TRAIL_ANGELS: LegacyAngelEntry[] = [
`;

const body = entries
  .map(
    (e) =>
      `  { order: ${e.order}, region: ${JSON.stringify(e.region)}, location: ${JSON.stringify(e.location)}, details: ${JSON.stringify(e.details)}, phones: ${JSON.stringify(e.phones)}, sho: ${e.sho}, services: ${JSON.stringify(e.services)} },`,
  )
  .join('\n');

writeFileSync(OUT, `${header}${body}\n];\n`, 'utf-8');

const regions = [...new Set(entries.map((e) => e.region))];
console.log('entries:', entries.length);
for (const r of regions) console.log(' ', r, entries.filter((e) => e.region === r).length);
console.log('locations:', new Set(entries.map((e) => `${e.region}|${e.location}`)).size);
console.log('with phone:', entries.filter((e) => e.phones.length > 0).length);
console.log('SHO:', entries.filter((e) => e.sho).length);
console.log('saved:', OUT);
