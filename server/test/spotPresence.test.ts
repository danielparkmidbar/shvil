/**
 * 스팟 현장 결속 (R-스팟-현장결속) — 엔드포인트 통합 테스트.
 *
 * V-1(원격 청구)의 근본 완화를 고정한다: 스팟 청구 전에 서버가 1회용 랜덤 이동
 * 지시를 내고, 손님이 그 자리에서 몸으로 수행해야 청구가 성립한다.
 *
 * 확인 항목:
 *  ① 기본값이 "요구"다 — 사업자가 끄지 않는 한 원격 청구가 막힌다 (안전한 기본값).
 *  ② 지시 없이/조작 지시로는 청구할 수 없다 (★V-1 차단의 핵심).
 *  ③ 1회용: 소비된 지시·만료된 지시·남의 지시·다른 스팟 지시는 거부된다.
 *  ④ 물리적으로 불가능한 속도(즉시 응답)는 거부된다.
 *  ⑤ 실패한 지시는 즉시 소비된다 — 값을 바꿔가며 재시도하는 무차별 대입 차단.
 *  ⑥ 사업자가 끈 스팟(식당·주유소 즉시 스캔)은 종전대로 동작한다.
 *  ⑦ 서버는 좌표를 받지 않는다 — 저장되는 것은 요약 해시뿐.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SPOT_PRESENCE_CHALLENGE_TTL_MS,
  createTransfer,
  presenceMinDurationMs,
  type MovementLeg,
  type SpotPresenceLegReport,
} from '@shvil/shared';
import { buildApp } from '../src/app';
import { mintWalkCoinFor, register, signedInject, T0, type TestIdentity } from './utils';

/**
 * 걸음당 최소 소요 시간을 1ms로 낮춰 실시간 대기 없이 흐름을 검증한다 (운영 기본은
 * 0.3초/걸음 = 지시 하나에 최대 22초). 시간 게이트 자체의 동작은 "즉시 응답 거부"
 * 테스트가 elapsed=0으로 덮고, 상수의 물리적 타당성은 shared 단위 테스트가 덮는다.
 */
const PRESENCE_MS_PER_STEP = 1;
const app = buildApp({ dbPath: ':memory:', devMode: true, presenceMinMsPerStep: PRESENCE_MS_PER_STEP });
const DAY = 86_400_000;

let merchant: TestIdentity;
let guest: TestIdentity;
let other: TestIdentity;

interface ChallengeRes {
  challengeId: string;
  spotId: string;
  legs: MovementLeg[];
  expiresAt: number;
  minDurationMs: number;
}

