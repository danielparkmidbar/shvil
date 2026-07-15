/**
 * 보물 마이닝 (M9) — 명세 배포·수량 한정 발행 회계·1인 1회.
 *
 * 확인 사항:
 *  - 서버가 받는 것은 treasureId + transcriptHash뿐 (이동 데이터·좌표 필드 없음).
 *  - amountDshv>0 → TREASURE 승인서 발행 (민팅은 폰), 0 → 스탬프 기록만.
 *  - 도메인 오류는 자연어가 아니라 코드다 (noUiStrings).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  mintGrantCoin,
  treasureTranscriptHash,
  verifyCoin,
  verifyDistribution,
  type SignedGrant,
  type TreasureSpec,
} from '@shvil/shared';
import { buildApp } from '../src/app';
import { register, signedInject, type TestIdentity } from './utils';

const app = buildApp({ dbPath: ':memory:', devMode: true });

const NOW = Date.now();
const DAY = 86_400_000;

function spec(overrides: Partial<TreasureSpec> = {}): TreasureSpec {
  return {
    treasureId: 'promo-galilee-1',
    regionId: 'israel-national',
    zone: { center: { lat: 33.23, lon: 35.65 }, radiusM: 60 },
    amountDshv: 50,
    totalCount: 2,
    validFrom: NOW - DAY,
    validUntil: NOW + DAY,
    legs: [
      { dir: 'N', steps: 10 },
      { dir: 'E', steps: 30 },
      { dir: 'S', steps: 3 },
    ],
    ...overrides,
  };
}

/** 폰 로컬 판정 성공을 가정한 성공 요약 해시 (서버는 이 해시만 본다). */
function transcriptFor(t: TreasureSpec, who: TestIdentity): string {
  return treasureTranscriptHash(
    t.treasureId,
    who.memberId,
    t.legs.map((l) => ({ dir: l.dir, steps: l.steps, measuredSteps: l.steps })),
  );
}

let lior: TestIdentity;
let aviva: TestIdentity;
let noa: TestIdentity;
let trustedIssuerKeys: Record<string, string>;

beforeAll(async () => {
  await app.ready();
  lior = await register(app, '+972-50-tr-1', 'lior@tr.io', '리오르');
  aviva = await register(app, '+972-50-tr-2', 'aviva@tr.io', '아비바');
  noa = await register(app, '+972-50-tr-3', 'noa@tr.io', '노아');
  const keysRes = await app.inject({ method: 'GET', url: '/keys' });
  const { keys } = keysRes.json() as { keys: { keyId: string; publicKey: string; purpose: string }[] };
  trustedIssuerKeys = Object.fromEntries(
    keys.filter((k) => k.purpose !== 'MEMBERSHIP_ROOT' && k.purpose !== 'DISTRIBUTION').map((k) => [k.keyId, k.publicKey]),
  );
});

afterAll(async () => {
  await app.close();
});

