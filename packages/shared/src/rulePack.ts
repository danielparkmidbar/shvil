/**
 * 커뮤니티 규칙 팩 (M16) — 다니엘 쌤 2026-07-26.
 *
 * > "위폐 감지기도 각자 다운 받아 사용할 수 있다. 즉 커뮤니티에게 툴을 주고 커뮤니티가
 * >  스스로 확인한다. ... 가치가 올라갈수록 커뮤니티 스스로 위폐 감지기를 업그레이드할
 * >  수 있도록 열어 둔다. 내가 중앙에서 시스템을 유지하며 뭘 하는 것이 아니다."
 *
 * ── 이 파일이 푸는 문제 ───────────────────────────────────────────────
 * 감지기가 내가 배포하는 코드에만 있으면, 규칙을 더하는 사람은 언제나 나다. 그것은
 * "중앙에서 유지하지 않는다"와 정면으로 어긋난다. 그렇다고 각자가 검사 코드를
 * .js 파일로 주고받게 하면 그 순간 **악성코드 유통로**가 열린다 — 위폐를 막으려다
 * 지갑을 털리게 만드는 셈이다.
 *
 * 그래서 규칙 팩은 **코드가 아니라 데이터다.** eval도, Function도, 동적 import도
 * 없다. 팩은 선언형 JSON이고, 이 파일의 해석기만이 그것을 실행한다. 팩이 할 수 있는
 * 일의 상한은 이 파일에 적힌 연산자와 지표가 전부다.
 *
 * ── 안전성의 핵심: 비대칭 ─────────────────────────────────────────────
 * **팩은 검사를 더할 수만 있다. 끄거나, 덮어쓰거나, 완화할 수 없다.**
 * 이것은 정책이 아니라 구조다 — DSL에 "무시"·"허용"·"예외" 연산자가 아예 없고,
 * 해석기는 발견(finding)을 반환할 뿐 코어 발견을 건드릴 방법이 없다.
 *
 * 그 결과:
 *  - 악성 팩이 할 수 있는 최악은 **억울한 지목**이다 (성가심).
 *  - 악성 팩은 **위조를 진짜로 보이게 만들 수 없다** (화폐의 붕괴를 못 일으킨다).
 * 감수할 수 있는 위험과 감수할 수 없는 위험을 이렇게 갈라 놓는 것이 설계의 전부다.
 *
 * ── 화폐가 쪼개지지 않는 이유 ─────────────────────────────────────────
 * 리포트는 coreVerdict(팩 없이 — 누구나 같은 답)와 extendedVerdict(내 팩까지)를
 * **둘 다** 낸다. 모두가 같은 코어 답을 계산하므로 "이 코인이 진짜인가"에 대한
 * 공통 답은 하나다. 팩은 각자의 더 엄격한 시야일 뿐이며 남에게 강요되지 않는다.
 * 큰돈을 주고 사는 사람은 팩을 겹겹이 쌓고, 잔돈을 받는 사람은 코어만 본다.
 * 검사 강도는 각자의 손실 위험에 비례해 각자 정한다 (헌법 제9조 불간섭).
 *
 * ── 좌표는 없다 (제10조) ──────────────────────────────────────────────
 * 팩이 볼 수 있는 것은 아래 화이트리스트의 **파생 지표(숫자)**뿐이다. 좌표·경로·
 * 코스 이름·시각 원본은 노출되지 않는다. 화이트리스트 밖의 이름을 쓰면 팩은 로드에
 * 실패한다 — 조용히 통과시키지 않는다(fail-closed).
 */
import type { WalkSegmentProof } from './types';

// ── 스코프와 노출 지표 ────────────────────────────────────────────────

/** proof = 걷기 증명 한 건. member = 한 회원의 증명 묶음. */
export type RuleScope = 'proof' | 'member';

/**
 * 증명 한 건에서 볼 수 있는 지표. 전부 파생값이다 — 원본 시각도 좌표도 없다.
 * (`ageDays`만 검사 시각 now에 의존한다.)
 */
