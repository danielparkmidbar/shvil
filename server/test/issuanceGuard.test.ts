/**
 * 무제한 발행구 봉쇄 (2026-07-26 — docs/발행경로_실측_2026-07-26.md의 구멍 4개).
 *
 * ① POST /certificates: courseId 무검증 → 임의 문자열로 무한 발행 (가장 큰 구멍)
 * ② POST /claims: courseId 무검증 → 존재하지 않는 코스로 클레임
 * ③ POST /angels/first-hosting: 수량 한정 부재 (등록 보너스와 비대칭)
 * ④ POST /angels/first-hosting: 증빙 코인 금액 하한 부재 (0.1 SHV로 30 SHV 수령)
 *
 * 각 항목을 **차단**과 **정직한 사용자 통과** 두 방향에서 확인한다. 방어가 정직한
 * 사용자를 막으면 그것도 실패다 (제7조 — 순환이 끊긴다).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RECOMMENDED_PRICES_DSHV,
  acceptPayment,
  buildCharge,
  buildPayment,
  splitCoin,
  verifyCoin,
  type Coin,
  type SignedGrant,
} from '@shvil/shared';
import { HOSTING_EVIDENCE_MIN_DSHV, buildApp } from '../src/app';
import { distributedCourses, isKnownCourse, knownCourseIds } from '../src/courses';
import { T0, mintWalkCoinFor, register, signedInject, type TestIdentity } from './utils';

// 승격 기준 3명 (테스트 축소) — 커뮤니티가 올린 코스도 발행 대상이 되는지 확인하기 위해.
const app = buildApp({ dbPath: ':memory:', promotionThreshold: 3, claimVoteThreshold: 5, devMode: true });

let walker: TestIdentity;
let voters: TestIdentity[] = [];

beforeAll(async () => {
  await app.ready();
  walker = await register(app, '+82-10-7000', 'guard-walker@example.org', '가드워커');
  for (let i = 0; i < 5; i++) {
    voters.push(await register(app, `+82-10-71${i}0`, `guard-voter${i}@example.org`, `가드투표자${i}`));
  }
});

afterAll(async () => {
  await app.close();
});

describe('단일 진실 원천 — 발행 판정은 GET /courses가 내보내는 것과 정확히 같다', () => {
  it('knownCourseIds는 GET /courses 응답의 코스 ID 집합과 일치한다', async () => {
    const body = (await app.inject({ method: 'GET', url: '/courses' })).json() as {
      courses: { courseId: string }[];
    };
    const served = body.courses.map((c) => c.courseId).sort();
    expect([...knownCourseIds(app.db)].sort()).toEqual(served);
    expect(distributedCourses(app.db).map((c) => c.courseId).sort()).toEqual(served);
    // 배포되는 것은 전부 발행 가능한 코스여야 한다 (앱에 보이는데 서버가 거부 = 오탐).
    for (const courseId of served) expect(isKnownCourse(app.db, courseId)).toBe(true);
  });

  it('기본 배포 코스는 이스라엘 + 분당–불곡산이다', async () => {
    const body = (await app.inject({ method: 'GET', url: '/courses' })).json() as {
      courses: { courseId: string }[];
    };
    expect(body.courses.map((c) => c.courseId)).toEqual(['shvil-israel', 'bundang-bulgoksan']);
  });

  it('Milford Track은 배포 목록에 없다 — 허가·예약제 트레일 1차 제외 (세계코스_활성화_계획 §3-A)', () => {
    // 지갑 폴백·WORLD_TRAILS(COMING_SOON)에도 없으므로 거부해도 정직한 사용자가 막히지 않는다.
    expect(isKnownCourse(app.db, 'milford-track')).toBe(false);
  });
});

describe('① 완주 인증(격려 코인) — courseId 대조 (server/src/community.ts)', () => {
  it('★임의 문자열 courseId는 거부된다 (무한 발행구 차단)', async () => {
    for (const bogus of ['a', 'b', 'not-a-course', 'shvil-israel-2', '../shvil-israel']) {
      const res = await signedInject(app, walker, 'POST', '/certificates', {
        courseId: bogus,
        kind: 'FULL',
        photos: ['photo'],
        data: { distanceM: 120_000 },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { code: string }).code).toBe('UNKNOWN_COURSE');
    }
    // 거부는 기록도 발행도 남기지 않는다.
    const gallery = (await app.inject({ method: 'GET', url: '/certificates' })).json() as {
      certificates: unknown[];
    };
    expect(gallery.certificates.length).toBe(0);
  });

  it('실제 코스를 걸은 사람은 그대로 발행받는다 (정직한 사용자 통과)', async () => {
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
  });

  it('닫힌 시험용 국내 코스(분당–불곡산)도 통과한다', async () => {
    const res = await signedInject(app, walker, 'POST', '/certificates', {
      courseId: 'bundang-bulgoksan',
      kind: 'SECTION',
      photos: ['bulgoksan-photo'],
      data: { distanceM: 1_600 },
    });
    expect(res.statusCode).toBe(200);
  });

  it('커뮤니티가 공식 승격시킨 코스는 승격 즉시 발행 대상이 된다', async () => {
    const proposal = {
      courseId: 'guard-olle',
      name: 'Guard Olle (proposal)',
      polyline: [
        { lat: 33.4996, lon: 126.9089 },
        { lat: 33.4922, lon: 126.9257 },
      ],
    };
    await signedInject(app, walker, 'POST', '/courses/proposals', proposal);

    // 후보(CANDIDATE) 단계에서는 배포되지 않으므로 발행도 막힌다 — 배포 목록과 일치.
    const early = await signedInject(app, walker, 'POST', '/certificates', {
      courseId: 'guard-olle',
      kind: 'FULL',
      photos: ['p'],
      data: { distanceM: 15_000 },
    });
    expect(early.statusCode).toBe(400);
    expect((early.json() as { code: string }).code).toBe('UNKNOWN_COURSE');

    // 3명 완주 기록 → 공식 승격
    for (let i = 0; i < 3; i++) {
      await signedInject(app, voters[i]!, 'POST', '/courses/guard-olle/completions', {
        distanceM: 15_000,
        days: 1,
      });
    }
    const after = await signedInject(app, walker, 'POST', '/certificates', {
      courseId: 'guard-olle',
      kind: 'FULL',
      photos: ['p'],
      data: { distanceM: 15_000 },
    });
    expect(after.statusCode).toBe(200);
  });
});

describe('② 클레임 — courseId 대조 (server/src/community.ts)', () => {
  it('존재하지 않는 코스의 클레임은 접수되지 않는다', async () => {
    const res = await signedInject(app, walker, 'POST', '/claims', {
      courseId: 'ghost-course',
      walkedAt: Date.now() - 3600_000,
      distanceM: 12_000,
      photos: ['photo-hash-1'],
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('UNKNOWN_COURSE');
    const list = (await app.inject({ method: 'GET', url: '/claims' })).json() as { claims: unknown[] };
    expect(list.claims.length).toBe(0);
  });

  it('실제 코스의 클레임은 접수되고 5표로 승인된다 (정직한 사용자 통과)', async () => {
    const res = await signedInject(app, walker, 'POST', '/claims', {
      courseId: 'shvil-israel',
      walkedAt: Date.now() - 3600_000,
      distanceM: 12_300,
      photos: ['photo-hash-2'],
    });
    expect(res.statusCode).toBe(200);
    const claimId = (res.json() as { claimId: number }).claimId;
    for (let i = 0; i < 5; i++) await signedInject(app, voters[i]!, 'POST', `/claims/${claimId}/vote`);
    const detail = (await app.inject({ method: 'GET', url: `/claims/${claimId}` })).json() as {
      status: string;
      grant: SignedGrant;
    };
    expect(detail.status).toBe('APPROVED');
    expect(detail.grant.amountDshv).toBe(123);
  });
});

describe('③④ 첫 접대 보너스 — 수량 한정 + 증빙 금액 하한 (server/src/app.ts)', () => {
  /** 엔젤 가입·등록 → 손님이 amountDshv를 지불 → 수령 코인을 돌려준다. */
  async function hostedCoin(
    target: ReturnType<typeof buildApp>,
    angel: TestIdentity,
    guest: TestIdentity,
    amountDshv: number,
    walkKm: number,
  ): Promise<Coin> {
    const walkCoin = mintWalkCoinFor(guest, walkKm, T0);
    const charge = buildCharge(
      {
        chargeId: `chg-${angel.memberId}-${amountDshv}`,
        angelMemberId: angel.memberId,
        amountDshv,
        serviceType: 'SHOWER',
        createdAt: Date.now(),
      },
      angel.signer,
    );
    const rest = walkCoin.amountDshv - amountDshv;
    const parts = rest > 0 ? splitCoin(walkCoin, guest.signer, [amountDshv, rest], Date.now()) : [walkCoin];
    const payment = buildPayment(charge, [parts[0]!], guest.memberId, guest.signer, Date.now());
    const received = acceptPayment(charge, payment, angel.signer).coins[0]!;
    expect(verifyCoin(received).valid).toBe(true);
    return received;
  }

  async function registerAngel(target: ReturnType<typeof buildApp>, who: TestIdentity): Promise<void> {
    const res = await signedInject(target, who, 'PUT', '/angels/me', {
      name: `${who.memberId} house`,
      location: { lat: 33.229, lon: 35.655 },
      services: { shower: true },
      visible: true,
    });
    expect(res.statusCode).toBe(200);
  }

  it('④ 하한 미만(1 dSHV = 0.1 SHV) 증빙은 30 SHV를 받지 못한다', async () => {
    const angel = await register(app, '+82-10-7300', 'tiny-angel@example.org', '작은엔젤');
    const guest = await register(app, '+82-10-7301', 'tiny-guest@example.org', '작은손님');
    await registerAngel(app, angel);
    const coin = await hostedCoin(app, angel, guest, 1, 5); // 0.1 SHV
    const res = await signedInject(app, angel, 'POST', '/angels/first-hosting', { coin });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('EVIDENCE_BELOW_MINIMUM');
  });

  it('④ 하한은 권장 가격표의 가장 싼 접대(샤워 30 dSHV)다 — 샤워만 내어준 엔젤도 받는다', async () => {
    expect(HOSTING_EVIDENCE_MIN_DSHV).toBe(RECOMMENDED_PRICES_DSHV.SHOWER);
    expect(HOSTING_EVIDENCE_MIN_DSHV).toBe(30);
    const angel = await register(app, '+82-10-7310', 'shower-angel@example.org', '샤워엔젤');
    const guest = await register(app, '+82-10-7311', 'shower-guest@example.org', '샤워손님');
    await registerAngel(app, angel);
    const coin = await hostedCoin(app, angel, guest, HOSTING_EVIDENCE_MIN_DSHV, 5);
    const res = await signedInject(app, angel, 'POST', '/angels/first-hosting', { coin });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { grant: SignedGrant }).grant.amountDshv).toBe(300); // 30 SHV
  });

  it('③ 수량이 소진되면 더 발행하지 않는다 — 그리고 증빙 코인을 소모하지 않는다', async () => {
    // quota 1명분 서버: 첫 엔젤은 받고, 두 번째 엔젤은 409로 막힌다.
    const small = buildApp({ dbPath: ':memory:', firstHostingQuota: 1, devMode: true });
    await small.ready();
    const first = await register(small, '+82-10-7400', 'q1@example.org', '엔젤1');
    const second = await register(small, '+82-10-7401', 'q2@example.org', '엔젤2');
    const guest = await register(small, '+82-10-7402', 'qg@example.org', '손님');
    await registerAngel(small, first);
    await registerAngel(small, second);

    const coin1 = await hostedCoin(small, first, guest, 100, 20);
    const ok = await signedInject(small, first, 'POST', '/angels/first-hosting', { coin: coin1 });
    expect(ok.statusCode).toBe(200);

    // 걷기 거리를 달리해 앞의 코인과 다른 계보를 만든다 (같은 증명은 같은 코인 ID가 된다).
    const coin2 = await hostedCoin(small, second, guest, 100, 21);
    const blocked = await signedInject(small, second, 'POST', '/angels/first-hosting', { coin: coin2 });
    expect(blocked.statusCode).toBe(409);
    expect((blocked.json() as { code: string }).code).toBe('FIRST_HOSTING_QUOTA_EXHAUSTED');
    // 소진 시 증빙 코인은 기록되지 않는다 — 나중에 quota가 늘면 그대로 쓸 수 있어야 한다.
    const evidence = small.db.prepare('SELECT COUNT(*) AS n FROM hosting_evidence').get() as { n: number };
    expect(evidence.n).toBe(1);

    // 공시: 등록과 나란히 첫 접대 수량 한정이 공개된다.
    const promo = (await small.inject({ method: 'GET', url: '/transparency/promo' })).json() as {
      firstHostingIssued: number;
      firstHostingQuota: number;
    };
    expect(promo.firstHostingIssued).toBe(1);
    expect(promo.firstHostingQuota).toBe(1);
    await small.close();
  });

  it('③ 기본 수량 한정은 등록 보너스와 같은 500명분이다', async () => {
    const promo = (await app.inject({ method: 'GET', url: '/transparency/promo' })).json() as {
      registrationQuota: number;
      firstHostingQuota: number;
    };
    expect(promo.firstHostingQuota).toBe(500);
    expect(promo.firstHostingQuota).toBe(promo.registrationQuota);
  });
});

describe('소급 무효화 금지 — 새 규칙이 옛 화폐를 가짜로 만들지 않는다', () => {
  it('규칙 도입 전에 저장된 임의 courseId 레코드는 그대로 조회된다', async () => {
    // 옛 데이터를 직접 넣어 재현한다 (라우트로는 더 이상 만들 수 없다).
    app.db
      .prepare(
        'INSERT INTO certificates (member_id, course_id, kind, photos_json, data_json, grant_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(walker.memberId, 'legacy-course', 'FULL', '["p"]', '{"distanceM":1}', '{"amountDshv":100}', Date.now());
    const gallery = (await app.inject({ method: 'GET', url: '/certificates?courseId=legacy-course' })).json() as {
      certificates: { courseId: string }[];
    };
    expect(gallery.certificates.length).toBe(1);
    expect(gallery.certificates[0]!.courseId).toBe('legacy-course');
  });
});
