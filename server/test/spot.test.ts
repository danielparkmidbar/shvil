/**
 * 스팟 보물 (M12 — 몸인증_보물마이닝_설계 4장) — 엔드포인트 통합 테스트.
 *
 * 순수 함수 단위는 packages/shared/src/__tests__/spotTreasure.test.ts가 덮는다.
 * 여기서는 서버 왕복(HTTP inject)으로 회계·검증·불변식을 엔드포인트 레벨로 고정한다:
 *  - 예치 검증 4항 (진짜 / 리저브 소각 / 사업자 소유 / 미소비=이중예치)
 *  - 청구 회계 (선착순 소진 / 1인 1회 / 순차 다중 청구의 정확한 잔여 감소)
 *  - 만료·마감 후 청구 거부
 *  - ★총량 보존: 발행 총액 ≤ 예치 총액이 엔드포인트 왕복 후에도 성립 (T-3 공시)
 *  - GET /spot: 잔여 0 숨김 + 서버가 자연어(note)를 만들지 않음 (noUiStrings)
 *  - V-2: /spot/deposit 배열 상한 DoS 방어 (코드 에러)
 *  - V-3(헌법 중요): 인간 한계 초과 fake-walk 코인 예치 시 생산자 소명 등재 (세탁 차단)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWalkSegmentProof,
  createTransfer,
  mintGrantCoin,
  mintWalkCoin,
  verifyCoin,
  type Coin,
  type SettlementDraft,
  type SignedGrant,
} from '@shvil/shared';
import { buildApp } from '../src/app';
import { SPOT_DEPOSIT_MAX_COINS } from '../src/spotTreasure';
import { mintWalkCoinFor, register, signedInject, T0, type TestIdentity } from './utils';

const app = buildApp({ dbPath: ':memory:', devMode: true });
const DAY = 86_400_000;

let merchant: TestIdentity; // 스팟 사업자
let outsider: TestIdentity; // 타인(사업자 소유 아님 코인 소스)
let g1: TestIdentity;
let g2: TestIdentity;
let g3: TestIdentity;
let trustedIssuerKeys: Record<string, string>;

/** 사업자가 자기 걷기 코인을 리저브로 소각(미완결 이전)한 예치 코인. */
function burnToReserve(owner: TestIdentity, reservePublicKey: string, km: number, startAt: number): Coin {
  return createTransfer(mintWalkCoinFor(owner, km, startAt), owner.signer, reservePublicKey, Date.now());
}

/**
 * 스팟 생성 → reservePublicKey 반환 (사업자 서명).
 *
 * ★requirePresence=false로 만든다: 이 파일은 **예치·선착순 회계·총량 보존**을
 * 검증하는 곳이라 현장 결속(R-스팟-현장결속)은 관심사가 아니다. 현장 결속은
 * 기본값(요구)·지시 발급·수행 대조·우회 차단까지 spotPresence.test.ts가 전담한다.
 */
