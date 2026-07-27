/**
 * ★루트 시드 — "Render 재시작 한 번이면 설치된 폰의 코스 동기화가 영구히 죽는다"의 수리.
 *
 * 이 파일은 두 가지를 함께 못박는다:
 *  ① **사고 재현** — 시드가 없으면 재배포마다 다른 발행자가 된다(그대로 남겨 둔다).
 *  ② **수리 확인** — 같은 시드면 재배포해도 같은 키가 나오고, 지갑의 TOFU 핀이 유지된다.
 *
 * 그리고 ③ 시드가 **못 고치는 것**도 테스트로 적는다(제3조 정직화). 시드는 화폐의 권위를
 * 영속시킬 뿐 원장을 살리지 않는다 — 그 사실이 코드로 남아 있어야 나중에 착각하지 않는다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deriveDeploymentKeyPair,
  deriveKeyId,
  publicKeyFingerprint,
  verifyDistribution,
  verifyMembershipCertificate,
  type DistributionSig,
  type MembershipCertificate,
} from '@shvil/shared';
import { buildApp } from '../src/app';
import {
  DistributionPinMismatchError,
  guardDistribution,
} from '../../apps/wallet/src/core/distributionGuard';
import { mergePendingPinChange } from '../../apps/wallet/src/core/pinRecovery';
import { register, signedInject } from './utils';

type SignedResponse = Record<string, unknown> & { _sig?: DistributionSig };
interface KeyRow {
  keyId: string;
  publicKey: string;
  purpose: string;
}

/** 시험용 시드 2종 — 운영과 무관한 값. */
const SEED = 'a3f9'.repeat(16); // 64자
const OTHER_SEED = 'b7c2'.repeat(16);

/**
 * ★환경 격리 — 개발자 셸에 SHVIL_ROOT_SEED가 있으면 ①(사고 재현)이 조용히 거짓이 된다.
 * (키가 같아져서 "재배포하면 죽는다"가 재현되지 않는데, 그건 환경 때문이지 코드 때문이
 * 아니다.) 이 파일은 시드를 **명시적으로 주입**할 때만 시드 경로를 타야 한다.
 */
const savedSeed = process.env.SHVIL_ROOT_SEED;
const savedGen = process.env.SHVIL_KEY_GENERATION;
beforeAll(() => {
  delete process.env.SHVIL_ROOT_SEED;
  delete process.env.SHVIL_KEY_GENERATION;
});
afterAll(() => {
  if (savedSeed === undefined) delete process.env.SHVIL_ROOT_SEED;
  else process.env.SHVIL_ROOT_SEED = savedSeed;
  if (savedGen === undefined) delete process.env.SHVIL_KEY_GENERATION;
  else process.env.SHVIL_KEY_GENERATION = savedGen;
});

/** dbPath ':memory:' = 재배포마다 빈 디스크로 뜨는 것과 같다 (KEK는 vitest env로 동일). */
async function boot(opts: { rootSeed?: string; keyGeneration?: number } = {}) {
  const app = buildApp({ dbPath: ':memory:', devMode: true, ...opts });
  await app.ready();
  return app;
}

async function keysOf(app: Awaited<ReturnType<typeof boot>>): Promise<KeyRow[]> {
  const res = (await app.inject({ method: 'GET', url: '/keys' })).json() as SignedResponse & {
    keys: KeyRow[];
  };
  return res.keys;
}

// ── ① 사고 재현 — 시드가 없으면 재배포가 발행자를 갈아치운다 ──────────