describe('보물 등록 (devMode 시드) + 목록 배포', () => {
  it('개발 시드로 보물을 등록한다', async () => {
    const res = await app.inject({ method: 'POST', url: '/treasures', payload: { spec: spec() } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ treasureId: 'promo-galilee-1', registered: true });
  });

  it('중복 ID·형식 위반 명세를 거부한다', async () => {
    expect((await app.inject({ method: 'POST', url: '/treasures', payload: { spec: spec() } })).statusCode).toBe(409);
    const bad = await app.inject({
      method: 'POST',
      url: '/treasures',
      payload: { spec: spec({ treasureId: 'promo-bad', legs: [{ dir: 'N', steps: 999 }] }) },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: 'INVALID_TREASURE_SPEC' });
  });

  it('지역 필터 + 유효 기간 필터 + 배포 서명(H-3)이 적용된다', async () => {
    // 만료된 보물은 목록에 나오지 않아야 한다.
    await app.inject({
      method: 'POST',
      url: '/treasures',
      payload: { spec: spec({ treasureId: 'promo-expired', validFrom: NOW - 3 * DAY, validUntil: NOW - DAY }) },
    });
    const res = await app.inject({ method: 'GET', url: '/treasures?region=israel-national' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { treasures: (TreasureSpec & { remaining: number })[] };
    expect(verifyDistribution(body as never).valid).toBe(true);
    expect(body.treasures.map((t) => t.treasureId)).toEqual(['promo-galilee-1']);
    expect(body.treasures[0]!.remaining).toBe(2);
    expect(body.treasures[0]!.legs).toHaveLength(3); // 지시 포함 — 몸 수행 없이는 소용없다
    const other = await app.inject({ method: 'GET', url: '/treasures?region=camino-de-santiago' });
    expect((other.json() as { treasures: unknown[] }).treasures).toHaveLength(0);
  });
});

describe('획득 청구 — 수량 한정 발행 회계 (승인 아님)', () => {
  it('성공 요약 해시만으로 승인서를 발행하고, 폰 민팅 코인이 검증을 통과한다', async () => {
    const t = spec();
    const res = await signedInject(app, lior, 'POST', '/treasures/claim', {
      treasureId: t.treasureId,
      transcriptHash: transcriptFor(t, lior),
    });
    expect(res.statusCode).toBe(200);
    const { grant, amountDshv } = res.json() as { grant: SignedGrant; amountDshv: number };
    expect(amountDshv).toBe(50);
    expect(grant.kind).toBe('TREASURE');
    expect(grant.recipientPublicKey).toBe(lior.signer.publicKeyHex);
    // 지갑과 동일한 로컬 검증 — BONUS 계보 (걸음 코인으로 둔갑 불가).
    const coin = mintGrantCoin(grant);
    expect(verifyCoin(coin, { trustedIssuerKeys }).valid).toBe(true);
    expect(coin.amountDshv).toBe(50);
    expect(coin.memberId).toBe(lior.memberId);
  });

  it('1인 1회 — 중복 청구를 거부한다', async () => {
    const t = spec();
    const res = await signedInject(app, lior, 'POST', '/treasures/claim', {
      treasureId: t.treasureId,
      transcriptHash: transcriptFor(t, lior),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'TREASURE_ALREADY_CLAIMED' });
  });

  it('총량 소진 시 에러 코드 (자연어 금지)', async () => {
    const t = spec();
    // totalCount=2: 아비바가 2번째(마지막)를 가져가면 노아는 소진 코드를 받는다.
    const second = await signedInject(app, aviva, 'POST', '/treasures/claim', {
      treasureId: t.treasureId,
      transcriptHash: transcriptFor(t, aviva),
    });
    expect(second.statusCode).toBe(200);
    const third = await signedInject(app, noa, 'POST', '/treasures/claim', {
      treasureId: t.treasureId,
      transcriptHash: transcriptFor(t, noa),
    });
    expect(third.statusCode).toBe(409);
    expect(third.json()).toEqual({ error: 'TREASURE_EXHAUSTED' });
  });

  it('유효 기간 밖 청구를 거부한다', async () => {
    const res = await signedInject(app, lior, 'POST', '/treasures/claim', {
      treasureId: 'promo-expired',
      transcriptHash: 'a'.repeat(64),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'TREASURE_OUT_OF_VALIDITY' });
  });

  it('미지의 보물·형식 위반을 거부한다', async () => {
    const unknown = await signedInject(app, lior, 'POST', '/treasures/claim', {
      treasureId: 'no-such-treasure',
      transcriptHash: 'a'.repeat(64),
    });
    expect(unknown.statusCode).toBe(404);
    const badHash = await signedInject(app, lior, 'POST', '/treasures/claim', {
      treasureId: 'promo-galilee-1',
      transcriptHash: '이동데이터아님',
    });
    expect(badHash.statusCode).toBe(400);
    expect(badHash.json()).toEqual({ error: 'BAD_TRANSCRIPT_HASH' });
    const unauth = await app.inject({
      method: 'POST',
      url: '/treasures/claim',
      payload: { treasureId: 'promo-galilee-1', transcriptHash: 'a'.repeat(64) },
    });
    expect(unauth.statusCode).toBe(401);
  });

  it('무보상 인증 미션(amountDshv=0)은 스탬프 기록만 반환한다 (코인 없음)', async () => {
    const stampSpec = spec({ treasureId: 'stamp-north-gate', amountDshv: 0, totalCount: 100 });
    await app.inject({ method: 'POST', url: '/treasures', payload: { spec: stampSpec } });
    const res = await signedInject(app, lior, 'POST', '/treasures/claim', {
      treasureId: stampSpec.treasureId,
      transcriptHash: transcriptFor(stampSpec, lior),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ treasureId: 'stamp-north-gate', amountDshv: 0, stamp: true });
  });
});

describe('투명성 공시 + 위치 비저장', () => {
  it('/transparency/promo에 보물 집계(숫자만)가 포함된다', async () => {
    const res = await app.inject({ method: 'GET', url: '/transparency/promo' });
    const body = res.json() as { treasureIssued: number; treasureQuota: number };
    // 코인 보물 2건 + 스탬프 1건 = 3 발행, 총량 2 + 100 + 만료분 2 = 104.
    expect(body.treasureIssued).toBe(3);
    expect(body.treasureQuota).toBe(104);
  });

  it('서버 DB에 이동 데이터가 없다 — 청구 기록은 해시뿐이다', () => {
    const rows = app.db.prepare('SELECT * FROM treasure_claims').all() as Record<string, unknown>[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const cols = Object.keys(row);
      // 걸음·방향·좌표 컬럼이 존재하지 않는다 (몸 인증은 100% 폰 로컬).
      expect(cols).toEqual(['id', 'treasure_id', 'member_id', 'transcript_hash', 'grant_json', 'claimed_at']);
      expect(row.transcript_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
