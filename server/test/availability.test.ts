/**
 * M6 예약 — 엔젤 "가능 여부" 자발 공개 (R-3).
 *
 * 서버가 아는 것은 "지금 손님을 받을 수 있는가"(available: boolean)와 갱신 시각뿐이다.
 * 구체 날짜·캘린더·신청 내용은 서버에 없다 — 전부 E2E 암호 메시지로만 오간다
 * (헌법 제9조: 서버는 예약을 승인하지 않는다. 릴레이 검증은 integration.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { register, signedInject, type TestIdentity } from './utils';

const app = buildApp({ dbPath: ':memory:', devMode: true });
let aviva: TestIdentity;

const PROFILE = {
  name: '아비바의 집',
  location: { lat: 33.229, lon: 35.655 },
  services: { bed: 'ROOM' },
  capacity: 3,
  visible: true,
};

interface AngelView {
  memberId: string;
  available: boolean;
  availabilityUpdatedAt: number | null;
}

async function angelOf(memberId: string): Promise<AngelView | undefined> {
  const res = await app.inject({ method: 'GET', url: '/angels' });
  return (res.json() as { angels: AngelView[] }).angels.find((a) => a.memberId === memberId);
}

beforeAll(async () => {
  await app.ready();
  aviva = await register(app, '+972-50-avail-1', 'aviva@example.org', '아비바');
});

afterAll(async () => {
  await app.close();
});

describe('엔젤 가능 여부 자발 공개 (M6, R-3)', () => {
  it('available 미지정 등록은 기본 가능(true)이고 갱신 시각은 비어 있다', async () => {
    const res = await signedInject(app, aviva, 'PUT', '/angels/me', PROFILE);
    expect(res.statusCode).toBe(200);
    const view = await angelOf(aviva.memberId);
    expect(view?.available).toBe(true);
    expect(view?.availabilityUpdatedAt).toBeNull();
  });

  it('available=false 갱신이 조회에 반영되고 갱신 시각이 찍힌다', async () => {
    const before = Date.now();
    const res = await signedInject(app, aviva, 'PUT', '/angels/me', { ...PROFILE, available: false });
    expect(res.statusCode).toBe(200);
    const view = await angelOf(aviva.memberId);
    expect(view?.available).toBe(false);
    expect(view?.availabilityUpdatedAt).toBeGreaterThanOrEqual(before);
  });

  it('available 미지정 프로필 갱신은 기존 가능 여부·갱신 시각을 유지한다', async () => {
    const kept = (await angelOf(aviva.memberId))!;
    await signedInject(app, aviva, 'PUT', '/angels/me', { ...PROFILE, capacity: 4 });
    const view = await angelOf(aviva.memberId);
    expect(view?.available).toBe(false);
    expect(view?.availabilityUpdatedAt).toBe(kept.availabilityUpdatedAt);
  });

  it('available=true로 되돌릴 수 있다 (엔젤의 자율 — 헌법 제9조)', async () => {
    await signedInject(app, aviva, 'PUT', '/angels/me', { ...PROFILE, available: true });
    const view = await angelOf(aviva.memberId);
    expect(view?.available).toBe(true);
  });

  it('가능 여부는 서명 인증 없이 갱신할 수 없다', async () => {
    const res = await app.inject({ method: 'PUT', url: '/angels/me', payload: { ...PROFILE, available: false } });
    expect(res.statusCode).toBe(401);
  });
});
