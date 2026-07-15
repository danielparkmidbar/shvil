/**
 * 회귀 방지: 서버는 UI 문구를 반환하지 않는다.
 *
 * 다국어는 전적으로 클라이언트(웹·지갑)의 책임이다 — 서버가 자연어 문장을 응답에
 * 담으면 어떤 클라이언트도 그것을 번역할 수 없다. 실제로 GET /transparency/market이
 * 한국어 note를 내려보내 shvilangel.org의 영어 투명성 페이지에 한국어가 노출된 적이
 * 있다. 이 테스트는 공개 GET 응답에서 (1) 한글이 한 글자도 없고 (2) 설명용 note 필드가
 * 없음을 확인한다. 응답은 숫자·코드·ID여야 한다.
 *
 * 사용자 자유 텍스트(엔젤 이름·접대 조건·리더보드 표시명 등)는 번역 대상이 아니므로
 * 이 검사의 대상이 아니다 — 여기서는 그런 필드가 없는 엔드포인트만 확인한다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

const HANGUL = /[가-힣㄰-㆏]/;

const app = buildApp({ dbPath: ':memory:', devMode: true });

beforeAll(async () => {
  await app.ready();
  // 소명 대기 목록이 빈 배열이 아니어야 사유 필드까지 검사된다.
  await app.inject({
    method: 'POST',
    url: '/limits/flagged',
    payload: { memberId: 'SHV-000001', reasonCode: 'OVERPRODUCTION_DAILY', params: { date: '2026-07-14', totalDshv: 500, limitDshv: 400 } },
  });
  // 보물 목록도 빈 배열이 아니어야 명세 필드까지 검사된다 (M9).
  await app.inject({
    method: 'POST',
    url: '/treasures',
    payload: {
      spec: {
        treasureId: 'promo-noui-1',
        regionId: 'israel-national',
        zone: { center: { lat: 33.23, lon: 35.65 }, radiusM: 60 },
        amountDshv: 50,
        totalCount: 10,
        validFrom: Date.now() - 1000,
        validUntil: Date.now() + 86_400_000,
        legs: [{ dir: 'N', steps: 10 }],
      },
    },
  });
});

afterAll(async () => {
  await app.close();
});

/** 중첩 객체 어디에도 자연어 설명 필드(note)가 없어야 한다. */
function findNoteKey(value: unknown, path = '$'): string | null {
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) {
      const hit = findNoteKey(v, `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'note') return `${path}.${k}`;
      const hit = findNoteKey(v, `${path}.${k}`);
      if (hit) return hit;
    }
  }
  return null;
}

const PUBLIC_GETS = [
  '/keys',
  '/courses',
  '/treasures',
  '/limits/baseline',
  '/limits/flagged',
  '/transparency/promo',
  '/transparency/market',
  '/transparency/community',
  '/transparency/anomalies',
];

describe('서버는 UI 문구를 반환하지 않는다 (다국어는 클라이언트 책임)', () => {
  it.each(PUBLIC_GETS)('%s 응답에 한글이 없다', async (url) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toMatch(HANGUL);
  });

  it.each(PUBLIC_GETS)('%s 응답에 설명용 note 필드가 없다', async (url) => {
    const body = (await app.inject({ method: 'GET', url })).json() as unknown;
    expect(findNoteKey(body)).toBeNull();
  });

  it('소명 사유는 코드 + 파라미터로 나간다 (자연어 문장 아님)', async () => {
    const body = (await app.inject({ method: 'GET', url: '/limits/flagged' })).json() as {
      members: { memberId: string; reasonCode: string; params: Record<string, unknown> }[];
    };
    const entry = body.members.find((m) => m.memberId === 'SHV-000001');
    expect(entry?.reasonCode).toBe('OVERPRODUCTION_DAILY');
    expect(entry?.params).toEqual({ date: '2026-07-14', totalDshv: 500, limitDshv: 400 });
  });
});
