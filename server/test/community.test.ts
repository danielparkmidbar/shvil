/**
 * M4 커뮤니티 기능 테스트 (지시서 2.5, 2.6, 3장, 6장):
 * 코스 등록부(승격), 클레임(24h·월 한도·투표 승인·발행), 격려 코인,
 * 탑 100 리더보드·기준선, 소명 대기 목록, 투명성 공시.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintGrantCoin, verifyCoin, type SignedGrant } from '@shvil/shared';
import { buildApp } from '../src/app';
import { register, signedInject, type TestIdentity } from './utils';

// 승격 기준은 지시서상 100명 — 테스트는 축소 옵션(3명)으로 흐름을 검증하고,
// 기본값이 100임은 별도 단언한다.
const app = buildApp({ dbPath: ':memory:', promotionThreshold: 3, claimVoteThreshold: 5, claimMonthlyLimit: 2, devMode: true });

let walker: TestIdentity; // 클레임 제출자
let voters: TestIdentity[] = []; // 인정 투표자 5명
let trustedKeys: Record<string, string> = {};

beforeAll(async () => {
  await app.ready();
  walker = await register(app, '+82-10-1000', 'walker@example.org', '워커');
  for (let i = 0; i < 5; i++) {
    voters.push(await register(app, `+82-10-200${i}`, `voter${i}@example.org`, `투표자${i}`));
  }
  const keysRes = await app.inject({ method: 'GET', url: '/keys' });
  const { keys } = keysRes.json() as { keys: { keyId: string; publicKey: string }[] };
  trustedKeys = Object.fromEntries(keys.map((k) => [k.keyId, k.publicKey]));
});

afterAll(async () => {
  await app.close();
});

describe('코스 등록부 — 제안 → 완주 기록 → 공식 승격 (지시서 6장 3절)', () => {
  it('기본 승격 기준은 100명이다', async () => {
    const defaultApp = buildApp({ dbPath: ':memory:', devMode: true });
    await defaultApp.ready();
    const w = await register(defaultApp, '+1-1', 'a@b.c', 'x');
    await signedInject(defaultApp, w, 'POST', '/courses/proposals', {
      courseId: 'test-default',
      name: '기본값 확인',
      polyline: [{ lat: 0, lon: 0 }, { lat: 0.01, lon: 0.01 }],
    });
    const res = await defaultApp.inject({ method: 'GET', url: '/courses/proposals' });
    const { proposals } = res.json() as { proposals: { promotionThreshold: number }[] };
    expect(proposals[0]!.promotionThreshold).toBe(100);
    await defaultApp.close();
  });

  it('제안 → 후보 게시 → 기준 인원 완주 기록 → 공식 승격 → 앱 배포 목록 포함', async () => {
    const create = await signedInject(app, walker, 'POST', '/courses/proposals', {
      courseId: 'jeju-olle-1',
      name: '제주 올레 1코스 (제안)',
      polyline: [
        { lat: 33.4996, lon: 126.9089 },
        { lat: 33.4922, lon: 126.9257 },
        { lat: 33.4783, lon: 126.9295 },
      ],
    });
    expect(create.statusCode).toBe(200);

    // 후보 상태에서는 GET /courses에 없다 (코인 생성 불가)
    let courses = (await app.inject({ method: 'GET', url: '/courses' })).json() as { courses: { courseId: string }[] };
    expect(courses.courses.some((c) => c.courseId === 'jeju-olle-1')).toBe(false);

    // 완주 기록 3명 (테스트 축소 기준) — 3번째에서 승격
    for (let i = 0; i < 3; i++) {
      const who = i === 0 ? walker : voters[i - 1]!;
      const res = await signedInject(app, who, 'POST', '/courses/jeju-olle-1/completions', {
        distanceM: 15_000,
        days: 1,
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { promoted: boolean }).promoted).toBe(i === 2);
    }

    // 승격 현황 공개 + 공식 코스 배포
    const proposals = (await app.inject({ method: 'GET', url: '/courses/proposals' })).json() as {
      proposals: { courseId: string; status: string; completions: number }[];
    };
    const mine = proposals.proposals.find((p) => p.courseId === 'jeju-olle-1')!;
    expect(mine.status).toBe('OFFICIAL');
    expect(mine.completions).toBe(3);

    courses = (await app.inject({ method: 'GET', url: '/courses' })).json() as { courses: { courseId: string }[] };
    expect(courses.courses.some((c) => c.courseId === 'jeju-olle-1')).toBe(true);
  });

  it('같은 회원의 완주 기록 중복 제출은 거부된다', async () => {
    const res = await signedInject(app, walker, 'POST', '/courses/jeju-olle-1/completions', {
      distanceM: 15_000,
      days: 1,
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('클레임 게시판 — 누락 걸음 구제 (지시서 2.5)', () => {
  let claimId: number;

  it('걷기 발생 24시간이 지난 클레임은 접수되지 않는다', async () => {
    const res = await signedInject(app, walker, 'POST', '/claims', {
      courseId: 'shvil-israel',
      walkedAt: Date.now() - 25 * 60 * 60 * 1000,
      distanceM: 12_000,
      photos: ['photo-hash-1'],
    });
    expect(res.statusCode).toBe(400);
  });

  it('사진 없는 클레임은 접수되지 않는다', async () => {
    const res = await signedInject(app, walker, 'POST', '/claims', {
      courseId: 'shvil-israel',
      walkedAt: Date.now() - 3600_000,
      distanceM: 12_000,
      photos: [],
    });
    expect(res.statusCode).toBe(400);
  });

  it('정상 접수 → 기준 인원(5명) 인정 투표 → 자동 산정·승인서 발행 → 폰 민팅', async () => {
    const res = await signedInject(app, walker, 'POST', '/claims', {
      courseId: 'shvil-israel',
      walkedAt: Date.now() - 3600_000,
      distanceM: 12_300, // 12.3km → 12.3 SHV
      photos: ['photo-hash-2', 'photo-hash-3'],
    });
    expect(res.statusCode).toBe(200);
    claimId = (res.json() as { claimId: number }).claimId;

    // 본인 투표 불가
    expect((await signedInject(app, walker, 'POST', `/claims/${claimId}/vote`)).statusCode).toBe(400);

    // 4표까지는 OPEN
    for (let i = 0; i < 4; i++) {
      const v = await signedInject(app, voters[i]!, 'POST', `/claims/${claimId}/vote`);
      expect((v.json() as { status: string }).status).toBe('OPEN');
    }
    // 중복 투표 불가
    expect((await signedInject(app, voters[0]!, 'POST', `/claims/${claimId}/vote`)).statusCode).toBe(409);

    // 5표째 → 승인 + 발행
    const fifth = await signedInject(app, voters[4]!, 'POST', `/claims/${claimId}/vote`);
    const body = fifth.json() as { status: string; amountDshv: number };
    expect(body.status).toBe('APPROVED');
    expect(body.amountDshv).toBe(123);

    // 승인서 조회 → 클레임 사용자 폰에서 민팅 → 계보 검증 (CommunityClaim)
    const detail = (await app.inject({ method: 'GET', url: `/claims/${claimId}` })).json() as { grant: SignedGrant };
    expect(detail.grant.kind).toBe('COMMUNITY_CLAIM');
    expect(detail.grant.reference).toContain(`claim:${claimId}:votes:5:`); // 게시물 해시 + 인정자 수
    const coin = mintGrantCoin(detail.grant);
    expect(verifyCoin(coin, { trustedIssuerKeys: trustedKeys }).valid).toBe(true);
    expect(coin.memberId).toBe(walker.memberId);
  });

  it('산정은 1일 40 SHV 상한을 준수한다 (60km 클레임 → 40 SHV)', async () => {
    const res = await signedInject(app, walker, 'POST', '/claims', {
      courseId: 'shvil-israel',
      walkedAt: Date.now() - 3600_000,
      distanceM: 60_000,
      photos: ['photo-hash-4'],
    });
    const id = (res.json() as { claimId: number }).claimId;
    for (let i = 0; i < 5; i++) await signedInject(app, voters[i]!, 'POST', `/claims/${id}/vote`);
    const detail = (await app.inject({ method: 'GET', url: `/claims/${id}` })).json() as { grant: SignedGrant };
    expect(detail.grant.amountDshv).toBe(400);
  });

  it('월 한도(2회) 초과 접수는 거부된다', async () => {
    const res = await signedInject(app, walker, 'POST', '/claims', {
      courseId: 'shvil-israel',
      walkedAt: Date.now() - 3600_000,
      distanceM: 5_000,
      photos: ['photo-hash-5'],
    });
    expect(res.statusCode).toBe(429);
  });
});

describe('완주 인증 게시판 — 격려 코인 (지시서 2.6)', () => {
  it('사진+데이터 완비 시 격려 코인 발행 (완주 10 SHV), 즉시 폰 민팅 가능', async () => {
    const res = await signedInject(app, walker, 'POST', '/certificates', {
      courseId: 'shvil-israel',
      kind: 'FULL',
      photos: ['summit-photo'],
      data: { distanceM: 120_000, days: 7 },
    });
    expect(res.statusCode).toBe(200);
    const { grant } = res.json() as { grant: SignedGrant };
    expect(grant.kind).toBe('COMMUNITY_REWARD');
    expect(grant.amountDshv).toBe(100);
    const coin = mintGrantCoin(grant);
    expect(verifyCoin(coin, { trustedIssuerKeys: trustedKeys }).valid).toBe(true);
  });

  it('데이터 미비 시 발행하지 않는다', async () => {
    const res = await signedInject(app, voters[0]!, 'POST', '/certificates', {
      courseId: 'shvil-israel',
      kind: 'FULL',
      photos: ['p'],
      data: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('같은 코스 중복 보상 없음 (1인 1코스 1회)', async () => {
    const res = await signedInject(app, walker, 'POST', '/certificates', {
      courseId: 'shvil-israel',
      kind: 'FULL',
      photos: ['another-photo'],
      data: { distanceM: 120_000 },
    });
    expect(res.statusCode).toBe(409);
  });

  it('구간 인증은 3 SHV, 갤러리에 공개된다', async () => {
    const res = await signedInject(app, voters[0]!, 'POST', '/certificates', {
      courseId: 'shvil-israel',
      kind: 'SECTION',
      photos: ['section-photo'],
      data: { section: '북부 1구간', distanceM: 17_000 },
    });
    expect((res.json() as { grant: SignedGrant }).grant.amountDshv).toBe(30);

    const gallery = (await app.inject({ method: 'GET', url: '/certificates?courseId=shvil-israel' })).json() as {
      certificates: unknown[];
    };
    expect(gallery.certificates.length).toBe(2);
  });
});

describe('탑 100 리더보드 + 기준선 + 소명 목록 (지시서 3장, 6장 7절)', () => {
  it('동의 없는 등재는 불가, 등재 정보는 거리·총량뿐 (위치 없음)', async () => {
    const noConsent = await signedInject(app, walker, 'POST', '/leaderboard/enroll', {
      region: 'israel-north',
      displayName: '워커',
      totalDistanceM: 1_200_000,
      totalMintedDshv: 9_000,
      consent: false,
    });
    expect(noConsent.statusCode).toBe(400);

    await signedInject(app, walker, 'POST', '/leaderboard/enroll', {
      region: 'israel-north',
      displayName: '워커',
      totalDistanceM: 1_200_000,
      totalMintedDshv: 9_000,
      consent: true,
    });
    await signedInject(app, voters[0]!, 'POST', '/leaderboard/enroll', {
      region: 'israel-north',
      displayName: '포터 A',
      totalDistanceM: 2_000_000,
      totalMintedDshv: 15_000,
      consent: true,
    });

    const res = await app.inject({ method: 'GET', url: '/leaderboard?region=israel-north' });
    const { leaderboard } = res.json() as { leaderboard: Record<string, unknown>[] };
    expect(leaderboard[0]!.displayName).toBe('포터 A'); // 생성 총량 내림차순
    expect(leaderboard[0]!.rank).toBe(1);
    for (const row of leaderboard) {
      expect(JSON.stringify(row)).not.toMatch(/lat|lon|location|coord/i);
    }
  });

  it('기준선 배포: 확정 상한 + 지역별 탑 기록', async () => {
    const res = await app.inject({ method: 'GET', url: '/limits/baseline' });
    const body = res.json() as { dailyMaxDshv: number; weeklyMaxDshv: number; regions: { region: string; topTotalMintedDshv: number }[] };
    expect(body.dailyMaxDshv).toBe(400);
    expect(body.weeklyMaxDshv).toBe(3000);
    expect(body.regions.find((r) => r.region === 'israel-north')?.topTotalMintedDshv).toBe(15_000);
  });

  it('소명 대기 목록: 등재 → 지갑 배포 → 소명 통과 시 해제', async () => {
    await app.inject({
      method: 'POST',
      url: '/limits/flagged',
      payload: { memberId: 'SHV-999999', reasonCode: 'MANUAL' },
    });
    let res = (await app.inject({ method: 'GET', url: '/limits/flagged' })).json() as {
      members: { memberId: string; reasonCode: string; params: Record<string, unknown> }[];
    };
    const entry = res.members.find((m) => m.memberId === 'SHV-999999');
    expect(entry).toBeDefined();
    // 사유는 코드 + 파라미터다 — 서버는 화면 문장을 만들지 않는다 (다국어는 클라이언트 책임).
    expect(entry!.reasonCode).toBe('MANUAL');
    expect(entry!.params).toEqual({});

    await app.inject({ method: 'POST', url: '/limits/flagged/SHV-999999/clear' });
    res = (await app.inject({ method: 'GET', url: '/limits/flagged' })).json() as {
      members: { memberId: string; reasonCode: string; params: Record<string, unknown> }[];
    };
    expect(res.members.some((m) => m.memberId === 'SHV-999999')).toBe(false);
  });

  it('알 수 없는 사유 코드는 거부된다 (자연어 사유 유입 차단)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/limits/flagged',
      payload: { memberId: 'SHV-999998', reasonCode: '기준선 추월' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('투명성 공시 (지시서 2.5-4, 2.6)', () => {
  it('클레임·격려 발행 총량과 코스 현황이 공시된다', async () => {
    const res = await app.inject({ method: 'GET', url: '/transparency/community' });
    const body = res.json() as {
      claims: { approved: number; issuedDshv: number };
      rewards: { issued: number; issuedDshv: number };
      courses: { official: number };
    };
    expect(body.claims.approved).toBe(2);
    expect(body.claims.issuedDshv).toBe(123 + 400);
    expect(body.rewards.issued).toBe(2);
    expect(body.rewards.issuedDshv).toBe(130);
    expect(body.courses.official).toBe(1);
  });
});