export const PROOF_METRIC_FIELDS = [
  'distanceM', // 인정 거리 (m)
  'stepCount', // 걸음 수
  'durationMs', // 창 길이 (ms)
  'spanDays', // 창 길이 (일)
  'amountDshv', // 발행액 (dSHV)
  'strideM', // 보폭 (m) — 걸음 0이면 없음
  'speedKmh', // 평균 속도
  'cadenceSpm', // 평균 케이던스 — 걸음 0이면 없음
  'dshvPerKm', // 1 km당 발행액 — 거리 0이면 없음
  'breakdownDays', // 일자별 내역 항목 수
  'maxDayDshv', // 하루 최대 발행액
  'courseCount', // 걸은 코스 개수 (이름은 노출하지 않는다)
  'ageDays', // 정산 후 흐른 날 수
] as const;
export type ProofMetricField = (typeof PROOF_METRIC_FIELDS)[number];

/** 한 회원의 증명 묶음에서 볼 수 있는 지표. */
export const MEMBER_METRIC_FIELDS = [
  'proofCount', // 증명 개수
  'totalDistanceM', // 거리 합
  'totalStepCount', // 걸음 합
  'dshvTotal', // 발행액 합
  'spanMs', // 첫 시작 ~ 마지막 정산
  'spanDays',
  'minGapMs', // 증명 시작 사이 최소 간격 — 2건 미만이면 없음
  'medianGapMs', // 중앙값 간격 — 2건 미만이면 없음
  'dshvPerDay', // 흐른 시간 대비 평균 발행 속도
  'maxProofDshv', // 가장 큰 증명 한 건의 발행액
  'deviceCount', // 서로 다른 기기 키 개수
] as const;
export type MemberMetricField = (typeof MEMBER_METRIC_FIELDS)[number];

export function metricFieldsFor(scope: RuleScope): readonly string[] {
  return scope === 'proof' ? PROOF_METRIC_FIELDS : MEMBER_METRIC_FIELDS;
}

/** 지표 묶음. **계산할 수 없는 지표는 아예 없다**(키가 빠진다) — 0으로 채우지 않는다. */
export type RuleMetrics = Readonly<Record<string, number>>;

// ── 조건식 DSL ────────────────────────────────────────────────────────

/**
 * 연산자는 이것이 전부다. 늘리지 마라 — 표현력이 커질수록 감사(사람이 팩을 눈으로
 * 읽고 안전한지 판단하는 일)가 어려워진다. 팩의 목적은 만능이 아니라 **읽히는 것**이다.
 */
export type RuleComparisonOp = 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'ne';

export type RuleCondition =
  | { op: RuleComparisonOp; field: string; value: number }
  | { op: 'between'; field: string; min: number; max: number }
  | { op: 'and' | 'or'; of: RuleCondition[] }
  | { op: 'not'; of: RuleCondition };

export interface RulePackRule {
  /** 팩 안에서 유일한 식별자. */
  id: string;
  scope: RuleScope;
  /**
   * 이 팩을 쓰는 **사람 자신의** 판단 강도다. 코어의 FATAL("물리적으로 불가능")과
   * 뜻이 다르다 — 팩의 FATAL은 "나는 이런 코인은 받지 않겠다"에 가깝다.
   * 그래서 팩의 severity는 coreVerdict를 절대 건드리지 못한다.
   */
  severity: 'FATAL' | 'SIGNAL';
  when: RuleCondition;
  /** 사람이 읽는 설명. `{지표이름}`은 실제 값으로 치환된다. */
  detail: string;
}

export interface RulePack {
  v: 1;
  id: string;
  name: string;
  author?: string;
  description?: string;
  rules: RulePackRule[];
}

/** 예약어 — 리포트에서 코어 발견의 source 값이다. 팩 id로 쓸 수 없다. */
export const CORE_SOURCE = 'CORE';

