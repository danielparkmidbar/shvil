/**
 * ★적대검증 2026-07-28 — 시드 유출 · 세대 강등 · 시드 오타.
 *
 * 앞선 작업이 발행 권위의 자리를 **DB에서 환경변수 한 줄로** 옮겼다. 이 파일은 그
 * 한 줄을 손에 넣은 자가 무엇을 할 수 있는지, 그리고 "세대를 올려 회전한다"는 대응이
 * 실제로 무엇을 막는지를 **운영 코드로** 재현한다.
 *
 * 이 파일이 재현하는 것(전부 실제로 통과한다):
 *  ② 시드 하나로 7개 키 전부 재현 → 임의 증서·임의 GRANT 발급. 그리고 ★유출자의
 *    배포 서명은 **핀 불일치를 일으키지 않는다** — 지갑에 화면조차 뜨지 않는다.
 *  ③ 세대를 올려도 옛 세대 위조력이 **1도 줄지 않는다.** 이력이 시드에서 재구성되므로
 *    옛 공개키를 목록에서 뺄 방법이 없고, 폐기 목록도 없다.
 *  ★그리고 시드가 유출됐을 때 `SHVIL_KEY_GENERATION`을 올리라는 배포 가이드의 지시는
 *    **아무것도 막지 못한다** — 유출자는 시드를 갖고 있으므로 새 세대도 유도한다.
 *  ⑤ 길이를 유지한 한 글자 오타는 서버를 **정상 기동**시키고 `/health`가 `warnings: []`로
 *    보고한다. 그런데 그것은 다른 화폐다. 다니엘 쌤의 확인 절차로는 알 수 없다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEPLOYMENT_KEY_SLOTS,
  GRANT_MAX_DSHV,
  addressFromPublicKey,
  buildGrant,
  buildMembershipCertificate,
  deriveDeploymentKeyPair,
  deriveDeploymentSigner,
  deriveKeyId,
  isSealed,
  mintGrantCoin,
  openSecret,
  signDistribution,
  verifyCoin,
  verifyMembershipCertificate,
  type DeploymentKeySlot,
  type DistributionSig,
} from '@shvil/shared';
import { buildApp } from '../src/app';
import { kvGet } from '../src/db';
import { guardDistribution } from '../../apps/wallet/src/core/distributionGuard';

type SignedResponse = Record<string, unknown> & { _sig?: DistributionSig };
interface KeyRow {
  keyId: string;
  publicKey: string;
  purpose: string;
}

/** 시험용 시드 — 운영과 무관. 64자 hex. */
const SEED = 'c4e1'.repeat(16);
/** ★같은 길이·같은 형식인데 **끝 한 글자만** 다르다 (붙여넣기 오타 재현). */
const SEED_TYPO = `${SEED.slice(0, 63)}2`;

const T0 = Date.parse('2026-08-01T06:00:00Z');
const DAY = 86_400_000;

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

async function boot(opts: { rootSeed?: string; keyGeneration?: number; dbPath?: string } = {}) {
  const app = buildApp({ dbPath: ':memory:', devMode: true, ...opts });
  await app.ready();
  return app;
}

/** 운영 모드(devMode 꺼짐) 기동 — `/health`의 warnings를 글자 그대로 보기 위한 것. */
async function bootProd(opts: { rootSeed?: string } = {}) {
  const app = buildApp({ dbPath: ':memory:', devMode: false, ...opts });
  await app.ready();
  return app;
}

async function keysOf(app: Awaited<ReturnType<typeof boot>>): Promise<KeyRow[]> {
  const res = (await app.inject({ method: 'GET', url: '/keys' })).json() as SignedResponse & { keys: KeyRow[] };
  return res.keys;
}

function rootsOf(rows: KeyRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of rows) if (k.purpose === 'MEMBERSHIP_ROOT') out[k.keyId] = k.publicKey;
  return out;
}

function issuersOf(rows: KeyRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of rows) if (k.purpose === 'ANGEL_BONUS') out[k.keyId] = k.publicKey;
  return out;
}

// ══ ② 시드 유출 — 시드를 아는 자가 무엇을 할 수 있나 ═══════════════

