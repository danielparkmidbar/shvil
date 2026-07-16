/**
 * 동행 찾기 게시판 (M8, 재조정 §4-6) — 여정 공유 + 팀 모집.
 *
 * 게스트북·별점과 같은 자발 공개 모델. 이 테스트는 게시→조회(필터)→갱신(마감)→삭제
 * 왕복, 타인이 남의 글을 수정·삭제하지 못함(서명), OPEN 상한(스팸 방지), 그리고
 * ★서버가 확정 팀 관계를 저장하지 않음(관심 표명은 응답 어디에도 없음)을 확인한다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { COMPANION_OPEN_LIMIT } from '@shvil/shared';
import { register, signedInject, type TestIdentity } from './utils';

const app = buildApp({ dbPath: ':memory:', devMode: true });
let lior: TestIdentity; // 게시자
let noa: TestIdentity; // 다른 회원

function postBody(overrides: Record<string, unknown> = {}) {
  return {
    regionId: 'israel-national',
    courseId: 'shvil-israel',
    fromDate: '2026-08-01',
    toDate: '2026-08-05',
    partySizeCurrent: 1,
    partySizeTarget: 4,
    mode: 'WALK',
    displayName: '리오르',
    note: '북부 구간을 함께 걸을 3~4인 팀을 찾습니다.',
    ...overrides,
  };
}

interface Listing {
  postId: string;
  displayName: string;
  authorMemberId: string;
  messagingPublicKey: string;
  regionId: string;
  courseId: string | null;
  fromDate: string;
  toDate: string;
  partySizeCurrent: number;
  partySizeTarget: number;
  mode: string;
  note: string | null;
  status: string;
  createdAt: number;
}

async function listCompanions(query = ''): Promise<Listing[]> {
  const res = await app.inject({ method: 'GET', url: `/companions${query}` });
  return (res.json() as { companions: Listing[] }).companions;
}

beforeAll(async () => {
  await app.ready();
  lior = await register(app, '+972-50-cmp-1', 'lior-cmp@example.org', '리오르');
  noa = await register(app, '+972-50-cmp-2', 'noa-cmp@example.org', '노아');
});

afterAll(async () => {
  await app.close();
});

describe('게시 → 조회(필터) → 갱신 → 삭제 왕복', () => {
  let postId = '';

  it('게시자가 동행 모집 글을 등록한다 (게시자 서명)', async () => {
    const res = await signedInject(app, lior, 'POST', '/companions', postBody());
    expect(res.statusCode).toBe(200);
    const body = res.json() as { posted: boolean; postId: string };
    expect(body.posted).toBe(true);
    expect(body.postId).toMatch(/^cmp-[0-9a-f]{16}$/);
    postId = body.postId;
  });

  it('공개 조회에 여정·닉네임·연락 핸들이 보인다 (서명 불필요)', async () => {
    const list = await listCompanions('?region=israel-national&status=OPEN');
    const entry = list.find((c) => c.postId === postId)!;
    expect(entry.displayName).toBe('리오르');
    expect(entry.mode).toBe('WALK');
    expect(entry.partySizeTarget).toBe(4);
    expect(entry.status).toBe('OPEN');
    // 연락 라우팅 핸들 (엔젤 디렉토리와 동일) — 지갑 E2E 접촉·딥링크에 쓴다.
    expect(entry.authorMemberId).toBe(lior.memberId);
    expect(entry.messagingPublicKey).toBe(lior.msg.publicKeyHex);
  });

  it('지역·상태·게시자 필터가 동작한다', async () => {
    expect((await listCompanions('?region=camino-de-santiago')).some((c) => c.postId === postId)).toBe(false);
    expect((await listCompanions('?status=CLOSED')).some((c) => c.postId === postId)).toBe(false);
    expect((await listCompanions(`?author=${lior.memberId}`)).some((c) => c.postId === postId)).toBe(true);
  });

  it('게시자가 인원을 갱신한다 (현재 3인)', async () => {
    const res = await signedInject(app, lior, 'PUT', `/companions/${postId}`, { partySizeCurrent: 3 });
    expect(res.statusCode).toBe(200);
    const list = await listCompanions(`?author=${lior.memberId}`);
    expect(list.find((c) => c.postId === postId)!.partySizeCurrent).toBe(3);
  });

  it('게시자가 모집을 마감한다 (status=CLOSED → OPEN 목록에서 사라짐)', async () => {
    const res = await signedInject(app, lior, 'PUT', `/companions/${postId}`, { status: 'CLOSED' });
    expect(res.statusCode).toBe(200);
    expect((await listCompanions('?status=OPEN')).some((c) => c.postId === postId)).toBe(false);
    // 게시자 본인은 author 필터로 CLOSED 글을 계속 관리할 수 있다.
    expect((await listCompanions(`?author=${lior.memberId}`)).find((c) => c.postId === postId)!.status).toBe('CLOSED');
  });

  it('게시자가 글을 삭제한다', async () => {
    const res = await signedInject(app, lior, 'DELETE', `/companions/${postId}`);
    expect(res.statusCode).toBe(200);
    expect((await listCompanions(`?author=${lior.memberId}`)).some((c) => c.postId === postId)).toBe(false);
  });
});

describe('서명 인증 — 남의 글에 못 쓴다', () => {
  it('서명 없이 게시할 수 없다 (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/companions', payload: postBody() });
    expect(res.statusCode).toBe(401);
  });

  it('타인은 남의 글을 수정·삭제할 수 없다 (404 — 자기 글 아님)', async () => {
    const posted = (await signedInject(app, lior, 'POST', '/companions', postBody())).json() as { postId: string };
    const badUpdate = await signedInject(app, noa, 'PUT', `/companions/${posted.postId}`, { status: 'CLOSED' });
    expect(badUpdate.statusCode).toBe(404);
    const badDelete = await signedInject(app, noa, 'DELETE', `/companions/${posted.postId}`);
    expect(badDelete.statusCode).toBe(404);
    // 원 게시글은 그대로 OPEN이다.
    expect((await listCompanions('?status=OPEN')).find((c) => c.postId === posted.postId)!.status).toBe('OPEN');
    await signedInject(app, lior, 'DELETE', `/companions/${posted.postId}`);
  });

  it('잘못된 입력은 400 (지역·날짜·팀규모)', async () => {
    expect((await signedInject(app, lior, 'POST', '/companions', postBody({ regionId: 'nowhere' }))).statusCode).toBe(400);
    expect((await signedInject(app, lior, 'POST', '/companions', postBody({ fromDate: '2026-13-40' }))).statusCode).toBe(400);
    expect((await signedInject(app, lior, 'POST', '/companions', postBody({ partySizeTarget: 99 }))).statusCode).toBe(400);
  });
});

describe('스팸 방지 — 동시 OPEN 상한', () => {
  it(`author당 OPEN ${COMPANION_OPEN_LIMIT}개를 넘으면 429`, async () => {
    const spammer = await register(app, '+972-50-cmp-spam', 'spam-cmp@example.org', '스패머');
    for (let i = 0; i < COMPANION_OPEN_LIMIT; i++) {
      expect((await signedInject(app, spammer, 'POST', '/companions', postBody())).statusCode).toBe(200);
    }
    // 상한 초과 → 429 (자연어 아님: 코드 에러).
    expect((await signedInject(app, spammer, 'POST', '/companions', postBody())).statusCode).toBe(429);
    // 하나를 마감하면 다시 게시할 수 있다 (OPEN 개수 기준).
    const mine = await listCompanions(`?author=${spammer.memberId}&status=OPEN`);
    await signedInject(app, spammer, 'PUT', `/companions/${mine[0]!.postId}`, { status: 'CLOSED' });
    expect((await signedInject(app, spammer, 'POST', '/companions', postBody())).statusCode).toBe(200);
  });
});

describe('프라이버시 자기점검 — 서버는 확정 팀 관계를 모른다', () => {
  it('게시·조회 어디에도 "팀원·수락된 관심" 필드가 없다', async () => {
    const posted = (await signedInject(app, lior, 'POST', '/companions', postBody())).json() as { postId: string };
    // 악의적 클라이언트가 팀 관계를 실어 보내도 서버는 저장·반영하지 않는다.
    await signedInject(app, lior, 'PUT', `/companions/${posted.postId}`, {
      partySizeCurrent: 2,
      teamMembers: [noa.memberId],
      acceptedInterest: noa.memberId,
    });
    const res = await app.inject({ method: 'GET', url: `/companions?author=${lior.memberId}` });
    expect(res.body).not.toContain('teamMembers');
    expect(res.body).not.toContain('acceptedInterest');
    // 관심을 표명한 상대(노아)의 회원 번호는 게시글 어디에도 없다 — 관계는 E2E에만 있다.
    expect(res.body).not.toContain(noa.memberId);
    await signedInject(app, lior, 'DELETE', `/companions/${posted.postId}`);
  });
});