export const RULE_PACK_LIMITS = {
  /** 팩 하나의 규칙 수 상한 — 눈으로 감사할 수 있는 범위. */
  maxRules: 200,
  /** 조건식 중첩 깊이 상한. */
  maxConditionDepth: 8,
  /** 조건식 노드 수 상한 (팩 하나 기준, 규칙당). */
  maxConditionNodes: 200,
  /** and/or의 자식 수 상한. */
  maxChildren: 16,
  maxDetailLength: 500,
  maxNameLength: 80,
  maxDescriptionLength: 500,
} as const;

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const PLACEHOLDER_PATTERN = /\{([A-Za-z0-9_]+)\}/g;
const COMPARISON_OPS: readonly RuleComparisonOp[] = ['lt', 'lte', 'gt', 'gte', 'eq', 'ne'];

// ── 검증 (fail-closed) ────────────────────────────────────────────────

export interface RulePackValidation {
  ok: boolean;
  errors: string[];
  /** ok일 때만 채워진다. 검증을 통과한 정규화 사본. */
  pack?: RulePack;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkExtraKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string, errors: string[]): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      errors.push(`${where}: 알 수 없는 항목 "${key}". 규칙 팩은 정해진 항목만 가질 수 있습니다.`);
    }
  }
}

function validateCondition(
  value: unknown,
  scope: RuleScope,
  where: string,
  errors: string[],
  depth: number,
  counter: { nodes: number },
): void {
  counter.nodes += 1;
  if (counter.nodes > RULE_PACK_LIMITS.maxConditionNodes) {
    if (counter.nodes === RULE_PACK_LIMITS.maxConditionNodes + 1) {
      errors.push(`${where}: 조건식이 너무 큽니다 (노드 ${RULE_PACK_LIMITS.maxConditionNodes}개 초과).`);
    }
    return;
  }
  if (depth > RULE_PACK_LIMITS.maxConditionDepth) {
    errors.push(`${where}: 조건식 중첩이 너무 깊습니다 (${RULE_PACK_LIMITS.maxConditionDepth}단 초과).`);
    return;
  }
  if (!isPlainObject(value)) {
    errors.push(`${where}: 조건은 객체여야 합니다.`);
    return;
  }
  const op = value['op'];
  if (typeof op !== 'string') {
    errors.push(`${where}: op가 없습니다.`);
    return;
  }

  if (op === 'and' || op === 'or') {
    checkExtraKeys(value, ['op', 'of'], where, errors);
    const of = value['of'];
    if (!Array.isArray(of) || of.length === 0) {
      errors.push(`${where}: ${op}의 of는 비어 있지 않은 배열이어야 합니다.`);
      return;
    }
    if (of.length > RULE_PACK_LIMITS.maxChildren) {
      errors.push(`${where}: ${op}의 자식이 너무 많습니다 (${RULE_PACK_LIMITS.maxChildren}개 초과).`);
      return;
    }
    of.forEach((child, i) => validateCondition(child, scope, `${where}.of[${i}]`, errors, depth + 1, counter));
    return;
  }

  if (op === 'not') {
    checkExtraKeys(value, ['op', 'of'], where, errors);
    const of = value['of'];
    if (Array.isArray(of)) {
      errors.push(`${where}: not의 of는 조건 하나여야 합니다 (배열이 아닙니다).`);
      return;
    }
    validateCondition(of, scope, `${where}.of`, errors, depth + 1, counter);
    return;
  }

  if (op === 'between') {
    checkExtraKeys(value, ['op', 'field', 'min', 'max'], where, errors);
    validateField(value['field'], scope, where, errors);
    const min = value['min'];
    const max = value['max'];
    if (typeof min !== 'number' || !Number.isFinite(min)) errors.push(`${where}: min은 유한한 숫자여야 합니다.`);
    if (typeof max !== 'number' || !Number.isFinite(max)) errors.push(`${where}: max는 유한한 숫자여야 합니다.`);
    if (typeof min === 'number' && typeof max === 'number' && min > max) {
      errors.push(`${where}: min(${min})이 max(${max})보다 큽니다.`);
    }
    return;
  }

  if ((COMPARISON_OPS as readonly string[]).includes(op)) {
    checkExtraKeys(value, ['op', 'field', 'value'], where, errors);
    validateField(value['field'], scope, where, errors);
    const v = value['value'];
    if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`${where}: value는 유한한 숫자여야 합니다.`);
    return;
  }

  errors.push(
    `${where}: 알 수 없는 연산자 "${op}". 쓸 수 있는 것: ${[...COMPARISON_OPS, 'between', 'and', 'or', 'not'].join(', ')}.`,
  );
}