describe('적대검증 2 — 시드 유출', () => {
  it('②-a 시드 한 줄로 서버가 쓰는 7개 키를 전부 재현한다 (스팟 리저브 주소 포함)', async () => {
    const app = await boot({ rootSeed: SEED });
    try {
      // 발행 6개 — 서버가 실제로 쓰는 이름과 글자까지 같다.
      expect(deriveKeyId('MEMBERSHIP_ROOT', deriveDeploymentKeyPair(SEED, 'MEMBERSHIP_ROOT', 0).publicKeyHex)).toBe(
        app.keyIds.membershipRoot,
      );
      expect(deriveKeyId('ANGEL_BONUS', deriveDeploymentKeyPair(SEED, 'ANGEL_BONUS', 0).publicKeyHex)).toBe(
        app.keyIds.promo,
      );
      expect(deriveKeyId('DISTRIBUTION', deriveDeploymentKeyPair(SEED, 'DISTRIBUTION', 0).publicKeyHex)).toBe(
        app.keyIds.distribution,
      );
      // 7번째 — 예치(소각) 수령 주소. 유출자는 이 주소도 안다.
      const spot = (await app.inject({ method: 'GET', url: '/spot' })).json() as { reservePublicKey: string };
      expect(spot.reservePublicKey).toBe(deriveDeploymentKeyPair(SEED, 'SPOT_RESERVE', 0).publicKeyHex);
      // 그리고 **개인키**도 안다 = 소각이 소각이 아니게 된다.
      expect(deriveDeploymentKeyPair(SEED, 'SPOT_RESERVE', 0).secretKeyHex).toMatch(/^[0-9a-f]{64}$/);
      console.log(
        `[시드유출] 슬롯 ${Object.keys(DEPLOYMENT_KEY_SLOTS).length}개 전부 재현 · 예치 리저브 주소 ${addressFromPublicKey(
          spot.reservePublicKey,
        ).slice(0, 12)}… 의 개인키까지`,
      );
    } finally {
      await app.close();
    }
  });

  it('②-b 유출자가 임의 회원 증서를 발급하고, 그것이 진짜 서버의 /keys로 검증된다', async () => {
    const app = await boot({ rootSeed: SEED });
    try {
      const stolenRoot = deriveDeploymentSigner(SEED, 'MEMBERSHIP_ROOT', 0);
      const fakeCert = buildMembershipCertificate(
        {
          memberId: 'SHV-2026-999999', // 존재하지 않는 회원
          devicePublicKey: deriveDeploymentKeyPair(SEED, 'TREASURE', 7).publicKeyHex, // 아무 기기 키
          integrity: 'VERIFIED', // ★무결성 검증을 통과했다고 스스로 새긴다
          issuedAt: T0,
          expiresAt: T0 + 365 * DAY,
          issuerKeyId: app.keyIds.membershipRoot,
        },
        stolenRoot,
      );
      const verdict = verifyMembershipCertificate(fakeCert, rootsOf(await keysOf(app)), T0 + DAY);
      expect(verdict.valid).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('②-c 유출자가 GRANT를 무제한 위조한다 — 개당 상한은 있으나 **장수 제한이 없다**', async () => {
    const app = await boot({ rootSeed: SEED });
    try {
      const stolenPromo = deriveDeploymentSigner(SEED, 'ANGEL_BONUS', 0);
      const issuers = issuersOf(await keysOf(app));
      const mint = (amount: number, i: number) =>
        mintGrantCoin(
          buildGrant(
            {
              kind: 'ANGEL_BONUS',
              memberId: 'SHV-2026-999999',
              amountDshv: amount,
              reference: `forged-${i}`,
              recipientPublicKey: deriveDeploymentKeyPair(SEED, 'TREASURE', 9).publicKeyHex,
              issuerKeyId: app.keyIds.promo,
              issuedAt: T0 + i,
            },
            stolenPromo,
          ),
        );
      // 개당 상한(GRANT_MAX_DSHV)은 실제로 막는다 — 방어가 하나는 산다.
      expect(
        verifyCoin(mint(GRANT_MAX_DSHV.ANGEL_BONUS + 1, 0), { trustedIssuerKeys: issuers, now: T0 + DAY }).valid,
      ).toBe(false);
      // 그러나 상한 이하로 여러 장 찍는 것은 **아무도 막지 않는다** (서버 왕복이 없다).
      let total = 0;
      for (let i = 0; i < 100; i += 1) {
        const c = mint(GRANT_MAX_DSHV.ANGEL_BONUS, i);
        expect(verifyCoin(c, { trustedIssuerKeys: issuers, now: T0 + DAY }).valid).toBe(true);
        total += c.amountDshv;
      }
      expect(total).toBe(100 * GRANT_MAX_DSHV.ANGEL_BONUS);
      console.log(`[시드유출] 위조 엔젤 보너스 100장 = ${total / 10} SHV — 전부 verifyCoin 통과`);
    } finally {
      await app.close();
    }
  });

  it('②-d ★유출자의 배포 서명은 핀 불일치를 일으키지 않는다 — 화면조차 뜨지 않는다', async () => {
    const app = await boot({ rootSeed: SEED });
    try {
      // 폰이 진짜 서버에 핀했다.
      const real = (await app.inject({ method: 'GET', url: '/courses' })).json() as SignedResponse;
      const pin = guardDistribution(real as never, null).pinToStore!;
      expect(pin).toBeTruthy();

      // 유출자가 **같은 배포 키**로 자기 데이터를 서명한다 (코스 폴리라인 주입).
      const stolenDist = deriveDeploymentSigner(SEED, 'DISTRIBUTION', 0);
      const injected = signDistribution(
        { courses: [{ courseId: 'evil', name: '가짜 코스' }] },
        stolenDist,
        app.keyIds.distribution,
        Date.now(),
      );
      // ★던지지 않는다 = 지갑이 그대로 받는다. 「서버 열쇠」 화면은 뜨지 않는다.
      const { body, pinToStore } = guardDistribution(injected as never, pin) as {
        body: { courses: { courseId: string }[] };
        pinToStore: string | null;
      };
      expect(pinToStore).toBeNull();
      expect(body.courses[0]!.courseId).toBe('evil');
      console.log('[시드유출] 코스 주입이 핀을 통과 — MITM보다 은밀하다 (사람에게 물어보는 절차 자체가 없다)');
    } finally {
      await app.close();
    }
  });

  it('②-e ★세대를 올려도 유출자는 새 세대를 그대로 유도한다 (배포 가이드의 대응이 무효)', async () => {
    const rotated = await boot({ rootSeed: SEED, keyGeneration: 1 });
    try {
      // 운영자가 "유출됐으니 SHVIL_KEY_GENERATION=1" 을 했다. 유출자는 시드를 갖고 있다.
      const stolenRootG1 = deriveDeploymentSigner(SEED, 'MEMBERSHIP_ROOT', 1);
      expect(deriveKeyId('MEMBERSHIP_ROOT', stolenRootG1.publicKeyHex)).toBe(rotated.keyIds.membershipRoot);
      const fakeCert = buildMembershipCertificate(
        {
          memberId: 'SHV-2026-999999',
          devicePublicKey: deriveDeploymentKeyPair(SEED, 'TREASURE', 3).publicKeyHex,
          integrity: 'VERIFIED',
          issuedAt: T0,
          expiresAt: T0 + 365 * DAY,
          issuerKeyId: rotated.keyIds.membershipRoot,
        },
        stolenRootG1,
      );
      expect(verifyMembershipCertificate(fakeCert, rootsOf(await keysOf(rotated)), T0 + DAY).valid).toBe(true);
      console.log('[시드유출] 세대 1로 회전 후에도 위조 성공 — 시드가 유출되면 세대 올리기는 아무것도 막지 않는다');
    } finally {
      await rotated.close();
    }
  });

  it('②-f 비교 — 시드 이전(휘발 무작위)에는 개인키를 얻으려면 DB 봉인문 + KEK 둘 다 필요했다', async () => {
    const dbPath = `file:adv-ephem-${Date.now()}?mode=memory&cache=shared`;
    const app = buildApp({ dbPath, devMode: true, kek: 'adversarial-test-kek-000000000000' });
    await app.ready();
    try {
      const sealed = kvGet(app.db, 'membershipRootKey');
      expect(sealed).toBeTruthy();
      expect(isSealed(sealed!)).toBe(true); // DB만 훔쳐서는 못 연다
      expect(() => openSecret(sealed!, '엉뚱한-kek-0000000000000000000')).toThrow(); // KEK 없이 실패
      const opened = JSON.parse(openSecret(sealed!, 'adversarial-test-kek-000000000000')) as {
        secretKeyHex: string;
      };
      expect(opened.secretKeyHex).toMatch(/^[0-9a-f]{64}$/); // 둘 다 있어야 열린다
      console.log('[비교] 옛 방식 = DB 봉인문 + KEK 두 개 / 새 방식 = 환경변수 한 줄');
    } finally {
      await app.close();
    }
  });
});

// ══ ③ 세대 강등 — 옛 세대로 서명한 것을 새 세대 서버에 들이밀면 ═════

describe('적대검증 3 — 세대 강등 · 폐기 경로', () => {
  it('③-a 세대 0 루트로 만든 증서가 세대 5 서버의 /keys만 보고 검증된다 (설계 의도이자 구멍)', async () => {
    const g5 = await boot({ rootSeed: SEED, keyGeneration: 5 });
    try {
      const oldRoot = deriveDeploymentSigner(SEED, 'MEMBERSHIP_ROOT', 0);
      const oldRootId = deriveKeyId('MEMBERSHIP_ROOT', oldRoot.publicKeyHex);
      const cert = buildMembershipCertificate(
        {
          memberId: 'SHV-2026-999999',
          devicePublicKey: deriveDeploymentKeyPair(SEED, 'TREASURE', 1).publicKeyHex,
          integrity: 'VERIFIED',
          issuedAt: T0, // ★회전 이후에 만들어도 상관없다 — 발급 시각은 판정에 안 쓰인다
          expiresAt: T0 + 365 * DAY,
          issuerKeyId: oldRootId,
        },
        oldRoot,
      );
      expect(verifyMembershipCertificate(cert, rootsOf(await keysOf(g5)), T0 + DAY).valid).toBe(true);
    } finally {
      await g5.close();
    }
  });

  it('③-b 세대 0 발행 키로 만든 GRANT 코인도 세대 5 서버 기준으로 통과한다', async () => {
    const g5 = await boot({ rootSeed: SEED, keyGeneration: 5 });
    try {
      const oldPromo = deriveDeploymentSigner(SEED, 'ANGEL_BONUS', 0);
      const coin = mintGrantCoin(
        buildGrant(
          {
            kind: 'ANGEL_BONUS',
            memberId: 'SHV-2026-999999',
            amountDshv: 300,
            reference: 'downgrade',
            recipientPublicKey: deriveDeploymentKeyPair(SEED, 'TREASURE', 2).publicKeyHex,
            issuerKeyId: deriveKeyId('ANGEL_BONUS', oldPromo.publicKeyHex),
            issuedAt: T0,
          },
          oldPromo,
        ),
      );
      expect(verifyCoin(coin, { trustedIssuerKeys: issuersOf(await keysOf(g5)), now: T0 + DAY }).valid).toBe(true);
    } finally {
      await g5.close();
    }
  });

  it('③-c 세대 0 배포 키로 서명하면 세대 0에 핀한 폰이 **조용히** 받는다 (화면 없음)', async () => {
    const g0 = await boot({ rootSeed: SEED, keyGeneration: 0 });
    const g5 = await boot({ rootSeed: SEED, keyGeneration: 5 });
    try {
      const first = (await g0.inject({ method: 'GET', url: '/courses' })).json() as SignedResponse;
      const pin = guardDistribution(first as never, null).pinToStore!;
      // 운영자는 세대 5로 옮겼지만, 이 폰은 세대 0 키에 핀되어 있다.
      const rotated = (await g5.inject({ method: 'GET', url: '/courses' })).json() as SignedResponse;
      expect(() => guardDistribution(rotated as never, pin)).toThrow(/KEY_PIN_MISMATCH/); // 진짜 서버는 거부되는데
      // 유출된 세대 0 키를 쥔 공격자는 아무 경고 없이 통과한다.
      const injected = signDistribution(
        { courses: [{ courseId: 'evil' }] },
        deriveDeploymentSigner(SEED, 'DISTRIBUTION', 0),
        deriveKeyId('DISTRIBUTION', deriveDeploymentKeyPair(SEED, 'DISTRIBUTION', 0).publicKeyHex),
        Date.now(),
      );
      expect(guardDistribution(injected as never, pin).pinToStore).toBeNull();
      console.log('[세대강등] 회전 후: 진짜 서버=거부 / 유출된 옛 키=통과. 회전이 폰을 공격자에게 묶어 둔다');
    } finally {
      await g0.close();
      await g5.close();
    }
  });

  it('③-d ★폐기 경로가 없다 — 어떤 기동 옵션으로도 옛 세대 공개키를 /keys에서 뺄 수 없다', async () => {
    // 세대를 올릴수록 옛 공개키가 **늘어나기만** 한다. 줄이는 입력이 존재하지 않는다.
    const counts: number[] = [];
    for (const g of [0, 1, 2, 3]) {
      const app = await boot({ rootSeed: SEED, keyGeneration: g });
      try {
        const rows = await keysOf(app);
        counts.push(rows.length);
        // 세대 0 루트는 g가 몇이든 언제나 실려 있다.
        expect(rows.some((k) => k.publicKey === deriveDeploymentKeyPair(SEED, 'MEMBERSHIP_ROOT', 0).publicKeyHex)).toBe(
          true,
        );
      } finally {
        await app.close();
      }
    }
    expect(counts).toEqual([6, 12, 18, 24]); // 6용도 × (세대+1) — 단조 증가
    console.log(`[세대강등] /keys 항목 수 = ${counts.join(' → ')} (감소 경로 없음 = 폐기 불가)`);
  });

  it('③-e 그래서 회전은 위조력을 **1도 줄이지 않는다** (회전 전후 동일)', async () => {
    const before = await boot({ rootSeed: SEED, keyGeneration: 0 });
    const after = await boot({ rootSeed: SEED, keyGeneration: 3 });
    try {
      const oldPromo = deriveDeploymentSigner(SEED, 'ANGEL_BONUS', 0);
      const forge = () =>
        mintGrantCoin(
          buildGrant(
            {
              kind: 'ANGEL_BONUS',
              memberId: 'SHV-2026-999999',
              amountDshv: 300,
              reference: 'same-power',
              recipientPublicKey: deriveDeploymentKeyPair(SEED, 'TREASURE', 4).publicKeyHex,
              issuerKeyId: deriveKeyId('ANGEL_BONUS', oldPromo.publicKeyHex),
              issuedAt: T0,
            },
            oldPromo,
          ),
        );
      const okBefore = verifyCoin(forge(), { trustedIssuerKeys: issuersOf(await keysOf(before)), now: T0 + DAY }).valid;
      const okAfter = verifyCoin(forge(), { trustedIssuerKeys: issuersOf(await keysOf(after)), now: T0 + DAY }).valid;
      expect(okBefore).toBe(true);
      expect(okAfter).toBe(true); // 회전해도 그대로 유효
    } finally {
      await before.close();
      await after.close();
    }
  });
});

// ══ ⑤ 시드 오타 — 부팅 거부가 잡아 주는가 ══════════════════════════

describe('적대검증 5 — 시드 오타를 알아차릴 수 있는가', () => {
  it('⑤-a 너무 짧은 시드(잘림)는 기동 시점에 터진다 — 이건 잡힌다', () => {
    expect(() => buildApp({ dbPath: ':memory:', devMode: true, rootSeed: SEED.slice(0, 20) })).toThrow(
      /SHVIL_ROOT_SEED/,
    );
  });

  it('⑤-b ★한 글자 오타(길이 유지)는 정상 기동하고 /health가 "경고 없음"으로 보고한다', async () => {
    // devMode를 끈다 — 다니엘 쌤이 3단계에서 보는 `"warnings":[]`를 글자 그대로 재현한다.
    const good = await bootProd({ rootSeed: SEED });
    const typo = await bootProd({ rootSeed: SEED_TYPO });
    try {
      const h = (await typo.inject({ method: 'GET', url: '/health' })).json() as {
        ok: boolean;
        keySource: string;
        warnings: string[];
        distKeyId: string;
      };
      // 다니엘 쌤의 3단계 확인 절차가 보는 값 — 전부 "성공"이다.
      expect(h.ok).toBe(true);
      expect(h.keySource).toBe('SEED');
      expect(h.warnings).toEqual([]);
      // 그런데 이것은 **다른 화폐**다.
      expect(typo.keyIds.distribution).not.toBe(good.keyIds.distribution);
      expect(typo.keyIds.membershipRoot).not.toBe(good.keyIds.membershipRoot);
      console.log(
        `[시드오타] 끝 한 글자 차이 → 배포키 ${good.keyIds.distribution.slice(13, 25)}… vs ${typo.keyIds.distribution.slice(
          13,
          25,
        )}… · /health warnings=[] `,
      );
    } finally {
      await good.close();
      await typo.close();
    }
  });

  it('⑤-c 64자 hex에 글자가 하나 더 붙으면 hex가 아니게 되어 UTF-8 경로로 빠진다 (역시 조용하다)', async () => {
    const extra = await bootProd({ rootSeed: `${SEED}a` }); // 65자
    const good = await bootProd({ rootSeed: SEED });
    try {
      const h = (await extra.inject({ method: 'GET', url: '/health' })).json() as { warnings: string[] };
      expect(h.warnings).toEqual([]);
      expect(extra.keyIds.membershipRoot).not.toBe(good.keyIds.membershipRoot);
    } finally {
      await extra.close();
      await good.close();
    }
  });

  it('⑤-d 대문자·앞뒤 공백은 안전하다 (같은 키가 나온다 — 여기는 잘 되어 있다)', async () => {
    const a = await boot({ rootSeed: SEED });
    const b = await boot({ rootSeed: `  ${SEED.toUpperCase()}  ` });
    try {
      expect(b.keyIds).toEqual(a.keyIds);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('⑤-e 오타를 스스로 알아차릴 재료가 서버에 없다 — 기대값을 적어 두는 곳이 없다', async () => {
    const typo = await boot({ rootSeed: SEED_TYPO });
    try {
      const h = (await typo.inject({ method: 'GET', url: '/health' })).json() as Record<string, unknown>;
      // /health가 내보내는 값 중 "이 시드가 내가 넣으려던 그 시드인가"를 답할 수 있는 것은 없다.
      // (있다면 체크섬·지문 필드일 텐데, 없다.)
      expect(Object.keys(h).some((k) => /checksum|seedFingerprint|expected/i.test(k))).toBe(false);
      // 지갑 쪽 화면이 대조하라고 안내하는 distKeyId는 오타 서버에서도 "그럴듯하게" 나온다.
      expect(String(h.distKeyId)).toMatch(/^distribution-[0-9a-f]{32}$/);
    } finally {
      await typo.close();
    }
  });
});

// ══ 슬롯 표가 규격과 어긋나지 않는지 (이 파일이 쓰는 전제의 검산) ═══

describe('전제 검산', () => {
  it('유도 슬롯 표에 7개가 있고 SPOT_RESERVE만 /keys에 실리지 않는다', async () => {
    const app = await boot({ rootSeed: SEED });
    try {
      const slots = Object.keys(DEPLOYMENT_KEY_SLOTS) as DeploymentKeySlot[];
      expect(slots).toHaveLength(7);
      const published = new Set((await keysOf(app)).map((k) => k.publicKey));
      expect(published.has(deriveDeploymentKeyPair(SEED, 'SPOT_RESERVE', 0).publicKeyHex)).toBe(false);
      expect(published.size).toBe(6);
    } finally {
      await app.close();
    }
  });
});
