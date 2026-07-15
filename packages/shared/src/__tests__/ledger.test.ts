import { describe, expect, it } from 'vitest';
import { PendingWalkLedger } from '../ledger';
import { T0, makeSample, walkKm } from './helpers';

const MEMBER = 'member-0001';
const DAY_MS = 86_400_000;

function newLedger() {
  return new PendingWalkLedger({ memberId: MEMBER });
}

describe('잠정 누적과 정산 (지시서 0-6, 2.2)', () => {
  it('사용(지불) 시 정산: 구간이 확정되고 새 구간이 시작된다', () => {
    const ledger = newLedger();
    const end = walkKm(ledger, 12.3);
    expect(ledger.getPending().pendingDshvEstimate).toBe(123);

    const draft = ledger.settleOnSpend(end);
    expect(draft).not.toBeNull();
    expect(draft!.amountDshv).toBe(123);
    expect(draft!.settlement).toBe('SPEND');
    expect(draft!.courseIds).toEqual(['shvil-israel']);
    expect(draft!.dailyBreakdown).toEqual([{ date: '2026-07-01', amountDshv: 123 }]);

    // 정산 후 새 구간 — 잠정 누적은 0에서 다시 시작
    expect(ledger.getPending().pendingDshvEstimate).toBe(0);
    expect(ledger.getPending().startedAt).toBeNull();
  });

  it('수동 정산("여기서 정산")도 동일하게 확정한다', () => {
    const ledger = newLedger();
    const end = walkKm(ledger, 5);
    const draft = ledger.settleManual(end);
    expect(draft!.amountDshv).toBe(50);
    expect(draft!.settlement).toBe('MANUAL');
  });

  it('자동 정산 부재: 며칠을 걸어도 정산 호출 없이는 아무것도 만들어지지 않는다', () => {
    const ledger = newLedger();
    for (let day = 0; day < 5; day++) walkKm(ledger, 10, {}, T0 + day * DAY_MS);

    // 잠정 누적만 쌓일 뿐 — getPending은 조회일 뿐 코인을 만들지 않는다
    const before = ledger.getPending();
    expect(before.pendingDshvEstimate).toBe(500);
    expect(ledger.getPending()).toEqual(before);

    // 명시적 정산 API 외에 확정 경로가 없다 (자동 생성·자동 정산 없음)
    const publicApi = Object.getOwnPropertyNames(Object.getPrototypeOf(ledger)).filter(
      (m) => !m.startsWith('_') && m !== 'constructor',
    );
    expect(publicApi.sort()).toEqual(
      ['dateOf', 'getMintedHistory', 'getPending', 'getState', 'recordSample', 'settleManual', 'settleOnSpend'].sort(),
    );
  });

  it('시작만 있고 생성이 없으면 정산해도 아무것도 만들어지지 않는다', () => {
    const ledger = newLedger();
    // 휴식 창만 기록 (거리 기여 0)
    ledger.recordSample(makeSample({ distanceM: 3, steps: 5 }));
    expect(ledger.settleManual(T0 + 3_600_000)).toBeNull();
  });

  it('멀티데이 잠정 누적: 일자별 내역이 남고 총액은 합계다', () => {
    const ledger = newLedger();
    let end = T0;
    for (let day = 0; day < 3; day++) end = walkKm(ledger, 10, {}, T0 + day * DAY_MS);
    const draft = ledger.settleOnSpend(end);
    expect(draft!.amountDshv).toBe(300);
    expect(draft!.dailyBreakdown).toEqual([
      { date: '2026-07-01', amountDshv: 100 },
      { date: '2026-07-02', amountDshv: 100 },
      { date: '2026-07-03', amountDshv: 100 },
    ]);
  });
});

describe('일일 상한 40 SHV (확정 파라미터)', () => {
  it('하루 50km를 걸어도 400 dSHV까지만 확정된다', () => {
    const ledger = newLedger();
    const end = walkKm(ledger, 50);
    const draft = ledger.settleOnSpend(end);
    expect(draft!.amountDshv).toBe(400);
    expect(draft!.dailyBreakdown).toEqual([{ date: '2026-07-01', amountDshv: 400 }]);
  });

  it('같은 날 정산을 나눠도 상한을 우회할 수 없다', () => {
    const ledger = newLedger();
    let end = walkKm(ledger, 30);
    expect(ledger.settleOnSpend(end)!.amountDshv).toBe(300);

    end = walkKm(ledger, 20, {}, end);
    expect(ledger.settleOnSpend(end)!.amountDshv).toBe(100); // 300 + 100 = 400 상한
  });

  it('난이도 계수 적용 후 총액 기준으로 상한이 걸린다 (×2.5, 8km = 20 SHV)', () => {
    const ledger = newLedger();
    const end = walkKm(ledger, 8, { difficultyTenths: 25 });
    expect(ledger.settleOnSpend(end)!.amountDshv).toBe(200);
  });

  it('잠정 누적 상태는 스냅숏으로 저장·복원된다 (앱 재시작 대비, 좌표 없음)', () => {
    const ledger = newLedger();
    let end = walkKm(ledger, 7);
    end = walkKm(ledger, 2, { tier: 'ANGEL_DETOUR', detourAngelMemberId: 'angel-77', courseId: undefined }, end);

    const state = ledger.getState();
    expect(JSON.stringify(state)).not.toMatch(/lat|lon|coord/i);

    const restored = PendingWalkLedger.fromState({ memberId: MEMBER }, state);
    expect(restored.getPending()).toEqual(ledger.getPending());
    expect(restored.settleOnSpend(end, 'angel-77')!.amountDshv).toBe(90); // 70 + 20 우회 확정
  });

  it('발행 이력은 영속화·복원 가능 (재시작 후에도 상한 유지)', () => {
    const ledger = newLedger();
    const end = walkKm(ledger, 30);
    ledger.settleOnSpend(end);

    const restored = new PendingWalkLedger({ memberId: MEMBER }, ledger.getMintedHistory());
    const end2 = walkKm(restored, 20, {}, end);
    expect(restored.settleOnSpend(end2)!.amountDshv).toBe(100);
  });
});