function validateField(field: unknown, scope: RuleScope, where: string, errors: string[]): void {
  if (typeof field !== 'string') {
    errors.push(`${where}: field는 문자열이어야 합니다.`);
    return;
  }
  if (!metricFieldsFor(scope).includes(field)) {
    errors.push(
      `${where}: "${field}"는 ${scope} 범위에서 볼 수 없는 지표입니다. ` +
        `쓸 수 있는 것: ${metricFieldsFor(scope).join(', ')}.`,
    );
  }
}

function validateDetail(detail: unknown, scope: RuleScope, where: string, errors: string[]): void {
  if (typeof detail !== 'string' || detail.trim().length === 0) {
    errors.push(`${where}: detail(사람이 읽는 설명)이 없습니다.`);
    return;
  }
  if (detail.length > RULE_PACK_LIMITS.maxDetailLength) {
    errors.push(`${where}: detail이 너무 깁니다 (${RULE_PACK_LIMITS.maxDetailLength}자 초과).`);
  }
  for (const m of detail.matchAll(PLACEHOLDER_PATTERN)) {
    const name = m[1]!;
    if (!metricFieldsFor(scope).includes(name)) {
      errors.push(`${where}: detail의 {${name}}는 ${scope} 범위에서 볼 수 없는 지표입니다.`);
    }
  }
}

/**
 * 규칙 팩 검증 — **사람이 팩을 받았을 때 열어보기 전에 안전한지 확인하는 문**이다.
 *
 * 문자열(JSON)도 받고 이미 파싱된 객체도 받는다. 모르는 연산자·지표·항목이 하나라도
 * 있으면 실패한다(fail-closed) — "모르는 건 일단 통과"는 감지기에서 가장 위험한 습관이다.
 */