async function createSpot(
  sponsor: TestIdentity,
  spotId: string,
  perClaimDshv: number,
  overrides: { validFrom?: number; validUntil?: number } = {},
): Promise<string> {
  const now = Date.now();
  const res = await signedInject(app, sponsor, 'POST', '/spot', {
    spotId,
    regionId: 'israel-national',
    displayName: '갈릴리 카페',
    location: { lat: 33.231, lon: 35.651 },
    perClaimDshv,
    requirePresence: false,
    validFrom: overrides.validFrom ?? now - DAY,
    validUntil: overrides.validUntil ?? now + DAY,
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { reservePublicKey: string }).reservePublicKey;
}

beforeAll(async () => {
  await app.ready();
  merchant = await register(app, '+972-55-8000-001', 'cafe@spot.io', '갈릴리 카페');
  outsider = await register(app, '+972-55-8000-002', 'out@spot.io', '타인');
  g1 = await register(app, '+972-55-8000-011', 'g1@spot.io', '손님1');
  g2 = await register(app, '+972-55-8000-012', 'g2@spot.io', '손님2');
  g3 = await register(app, '+972-55-8000-013', 'g3@spot.io', '손님3');
  const { keys } = (await app.inject({ method: 'GET', url: '/keys' })).json() as {
    keys: { keyId: string; publicKey: string; purpose: string }[];
  };
  trustedIssuerKeys = Object.fromEntries(
    keys.filter((k) => k.purpose !== 'MEMBERSHIP_ROOT' && k.purpose !== 'DISTRIBUTION').map((k) => [k.keyId, k.publicKey]),
  );
});

afterAll(async () => {
  await app.close();
});

describe('예치 검증 (POST /spot/deposit) — 4항 + 이중예치', () => {
  it('진짜 코인(사업자 소유·리저브 소각)을 통과시키고 슬롯을 유도한다', async () => {
    const reserve = await createSpot(merchant, 'spot-deposit-ok', 50);
    const burn = burnToReserve(merchant, reserve, 10, T0); // 10km = 100 dSHV
    const res = await signedInject(app, merchant, 'POST', '/spot/deposit', { spotId: 'spot-deposit-ok', coins: [burn] });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { depositTotalDshv: number; totalSlots: number; remainingSlots: number };
    expect(body.depositTotalDshv).toBe(100);
    expect(body.totalSlots).toBe(2); // floor(100 / 50)
    expect(body.remainingSlots).toBe(2);
  });

  it('사업자 소유가 아닌 코인을 거부한다 (NOT_SPONSOR_OWNED)', async () => {
    const reserve = await createSpot(merchant, 'spot-notowned', 50);
    // outsider가 자기 코인을 리저브로 소각 — merchant의 예치로 인정 불가.
    const burn = burnToReserve(outsider, reserve, 5, T0 + DAY);
    const res = await signedInject(app, merchant, 'POST', '/spot/deposit', { spotId: 'spot-notowned', coins: [burn] });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; reasons: string[] };
    expect(body.error).toBe('INVALID_DEPOSIT_COIN');
    expect(body.reasons).toContain('NOT_SPONSOR_OWNED');
  });

  it('리저브가 아닌 곳으로 이전한 코인을 거부한다 (NOT_COMMITTED_TO_RESERVE)', async () => {
    await createSpot(merchant, 'spot-notreserve', 50);
    // merchant가 자기 코인을 리저브가 아닌 outsider에게 이전 — 소각이 아님.
    const notReserve = createTransfer(mintWalkCoinFor(merchant, 5, T0 + 2 * DAY), merchant.signer, outsider.signer.publicKeyHex, Date.now());
    const res = await signedInject(app, merchant, 'POST', '/spot/deposit', { spotId: 'spot-notreserve', coins: [notReserve] });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; reasons: string[] };
    expect(body.error).toBe('INVALID_DEPOSIT_COIN');
    expect(body.reasons).toContain('NOT_COMMITTED_TO_RESERVE');
  });

  it('소각 서명이 없는 코인을 거부한다 (PENDING_COMMIT_MISSING)', async () => {
    await createSpot(merchant, 'spot-nopending', 50);
    const noBurn = mintWalkCoinFor(merchant, 5, T0 + 3 * DAY); // 이전 체인 없음
    const res = await signedInject(app, merchant, 'POST', '/spot/deposit', { spotId: 'spot-nopending', coins: [noBurn] });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { reasons: string[] }).reasons).toContain('PENDING_COMMIT_MISSING');
  });

  it('같은 소각 코인의 이중 예치를 거부한다 (COIN_ALREADY_DEPOSITED)', async () => {
    const reserve = await createSpot(merchant, 'spot-dup', 50);
    const burn = burnToReserve(merchant, reserve, 5, T0 + 4 * DAY);
    const first = await signedInject(app, merchant, 'POST', '/spot/deposit', { spotId: 'spot-dup', coins: [burn] });
    expect(first.statusCode).toBe(200);
    const second = await signedInject(app, merchant, 'POST', '/spot/deposit', { spotId: 'spot-dup', coins: [burn] });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: string }).error).toBe('COIN_ALREADY_DEPOSITED');
  });

  it('다른 사업자의 스팟에는 예치할 수 없다 (NOT_SPOT_SPONSOR)', async () => {
    const reserve = await createSpot(merchant, 'spot-foreign', 50);
    const burn = burnToReserve(outsider, reserve, 5, T0 + 5 * DAY);
    const res = await signedInject(app, outsider, 'POST', '/spot/deposit', { spotId: 'spot-foreign', coins: [burn] });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe('NOT_SPOT_SPONSOR');
  });
});

