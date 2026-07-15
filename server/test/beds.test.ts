/**
 * 잠자리 복수 선택 — 유형별 수용 인원 (2026-07-15 다니엘 쌤 지시).
 *
 * services.beds = { room?, sofa?, tent? } (정수 1~20). 서버는 저장·반환만 하고
 * 숫자만 다룬다 (자연어 없음 — noUiStrings). 하위 호환: 옛 레코드(beds 없음)는
 * bed(단일)+capacity 그대로이며, 새 레코드도 bed(최다 유형)·capacity(합계)를
 * 파생값으로 함께 보낸다 — 옛 클라이언트도 계속 읽을 수 있다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { register, signedInject, type TestIdentity } from './utils';

const app = buildApp({ dbPath: ':memory:', devMode: true });
let noga: TestIdentity;

interface AngelView {
  memberId: string;
  services: { bed?: string; beds?: { room?: number; sofa?: number; tent?: number } };
  capacity: number;
}

async function angelOf(memberId: string): Promise<AngelView | undefined> {
  const res = await app.inject({ method: 'GET', url: '/angels' });
  return (res.json() as { angels: AngelView[] }).angels.find((a) => a.memberId === memberId);
}

beforeAll(async () => {
  await app.ready();
  noga = await register(app, '+972-50-beds-1', 'noga@example.org', '노가');
});

afterAll(async () => {
  await app.close();
});

describe('잠자리 유형별 수용 인원 (beds)', () => {
  it('beds 등록 → 조회 왕복: 유형별 인원과 파생 bed·capacity가 그대로 반환된다', async () => {
    const res = await signedInject(app, noga, 'PUT', '/angels/me', {
      name: '노가의 집',
      location: { lat: 33.229, lon: 35.655 },
      // bed = 인원이 가장 많은 유형(TENT), capacity = 합계 — 지갑이 파생해 보낸다.
      services: { bed: 'TENT', internet: true, shower: false, meal: true, beds: { room: 2, sofa: 1, tent: 4 } },
      capacity: 7,
      visible: true,
    });
    expect(res.statusCode).toBe(200);

    const view = await angelOf(noga.memberId);
    expect(view?.services.beds).toEqual({ room: 2, sofa: 1, tent: 4 });
    expect(view?.services.bed).toBe('TENT');
    expect(view?.capacity).toBe(7);
  });

  it('beds 방어 검증: 범위 밖·비정수·0은 버려지고, 전부 무효면 beds 자체가 사라진다', async () => {
    // 유효 항목(room)만 남는다 — sofa(0=미제공)·tent(21>한도)·잡음 키는 버려진다.
    await signedInject(app, noga, 'PUT', '/angels/me', {
      name: '노가의 집',
      location: { lat: 33.229, lon: 35.655 },
      services: { bed: 'ROOM', beds: { room: 3, sofa: 0, tent: 21, attic: 5 } },
      capacity: 3,
      visible: true,
    });
    let view = await angelOf(noga.memberId);
    expect(view?.services.beds).toEqual({ room: 3 });

    // 전부 무효 → beds 없는 옛 레코드와 같은 형태로 저장된다 (폴백 경로).
    await signedInject(app, noga, 'PUT', '/angels/me', {
      name: '노가의 집',
      location: { lat: 33.229, lon: 35.655 },
      services: { bed: 'SOFA', beds: { room: -1, sofa: 2.5, tent: '4' } },
      capacity: 2,
      visible: true,
    });
    view = await angelOf(noga.memberId);
    expect(view?.services.beds).toBeUndefined();
    expect(view?.services.bed).toBe('SOFA');
    expect(view?.capacity).toBe(2);
  });
});
