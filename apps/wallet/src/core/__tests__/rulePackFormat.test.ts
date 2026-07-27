/**
 * 규칙 팩 배선 — **사람이 읽을 수 있어야 안전 설계가 완성된다.**
 *
 * 팩은 코드가 아니라 데이터라 다운로드가 코드 실행이 되지 않는다. 그 대가로 표현력이
 * 좁고, 좁은 대신 눈으로 감사할 수 있어야 한다. 남이 준 JSON을 켜면서 그 뜻을 모른다면
 * 안전 설계의 절반이 죽는다. 이 파일은 "번역이 실제로 된다"와 "모르는 것은 통과하지
 * 않는다"를 못박는다.
 */
import { describe, expect, it } from 'vitest';
import {
  EXAMPLE_RULE_PACKS,
  MEMBER_METRIC_FIELDS,
  PROOF_METRIC_FIELDS,
  type RulePack,
} from '@shvil/shared';
import {
  METRIC_LABELS,
  explainCondition,
  explainPack,
  metricLabel,
  parseRulePackText,
  parseStoredPacks,
  removePack,
  serializePacks,
  upsertPack,
  visibleMetrics,
} from '../rulePackFormat';

describe('팩이 무엇을 검사하는지 한국어로 읽힌다', () => {
  it('비교·범위·논리 조건이 전부 문장이 된다', () => {
    expect(explainCondition({ op: 'gt', field: 'spanDays', value: 14 })).toBe('걷기 구간 길이(일)가 14보다 크다');
    expect(explainCondition({ op: 'between', field: 'speedKmh', min: 2, max: 6 })).toBe(
      '평균 속도(km/h)가 2~6 사이다',
    );
    expect(
      explainCondition({
        op: 'and',
        of: [
          { op: 'gte', field: 'distanceM', value: 1000 },
          { op: 'gt', field: 'dshvPerKm', value: 20 },
        ],
      }),
    ).toBe('인정 거리(m)가 1,000이상이다 그리고 1 km당 발행액(dSHV)가 20보다 크다');
    expect(explainCondition({ op: 'not', of: { op: 'eq', field: 'stepCount', value: 0 } })).toBe(
      '(걸음 수가 0와 같다)가 아니다',
    );
  });

  it('★화이트리스트의 모든 지표에 사람이 읽는 이름이 있다 (하나라도 빠지면 팩이 안 읽힌다)', () => {
    const missing = [...PROOF_METRIC_FIELDS, ...MEMBER_METRIC_FIELDS].filter((f) => METRIC_LABELS[f] === undefined);
    expect(missing).toEqual([]);
    expect(metricLabel('알수없는지표')).toBe('알수없는지표'); // 모르는 이름은 그대로 보여 준다
  });

  it('본보기 팩 전부가 규칙 하나하나까지 번역된다', () => {
    for (const pack of EXAMPLE_RULE_PACKS) {
      const e = explainPack(pack);
      expect(e.ruleCount).toBe(pack.rules.length);
      for (const r of e.rules) {
        expect(r.whenText.length).toBeGreaterThan(0);
        // 지표 원본 이름이 문장에 그대로 남아 있으면 번역이 빠진 것이다.
        expect(r.whenText).not.toMatch(/\b(spanDays|dshvPerKm|minGapMs|deviceCount|stepCount)\b/);
        expect(['받지 않겠다', '물어보겠다']).toContain(r.severityText);
      }
    }
    const strict = explainPack(EXAMPLE_RULE_PACKS[0]!);
    console.log(`   "${strict.name}" 규칙 ${strict.ruleCount}개 중 3개:`);
    for (const r of strict.rules.slice(0, 3)) {
      console.log(`     [${r.severityText}] ${r.id} · ${r.scopeText} → ${r.whenText}`);
    }
  });

  it('팩이 볼 수 있는 것 목록에 좌표·코스 이름·시각 원본이 없다 (제10조)', () => {
    const all = visibleMetrics().flatMap((g) => g.fields.map((f) => f.field));
    expect(all).not.toContain('lat');
    expect(all).not.toContain('lon');
    expect(all).not.toContain('courseId');
    expect(all).not.toContain('startedAt');
    expect(all).toContain('courseCount'); // 개수는 보이지만 이름은 안 보인다
  });
});

describe('모르는 것은 통과시키지 않는다 (fail-closed)', () => {
  const base = {
    v: 1,
    id: 'test-pack',
    name: '테스트',
    rules: [
      { id: 'r1', scope: 'proof', severity: 'SIGNAL', detail: '거리 {distanceM}', when: { op: 'gt', field: 'distanceM', value: 100 } },
    ],
  };

  it('정상 팩은 읽힌다', () => {
    const r = parseRulePackText(JSON.stringify(base));
    expect(r.ok).toBe(true);
    expect(r.pack!.rules).toHaveLength(1);
  });

  it('화이트리스트 밖 지표는 로드 실패', () => {
    const bad = { ...base, rules: [{ ...base.rules[0]!, when: { op: 'gt', field: 'latitude', value: 1 } }] };
    const r = parseRulePackText(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('latitude');
  });

  it('없는 연산자는 로드 실패 — "무시"·"허용" 같은 완화 연산자는 DSL에 아예 없다', () => {
    for (const op of ['ignore', 'allow', 'skip', 'always']) {
      const bad = { ...base, rules: [{ ...base.rules[0]!, when: { op, field: 'distanceM', value: 1 } }] };
      expect(parseRulePackText(JSON.stringify(bad)).ok).toBe(false);
    }
  });

  it('예약어 id(CORE)는 팩이 쓸 수 없다 — 코어 검사를 사칭할 수 없다', () => {
    const r = parseRulePackText(JSON.stringify({ ...base, id: 'core' }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('예약어');
  });

  it('JSON이 아니거나 비어 있으면 실패', () => {
    expect(parseRulePackText('').ok).toBe(false);
    expect(parseRulePackText('그냥 텍스트').ok).toBe(false);
  });
});

describe('보관 — 저장·복원·교체·제거', () => {
  const a = EXAMPLE_RULE_PACKS[0]!;
  const b = EXAMPLE_RULE_PACKS[1]!;

  it('저장한 목록을 그대로 되읽는다', () => {
    const json = serializePacks([a, b]);
    const { packs, errors } = parseStoredPacks(json);
    expect(errors).toEqual([]);
    expect(packs.map((p) => p.id)).toEqual([a.id, b.id]);
  });

  it('같은 id는 새 판으로 교체된다 (중복이 쌓이지 않는다)', () => {
    const v2: RulePack = { ...a, name: '엄격 구매자 v2' };
    const next = upsertPack([a, b], v2);
    expect(next).toHaveLength(2);
    expect(next.find((p) => p.id === a.id)!.name).toBe('엄격 구매자 v2');
  });

  it('제거하면 사라진다', () => {
    expect(removePack([a, b], a.id).map((p) => p.id)).toEqual([b.id]);
  });

  it('저장소가 손상돼도 코어 검사를 막지 않는다 — 빈 목록 + 이유', () => {
    const r = parseStoredPacks('{깨진 JSON');
    expect(r.packs).toEqual([]);
    expect(r.errors).toHaveLength(1);
  });

  it('저장된 목록 안의 깨진 팩만 버리고 나머지는 살린다', () => {
    const json = JSON.stringify([a, { v: 1, id: 'x', name: '깨짐' }, b]);
    const r = parseStoredPacks(json);
    expect(r.packs.map((p) => p.id)).toEqual([a.id, b.id]);
    expect(r.errors).toHaveLength(1);
  });
});
