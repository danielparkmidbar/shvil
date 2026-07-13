/**
 * H-1 사후 이상 탐지 테스트: 기회적 동기화 지문 대조로
 * 이중 사용(오프라인 분기)·초과 생성이 포착되어 소명 목록에 자동 등재되는지.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PendingWalkLedger,
  acceptPayment,
  buildCharge,
  buildPayment,
  buildWalkSegmentProof,
  coinFingerprint,
  mintWalkCoin,
  splitCoin,
  type Coin,
  type CoinFingerprint,
  type WalkSample,
} from '@shvil/shared';
import { buildApp } from '../src/app';
import { register, signedInject, type TestIdentity } from './utils';

const app = buildApp({ dbPath: ':memory:', devMode: true });
const T0 = Date.parse('2026-07-11T06:00:00Z');

let attacker: TestIdentity; // 이중 지불자
let bob: TestIdentity; // 수령자 1
let carol: TestIdentity; // 수령자 2
let prolific: TestIdentity; // 초과 생성자

/** 코스 위 정상 보행 걷기 코인 (같은 날 총량 지정). */
function mintWalk(id: TestIdentity, dshv: number, startAt: number): Coin {
  const ledger = new PendingWalkLedger({ memberId: id.memberId });
  let t = startAt;
  for (let i = 0; i < dshv; i++) {
    const sample: WalkSample = { durationS: 72, distanceM: 100, steps: 140, tier: 'ON_COURSE', timestamp: t, courseId: 'shvil-israel' };
    ledger.recordSample(sample);
    t += 72_000;
  }
  return mintWalkCoin(buildWalkSegmentProof(ledger.settleOnSpend(t)!, id.signer));
}

/** QR 왕복으로 코인을 수령자에게 지불 (로컬 완결). */
function payTo(coin: Coin, payer: TestIdentity, payee: TestIdentity, chargeId: string): Coin {
  const charge = buildCharge(
    { chargeId, angelMemberId: payee.memberId, amountDshv: coin.amountDshv, createdAt: Date.now() },
    payee.signer,
  );
  const payment = buildPayment(charge, [coin], payer.memberId, payer.signer, Date.now());
  return acceptPayment(charge, payment, payee.signer).coins[0]!;
}

async function submitFingerprints(who: TestIdentity, fps: CoinFingerprint[]) {
  return signedInject(app, who, 'POST', '/sync/coins', { fingerprints: fps });
}

async function flaggedIds(): Promise<string[]> {
  const res = (await app.inject({ method: 'GET', url: '/limits/flagged' })).json() as {
    members: { memberId: string }[];
  };
  return res.members.map((m) => m.memberId);
}

beforeAll(async () => {
  await app.ready();
  attacker = await register(app, '+1-100', 'a@x.io', '이중지불자');
  bob = await register(app, '+1-200', 'b@x.io', '밥');
  carol = await register(app, '+1-300', 'c@x.io', '캐롤');
  prolific = await register(app, '+1-400', 'p@x.io', '초과생성자');
});

afterAll(async () => {
  await app.close();
});

describe('이중 사용 사후 포착 (H-1 ①)', () => {
  it('정상 흐름: 단일 수령자의 지문 제출은 플래그를 만들지 않는다', async () => {
    const coin = mintWalk(attacker, 100, T0);
    const received = payTo(coin, attacker, bob, 'chg-normal');
    const res = await submitFingerprints(bob, [coinFingerprint(received)]);
    expect((res.json() as { accepted: number }).accepted).toBe(1);
    expect(await flaggedIds()).not.toContain(attacker.memberId);
  });

  it('오프라인 분기: 같은 코인을 두 수령자에게 지불 → 두 번째 지문 제출에서 이중 지불자 자동 등재', async () => {
    // 공격자가 오프라인에서 같은 코인(사본)을 밥과 캐롤에게 각각 지불
    const coin = mintWalk(attacker, 150, T0 + 86_400_000);
    const toBob = payTo(coin, attacker, bob, 'chg-fork-1');
    const toCarol = payTo(coin, attacker, carol, 'chg-fork-2');

    // 두 수령자가 각자 온라인이 되어 지문 제출 (기회적 동기화)
    await submitFingerprints(bob, [coinFingerprint(toBob)]);
    expect(await flaggedIds()).not.toContain(attacker.memberId); // 첫 목격만으로는 모름

    await submitFingerprints(carol, [coinFingerprint(toCarol)]);
    // 같은 (coinId, 체인 길이 1)에 서로 다른 소유자 → 분기점 지불자 = 공격자 등재
    expect(await flaggedIds()).toContain(attacker.memberId);
  });

  it('등재 사유가 이중 사용으로 공시된다 (익명 카운트)', async () => {
    const res = (await app.inject({ method: 'GET', url: '/transparency/anomalies' })).json() as {
      doubleSpendSuspects: number;
      pendingTotal: number;
    };
    expect(res.doubleSpendSuspects).toBeGreaterThanOrEqual(1);
    expect(res.pendingTotal).toBeGreaterThanOrEqual(1);
  });
});

describe('초과 생성 사후 포착 (H-1 ②)', () => {
  it('서로 다른 수령자에게 흩어진 같은 날 증명들의 합산이 일 상한을 넘으면 생산자 등재', async () => {
    // 초과생성자가 같은 날 300 + 300 dSHV 두 증명을 만들어 각각 밥·캐롤에게 지불.
    // (각 수령자의 로컬 인간 한계 검사는 자기 보유분만 보므로 개별로는 통과 —
    //  변조 원장 가정. 서버 합산 대조만이 잡을 수 있는 사각.)
    const day = T0 + 3 * 86_400_000;
    const c1 = mintWalk(prolific, 300, day);
    // 두 번째 증명: 같은 날이지만 다른 시간대 — 로컬 원장 없이 직접 두 번째 원장 사용
    const c2 = mintWalk(prolific, 300, day + 8 * 3600_000);

    const r1 = payTo(c1, prolific, bob, 'chg-over-1');
    const r2 = payTo(c2, prolific, carol, 'chg-over-2');

    await submitFingerprints(bob, [coinFingerprint(r1)]);
    expect(await flaggedIds()).not.toContain(prolific.memberId); // 300 ≤ 400

    await submitFingerprints(carol, [coinFingerprint(r2)]);
    // 합산 600 > 400 → 초과 생성 등재
    expect(await flaggedIds()).toContain(prolific.memberId);

    const res = (await app.inject({ method: 'GET', url: '/transparency/anomalies' })).json() as {
      overproductionSuspects: number;
    };
    expect(res.overproductionSuspects).toBeGreaterThanOrEqual(1);
  });

  it('분할 형제 지문은 같은 증명을 이중 계상하지 않는다', async () => {
    const honest = await register(app, '+1-500', 'h@x.io', '정직');
    const coin = mintWalk(honest, 350, T0 + 10 * 86_400_000); // 350 ≤ 400
    const [a, b] = splitCoin(coin, honest.signer, [200, 150], Date.now());
    // 두 자식이 각각 다른 경로로 신고돼도 proofHash dedup으로 350 한 번만 계상
    await submitFingerprints(bob, [coinFingerprint(a!)]);
    await submitFingerprints(carol, [coinFingerprint(b!)]);
    expect(await flaggedIds()).not.toContain(honest.memberId);
  });

  it('지문 제출은 서명 인증 필수', async () => {
    const res = await app.inject({ method: 'POST', url: '/sync/coins', payload: { fingerprints: [] } });
    expect(res.statusCode).toBe(401);
  });
});