describe('자전거 모드 원장 통합 (M11 · T-2)', () => {
  it('자전거 코스 위 20km = 10 SHV (도보 20km=20 SHV의 절반)', () => {
    const ledger = newLedger();
    const end = walkKm(ledger, 20, { mode: 'BIKE', steps: 0 });
    expect(ledger.settleOnSpend(end)!.amountDshv).toBe(100); // 10 SHV
  });

  it('도보+자전거 발행은 같은 날 하나의 40 SHV 상한에 합산된다 (따로 벌 수 없다)', () => {
    const ledger = newLedger();
    // 같은 날: 도보 30km(=30 SHV=300 dSHV) + 자전거 30km(=15 SHV=150 dSHV) → 후보 450
    let end = walkKm(ledger, 30);
    end = walkKm(ledger, 30, { mode: 'BIKE', steps: 0 }, end);
    // 만약 수단별로 따로 상한이 걸린다면 300+150=450이 되겠지만, 합산 상한이므로 400.
    const draft = ledger.settleOnSpend(end);
    expect(draft!.amountDshv).toBe(400);
    expect(draft!.dailyBreakdown).toEqual([{ date: '2026-07-01', amountDshv: 400 }]);
  });

  it('세션 중 도보→자전거 전환: 이미 누적된 도보분은 유지, 이후 창만 자전거 요율', () => {
    const ledger = newLedger();
    // 도보 10km(=10 SHV) 후 자전거 10km(=5 SHV) — 전환은 이후 창부터
    let end = walkKm(ledger, 10);
    end = walkKm(ledger, 10, { mode: 'BIKE', steps: 0 }, end);
    expect(ledger.settleManual(end)!.amountDshv).toBe(150); // 100 + 50
  });

  it('자전거는 걸음 0으로도 거리 기반 누적된다 (만보기 없이)', () => {
    const ledger = newLedger();
    const end = walkKm(ledger, 12, { mode: 'BIKE', steps: 0 });
    expect(ledger.getPending().pendingDshvEstimate).toBe(60); // 12km × 0.5 = 6 SHV
    expect(ledger.getPending().stepCount).toBe(0);
    expect(end).toBeGreaterThan(0);
  });
});

describe('3단계 요율 통합 (원장 경유)', () => {
  it('코스 이탈 걸음은 일상과 동일 미세 요율(1/1,000)로 누적된다 (T-1 확정)', () => {
    const ledger = newLedger();
    let end = T0;
    // 10일 × 10km 이탈 걸음 = 100km → 0.1 SHV (일상 걸음과 같은 결과)
    for (let day = 0; day < 10; day++) end = walkKm(ledger, 10, { tier: 'OFF_COURSE' }, T0 + day * DAY_MS);
    expect(ledger.settleManual(end)!.amountDshv).toBe(1);
  });

  it('일상 걸음은 미세 요율(1/1,000)로만 누적된다', () => {
    const ledger = newLedger();
    let end = T0;
    // 10일 × 10km 일상 걸음 = 100km → 0.1 SHV
    for (let day = 0; day < 10; day++) end = walkKm(ledger, 10, { tier: 'DAILY_LIFE' }, T0 + day * DAY_MS);
    const draft = ledger.settleManual(end);
    expect(draft!.amountDshv).toBe(1);
  });
});

describe('엔젤 우회 (잠정 → 사용 시 확정)', () => {
  const detour = { tier: 'ANGEL_DETOUR' as const, detourAngelMemberId: 'angel-77', courseId: undefined };

  it('우회분은 그 엔젤에게 지불하는 정산에서만 확정된다', () => {
    const ledger = newLedger();
    let end = walkKm(ledger, 5);
    end = walkKm(ledger, 2, detour, end);
    expect(ledger.getPending().detourPendingByAngel['angel-77']).toBe(20);

    const draft = ledger.settleOnSpend(end, 'angel-77');
    expect(draft!.amountDshv).toBe(70); // 50 (코스) + 20 (우회 확정)
  });

  it('다른 엔젤에게 지불하면 우회분은 소멸한다', () => {
    const ledger = newLedger();
    let end = walkKm(ledger, 5);
    end = walkKm(ledger, 2, detour, end);
    expect(ledger.settleOnSpend(end, 'angel-99')!.amountDshv).toBe(50);
  });

  it('수동 정산으로도 우회분은 확정되지 않는다', () => {
    const ledger = newLedger();
    let end = walkKm(ledger, 5);
    end = walkKm(ledger, 2, detour, end);
    expect(ledger.settleManual(end)!.amountDshv).toBe(50);
  });

  it('우회 인정 한도(편도 5km 제안)를 넘는 거리는 잠정 카운트되지 않는다', () => {
    const ledger = newLedger();
    const end = walkKm(ledger, 8, detour);
    expect(ledger.settleOnSpend(end, 'angel-77')!.amountDshv).toBe(50); // 8km 중 5km만
  });

  it('목적지 엔젤 없는 우회 샘플은 코스 이탈 요율(=일상 1/1,000)로 강등된다', () => {
    const ledger = newLedger();
    const end = walkKm(ledger, 10, { tier: 'ANGEL_DETOUR', courseId: undefined });
    // 10km × 1/1,000 = 0.01 SHV → 0.1 SHV 단위 내림 = 0 → 정산 대상 없음 (T-1: 이탈 = 일상)
    expect(ledger.settleManual(end)).toBeNull();
  });
});
