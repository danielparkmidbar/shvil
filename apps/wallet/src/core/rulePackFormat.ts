/**
 * 규칙 팩을 **사람이 읽을 수 있게** 만드는 곳 (M16 배선 — 2026-07-27).
 *
 * `packages/shared/src/rulePack.ts`의 해석기는 완성돼 있었지만 지갑 어디서도 참조하지
 * 않았다. 수령 경로가 팩의 존재를 몰랐다는 뜻이다.
 *
 * ── 왜 "읽히는 것"이 기능인가 ────────────────────────────────────────
 * 팩은 코드가 아니라 데이터다(eval·Function·동적 import 없음). 그래서 악성 팩이 할 수
 * 있는 최악은 억울한 지목뿐이고, 위조를 진짜로 보이게 만들 수는 **구조적으로** 없다.
 * 그 안전성의 대가로 팩은 표현력이 좁고, 좁은 대신 **눈으로 감사할 수 있어야** 한다.
 * 남이 준 JSON을 그대로 켜면서 그 안이 무슨 뜻인지 모른다면 안전 설계의 절반이 죽는다.
 *
 * 그래서 이 파일은 조건식 DSL을 한국어 문장으로 되돌린다. 지표 이름은 단위까지 붙는다
 * ("spanDays"가 아니라 "걷기 구간 길이(일)"). 화면은 이 문장을 그대로 띄운다.
 *
 * 순수 TS다 — expo 모듈 import 금지 (vitest 대상). 저장은 rulePackStore.ts가 한다.
 */
import {
  MEMBER_METRIC_FIELDS,
  PROOF_METRIC_FIELDS,
  validateRulePack,
  validateRulePacks,
  type RuleCondition,
  type RulePack,
  type RulePackRule,
  type RuleScope,
} from '@shvil/shared';

/** 지표 이름 → 사람이 읽는 이름(단위 포함). 화이트리스트와 1:1이어야 한다. */
export const METRIC_LABELS: Record<string, string> = {
  // proof
  distanceM: '인정 거리(m)',
  stepCount: '걸음 수',
  durationMs: '걷기 창 길이(ms)',
  spanDays: '걷기 구간 길이(일)',
  amountDshv: '발행액(dSHV)',
  strideM: '보폭(m)',
  speedKmh: '평균 속도(km/h)',
  cadenceSpm: '분당 걸음 수',
  dshvPerKm: '1 km당 발행액(dSHV)',
  breakdownDays: '일자별 내역 줄 수',
  maxDayDshv: '하루 최대 발행액(dSHV)',
  courseCount: '걸은 코스 개수',
  ageDays: '정산 후 지난 날 수',
  // member
  proofCount: '증명 개수',
  totalDistanceM: '거리 합(m)',
  totalStepCount: '걸음 합',
  dshvTotal: '발행액 합(dSHV)',
  spanMs: '첫 시작~마지막 정산(ms)',
  minGapMs: '정산 사이 최소 간격(ms)',
  medianGapMs: '정산 사이 중앙값 간격(ms)',
  dshvPerDay: '하루 평균 발행액(dSHV)',
  maxProofDshv: '가장 큰 증명 한 건(dSHV)',
  deviceCount: '기기 키 개수',
};

export function metricLabel(field: string): string {
  return METRIC_LABELS[field] ?? field;
}

const OP_TEXT: Record<string, string> = {
  lt: '보다 작다',
  lte: '이하다',
  gt: '보다 크다',
  gte: '이상이다',
  eq: '와 같다',
  ne: '와 다르다',
};

/** 조건식 하나를 한국어 문장으로. 중첩은 괄호로 묶는다. */
export function explainCondition(cond: RuleCondition): string {
  switch (cond.op) {
    case 'and':
      return cond.of.map(explainCondition).join(' 그리고 ');
    case 'or':
      return `(${cond.of.map(explainCondition).join(' 또는 ')})`;
    case 'not':
      return `(${explainCondition(cond.of)})가 아니다`;
    case 'between':
      return `${metricLabel(cond.field)}가 ${fmtNum(cond.min)}~${fmtNum(cond.max)} 사이다`;
    default:
      return `${metricLabel(cond.field)}가 ${fmtNum(cond.value)}${OP_TEXT[cond.op] ?? cond.op}`;
  }
}