/** 스팟 생성 (기본은 현장 결속 요구 — requirePresence를 넘기지 않는다). */
async function createSpot(
  spotId: string,
  perClaimDshv: number,
  opts: { requirePresence?: boolean } = {},
): Promise<string> {
  const now = Date.now();
  const res = await signedInject(app, merchant, 'POST', '/spot', {
    spotId,
    regionId: 'israel-national',
    displayName: '갈릴리 카페',
    location: { lat: 33.231, lon: 35.651 },
    perClaimDshv,
    ...(opts.requirePresence !== undefined ? { requirePresence: opts.requirePresence } : {}),
    validFrom: now - DAY,
    validUntil: now + DAY,
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { reservePublicKey: string }).reservePublicKey;
}

/** 스팟에 코인을 예치해 슬롯을 만든다. */
async function fund(spotId: string, reserve: string, km: number, startAt: number): Promise<void> {
  const burn = createTransfer(mintWalkCoinFor(merchant, km, startAt), merchant.signer, reserve, Date.now());
  const res = await signedInject(app, merchant, 'POST', '/spot/deposit', { spotId, coins: [burn] });
  expect(res.statusCode).toBe(200);
}

async function getChallenge(who: TestIdentity, spotId: string) {
  return signedInject(app, who, 'POST', '/spot/challenge', { spotId });
}

/** 지시를 정확히 수행한 보고. */
function perform(legs: MovementLeg[]): SpotPresenceLegReport[] {
  return legs.map((l) => ({ dir: l.dir, steps: l.steps, measuredSteps: l.steps }));
}

/** 현장 수행 시간을 흘려보낸다 (테스트 주입값 기준 — 위 PRESENCE_MS_PER_STEP). */
async function walkFor(legs: MovementLeg[]): Promise<void> {
  await new Promise((r) => setTimeout(r, presenceMinDurationMs(legs, PRESENCE_MS_PER_STEP) + 50));
}

beforeAll(async () => {
  await app.ready();
  merchant = await register(app, '+972-55-9100-001', 'cafe@presence.io', '갈릴리 카페');
  guest = await register(app, '+972-55-9100-002', 'g1@presence.io', '손님');
  other = await register(app, '+972-55-9100-003', 'g2@presence.io', '다른손님');
});

afterAll(async () => {
  await app.close();
});

describe('① 안전한 기본값 — 지정하지 않으면 현장 결속을 요구한다', () => {
  it('기본 생성 스팟은 requirePresence=true로 공개된다', async () => {
    const reserve = await createSpot('spot-pres-default', 50);
    await fund('spot-pres-default', reserve, 10, T0);
    const { spots } = (await app.inject({ method: 'GET', url: '/spot?region=israel-national' })).json() as {
      spots: { spotId: string; requirePresence: boolean }[];
    };
    expect(spots.find((s) => s.spotId === 'spot-pres-default')!.requirePresence).toBe(true);
  });
});

describe('② ★원격 청구 차단 (V-1의 근본 완화)', () => {
  it('지시 없이 spotId만으로는 청구할 수 없다', async () => {
    const reserve = await createSpot('spot-pres-remote', 50);
    await fund('spot-pres-remote', reserve, 10, T0 + DAY);
    const res = await signedInject(app, guest, 'POST', '/spot/claim', { spotId: 'spot-pres-remote' });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('SPOT_PRESENCE_REQUIRED');
  });

  it('지시를 받고 그 자리에서 수행하면 청구가 성립한다', async () => {
    const reserve = await createSpot('spot-pres-ok', 50);
    await fund('spot-pres-ok', reserve, 10, T0 + 2 * DAY);
    const ch = (await getChallenge(guest, 'spot-pres-ok')).json() as ChallengeRes;
    expect(ch.legs.length).toBeGreaterThan(0);
    await walkFor(ch.legs);
    const res = await signedInject(app, guest, 'POST', '/spot/claim', {
      spotId: 'spot-pres-ok',
      challengeId: ch.challengeId,
      legs: perform(ch.legs),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { amountDshv: number }).amountDshv).toBe(50);
  });

  it('지시를 조작해 보고하면 거부된다 (수행하지 않고 꾸며낸 값)', async () => {
    const reserve = await createSpot('spot-pres-forge', 50);
    await fund('spot-pres-forge', reserve, 10, T0 + 3 * DAY);
    const ch = (await getChallenge(guest, 'spot-pres-forge')).json() as ChallengeRes;
    await walkFor(ch.legs);
    const forged = perform(ch.legs);
    forged[0] = { ...forged[0]!, dir: forged[0]!.dir === 'N' ? 'E' : 'N' };
    const res = await signedInject(app, guest, 'POST', '/spot/claim', {
      spotId: 'spot-pres-forge',
      challengeId: ch.challengeId,
      legs: forged,
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('SPOT_PRESENCE_LEGS_MISMATCH');
  });

  it('걷지 않고 걸음 0으로 보고하면 거부된다', async () => {
    const reserve = await createSpot('spot-pres-lazy', 50);
    await fund('spot-pres-lazy', reserve, 10, T0 + 4 * DAY);
    const ch = (await getChallenge(guest, 'spot-pres-lazy')).json() as ChallengeRes;
    await walkFor(ch.legs);
    const lazy = ch.legs.map((l) => ({ dir: l.dir, steps: l.steps, measuredSteps: 0 }));
    const res = await signedInject(app, guest, 'POST', '/spot/claim', {
      spotId: 'spot-pres-lazy',
      challengeId: ch.challengeId,
      legs: lazy,
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('SPOT_PRESENCE_STEPS_OUT_OF_BAND');
  });
});

describe('③ 1회용 지시 — 도용·재사용·만료 차단', () => {
  it('남의 지시로는 청구할 수 없다', async () => {
    const reserve = await createSpot('spot-pres-steal', 50);
    await fund('spot-pres-steal', reserve, 10, T0 + 5 * DAY);
    const ch = (await getChallenge(other, 'spot-pres-steal')).json() as ChallengeRes;
    await walkFor(ch.legs);
    const res = await signedInject(app, guest, 'POST', '/spot/claim', {
      spotId: 'spot-pres-steal',
      challengeId: ch.challengeId,
      legs: perform(ch.legs),
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('SPOT_PRESENCE_CHALLENGE_INVALID');
  });

  it('다른 스팟의 지시로는 청구할 수 없다', async () => {
    const r1 = await createSpot('spot-pres-cross-a', 50);
    await fund('spot-pres-cross-a', r1, 10, T0 + 6 * DAY);
    const r2 = await createSpot('spot-pres-cross-b', 50);
    await fund('spot-pres-cross-b', r2, 10, T0 + 7 * DAY);
    const ch = (await getChallenge(guest, 'spot-pres-cross-a')).json() as ChallengeRes;
    await walkFor(ch.legs);
    const res = await signedInject(app, guest, 'POST', '/spot/claim', {
      spotId: 'spot-pres-cross-b',
      challengeId: ch.challengeId,
      legs: perform(ch.legs),
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('SPOT_PRESENCE_CHALLENGE_INVALID');
  });

  it('새 지시를 받으면 이전 미소비 지시는 폐기된다 (미리 쌓아두기 차단)', async () => {
    const reserve = await createSpot('spot-pres-restack', 50);
    await fund('spot-pres-restack', reserve, 10, T0 + 8 * DAY);
    const first = (await getChallenge(guest, 'spot-pres-restack')).json() as ChallengeRes;
    const second = (await getChallenge(guest, 'spot-pres-restack')).json() as ChallengeRes;
    expect(second.challengeId).not.toBe(first.challengeId);
    await walkFor(first.legs);
    const res = await signedInject(app, guest, 'POST', '/spot/claim', {
      spotId: 'spot-pres-restack',
      challengeId: first.challengeId,
      legs: perform(first.legs),
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('SPOT_PRESENCE_CHALLENGE_INVALID');
  });

  it('지시 유효 시간이 응답에 실려 온다 (그 자리에서 바로 하라는 뜻)', async () => {
    const reserve = await createSpot('spot-pres-ttl', 50);
    await fund('spot-pres-ttl', reserve, 10, T0 + 9 * DAY);
    const res = await getChallenge(guest, 'spot-pres-ttl');
    const ch = res.json() as ChallengeRes;
    expect(ch.expiresAt - Date.now()).toBeLessThanOrEqual(SPOT_PRESENCE_CHALLENGE_TTL_MS);
    expect(ch.expiresAt).toBeGreaterThan(Date.now());
    expect(ch.minDurationMs).toBe(presenceMinDurationMs(ch.legs, PRESENCE_MS_PER_STEP));
  });
});

describe('④⑤ 자동화 차단 — 즉시 응답·무차별 재시도', () => {
  it('★지시를 받자마자 즉시 응답하면 거부된다 (물리적으로 불가능한 속도)', async () => {
    const reserve = await createSpot('spot-pres-fast', 50);
    await fund('spot-pres-fast', reserve, 10, T0 + 10 * DAY);
    const ch = (await getChallenge(guest, 'spot-pres-fast')).json() as ChallengeRes;
    // 기다리지 않고 곧바로 완벽한 답을 제출 — 봇의 전형적 행동.
    const res = await signedInject(app, guest, 'POST', '/spot/claim', {
      spotId: 'spot-pres-fast',
      challengeId: ch.challengeId,
      legs: perform(ch.legs),
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('SPOT_PRESENCE_TOO_FAST');
  });

  it('실패한 지시는 즉시 소비된다 — 같은 지시로 값을 바꿔 재시도할 수 없다', async () => {
    const reserve = await createSpot('spot-pres-retry', 50);
    await fund('spot-pres-retry', reserve, 10, T0 + 11 * DAY);
    const ch = (await getChallenge(guest, 'spot-pres-retry')).json() as ChallengeRes;
    // 1차: 너무 빨라 실패 → 지시 소비됨
    await signedInject(app, guest, 'POST', '/spot/claim', {
      spotId: 'spot-pres-retry',
      challengeId: ch.challengeId,
      legs: perform(ch.legs),
    });
    // 2차: 이번엔 제대로 기다려도 같은 지시는 이미 죽었다.
    await walkFor(ch.legs);
    const res = await signedInject(app, guest, 'POST', '/spot/claim', {
      spotId: 'spot-pres-retry',
      challengeId: ch.challengeId,
      legs: perform(ch.legs),
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('SPOT_PRESENCE_CHALLENGE_USED');
  });
});

describe('⑥ 사업자가 끈 스팟 — 즉시 스캔 원안 보존', () => {
  it('requirePresence=false면 지시 없이 종전대로 청구된다', async () => {
    const reserve = await createSpot('spot-pres-off', 50, { requirePresence: false });
    await fund('spot-pres-off', reserve, 10, T0 + 12 * DAY);
    const res = await signedInject(app, guest, 'POST', '/spot/claim', { spotId: 'spot-pres-off' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { amountDshv: number }).amountDshv).toBe(50);
  });

  it('끈 스팟에 지시를 요구하면 코드 에러로 거부한다', async () => {
    const res = await getChallenge(other, 'spot-pres-off');
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('SPOT_PRESENCE_NOT_REQUIRED');
  });
});

describe('⑦ 프라이버시 — 서버는 사용자 좌표를 받지도 저장하지도 않는다', () => {
  it('지시 응답은 화이트리스트 필드뿐 — 스팟 공개 위치 외 좌표 없음, 자연어 없음', async () => {
    const reserve = await createSpot('spot-pres-privacy', 50);
    await fund('spot-pres-privacy', reserve, 10, T0 + 13 * DAY);
    const res = await getChallenge(other, 'spot-pres-privacy');
    const body = res.json() as Record<string, unknown>;
    // location은 **사업장의 공개 위치**다(GET /spot과 동일) — 사용자 좌표가 아니다.
    // 폰이 근접 판정 기준으로 쓰며, 미충전(목록 밖) 스팟의 현장 인증도 가능케 한다.
    expect(Object.keys(body).sort()).toEqual(
      ['challengeId', 'expiresAt', 'legs', 'location', 'minDurationMs', 'spotId'].sort(),
    );
    expect(res.body).not.toMatch(/[가-힣]/); // noUiStrings — 문구는 지갑 사전이 조립
    // 지시(legs)에는 방향·걸음뿐 — 좌표류 필드가 없다.
    for (const leg of body.legs as Record<string, unknown>[]) {
      expect(Object.keys(leg).sort()).toEqual(['dir', 'steps']);
    }
  });

  it('청구 대장에는 요약 해시만 남는다 (이동 복원 불가)', async () => {
    const reserve = await createSpot('spot-pres-ledger', 50);
    await fund('spot-pres-ledger', reserve, 10, T0 + 14 * DAY);
    const ch = (await getChallenge(other, 'spot-pres-ledger')).json() as ChallengeRes;
    await walkFor(ch.legs);
    await signedInject(app, other, 'POST', '/spot/claim', {
      spotId: 'spot-pres-ledger',
      challengeId: ch.challengeId,
      legs: perform(ch.legs),
    });
    const row = app.db
      .prepare('SELECT presence_hash FROM spot_claims WHERE spot_id = ? AND member_id = ?')
      .get('spot-pres-ledger', other.memberId) as { presence_hash: string | null };
    expect(row.presence_hash).toMatch(/^[0-9a-f]{64}$/); // 해시일 뿐
    // 지시 테이블에도 좌표 컬럼이 없다.
    const cols = app.db.prepare('PRAGMA table_info(spot_challenges)').all() as unknown as { name: string }[];
    expect(cols.map((c) => c.name)).not.toContain('lat');
    expect(cols.map((c) => c.name)).not.toContain('lon');
  });
});