describe('V-2 — /spot/deposit 무제한 배열 DoS 방어', () => {
  it('배열 길이 상한 초과를 코드 에러로 거부한다 (자연어 금지)', async () => {
    const reserve = await createSpot(merchant, 'spot-dos', 50);
    // 실제 코인일 필요 없다 — 길이 검사가 검증보다 먼저다. 얕은 더미로 상한만 친다.
    const coins = Array.from({ length: SPOT_DEPOSIT_MAX_COINS + 1 }, () => ({}) as Coin);
    const res = await signedInject(app, merchant, 'POST', '/spot/deposit', { spotId: 'spot-dos', coins });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('TOO_MANY_DEPOSIT_COINS');
    expect(res.body).not.toMatch(/[가-힣]/); // 코드만 — 자연어 없음
  });
});

describe('V-3 (헌법 중요) — 가짜 걷기 코인 세탁 차단', () => {
  it('인간 한계 초과 fake-walk 코인을 예치하면 생산자가 소명 대기 등재된다', async () => {
    const launderer = await register(app, '+972-55-8000-666', 'l@spot.io', '세탁업자');
    const reserve = await createSpot(launderer, 'spot-launder', 100);

    // 자가 서명 fake-walk 코인: 잠정 원장(일 상한 40 SHV)을 우회해 draft를 직접 위조한다.
    // 500 dSHV = 50 SHV > 일 400 dSHV 한계 — 사람이 하루에 걸을 수 없는 양.
    const draft: SettlementDraft = {
      memberId: launderer.memberId,
      settlement: 'MANUAL',
      startedAt: T0,
      settledAt: T0,
      distanceM: 1,
      stepCount: 1,
      courseIds: [],
      amountDshv: 500,
      dailyBreakdown: [{ date: '2026-07-20', amountDshv: 500 }],
      sensorSummaryHash: 'forged',
    };
    const fake = mintWalkCoin(buildWalkSegmentProof(draft, launderer.signer));
    // ★2026-07-20 강화 (적대적 검증): 예전에는 예치가 **수리된 뒤** 생산자만 등재됐다.
    //   그 사이 슬롯이 만들어져 부풀린 액수가 진짜 그랜트로 재배포되는 무제한 발행구였다.
    //   이제는 예치 자체를 거부하면서(총량 보존) 동시에 생산자를 등재한다(소명 책임).
    const burn = createTransfer(fake, launderer.signer, reserve, Date.now());
    const dep = await signedInject(app, launderer, 'POST', '/spot/deposit', { spotId: 'spot-launder', coins: [burn] });
    expect(dep.statusCode).toBe(400);
    expect((dep.json() as { reasons: string[] }).reasons).toContain('EXCEEDS_HUMAN_LIMITS');

    // 예치가 거부됐으므로 슬롯이 하나도 생기지 않는다 (부풀린 액수가 유통되지 않는다).
    const mine = (await signedInject(app, launderer, 'GET', '/spot/mine')).json() as {
      spots: { spotId: string; totalSlots: number }[];
    };
    expect(mine.spots.find((s) => s.spotId === 'spot-launder')!.totalSlots).toBe(0);

    // 생산자(세탁업자)가 초과생성으로 소명 대기 등재된다 — 예치가 sync 기반 탐지를 우회하지 못한다.
    const flagged = (await app.inject({ method: 'GET', url: '/limits/flagged' })).json() as {
      members: { memberId: string; reasonCode: string }[];
    };
    const entry = flagged.members.find((m) => m.memberId === launderer.memberId);
    expect(entry).toBeDefined();
    expect(entry!.reasonCode).toBe('OVERPRODUCTION_DAILY');
  });
});