export function validateRulePack(input: unknown): RulePackValidation {
  const errors: string[] = [];

  let raw: unknown = input;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { ok: false, errors: ['JSON을 읽을 수 없습니다.'] };
    }
  }
  if (!isPlainObject(raw)) return { ok: false, errors: ['규칙 팩은 객체(JSON)여야 합니다.'] };

  checkExtraKeys(raw, ['v', 'id', 'name', 'author', 'description', 'rules'], '팩', errors);

  if (raw['v'] !== 1) errors.push('팩: v는 1이어야 합니다 (지원하지 않는 버전).');

  const id = raw['id'];
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    errors.push('팩: id는 소문자·숫자·(.-_)로 된 2~64자여야 합니다.');
  } else if (id.toUpperCase() === CORE_SOURCE) {
    errors.push(`팩: id "${id}"는 예약어입니다 (코어 검사의 이름). 다른 id를 쓰십시오.`);
  }

  const name = raw['name'];
  if (typeof name !== 'string' || name.trim().length === 0) errors.push('팩: name이 없습니다.');
  else if (name.length > RULE_PACK_LIMITS.maxNameLength) errors.push('팩: name이 너무 깁니다.');

  const author = raw['author'];
  if (author !== undefined && (typeof author !== 'string' || author.length > RULE_PACK_LIMITS.maxNameLength)) {
    errors.push('팩: author는 짧은 문자열이어야 합니다.');
  }
  const description = raw['description'];
  if (
    description !== undefined &&
    (typeof description !== 'string' || description.length > RULE_PACK_LIMITS.maxDescriptionLength)
  ) {
    errors.push('팩: description은 짧은 문자열이어야 합니다.');
  }

  const rules = raw['rules'];
  if (!Array.isArray(rules) || rules.length === 0) {
    errors.push('팩: rules는 비어 있지 않은 배열이어야 합니다.');
  } else if (rules.length > RULE_PACK_LIMITS.maxRules) {
    errors.push(`팩: 규칙이 너무 많습니다 (${RULE_PACK_LIMITS.maxRules}개 초과).`);
  } else {
    const seen = new Set<string>();
    rules.forEach((rule, i) => {
      const where = `규칙[${i}]`;
      if (!isPlainObject(rule)) {
        errors.push(`${where}: 객체여야 합니다.`);
        return;
      }
      checkExtraKeys(rule, ['id', 'scope', 'severity', 'when', 'detail'], where, errors);

      const rid = rule['id'];
      if (typeof rid !== 'string' || !ID_PATTERN.test(rid)) {
        errors.push(`${where}: id는 소문자·숫자·(.-_)로 된 2~64자여야 합니다.`);
      } else if (seen.has(rid)) {
        errors.push(`${where}: id "${rid}"가 중복됩니다.`);
      } else {
        seen.add(rid);
      }

      const scope = rule['scope'];
      if (scope !== 'proof' && scope !== 'member') {
        errors.push(`${where}: scope는 'proof' 또는 'member'여야 합니다.`);
        return; // 스코프를 모르면 field·detail을 검증할 수 없다
      }

      const severity = rule['severity'];
      if (severity !== 'FATAL' && severity !== 'SIGNAL') {
        errors.push(`${where}: severity는 'FATAL' 또는 'SIGNAL'이어야 합니다.`);
      }

      validateDetail(rule['detail'], scope, where, errors);
      validateCondition(rule['when'], scope, `${where}.when`, errors, 1, { nodes: 0 });
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, errors: [], pack: normalize(raw) };
}

/** 검증을 통과한 값만 들어온다 — 알려진 항목만 복사한다(불필요한 필드 반입 차단). */
function normalize(raw: Record<string, unknown>): RulePack {
  const rules = (raw['rules'] as Record<string, unknown>[]).map((r) => ({
    id: r['id'] as string,
    scope: r['scope'] as RuleScope,
    severity: r['severity'] as 'FATAL' | 'SIGNAL',
    when: r['when'] as RuleCondition,
    detail: r['detail'] as string,
  }));
  const author = raw['author'];
  const description = raw['description'];
  return {
    v: 1,
    id: raw['id'] as string,
    name: raw['name'] as string,
    ...(typeof author === 'string' ? { author } : {}),
    ...(typeof description === 'string' ? { description } : {}),
    rules,
  };
}

/** 여러 팩을 한 번에 검증한다. 실패한 팩은 버리고 이유만 남긴다 — 나머지는 계속 쓴다. */
export function validateRulePacks(inputs: readonly unknown[]): { packs: RulePack[]; errors: string[] } {
  const packs: RulePack[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  inputs.forEach((input, i) => {
    const result = validateRulePack(input);
    if (!result.ok || !result.pack) {
      errors.push(`팩 #${i + 1} 로드 실패: ${result.errors.join(' / ')}`);
      return;
    }
    if (seen.has(result.pack.id)) {
      errors.push(`팩 #${i + 1} 로드 실패: id "${result.pack.id}"가 중복됩니다.`);
      return;
    }
    seen.add(result.pack.id);
    packs.push(result.pack);
  });
  return { packs, errors };
}

// ── 지표 계산 ─────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** 일자별 내역을 날짜로 합산한다 — 같은 날짜가 여러 줄로 쪼개져 있어도 하루는 하루다. */
export function sumByDate(breakdown: readonly { date: string; amountDshv: number }[]): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const day of breakdown) {
    byDate.set(day.date, (byDate.get(day.date) ?? 0) + day.amountDshv);
  }
  return byDate;
}

