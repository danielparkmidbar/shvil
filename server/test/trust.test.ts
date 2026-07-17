/**
 * 검증 가능한 신뢰 지표 (C — 별점 대신 사실, 검증가능신뢰_설계.md) 서버 테스트.
 *
 * 확인 항목:
 *  ① 자발 공개 게이트: 공개 전엔 조회가 { visible:false } (미가입과 구별 불가 →
 *     존재 오라클 차단). 본인은 GET /trust/me로 항상 자기 것을 본다.
 *  ② 교차 목격 걷기 실적: 남이 목격한 코인만 walkTier에 반영. 자기 신고는 안 됨
 *     (서명 없는 sync 지문으로 실적을 부풀리지 못한다).
 *  ③ 커뮤니티 인정 완주(claims APPROVED)·완주 인증(certificates) 집계.
 *  ④ 정확 코인 액수 비노출 — 응답에 dSHV 수치가 없고 구간 뱃지만 있다.
 *  ⑤ 동행 게시판(M8) 카드에 게시자의 공개 신뢰 뱃지가 실린다.
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
  type Coin,
  type TrustSummary,
  type WalkSample,
} from '@shvil/shared';
import { buildApp } from '../src/app';
import { register, signedInject, type TestIdentity } from './utils';

const app = buildApp({ dbPath: ':memory:', devMode: true, claimVoteThreshold: 2 });
const T0 = Date.parse('2026-07-12T06:00:00Z');

let walker: TestIdentity; // 걷는 사람 (실적 주인)
let witness: TestIdentity; // 코인을 받아 목격하는 사람
let voter1: TestIdentity;
let voter2: TestIdentity;
let poster: TestIdentity; // 동행 게시자

function mintWalk(id: TestIdentity, dshv: number, startAt: number): Coin {
  const ledger = new PendingWalkLedger({ memberId: id.memberId });
  let t = startAt;
  for (let i = 0; i < dshv; i++) {
    const sample: WalkSample = {
      durationS: 72,
      distanceM: 100,
      steps: 140,
      tier: 'ON_COURSE',
      timestamp: t,
      courseId: 'shvil-israel',
    };
    ledger.recordSample(sample);
    t += 72_000;
  }
  return mintWalkCoin(buildWalkSegmentProof(ledger.settleOnSpend(t)!, id.signer));
}

function payTo(coin: Coin, payer: TestIdentity, payee: TestIdentity, chargeId: string): Coin {
  const charge = buildCharge(
    { chargeId, angelMemberId: payee.memberId, amountDshv: coin.amountDshv, createdAt: Date.now() },
    payee.signer,
  );
  const payment = buildPayment(charge, [coin], payer.memberId, payer.signer, Date.now());
  return acceptPayment(charge, payment, payee.signer).coins[0]!;
}

async function disclose(who: TestIdentity, visible: boolean) {
  return signedInject(app, who, 'PUT', '/trust/me', { visible });
}

async function publicTrust(memberId: string): Promise<{ visible: boolean; trust: TrustSummary | null }> {
  const res = await app.inject({ method: 'GET', url: `/trust?member=${memberId}` });
  return res.json() as { visible: boolean; trust: TrustSummary | null };
}

beforeAll(async () => {
  await app.ready();
  walker = await register(app, '+972-50-trust-1', 'walker@x.io', '워커');
  witness = await register(app, '+972-50-trust-2', 'witness@x.io', '위트니스');
  voter1 = await register(app, '+972-50-trust-3', 'v1@x.io', '보터1');
  voter2 = await register(app, '+972-50-trust-4', 'v2@x.io', '보터2');
  poster = await register(app, '+972-50-trust-5', 'poster@x.io', '포스터');
});

afterAll(async () => {
  await app.close();
});

describe('① 자발 공개 게이트', () => {
  it('공개 전에는 조회가 { visible:false, trust:null }', async () => {
    const r = await publicTrust(walker.memberId);
    expect(r.visible).toBe(false);
    expect(r.trust).toBeNull();
  });

  it('미가입 회원 번호도 동일한 응답 — 존재 오라클이 되지 않는다', async () => {
    const r = await publicTrust('SHV-999999');
    expect(r).toEqual({ visible: false, trust: null });
  });

  it('member 파라미터가 없으면 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/trust' });
    expect(res.statusCode).toBe(400);
  });

  it('본인은 공개 전에도 GET /trust/me로 자기 지표를 본다', async () => {
    const res = await signedInject(app, walker, 'GET', '/trust/me');
    const body = res.json() as { visible: boolean; trust: TrustSummary | null };
    expect(body.visible).toBe(false);
    expect(body.trust).not.toBeNull();
    expect(body.trust!.memberSinceDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('공개로 전환하면 조회에 집계가 나온다', async () => {
    const put = await disclose(walker, true);
    expect(put.statusCode).toBe(200);
    const r = await publicTrust(walker.memberId);
    expect(r.visible).toBe(true);
    expect(r.trust).not.toBeNull();
  });

  it('공개 설정은 boolean 필수 (400)', async () => {
    const res = await signedInject(app, walker, 'PUT', '/trust/me', { visible: 'yes' });
    expect(res.statusCode).toBe(400);
  });

  it('비공개로 되돌리면 다시 가려진다', async () => {
    await disclose(walker, false);
    expect((await publicTrust(walker.memberId)).visible).toBe(false);
    await disclose(walker, true); // 이후 테스트를 위해 다시 공개
  });
});

describe('② 교차 목격 걷기 실적 (자기 신고는 실적이 아니다)', () => {
  it('자기 코인을 자기가 sync 하면 walkTier는 오르지 않는다 (부풀림 차단)', async () => {
    const coin = mintWalk(walker, 100, T0);
    await signedInject(app, walker, 'POST', '/sync/coins', { fingerprints: [coinFingerprint(coin)] });
    const r = await publicTrust(walker.memberId);
    expect(r.trust!.walkTier).toBe('NONE');
  });

  it('남이 받은 코인을 목격(sync)하면 생산자의 walkTier가 오른다', async () => {
    // walker가 100 dSHV를 걸어 witness에게 지불 → witness가 sync (교차 목격)
    const coin = mintWalk(walker, 100, T0 + 86_400_000);
    const received = payTo(coin, walker, witness, 'chg-trust-corr');
    await signedInject(app, witness, 'POST', '/sync/coins', { fingerprints: [coinFingerprint(received)] });
    const r = await publicTrust(walker.memberId);
    // 100 dSHV 교차 목격 → STARTER (≥1)
    expect(r.trust!.walkTier).toBe('STARTER');
  });
});

describe('③ 커뮤니티 인정 완주·완주 인증 집계', () => {
  it('claims가 투표로 APPROVED 되면 claimsApproved가 증가한다', async () => {
    const now = Date.now();
    const post = await signedInject(app, walker, 'POST', '/claims', {
      courseId: 'shvil-israel',
      walkedAt: now - 3600_000,
      distanceM: 5000,
      photos: ['data:image/png;base64,AA=='],
    });
    const { claimId } = post.json() as { claimId: number };
    await signedInject(app, voter1, 'POST', `/claims/${claimId}/vote`);
    const v2 = await signedInject(app, voter2, 'POST', `/claims/${claimId}/vote`);
    expect((v2.json() as { status: string }).status).toBe('APPROVED');

    const r = await publicTrust(walker.memberId);
    expect(r.trust!.claimsApproved).toBeGreaterThanOrEqual(1);
  });

  it('완주 인증(FULL)이 certificatesFull에 집계된다', async () => {
    await signedInject(app, walker, 'POST', '/certificates', {
      courseId: 'shvil-israel',
      kind: 'FULL',
      photos: ['data:image/png;base64,AA=='],
      data: { distanceM: 100000, days: 40 },
    });
    const r = await publicTrust(walker.memberId);
    expect(r.trust!.certificatesFull).toBeGreaterThanOrEqual(1);
  });
});

describe('④ 정확 코인 액수 비노출 + noUiStrings (구간 뱃지·코드·숫자만)', () => {
  it('응답 본문에 dSHV 수치·총액 필드가 없다 (walkTier 코드만)', async () => {
    const res = await app.inject({ method: 'GET', url: `/trust?member=${walker.memberId}` });
    const raw = res.body;
    expect(raw).not.toMatch(/dshv/i);
    expect(raw).not.toMatch(/totalMinted|corroborated|total_dshv/i);
    const r = JSON.parse(raw) as { trust: TrustSummary };
    expect(['NONE', 'STARTER', 'EXPERIENCED', 'VETERAN']).toContain(r.trust.walkTier);
  });

  it('공개 조회 응답에 한글·자연어 note가 없다 (다국어는 클라이언트 책임)', async () => {
    const raw = (await app.inject({ method: 'GET', url: `/trust?member=${walker.memberId}` })).body;
    expect(raw).not.toMatch(/[가-힣]/);
    expect(raw).not.toMatch(/"note"/);
  });
});

describe('⑥ 엔젤 디렉토리(/angels)에 공개 신뢰 뱃지가 실린다', () => {
  it('엔젤이 공개했으면 /angels 항목에 trust, 안 했으면 null', async () => {
    // walker를 엔젤로 등록 (walker는 앞 테스트에서 이미 공개 상태)
    await signedInject(app, walker, 'PUT', '/angels/me', {
      name: '워커의 집',
      location: { lat: 33.21, lon: 35.62 },
      services: { shower: true },
      regionId: 'israel-national',
    });
    const angels = (await app.inject({ method: 'GET', url: '/angels?region=israel-national' })).json() as {
      angels: { memberId: string; trust: TrustSummary | null }[];
    };
    const mine = angels.angels.find((a) => a.memberId === walker.memberId);
    expect(mine).toBeDefined();
    expect(mine!.trust).not.toBeNull();
    // 앞 테스트에서 claim 승인·완주 인증을 쌓았으므로 실적이 보인다.
    expect(mine!.trust!.claimsApproved).toBeGreaterThanOrEqual(1);

    // 비공개로 돌리면 같은 엔젤 항목의 trust가 사라진다.
    await disclose(walker, false);
    const after = (await app.inject({ method: 'GET', url: '/angels?region=israel-national' })).json() as {
      angels: { memberId: string; trust: TrustSummary | null }[];
    };
    expect(after.angels.find((a) => a.memberId === walker.memberId)!.trust).toBeNull();
    await disclose(walker, true);
  });
});

describe('⑤ 동행 게시판(M8) 카드에 공개 신뢰 뱃지가 실린다', () => {
  it('게시자가 공개했으면 카드에 trust, 안 했으면 null', async () => {
    // poster는 공개하지 않은 채로 게시
    await signedInject(app, poster, 'POST', '/companions', {
      regionId: 'israel-national',
      fromDate: '2026-08-01',
      toDate: '2026-08-05',
      partySizeCurrent: 1,
      partySizeTarget: 3,
      mode: 'WALK',
      displayName: '포스터',
    });
    let list = (await app.inject({ method: 'GET', url: '/companions?author=' + poster.memberId })).json() as {
      companions: { authorMemberId: string; trust: TrustSummary | null }[];
    };
    expect(list.companions[0]!.trust).toBeNull();

    // 공개로 전환하면 같은 카드에 뱃지가 실린다
    await disclose(poster, true);
    list = (await app.inject({ method: 'GET', url: '/companions?author=' + poster.memberId })).json() as {
      companions: { authorMemberId: string; trust: TrustSummary | null }[];
    };
    expect(list.companions[0]!.trust).not.toBeNull();
    expect(list.companions[0]!.trust!.memberSinceDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