describe('청구 회계 (POST /spot/claim) — 선착순·1인1회·순차 정확성', () => {
  it('잔여>0이면 TREASURE 그랜트를 발행하고 폰 민팅이 검증을 통과한다', async () => {
    const reserve = await createSpot(merchant, 'spot-claim', 50);
    const burn = burnToReserve(merchant, reserve, 10, T0 + 10 * DAY); // 100 dSHV → 2 슬롯
    await signedInject(app, merchant, 'POST', '/spot/deposit', { spotId: 'spot-claim', coins: [burn] });

    const res = await signedInject(app, g1, 'POST', '/spot/claim', { spotId: 'spot-claim' });
    expect(res.statusCode).toBe(200);
    const { grant, amountDshv } = res.json() as { grant: SignedGrant; amountDshv: number };
    expect(amountDshv).toBe(50);
    expect(grant.kind).toBe('TREASURE');
    const coin = mintGrantCoin(grant);
    expect(verifyCoin(coin, { trustedIssuerKeys }).valid).toBe(true);
    expect(coin.memberId).toBe(g1.memberId);
  });

  it('1인 1회 — 같은 회원의 재청구를 거부한다 (SPOT_ALREADY_CLAIMED)', async () => {
    const res = await signedInject(app, g1, 'POST', '/spot/claim', { spotId: 'spot-claim' });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('SPOT_ALREADY_CLAIMED');
  });

  it('마지막 슬롯 소진 후에는 SPOT_EXHAUSTED (발행이 예치를 넘지 못한다)', async () => {
    const second = await signedInject(app, g2, 'POST', '/spot/claim', { spotId: 'spot-claim' });
    expect(second.statusCode).toBe(200); // 2번째(마지막) 슬롯
    const third = await signedInject(app, g3, 'POST', '/spot/claim', { spotId: 'spot-claim' });
    expect(third.statusCode).toBe(409);
    expect((third.json() as { error: string }).error).toBe('SPOT_EXHAUSTED');
  });

  it('순차 다중 청구가 잔여를 정확히 감소시킨다 (초과발행 없음)', async () => {
    const reserve = await createSpot(merchant, 'spot-atomic', 20);
    const burn = burnToReserve(merchant, reserve, 10, T0 + 11 * DAY); // 100 dSHV / 20 = 5 슬롯
    await signedInject(app, merchant, 'POST', '/spot/deposit', { spotId: 'spot-atomic', coins: [burn] });

    // 7명이 순차로 청구 → 정확히 5명만 지급, 2명은 소진.
    const claimers: TestIdentity[] = [];
    for (let i = 0; i < 7; i++) {
      claimers.push(await register(app, `+972-55-8100-${100 + i}`, `atom${i}@spot.io`, `원자${i}`));
    }
    let paid = 0;
    let exhausted = 0;
    for (const c of claimers) {
      const r = await signedInject(app, c, 'POST', '/spot/claim', { spotId: 'spot-atomic' });
      if (r.statusCode === 200 && (r.json() as { grant?: SignedGrant }).grant) paid += 1;
      else if (r.statusCode === 409 && (r.json() as { error: string }).error === 'SPOT_EXHAUSTED') exhausted += 1;
    }
    expect(paid).toBe(5);
    expect(exhausted).toBe(2);

    // 회계 확인: 발행 수 5, 발행 총액 100 = 예치 100 (넘지 않음).
    const mine = (await signedInject(app, merchant, 'GET', '/spot/mine')).json() as {
      spots: { spotId: string; issuedCount: number; totalSlots: number; remainingSlots: number; depositTotalDshv: number; perClaimDshv: number }[];
    };
    const s = mine.spots.find((x) => x.spotId === 'spot-atomic')!;
    expect(s.issuedCount).toBe(5);
    expect(s.remainingSlots).toBe(0);
    expect(s.issuedCount * s.perClaimDshv).toBeLessThanOrEqual(s.depositTotalDshv); // ★총량 보존
  });
});