/** 증명 한 건의 파생 지표. 계산할 수 없는 값은 키 자체를 넣지 않는다. */
export function proofMetrics(proof: WalkSegmentProof, now: number): RuleMetrics {
  const durationMs = proof.settledAt - proof.startedAt;
  const m: Record<string, number> = {
    distanceM: proof.distanceM,
    stepCount: proof.stepCount,
    durationMs,
    amountDshv: proof.amountDshv,
    breakdownDays: proof.dailyBreakdown.length,
    courseCount: proof.courseIds.length,
    maxDayDshv: Math.max(0, ...sumByDate(proof.dailyBreakdown).values()),
  };
  if (Number.isFinite(durationMs)) {
    m['spanDays'] = durationMs / DAY_MS;
    if (durationMs > 0) {
      m['speedKmh'] = (proof.distanceM / (durationMs / 1000)) * 3.6;
      if (proof.stepCount > 0) m['cadenceSpm'] = proof.stepCount / (durationMs / 60_000);
    }
  }
  if (proof.stepCount > 0) m['strideM'] = proof.distanceM / proof.stepCount;
  if (proof.distanceM > 0) m['dshvPerKm'] = proof.amountDshv / (proof.distanceM / 1000);
  if (Number.isFinite(proof.settledAt)) m['ageDays'] = (now - proof.settledAt) / DAY_MS;
  return m;
}

/** 한 회원의 증명 묶음에 대한 파생 지표. */
export function memberMetrics(proofs: readonly WalkSegmentProof[]): RuleMetrics {
  const sorted = [...proofs].sort((a, b) => a.startedAt - b.startedAt);
  const first = sorted[0];
  const m: Record<string, number> = {
    proofCount: sorted.length,
    totalDistanceM: sorted.reduce((s, p) => s + p.distanceM, 0),
    totalStepCount: sorted.reduce((s, p) => s + p.stepCount, 0),
    dshvTotal: sorted.reduce((s, p) => s + p.amountDshv, 0),
    maxProofDshv: sorted.reduce((s, p) => Math.max(s, p.amountDshv), 0),
    deviceCount: new Set(sorted.map((p) => p.devicePublicKey)).size,
  };
  if (first) {
    const spanMs = sorted.reduce((s, p) => Math.max(s, p.settledAt), first.settledAt) - first.startedAt;
    m['spanMs'] = spanMs;
    m['spanDays'] = spanMs / DAY_MS;
    if (spanMs > 0) m['dshvPerDay'] = m['dshvTotal']! / (spanMs / DAY_MS);
  }
  if (sorted.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i]!.startedAt - sorted[i - 1]!.startedAt);
    gaps.sort((a, b) => a - b);
    m['minGapMs'] = gaps[0]!;
    const mid = Math.floor(gaps.length / 2);
    m['medianGapMs'] = gaps.length % 2 === 1 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
  }
  return m;
}

// ── 조건식 평가 (3값 논리) ────────────────────────────────────────────

/**
 * true / false / undefined("판단 불가")의 3값 논리다.
 *
 * 왜 3값인가: 계산할 수 없는 지표(걸음 0인 자전거 코인의 보폭 등)를 0으로 채우면
 * `strideM lt 0.5` 같은 규칙이 자전거 이용자를 몽땅 지목한다. undefined를 그냥
 * false로 접으면 이번에는 `not(...)`이 그것을 true로 뒤집어 같은 오탐이 난다.
 * 그래서 "모르는 것은 끝까지 모르는 것"으로 전파시키고, **규칙은 true일 때만 발동**한다.
 */
