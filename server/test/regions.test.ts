/**
 * 지역(트레일) 카탈로그 배포 + 엔젤 지역 필터 (150개국 확장).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyDistribution } from '@shvil/shared';
import { buildApp } from '../src/app';
import { register, signedInject, type TestIdentity } from './utils';

const app = buildApp({ dbPath: ':memory:', devMode: true });
let aviva: TestIdentity;

beforeAll(async () => {
  await app.ready();
  aviva = await register(app, '+972-50-region', 'r@x.io', '아비바');
});

afterAll(async () => {
  await app.close();
});

describe('세계 트레일 지역 배포 (/regions)', () => {
  it('지역 카탈로그가 배포 서명과 함께 내려온다', async () => {
    const res = await app.inject({ method: 'GET', url: '/regions' });
    const raw = res.json() as never;
    expect(verifyDistribution(raw).valid).toBe(true);
    const body = res.json() as { regions: { regionId: string; status: string }[]; targetCountryCount: number };
    expect(body.targetCountryCount).toBe(150);
    expect(body.regions.find((r) => r.regionId === 'israel-national')?.status).toBe('LIVE');
    expect(body.regions.some((r) => r.status === 'COMING_SOON')).toBe(true);
  });
});

describe('엔젤 지역 필터', () => {
  it('엔젤 등록 시 지역 미지정이면 이스라엘로 귀속된다', async () => {
    await signedInject(app, aviva, 'PUT', '/angels/me', {
      name: '아비바의 집',
      location: { lat: 33.229, lon: 35.655 },
      services: { bed: 'ROOM' },
      visible: true,
    });
    const res = await app.inject({ method: 'GET', url: '/angels?region=israel-national' });
    const angels = (res.json() as { angels: { memberId: string; regionId: string }[] }).angels;
    const mine = angels.find((a) => a.memberId === aviva.memberId);
    expect(mine?.regionId).toBe('israel-national');
  });

  it('아직 열리지 않은 지역엔 다른 지역 필터로 안 잡힌다', async () => {
    const res = await app.inject({ method: 'GET', url: '/angels?region=camino-de-santiago' });
    expect((res.json() as { angels: unknown[] }).angels).toHaveLength(0);
  });

  it('LIVE가 아닌 지역으로는 엔젤 등록이 거부된다', async () => {
    const res = await signedInject(app, aviva, 'PUT', '/angels/me', {
      name: '아비바의 집',
      location: { lat: 33.229, lon: 35.655 },
      services: { bed: 'ROOM' },
      visible: true,
      regionId: 'camino-de-santiago',
    });
    expect(res.statusCode).toBe(400);
  });
});
