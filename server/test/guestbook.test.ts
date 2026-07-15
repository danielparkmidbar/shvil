/**
 * 게스트북 (M7-A, 재조정 §4-5) — 엔젤이 받은 감사 카드를 자발 공개 게시.
 *
 * 서버는 E2E 감사 카드 원본을 못 본다 — 엔젤 서명으로 인증된 자발 게시만 신뢰한다
 * (신뢰 모델은 guestbook.ts 주석). 이 테스트는 게시→조회→철회 왕복과, 타 회원이
 * 남의 방명록을 조작하지 못함(서명 인증)을 확인한다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { newThanksCardId } from '@shvil/shared';
import { register, signedInject, type TestIdentity } from './utils';

const app = buildApp({ dbPath: ':memory:', devMode: true });
let aviva: TestIdentity; // 엔젤 (방명록 주인)
let noa: TestIdentity; // 다른 회원

function cardBody(overrides: Record<string, unknown> = {}) {
  return {
    cardId: newThanksCardId(),
    fromDisplayName: '리오르',
    template: 'TENT',
    message: '마당 텐트 자리와 따뜻한 차 정말 고마웠습니다.',
    journeyLine: '쉬빌 북부 구간을 걸었습니다',
    ...overrides,
  };
}

interface GuestbookCard {
  cardId: string;
  fromDisplayName: string;
  template: string;
  message: string;
  journeyLine: string | null;
  createdAt: number;
}

async function guestbookOf(memberId: string) {
  const res = await app.inject({ method: 'GET', url: `/guestbook?member=${encodeURIComponent(memberId)}` });
  return res.json() as { total: number; cards: GuestbookCard[] };
}

beforeAll(async () => {
  await app.ready();
  aviva = await register(app, '+972-50-gb-1', 'aviva@example.org', '아비바');
  noa = await register(app, '+972-50-gb-2', 'noa@example.org', '노아');
});

afterAll(async () => {
  await app.close();
});

describe('게스트북 게시 → 조회 → 철회 왕복', () => {
  const card = cardBody();

  it('엔젤이 받은 감사 카드를 게스트북에 게시한다', async () => {
    const res = await signedInject(app, aviva, 'POST', '/guestbook', card);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { published: boolean }).published).toBe(true);
  });

  it('공개 조회에 게시 카드가 닉네임·메시지로 보인다 (서명 불필요)', async () => {
    const view = await guestbookOf(aviva.memberId);
    expect(view.total).toBe(1);
    const entry = view.cards.find((c) => c.cardId === card.cardId)!;
    expect(entry.fromDisplayName).toBe('리오르');
    expect(entry.message).toBe(card.message);
    expect(entry.template).toBe('TENT');
  });

  it('공개 조회 응답에 회원 번호가 노출되지 않는다', async () => {
    const res = await app.inject({ method: 'GET', url: `/guestbook?member=${aviva.memberId}` });
    expect(res.body).not.toContain(aviva.memberId);
    expect(res.body).not.toContain(noa.memberId);
  });

  it('같은 카드 이중 게시는 409', async () => {
    const res = await signedInject(app, aviva, 'POST', '/guestbook', card);
    expect(res.statusCode).toBe(409);
  });

  it('엔젤이 자기 방명록의 카드를 철회한다', async () => {
    const res = await signedInject(app, aviva, 'DELETE', `/guestbook/${card.cardId}`);
    expect(res.statusCode).toBe(200);
    expect((await guestbookOf(aviva.memberId)).total).toBe(0);
  });
});

describe('서명 인증 — 남의 방명록에 못 쓴다', () => {
  it('서명 없이 게시할 수 없다 (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/guestbook', payload: cardBody() });
    expect(res.statusCode).toBe(401);
  });

  it('철회는 게시자(엔젤) 본인만 — 타 회원의 DELETE는 404 (자기 카드 아님)', async () => {
    const card = cardBody();
    await signedInject(app, aviva, 'POST', '/guestbook', card);
    // 노아가 아비바의 카드를 지우려 함 — angel_member_id가 달라 대상이 없다.
    const res = await signedInject(app, noa, 'DELETE', `/guestbook/${card.cardId}`);
    expect(res.statusCode).toBe(404);
    // 아비바의 방명록엔 그대로 남아 있다.
    expect((await guestbookOf(aviva.memberId)).total).toBe(1);
  });

  it('잘못된 cardId 형식은 400', async () => {
    const res = await signedInject(app, aviva, 'POST', '/guestbook', cardBody({ cardId: 'nope' }));
    expect(res.statusCode).toBe(400);
  });

  it('빈 메시지는 400', async () => {
    const res = await signedInject(app, aviva, 'POST', '/guestbook', cardBody({ message: '   ' }));
    expect(res.statusCode).toBe(400);
  });

  it('템플릿 enum 위반은 400', async () => {
    const res = await signedInject(app, aviva, 'POST', '/guestbook', cardBody({ template: 'PARTY' }));
    expect(res.statusCode).toBe(400);
  });
});