export function evaluateCondition(cond: RuleCondition, metrics: RuleMetrics): boolean | undefined {
  switch (cond.op) {
    case 'and': {
      let unknown = false;
      for (const child of cond.of) {
        const r = evaluateCondition(child, metrics);
        if (r === false) return false;
        if (r === undefined) unknown = true;
      }
      return unknown ? undefined : true;
    }
    case 'or': {
      let unknown = false;
      for (const child of cond.of) {
        const r = evaluateCondition(child, metrics);
        if (r === true) return true;
        if (r === undefined) unknown = true;
      }
      return unknown ? undefined : false;
    }
    case 'not': {
      const r = evaluateCondition(cond.of, metrics);
      return r === undefined ? undefined : !r;
    }
    case 'between': {
      const v = metrics[cond.field];
      if (v === undefined) return undefined;
      return v >= cond.min && v <= cond.max;
    }
    default: {
      const v = metrics[cond.field];
      if (v === undefined) return undefined;
      switch (cond.op) {
        case 'lt':
          return v < cond.value;
        case 'lte':
          return v <= cond.value;
        case 'gt':
          return v > cond.value;
        case 'gte':
          return v >= cond.value;
        case 'eq':
          return v === cond.value;
        case 'ne':
          return v !== cond.value;
      }
    }
  }
}

function formatMetric(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return '(알 수 없음)';
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}

/** detail 템플릿의 `{지표}`를 실제 값으로 채운다. */
export function renderDetail(template: string, metrics: RuleMetrics): string {
  return template.replace(PLACEHOLDER_PATTERN, (_, name: string) => formatMetric(metrics[name]));
}

// ── 적용 ──────────────────────────────────────────────────────────────

export interface RulePackFinding {
  packId: string;
  packName: string;
  ruleId: string;
  scope: RuleScope;
  severity: 'FATAL' | 'SIGNAL';
  detail: string;
  proofHashes: string[];
}

/** 팩이 볼 대상 — 코어가 이미 dedup·정규화해 넘겨준다. */
export interface RulePackTarget {
  hash: string;
  proof: WalkSegmentProof;
}

/**
 * 팩을 적용해 **추가** 발견만 만든다.
 *
 * 이 함수는 코어 발견을 인자로 받지 않는다 — 받을 수 없으므로 지울 수도 없다.
 * 팩이 코어를 약화시킬 수 없다는 보장이 여기서 구조적으로 성립한다.
 */
export function applyRulePacks(
  packs: readonly RulePack[],
  targets: readonly RulePackTarget[],
  options: { now: number },
): RulePackFinding[] {
  const out: RulePackFinding[] = [];
  if (packs.length === 0 || targets.length === 0) return out;

  const proofScope = targets.map((t) => ({ target: t, metrics: proofMetrics(t.proof, options.now) }));

  const byMember = new Map<string, RulePackTarget[]>();
  for (const t of targets) {
    const list = byMember.get(t.proof.memberId) ?? [];
    list.push(t);
    byMember.set(t.proof.memberId, list);
  }
  const memberScope = [...byMember.entries()].map(([memberId, list]) => ({
    memberId,
    hashes: list.map((t) => t.hash),
    metrics: memberMetrics(list.map((t) => t.proof)),
  }));

  for (const pack of packs) {
    for (const rule of pack.rules) {
      if (rule.scope === 'proof') {
        for (const { target, metrics } of proofScope) {
          if (evaluateCondition(rule.when, metrics) !== true) continue;
          out.push({
            packId: pack.id,
            packName: pack.name,
            ruleId: rule.id,
            scope: 'proof',
            severity: rule.severity,
            detail: renderDetail(rule.detail, metrics),
            proofHashes: [target.hash],
          });
        }
      } else {
        for (const group of memberScope) {
          if (evaluateCondition(rule.when, group.metrics) !== true) continue;
          out.push({
            packId: pack.id,
            packName: pack.name,
            ruleId: rule.id,
            scope: 'member',
            severity: rule.severity,
            detail: `회원 ${group.memberId}: ${renderDetail(rule.detail, group.metrics)}`,
            proofHashes: group.hashes,
          });
        }
      }
    }
  }
  return out;
}