describe('① 재배포 실측 — 시드가 없으면 무엇이 죽는가', () => {
  it('같은 KEK라도 DB가 비면 배포 키·발행 키·루트 키가 전부 새로 생성된다', async () => {
    const a = await boot();
    const b = await boot();
    try {
      expect(process.env.SHVIL_KEK ?? '').toBeDefined(); // KEK는 환경변수라 살아남는다
      // 이름이 공개키에서 유도되므로, 이름이 다르다 = 공개키가 다르다.
      expect(a.keyIds.distribution).not.toBe(b.keyIds.distribution);
      expect(a.keyIds.membershipRoot).not.toBe(b.keyIds.membershipRoot);
      expect(a.keyIds.promo).not.toBe(b.keyIds.promo);
      expect(a.keyIds.treasure).not.toBe(b.keyIds.treasure);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('첫 배포에 핀한 지갑은 재배포 후 /courses·/keys·/limits/flagged를 거부한다', async () => {
    const before = await boot();
    const after = await boot();
    try {
      const first = (await before.inject({ method: 'GET', url: '/courses' })).json() as SignedResponse;
      const { pinToStore } = guardDistribution(first as never, null);
      const pin = pinToStore!;
      expect(pin).toBeTruthy();

      for (const url of ['/courses', '/keys', '/limits/flagged']) {
        const res = (await after.inject({ method: 'GET', url })).json() as SignedResponse;
        expect(verifyDistribution(res as never).valid).toBe(true); // 서명 자체는 유효한데
        expect(() => guardDistribution(res as never, pin)).toThrow(/KEY_PIN_MISMATCH/); // 핀이 다르다
      }
    } finally {
      await before.close();
      await after.close();
    }
  });
});

// ── ② 수리 — 같은 시드면 재배포해도 같은 화폐다 ────────────────────

describe('② 시드 유도 — 재배포해도 같은 키·같은 핀', () => {
  it('★같은 시드 + 빈 DB로 두 번 기동해도 6개 키가 전부 같다', async () => {
    const a = await boot({ rootSeed: SEED });
    const b = await boot({ rootSeed: SEED });
    try {
      expect(b.keyIds).toEqual(a.keyIds);
      // 키 이름만이 아니라 공개키 자체가 같은지 /keys로 확인한다.
      const ka = await keysOf(a);
      const kb = await keysOf(b);
      expect(kb.map((k) => k.publicKey).sort()).toEqual(ka.map((k) => k.publicKey).sort());
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('★첫 배포에 핀한 지갑이 재배포 후에도 코스·키·소명 목록을 그대로 받는다 (3번 수리)', async () => {
    const before = await boot({ rootSeed: SEED });
    const after = await boot({ rootSeed: SEED });
    try {
      const first = (await before.inject({ method: 'GET', url: '/courses' })).json() as SignedResponse;
      const pin = guardDistribution(first as never, null).pinToStore!;
      expect(pin).toBeTruthy();

      // 배포 서명(_sig)이 붙는 6개 엔드포인트 전부 — 하나라도 막히면 그 기능이 죽는다.
      for (const url of ['/courses', '/keys', '/regions', '/limits/flagged', '/treasures', '/spot']) {
        const res = (await after.inject({ method: 'GET', url })).json() as SignedResponse;
        // 던지지 않는다 = 동기화가 산다. 그리고 재핀도 하지 않는다(핀은 그대로).
        expect(guardDistribution(res as never, pin).pinToStore).toBeNull();
      }
    } finally {
      await before.close();
      await after.close();
    }
  });

  it('시드가 다르면 다른 발행자다 (시드가 곧 발행 권위)', async () => {
    const a = await boot({ rootSeed: SEED });
    const b = await boot({ rootSeed: OTHER_SEED });
    try {
      expect(b.keyIds.distribution).not.toBe(a.keyIds.distribution);
      expect(b.keyIds.membershipRoot).not.toBe(a.keyIds.membershipRoot);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('규격 유도식과 서버가 실제로 쓰는 키가 일치한다 (제3의 구현이 검산할 수 있다)', async () => {
    const app = await boot({ rootSeed: SEED, keyGeneration: 2 });
    try {
      const root = deriveDeploymentKeyPair(SEED, 'MEMBERSHIP_ROOT', 2);
      expect(app.keyIds.membershipRoot).toBe(deriveKeyId('MEMBERSHIP_ROOT', root.publicKeyHex));
      const dist = deriveDeploymentKeyPair(SEED, 'DISTRIBUTION', 2);
      expect(app.keyIds.distribution).toBe(deriveKeyId('DISTRIBUTION', dist.publicKeyHex));
    } finally {
      await app.close();
    }
  });
});

// ── ③ 세대 — 회전할 수 있고, 회전해도 옛 코인이 죽지 않는다 ─────────

describe('③ 세대 — 유출 시 회전하되 옛 증서는 계속 검증된다', () => {
  it('세대를 올리면 현행 키가 전부 바뀐다 (= 회전이 가능하다)', async () => {
    const g0 = await boot({ rootSeed: SEED, keyGeneration: 0 });
    const g1 = await boot({ rootSeed: SEED, keyGeneration: 1 });
    try {
      expect(g1.keyIds.membershipRoot).not.toBe(g0.keyIds.membershipRoot);
      expect(g1.keyIds.distribution).not.toBe(g0.keyIds.distribution);
      expect(g1.keyIds.promo).not.toBe(g0.keyIds.promo);
    } finally {
      await g0.close();
      await g1.close();
    }
  });

  it('★세대 2 서버는 빈 DB로 떠도 세대 0·1의 공개키를 /keys에 전부 싣는다 (이력이 DB에서 독립)', async () => {
    const app = await boot({ rootSeed: SEED, keyGeneration: 2 });
    try {
      const published = new Set((await keysOf(app)).map((k) => k.publicKey));
      for (const purpose of [
        'MEMBERSHIP_ROOT',
        'ANGEL_BONUS',
        'COMMUNITY_CLAIM',
        'COMMUNITY_REWARD',
        'TREASURE',
        'DISTRIBUTION',
      ] as const) {
        for (const g of [0, 1, 2]) {
          expect(published.has(deriveDeploymentKeyPair(SEED, purpose, g).publicKeyHex)).toBe(true);
        }
      }
      // 6개 용도 × 3세대 = 18개.
      expect(published.size).toBe(18);
    } finally {
      await app.close();
    }
  });

  it('★세대 0에서 발급된 회원 증서가 세대 1 서버의 /keys만 보고도 계속 검증된다', async () => {
    const g0 = await boot({ rootSeed: SEED, keyGeneration: 0 });
    const g1 = await boot({ rootSeed: SEED, keyGeneration: 1 });
    try {
      const me = await register(g0, '+82-10-7777', 'old@shvil.org', '옛세대');
      const cert = me.cert as MembershipCertificate;
      expect(cert).toBeTruthy();
      expect(cert.issuerKeyId).toBe(g0.keyIds.membershipRoot);

      // 회전 이후 **새로 설치한 지갑**의 처지를 그대로 재현한다 — 캐시가 없고,
      // 아는 것은 세대 1 서버의 /keys 응답뿐이다.
      const roots: Record<string, string> = {};
      for (const k of await keysOf(g1)) {
        if (k.purpose === 'MEMBERSHIP_ROOT') roots[k.keyId] = k.publicKey;
      }
      expect(verifyMembershipCertificate(cert, roots, Date.now()).valid).toBe(true);
    } finally {
      await g0.close();
      await g1.close();
    }
  });
});

// ── ③-B 정당한 회전에서 폰이 벽돌이 되지 않는다 (서버↔지갑 관통) ────

describe('③-B 세대 회전 — 이미 핀한 폰의 복구 경로가 실제로 작동한다', () => {
  it('★회전 → 핀 불일치 → 사람이 지문 확인 → 받음 → 새 루트를 배운다', async () => {
    const g0 = await boot({ rootSeed: SEED, keyGeneration: 0 });
    const g1 = await boot({ rootSeed: SEED, keyGeneration: 1 });
    try {
      // ① 폰이 세대 0에 핀한다.
      const first = (await g0.inject({ method: 'GET', url: '/courses' })).json() as SignedResponse;
      let pin = guardDistribution(first as never, null).pinToStore!;
      expect(pin).toBeTruthy();

      // ② 운영자가 세대를 올린다(유출 대응). 폰은 갱신을 **거부**한다 — 자동으로 안 믿는다.
      const rotated = (await g1.inject({ method: 'GET', url: '/keys' })).json() as SignedResponse;
      let candidate: DistributionPinMismatchError['candidate'] = null;
      try {
        guardDistribution(rotated as never, pin);
        expect.unreachable('회전 후에는 거부되어야 한다');
      } catch (e) {
        expect(e).toBeInstanceOf(DistributionPinMismatchError);
        candidate = (e as DistributionPinMismatchError).candidate;
      }
      expect(candidate).not.toBeNull();
      // 사람이 서버 /health 의 distKeyId·지문과 눈으로 대조할 수 있다.
      // ★그 이름은 **지갑이 제시된 공개키에서 직접 유도한 값**이다(규격 9.6 P-3) —
      //   서버 주장을 그대로 옮긴 것이 아니므로 중간자가 베껴 넣을 수 없다.
      const health = (await g1.inject({ method: 'GET', url: '/health' })).json() as {
        distKeyId: string;
        distKeyFingerprint: string;
      };
      expect(candidate!.newKeyId).toBe(health.distKeyId);
      expect(candidate!.nameVerified).toBe(true); // 정직한 회전이므로 수락을 물어봐도 된다
      expect(publicKeyFingerprint(candidate!.newPublicKey)).toBe(health.distKeyFingerprint);
      // 후보는 kv에 누적된다(화면이 "몇 번 봤는지"를 보여줄 수 있게).
      expect(mergePendingPinChange(null, candidate!, Date.now()).seenCount).toBe(1);

      // ③ 사람이 확인하고 받는다 = acceptPinChange가 하는 일 그대로.
      pin = candidate!.newPublicKey;

      // ④ 이제 갱신이 다시 흐른다 — 그리고 **세대 0 루트가 목록에 그대로 있다.**
      const after = (await g1.inject({ method: 'GET', url: '/keys' })).json() as SignedResponse & {
        keys: KeyRow[];
      };
      const { body } = guardDistribution(after as never, pin) as { body: { keys: KeyRow[] } };
      const roots = body.keys.filter((k) => k.purpose === 'MEMBERSHIP_ROOT').map((k) => k.publicKey);
      expect(roots).toContain(deriveDeploymentKeyPair(SEED, 'MEMBERSHIP_ROOT', 0).publicKeyHex);
      expect(roots).toContain(deriveDeploymentKeyPair(SEED, 'MEMBERSHIP_ROOT', 1).publicKeyHex);
    } finally {
      await g0.close();
      await g1.close();
    }
  });

  it('본문이 조작된 응답은 후보조차 되지 않는다 (물어볼 값어치가 없다)', async () => {
    const g0 = await boot({ rootSeed: SEED });
    const g1 = await boot({ rootSeed: OTHER_SEED });
    try {
      const first = (await g0.inject({ method: 'GET', url: '/courses' })).json() as SignedResponse;
      const pin = guardDistribution(first as never, null).pinToStore!;
      const other = (await g1.inject({ method: 'GET', url: '/keys' })).json() as SignedResponse;
      const tampered = { ...other, keys: [{ keyId: 'x', publicKey: 'y', purpose: 'MEMBERSHIP_ROOT' }] };
      try {
        guardDistribution(tampered as never, pin);
        expect.unreachable('거부되어야 한다');
      } catch (e) {
        expect((e as DistributionPinMismatchError).candidate).toBeNull();
      }
    } finally {
      await g0.close();
      await g1.close();
    }
  });
});

// ── ④ 은퇴 키 — 시드 도입 전의 무작위 키도 이력에 남는다 ────────────

describe('④ 시드 도입 — 옛 무작위 키의 공개키는 이력에 남는다', () => {
  it('kv에 남아 있는 옛 키의 공개키가 /keys에 계속 실린다 (옛 증서가 죽지 않게)', async () => {
    // 디스크가 남아 있는 배포(로컬·유료 디스크)를 재현: 먼저 시드 없이 떠서 키를 만들고,
    // 같은 DB 파일로 시드를 넣어 다시 뜬다.
    const dbPath = `file:seed-migrate-${Date.now()}?mode=memory&cache=shared`;
    const before = buildApp({ dbPath, devMode: true });
    await before.ready();
    const oldRootId = before.keyIds.membershipRoot;
    const oldRootPub = (await keysOf(before)).find((k) => k.purpose === 'MEMBERSHIP_ROOT')!.publicKey;

    const after = buildApp({ dbPath, devMode: true, rootSeed: SEED });
    await after.ready();
    try {
      // 현행 키는 바뀌었다 — 시드 도입은 반드시 키를 한 번 바꾼다(물리적 사실).
      expect(after.keyIds.membershipRoot).not.toBe(oldRootId);
      // 그러나 옛 공개키는 목록에 그대로 있다 = 옛 증서가 계속 검증된다.
      const published = await keysOf(after);
      expect(published.some((k) => k.publicKey === oldRootPub)).toBe(true);
    } finally {
      await before.close();
      await after.close();
    }
  });
});

// ── ⑤ /health — 조용히 실패하지 않는다 ──────────────────────────────

describe('⑤ /health — 발행 키의 출처가 밖에서 보인다', () => {
  it('시드가 있으면 SEED로, 경고 없이 보고한다', async () => {
    const app = await boot({ rootSeed: SEED, keyGeneration: 3 });
    try {
      const h = (await app.inject({ method: 'GET', url: '/health' })).json() as {
        keySource: string;
        keyGeneration: number;
        distKeyId: string;
        warnings: string[];
      };
      expect(h.keySource).toBe('SEED');
      expect(h.keyGeneration).toBe(3);
      expect(h.distKeyId).toBe(app.keyIds.distribution);
      expect(h.warnings.some((w) => w.includes('SHVIL_ROOT_SEED'))).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('★시드가 없으면 EPHEMERAL_RANDOM과 한국어 경고를 내보낸다', async () => {
    const app = await boot();
    try {
      const h = (await app.inject({ method: 'GET', url: '/health' })).json() as {
        keySource: string;
        warnings: string[];
      };
      expect(h.keySource).toBe('EPHEMERAL_RANDOM');
      expect(h.warnings.some((w) => w.includes('SHVIL_ROOT_SEED'))).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('시드·KEK·개인키는 어디에도 실리지 않는다', async () => {
    const app = await boot({ rootSeed: SEED });
    try {
      const body = (await app.inject({ method: 'GET', url: '/health' })).body;
      expect(body).not.toContain(SEED);
      expect(body).not.toContain(deriveDeploymentKeyPair(SEED, 'DISTRIBUTION', 0).secretKeyHex);
      expect(body).not.toContain(process.env.SHVIL_KEK ?? '§없음§');
    } finally {
      await app.close();
    }
  });

  it('짧은 시드는 조용히 통과하지 않는다 (기동 시점에 터진다)', () => {
    expect(() => buildApp({ dbPath: ':memory:', devMode: true, rootSeed: '너무짧다' })).toThrow(
      /SHVIL_ROOT_SEED/,
    );
  });
});

// ── ⑥ 시드가 **못** 고치는 것 (정직화 · 제3조) ──────────────────────

describe('⑥ 시드가 못 고치는 것 — 원장은 여전히 재배포마다 죽는다', () => {
  it('같은 시드여도 members는 되살아나지 않는다 — 증서 갱신·메신저는 401', async () => {
    const before = await boot({ rootSeed: SEED });
    const after = await boot({ rootSeed: SEED });
    try {
      const me = await register(before, '+82-10-1234', 'a@b.org', '테스트');
      expect((await signedInject(before, me, 'POST', '/auth/certificate', {})).statusCode).toBe(200);
      // ★키는 같은데 회원 명부가 비어 있다 → 여전히 401. 시드는 원장을 살리지 않는다.
      expect((await signedInject(after, me, 'POST', '/auth/certificate', {})).statusCode).toBe(401);
      expect((await signedInject(after, me, 'GET', '/messages')).statusCode).toBe(401);
    } finally {
      await before.close();
      await after.close();
    }
  });

  it('같은 전화번호로 재가입하면 여전히 **다른 회원 번호**가 나온다', async () => {
    const before = await boot({ rootSeed: SEED });
    const after = await boot({ rootSeed: SEED });
    try {
      const first = await register(before, '+82-10-5555', 'c@d.org', '같은사람');
      const again = await register(after, '+82-10-5555', 'c@d.org', '같은사람');
      expect(again.memberId).not.toBe(first.memberId);
    } finally {
      await before.close();
      await after.close();
    }
  });

  it('발행 수량 카운터도 리셋된다 (엔젤 보너스 재수령 구멍은 그대로 남는다)', async () => {
    const before = await boot({ rootSeed: SEED });
    const after = await boot({ rootSeed: SEED });
    try {
      const me = await register(before, '+82-10-9999', 'e@f.org', '엔젤');
      const t1 = (await before.inject({ method: 'GET', url: '/transparency/promo' })).json() as {
        registrationIssued: number;
      };
      const t2 = (await after.inject({ method: 'GET', url: '/transparency/promo' })).json() as {
        registrationIssued: number;
      };
      expect(me.memberId).toBeTruthy();
      expect(t2.registrationIssued).toBe(0);
      expect(t1.registrationIssued).toBeGreaterThanOrEqual(0);
    } finally {
      await before.close();
      await after.close();
    }
  });
});
