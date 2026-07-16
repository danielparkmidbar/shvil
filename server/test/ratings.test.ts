/**
 * 상호 별점 (M7-B, 별점_프라이버시_결정 안 B) — 피평가자가 받은 별점을 자발 공개 게시.
 *
 * 게스트북과 같은 신뢰 모델: 서버는 E2E 별점 원본을 못 본다 — 피평가자 서명으로
 * 인증된 자발 게시만 신뢰한다. 이 테스트는 게시→조회→철회 왕복, 타인이 남의 별점을
 * 게시·삭제하지 못함(서명), 집계(평균·공개율 분모)·회원 번호 비노출을 확인한다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { newRatingId } from '@shvil/shared';
import { register, signedInject, type TestIdentity } from './utils';

const app = buildApp({ dbPath: ':memory:', devMode: true });
let aviva: TestIdentity; // 피평가자 (엔젤 — 프로필 주인)
let noa: TestIdentity; // 다른 회원

function ratingBody(overrides: Record<string, unknown> = {}) {
  return {
    ratingId: newRatingId(),
    stars: 5,
    review: '따뜻하게 맞아주셔서 북쪽 구간을 잘 이어 걸었습니다.',
    fromDisplayName: '리오르',
    direction: 'GUEST_TO_ANGEL',
    ...overrides,
  };
}

interface RatingView {
  averageTenths: number;
  publicCount: number;
  receivedCount: number;
  ratings: {
    ratingId: string;
    stars: number;
    review: string | null;
    fromDisplayName: string;
    direction: string;
    createdAt: number;
  }[];
}

async function ratingsOf(memberId: string): Promise<RatingView> {
  const res = await app.inject({ method: 'GET', url: `/ratings?member=${encodeURIComponent(memberId)}` });
  return res.json() as RatingView;
}

beforeAll(async () => {
  await app.ready();
  aviva = await register(app, '+972-50-rat-1', 'aviva-rat@example.org', '아비바');
  noa = await register(app, '+972-50-rat-2', 'noa-rat@example.org', '노아');
});

afterAll(async () => {
  await app.close();
});

describe('별점 게시 → 조회 → 철회 왕복', () => {
  const rating = ratingBody({ stars: 4, receivedCount: 3 });

  it('피평가자가 받은 별점을 게시한다 (공개율 분모 자발 신고 포함)', async () => {
    const res = await signedInject(app, aviva, 'POST', '/ratings', rating);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { published: boolean }).published).toBe(true);
  });

  it('공개 조회에 별점이 닉네임·후기·별수로 보인다 (서명 불필요)', async () => {
    const view = await ratingsOf(aviva.memberId);
    expect(view.publicCount).toBe(1);
    expect(view.averageTenths).toBe(40); // 별 4 → 4.0 → 40
    // 받은 총 개수(자발 신고) — 공개율 = 1/3
    expect(view.receivedCount).toBe(3);
    const entry = view.ratings.find((r) => r.ratingId === rating.ratingId)!;
    expect(entry.fromDisplayName).toBe('리오르');
    expect(entry.stars).toBe(4);
    expect(entry.direction).toBe('GUEST_TO_ANGEL');
  });

  it('공개 조회 응답에 회원 번호가 노출되지 않는다 (프라이버시 핵심)', async () => {
    const res = await app.inject({ method: 'GET', url: `/ratings?member=${aviva.memberId}` });
    expect(res.body).not.toContain(aviva.memberId);
    expect(res.body).not.toContain(noa.memberId);
  });

  it('같은 별점 이중 게시는 409', async () => {
    const res = await signedInject(app, aviva, 'POST', '/ratings', rating);
    expect(res.statusCode).toBe(409);
  });

  it('집계가 정확하다 (별 4·5·5 → 평균 4.7 → 47, 게시 3)', async () => {
    await signedInject(app, aviva, 'POST', '/ratings', ratingBody({ stars: 5 }));
    await signedInject(app, aviva, 'POST', '/ratings', ratingBody({ stars: 5, receivedCount: 6 }));
    const view = await ratingsOf(aviva.memberId);
    expect(view.publicCount).toBe(3);
    expect(view.averageTenths).toBe(47);
    // 자발 신고 6개 받음 / 3개 공개 = 공개율 50%
    expect(view.receivedCount).toBe(6);
  });

  it('피평가자가 자기 프로필의 별점을 철회한다', async () => {
    const res = await signedInject(app, aviva, 'DELETE', `/ratings/${rating.ratingId}`);
    expect(res.statusCode).toBe(200);
    const view = await ratingsOf(aviva.memberId);
    expect(view.publicCount).toBe(2);
  });
});

describe('서명 인증 — 남의 별점에 못 쓴다', () => {
  it('서명 없이 게시할 수 없다 (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/ratings', payload: ratingBody() });
    expect(res.statusCode).toBe(401);
  });

  it('철회는 게시자(피평가자) 본인만 — 타 회원의 DELETE는 404 (자기 별점 아님)', async () => {
    const rating = ratingBody();
    await signedInject(app, aviva, 'POST', '/ratings', rating);
    // 노아가 아비바의 별점을 지우려 함 — subject_member_id가 달라 대상이 없다.
    const res = await signedInject(app, noa, 'DELETE', `/ratings/${rating.ratingId}`);
    expect(res.statusCode).toBe(404);
    // 아비바의 프로필엔 그대로 남아 있다 (노아가 남의 별점을 자기 것으로 못 옮긴다).
    const bad = await signedInject(app, noa, 'POST', '/ratings', { ...ratingBody(), ratingId: rating.ratingId });
    expect(bad.statusCode).toBe(409); // 이미 아비바가 게시한 rating_id
  });

  it('잘못된 ratingId 형식은 400', async () => {
    const res = await signedInject(app, aviva, 'POST', '/ratings', ratingBody({ ratingId: 'nope' }));
    expect(res.statusCode).toBe(400);
  });

  it('별점 범위 위반은 400', async () => {
    expect((await signedInject(app, aviva, 'POST', '/ratings', ratingBody({ stars: 0 }))).statusCode).toBe(400);
    expect((await signedInject(app, aviva, 'POST', '/ratings', ratingBody({ stars: 6 }))).statusCode).toBe(400);
  });

  it('방향 enum 위반은 400', async () => {
    const res = await signedInject(app, aviva, 'POST', '/ratings', ratingBody({ direction: 'SIDEWAYS' }));
    expect(res.statusCode).toBe(400);
  });

  it('member 미지정 GET은 400 (전체 나열 금지 — 관계 정찰 방지)', async () => {
    const res = await app.inject({ method: 'GET', url: '/ratings' });
    expect(res.statusCode).toBe(400);
  });
});

describe('게시 상한 — 무제한 쓰기 DoS 차단 (조건 3)', () => {
  it('피평가자당 게시 상한(200)을 넘으면 429', async () => {
    // 다른 회원과 격리해 고유한 상한을 채운다 (매 게시 고유 ratingId).
    const dos = await register(app, '+972-50-rat-dos', 'dos-rat@example.org', '도스');
    for (let i = 0; i < 200; i++) {
      const res = await signedInject(app, dos, 'POST', '/ratings', ratingBody());
      expect(res.statusCode).toBe(200);
    }
    // 201번째는 상한 초과 → 429 (자연어 아님: 코드 에러).
    const over = await signedInject(app, dos, 'POST', '/ratings', ratingBody());
    expect(over.statusCode).toBe(429);
  }, 30_000);
});

describe('프라이버시 자기점검 — 서버는 투숙 관계를 담지 않는다', () => {
  it('게시 본문에 관계 증명을 실어도 서버는 저장하지 않는다', async () => {
    const rating = ratingBody({
      // 지갑은 관계 증명을 보내지 않지만, 악의적 클라이언트가 실어도 서버는 무시한다.
      relationProof: { kind: 'BOOKING_APPROVAL', requestId: 'bkg-0011223344556677' },
    });
    await signedInject(app, aviva, 'POST', '/ratings', rating);
    const res = await app.inject({ method: 'GET', url: `/ratings?member=${aviva.memberId}` });
    // 응답 어디에도 관계 증명·회원 번호가 없다 — 평가자는 닉네임만 남는다.
    expect(res.body).not.toContain('relationProof');
    expect(res.body).not.toContain('bkg-0011223344556677');
    expect(res.body).not.toContain(aviva.memberId);
  });
});