function fmtNum(v: number): string {
  return Number.isInteger(v) ? v.toLocaleString() : String(v);
}

export function scopeLabel(scope: RuleScope): string {
  return scope === 'proof' ? '코인 한 장' : '한 회원의 코인 묶음';
}

/** 팩의 severity는 코어의 그것과 뜻이 다르다 — 화면 문구도 달라야 한다. */
export function severityLabel(severity: RulePackRule['severity']): string {
  return severity === 'FATAL' ? '받지 않겠다' : '물어보겠다';
}

export interface ExplainedRule {
  id: string;
  scopeText: string;
  severity: RulePackRule['severity'];
  severityText: string;
  /** "이럴 때 걸린다" — 조건식의 한국어 번역. */
  whenText: string;
  /** 팩 작성자가 적어 둔 설명 (지표 자리표시자는 실제 값으로 채워지기 전 원본). */
  detail: string;
}

export interface ExplainedPack {
  id: string;
  name: string;
  author: string | null;
  description: string | null;
  ruleCount: number;
  rules: ExplainedRule[];
}

/** 검증을 통과한 팩을 화면이 그대로 그릴 수 있는 모양으로 편다. */
export function explainPack(pack: RulePack): ExplainedPack {
  return {
    id: pack.id,
    name: pack.name,
    author: pack.author ?? null,
    description: pack.description ?? null,
    ruleCount: pack.rules.length,
    rules: pack.rules.map((r) => ({
      id: r.id,
      scopeText: scopeLabel(r.scope),
      severity: r.severity,
      severityText: severityLabel(r.severity),
      whenText: explainCondition(r.when),
      detail: r.detail,
    })),
  };
}

/**
 * 팩이 볼 수 있는 지표 전부 — 화면의 "이 팩이 볼 수 있는 것" 안내에 쓴다.
 * 좌표·코스 이름·시각 원본은 여기에 없다. 없다는 것이 이 목록의 요점이다(제10조).
 */
export function visibleMetrics(): { scope: RuleScope; fields: { field: string; label: string }[] }[] {
  return [
    { scope: 'proof', fields: PROOF_METRIC_FIELDS.map((f) => ({ field: f, label: metricLabel(f) })) },
    { scope: 'member', fields: MEMBER_METRIC_FIELDS.map((f) => ({ field: f, label: metricLabel(f) })) },
  ];
}

export interface RulePackParseResult {
  ok: boolean;
  pack: RulePack | null;
  errors: string[];
}

/** 붙여넣은 텍스트 → 팩. fail-closed — 모르는 것이 하나라도 있으면 실패한다. */
export function parseRulePackText(text: string): RulePackParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, pack: null, errors: ['내용이 비어 있습니다.'] };
  const result = validateRulePack(trimmed);
  return { ok: result.ok, pack: result.pack ?? null, errors: result.errors };
}

/** 저장된 목록(JSON 문자열) → 팩 배열. 깨진 항목은 버리고 이유만 남긴다. */
export function parseStoredPacks(json: string | null): { packs: RulePack[]; errors: string[] } {
  if (!json) return { packs: [], errors: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { packs: [], errors: ['저장된 규칙 팩 목록을 읽을 수 없습니다 (JSON 손상).'] };
  }
  if (!Array.isArray(raw)) return { packs: [], errors: ['저장된 규칙 팩 목록의 형식이 올바르지 않습니다.'] };
  return validateRulePacks(raw);
}

export function serializePacks(packs: readonly RulePack[]): string {
  return JSON.stringify(packs);
}

/**
 * 팩 목록에 하나를 더한다. 같은 id는 **교체**한다 (같은 팩의 새 판을 받는 흔한 경우).
 * 반환은 새 목록 — 이 함수는 아무것도 저장하지 않는다(순수).
 */
export function upsertPack(packs: readonly RulePack[], pack: RulePack): RulePack[] {
  const others = packs.filter((p) => p.id !== pack.id);
  return [...others, pack];
}

export function removePack(packs: readonly RulePack[], packId: string): RulePack[] {
  return packs.filter((p) => p.id !== packId);
}
