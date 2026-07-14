/**
 * 지역(트레일) 카탈로그 배포 + 엔젤 지역 필터 (150개국 확장)
 * + 엔젤 위치 눈금화 (R-4 — 서버는 정확 좌표를 저장하지 않는다).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { snapToPrivacyGrid, verifyDistribution } from '@shvil/shared';
import { buildApp } from '../src/app';
import { register, signedInject, type TestIdentity } from './utils';

const app = buildApp({ dbPath: ':memory:', devMode: true });
let aviva: TestIdentity;
let noam: TestIdentity;

beforeAll(async () => {
  await app.ready();
  aviva = await register(app, '+972-50-region', 'r@x.io', '아비바');
  // 주의: phoneHash는 숫자만 남긴다 — aviva와 겹치지 않게 숫자로 구분.
  noam = await register(app, '+972-50-7040104', 'g@x.io', '노암');
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

describe('엔젤 위치 눈금화 (R-4 — 공개 좌표는 ~1km 눈금만)', () => {
  // 집 문 앞 수준의 정밀 좌표 — 서버에 이대로 남으면 안 된다.
  const precise = { lat: 33.229471, lon: 35.655318 };

  it('정밀 좌표로 등록해도 공개 응답의 좌표는 0.01° 눈금 위에 있다', async () => {
    const put = await signedInject(app, noam, 'PUT', '/angels/me', {
      name: '노암의 집',
      location: precise,
      services: { bed: 'SOFA' },
      visible: true,
    });
    expect(put.statusCode).toBe(200);

    const res = await app.inject({ method: 'GET', url: '/angels' });
    const angels = (res.json() as { angels: { memberId: string; location: { lat: number; lon: number } }[] }).angels;
    const mine = angels.find((a) => a.memberId === noam.memberId);
    expect(mine).toBeDefined();
    // 방어적 눈금화(클라이언트 불신) — 정밀 좌표가 그대로 나오면 안 된다.
    expect(mine!.location).toEqual(snapToPrivacyGrid(precise.lat, precise.lon));
    expect(mine!.location.lat).not.toBe(precise.lat);
    expect(mine!.location.lon).not.toBe(precise.lon);
    // 눈금 검증: ×100 하면 정수여야 한다.
    expect(Math.round(mine!.location.lat * 100) / 100).toBe(mine!.location.lat);
    expect(Math.round(mine!.location.lon * 100) / 100).toBe(mine!.location.lon);
  });

  it('눈금화가 지역 필터(region_id 귀속)를 깨지 않는다', async () => {
    const res = await app.inject({ method: 'GET', url: '/angels?region=israel-national' });
    const angels = (res.json() as { angels: { memberId: string; regionId: string }[] }).angels;
    const mine = angels.find((a) => a.memberId === noam.memberId);
    expect(mine?.regionId).toBe('israel-national');
  });
});