describe('만료·마감 후 청구 거부', () => {
  it('유효 기간이 지난 스팟 청구를 거부한다 (SPOT_OUT_OF_VALIDITY)', async () => {
    const now = Date.now();
    await createSpot(merchant, 'spot-expired', 50, { validFrom: now - 2 * DAY, validUntil: now - DAY });
    const res = await signedInject(app, g1, 'POST', '/spot/claim', { spotId: 'spot-expired' });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('SPOT_OUT_OF_VALIDITY');
  });

  it('마감된 스팟 청구를 거부한다 (SPOT_CLOSED)', async () => {
    const reserve = await createSpot(merchant, 'spot-closed', 50);
    const burn = burnToReserve(merchant, reserve, 10, T0 + 12 * DAY);
    await signedInject(app, merchant, 'POST', '/spot/deposit', { spotId: 'spot-closed', coins: [burn] });
    await signedInject(app, merchant, 'POST', '/spot/close', { spotId: 'spot-closed' });
    const res = await signedInject(app, g1, 'POST', '/spot/claim', { spotId: 'spot-closed' });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('SPOT_CLOSED');
  });
});

describe('총량 보존 공시 (T-3) — 발행 ≤ 예치', () => {
  it('/transparency/promo에서 스팟 발행 총액 ≤ 예치 총액이 성립한다', async () => {
    const body = (await app.inject({ method: 'GET', url: '/transparency/promo' })).json() as {
      spotDepositedDshv: number;
      spotIssuedDshv: number;
      spotIssuedCount: number;
    };
    expect(body.spotIssuedDshv).toBeLessThanOrEqual(body.spotDepositedDshv); // ★불변식
    expect(body.spotIssuedCount).toBeGreaterThan(0);
  });
});

describe('GET /spot — 맵 배포 (잔여0 숨김 + noUiStrings)', () => {
  it('잔여>0 스팟만 노출하고 소진·미충전 스팟은 숨긴다', async () => {
    const list = (await app.inject({ method: 'GET', url: '/spot?region=israel-national' })).json() as {
      spots: { spotId: string; remainingSlots: number }[];
    };
    const ids = list.spots.map((s) => s.spotId);
    // 소진된 spot-claim·spot-atomic, 미충전 spot-notowned은 맵에 없다.
    expect(ids).not.toContain('spot-claim');
    expect(ids).not.toContain('spot-atomic');
    expect(ids).not.toContain('spot-notowned');
    // 노출된 스팟은 전부 잔여>0.
    for (const s of list.spots) expect(s.remainingSlots).toBeGreaterThan(0);
  });

  it('노출 필드는 화이트리스트뿐 — 서버 생성 자연어(note) 없음', async () => {
    const list = (await app.inject({ method: 'GET', url: '/spot?region=israel-national' })).json() as {
      spots: Record<string, unknown>[];
    };
    const allowed = new Set([
      'spotId',
      'regionId',
      'displayName', // 사용자 원문(사업장명) — 엔젤 이름과 같은 범주, 번역 대상 아님
      'location',
      'perClaimDshv',
      'totalSlots',
      'remainingSlots',
      'depositTotalDshv',
      'validUntil',
      // R-스팟-현장결속: 현장 몸-걸음 인증 필요 여부 (불리언 — 자연어 아님).
      // 지갑이 스캔 후 지시를 받을지 판단하고, 맵이 표식을 붙이는 데 쓴다.
      'requirePresence',
    ]);
    for (const s of list.spots) {
      for (const k of Object.keys(s)) expect(allowed.has(k)).toBe(true);
      expect(Object.keys(s)).not.toContain('note'); // 서버는 설명 문구를 만들지 않는다
    }
  });
});
