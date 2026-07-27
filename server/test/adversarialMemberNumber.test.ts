/**
 * 적대검증 — **회원 번호**는 시드로 되살아나지 않는다 (제3조 정직화).
 *
 * ── 이 파일은 「고쳐졌다」가 아니라 「아직 안 고쳐졌다」를 못박는다 ──────
 * 루트 시드는 **발행 권위**(키)를 영속시킨다. 그러나 **원장**은 그대로 죽는다. 그중
 * 회원 번호(`members`)는 코인에 각인되는 값이라 유독 멀리 간다. 여기 있는 기대값은
 * **바람직한 동작이 아니라 현재의 구멍**이다 — 누군가 이 구멍을 막으면 이 테스트가
 * 실패해야 하고, 그때 이 파일을 고치면서 "무엇을 고쳤는지" 알게 된다.
 *
 * ── 실측된 것 ────────────────────────────────────────────────────────
 *  A. 인간 한계(1인 1일 40 SHV)는 **회원 번호별로** 합산된다(humanLimits.ts:73·78).
 *     재배포마다 새 번호가 나오므로 상한이 통째로 새로 열린다. 실측 120 SHV / 위반 0건.
 *  B. ★그리고 **시드가 그 구멍을 조용하게 만들었다.** 시드 이전에는 재배포가 루트 키까지
 *     바꿔서 새 신원의 코인이 옛 지갑에서 `UNKNOWN_MEMBERSHIP_ROOT`로 걸렸다(= 눈에
 *     보였다). 이제는 루트가 같으므로 **완전 검증을 통과한다.** 영속성을 얻고 가시성을
 *     잃은 교환이다.
 *  C. 번호 유일성의 근거가 `SELECT 1 FROM members`(app.ts:556) 하나뿐인데 그 테이블이
 *     휘발성이다. 재배포 뒤 **서로 다른 사람이 같은 번호**를 받을 수 있고, 그러면 정직한
 *     두 사람의 코인이 한 지갑에서 합산되어 서로를 오염시킨다.
 *
 * 근본 해결은 영구 저장소(유료 디스크·외부 DB)이며 헌법 제2조와 얽힌 다니엘 쌤의 결정이다.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  checkHumanLimits,
  verifyCoin,
  DEFAULT_HUMAN_LIMIT_PROFILE,
  PendingWalkLedger,
  buildWalkSegmentProof,
  mintWalkCoin,
  type Coin,
  type WalkSample,
} from '@shvil/shared';
import { buildApp } from '../src/app';
import { register, type TestIdentity } from './utils';

const SEED = 'a3f9'.repeat(16);

const savedSeed = process.env.SHVIL_ROOT_SEED;
beforeAll(() => {
  delete process.env.SHVIL_ROOT_SEED;
});
afterAll(() => {
  if (savedSeed === undefined) delete process.env.SHVIL_ROOT_SEED;
  else process.env.SHVIL_ROOT_SEED = savedSeed;
});

async function boot(opts: { rootSeed?: string } = {}) {
  const app = buildApp({ dbPath: ':memory:', devMode: true, ...opts });
  await app.ready();
  return app;
}

async function rootKeys(app: Awaited<ReturnType<typeof boot>>): Promise<Record<string, string>> {
  const res = await app.inject({ method: 'GET', url: '/keys' });
  const { keys } = res.json() as { keys: { keyId: string; publicKey: string; purpose: string }[] };
  const out: Record<string, string> = {};
  for (const k of keys) if (k.purpose === 'MEMBERSHIP_ROOT') out[k.keyId] = k.publicKey;
  return out;
}

/** 하루치 걷기 코인 — 증서를 붙여 완전 검증 대상이 되게 한다. */
function mintDay(who: TestIdentity, km: number, dayStart: number): Coin {
  const ledger = new PendingWalkLedger({ memberId: who.memberId });
  let t = dayStart;
  for (let i = 0; i < Math.round(km * 10); i++) {
    const sample: WalkSample = {
      durationS: 72,
      distanceM: 100,
      steps: 140,
      tier: 'ON_COURSE',
      timestamp: t,
      courseId: 'shvil-israel',
    };
    const v = ledger.recordSample(sample);
    if (!v.accepted) throw new Error('sample rejected: ' + JSON.stringify(v));
    t += 72_000;
  }
  const draft = ledger.settleOnSpend(t)!;
  return mintWalkCoin(
    buildWalkSegmentProof(draft, who.signer, { membership: who.cert ?? null }),
  );
}

/**
 * 시험용 하루 — **다음 UTC 자정 + 1시**.
 * 회원 증서의 유효 창은 [발급시각, +30일]이고 판정은 `proof.settledAt` 기준이므로
 * (2026-07-26 소급무효화 제거), 과거 날짜로 걸으면 증서 창 밖(MEMBERSHIP_OUT_OF_WINDOW)이
 * 되어 **엉뚱한 이유로** 검증이 실패한다. 자정+1시를 쓰면 하루가 UTC 경계를 넘지 않아
 * 일 상한 검사도 깨끗하다.
 */
const DAY = Math.ceil(Date.now() / 86_400_000) * 86_400_000 + 3_600_000;

describe('★회원 번호 — 시드가 고치지 못하는 축', () => {
  it('A. 인간 한계(1인 1일 40 SHV)는 재배포마다 상한이 통째로 새로 열린다', async () => {
    const cap = DEFAULT_HUMAN_LIMIT_PROFILE.dailyMaxDshv;
    const wallet: Coin[] = [];
    const ids: string[] = [];

    // 재배포 3번 — 같은 사람, 같은 전화번호, 같은 날짜.
    for (let deployment = 0; deployment < 3; deployment++) {
      const app = await boot({ rootSeed: SEED });
      try {
        const me = await register(app, '+82-10-0001', 'same@person.org', '같은사람', 'dev-verified');
        ids.push(me.memberId);
        // 상한을 꽉 채운다 (40 SHV = 40 km).
        const coin = mintDay(me, cap / 10, DAY);
        const verdict = checkHumanLimits(coin, wallet);
        wallet.push(coin);
        console.log(
          `  배포#${deployment} 회원번호 ${me.memberId} · 이 코인 ${coin.amountDshv / 10} SHV · ` +
            `지갑 누적 ${wallet.reduce((s, c) => s + c.amountDshv, 0) / 10} SHV · ` +
            `인간한계 위반 ${verdict.violations.length}건`,
        );
        expect(verdict.ok).toBe(true); // ★ 매번 통과한다
      } finally {
        await app.close();
      }
    }

    const total = wallet.reduce((s, c) => s + c.amountDshv, 0) / 10;
    console.log(`  ★같은 날 같은 사람이 ${total} SHV — 상한은 ${cap / 10} SHV인데 위반 0건`);
    console.log(`  회원번호 3개: ${ids.join(' / ')} (전부 다름: ${new Set(ids).size === 3})`);
    expect(new Set(ids).size).toBe(3);
    expect(total).toBe((cap / 10) * 3);

    // 같은 번호로 한 장만 더 얹으면 그때는 걸린다 — 검사 자체는 살아 있다.
    const app = await boot({ rootSeed: SEED });
    try {
      const me = await register(app, '+82-10-0002', 'x@y.org', '초과', 'dev-verified');
      const a = mintDay(me, cap / 10, DAY);
      const b = mintDay(me, 1, DAY + 12 * 3600_000);
      const v = checkHumanLimits(b, [a]);
      console.log(`  대조군(같은 번호로 41 SHV): 위반 ${v.violations.length}건 → 검사는 정상 작동`);
      expect(v.ok).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('B. ★시드가 그 코인들을 「완전히 신뢰받는」 것으로 만든다 (시드 전에는 STOP이었다)', async () => {
    // 지갑은 배포#0의 /keys만 안다 (설치 후 한 번 받아 캐시).
    const d0 = await boot({ rootSeed: SEED });
    const walletRoots = await rootKeys(d0);
    const p0 = await register(d0, '+82-10-1111', 'a@a.org', '사람', 'dev-verified');
    const c0 = mintDay(p0, 4, DAY);
    await d0.close();

    // 재배포 — 같은 시드.
    const d1 = await boot({ rootSeed: SEED });
    const p1 = await register(d1, '+82-10-1111', 'a@a.org', '사람', 'dev-verified');
    const c1 = mintDay(p1, 4, DAY);
    await d1.close();

    // 재배포 — 시드 없음(사고 당시 동작).
    const dx = await boot({});
    const px = await register(dx, '+82-10-1111', 'a@a.org', '사람', 'dev-verified');
    const cx = mintDay(px, 4, DAY);
    await dx.close();

    const opt = { trustedRootKeys: walletRoots, requireIntegrityToken: true };
    const v0 = verifyCoin(c0, opt);
    const v1 = verifyCoin(c1, opt);
    const vx = verifyCoin(cx, opt);
    console.log(`  배포#0 코인(${p0.memberId}): ok=${v0.valid} ${JSON.stringify(v0.reasons)}`);
    console.log(`  ★시드 재배포 코인(${p1.memberId}): ok=${v1.valid} ${JSON.stringify(v1.reasons)}`);
    console.log(`  시드 없는 재배포 코인(${px.memberId}): ok=${vx.valid} ${JSON.stringify(vx.reasons)}`);
    expect(v0.valid).toBe(true);
    expect(v1.valid).toBe(true); // ★새 신원인데 옛 지갑이 완전히 신뢰한다
    expect(vx.valid).toBe(false); // 시드 전에는 여기서 걸렸다
  });

  it('C. ★회원 번호 유일성의 근거가 휘발성 테이블이다 — 서로 다른 두 사람이 같은 번호를 받는다', async () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5); // 추첨을 고정
    try {
      const d0 = await boot({ rootSeed: SEED });
      const walletRoots = await rootKeys(d0);
      const 갑 = await register(d0, '+82-10-7777', 'gap@x.org', '갑', 'dev-verified');
      const coin갑 = mintDay(갑, 4, DAY);
      await d0.close();

      // 재배포 후, **전혀 다른 사람**이 가입한다.
      const d1 = await boot({ rootSeed: SEED });
      const 을 = await register(d1, '+82-10-8888', 'eul@x.org', '을', 'dev-verified');
      const coin을 = mintDay(을, 4, DAY + 3600_000);
      await d1.close();

      console.log(`  갑의 회원번호: ${갑.memberId} (기기키 ${갑.signer.publicKeyHex.slice(0, 12)}…)`);
      console.log(`  을의 회원번호: ${을.memberId} (기기키 ${을.signer.publicKeyHex.slice(0, 12)}…)`);
      console.log(`  ★같은 번호인가: ${갑.memberId === 을.memberId}`);
      expect(갑.memberId).toBe(을.memberId);
      expect(갑.signer.publicKeyHex).not.toBe(을.signer.publicKeyHex);

      // 두 증서 모두 같은(시드 유도) 루트가 서명 → 옛 지갑이 둘 다 신뢰한다.
      const opt = { trustedRootKeys: walletRoots, requireIntegrityToken: true };
      console.log(`  갑 코인 검증: ${verifyCoin(coin갑, opt).valid} / 을 코인 검증: ${verifyCoin(coin을, opt).valid}`);
      expect(verifyCoin(coin갑, opt).valid).toBe(true);
      expect(verifyCoin(coin을, opt).valid).toBe(true);

      // 결과: 남의 걷기가 내 상한에 합산된다 — 둘 다 정직하게 걸었는데 위반이 뜬다.
      const 갑큰것 = mintDay(갑, 30, DAY);
      const 을큰것 = mintDay(을, 30, DAY + 8 * 3600_000);
      const solo = checkHumanLimits(을큰것, []);
      const merged = checkHumanLimits(을큰것, [갑큰것]);
      console.log(`  을만 단독(30 SHV): 위반 ${solo.violations.length}건`);
      console.log(
        `  ★갑 30 + 을 30 을 한 지갑이 보면 같은 번호라 합산(60 SHV) → 위반 ${merged.violations.length}건 ` +
          JSON.stringify(merged.violations),
      );
      expect(solo.ok).toBe(true);
      expect(merged.ok).toBe(false); // 정직한 두 사람의 코인이 서로를 오염시킨다
    } finally {
      spy.mockRestore();
    }
  });

  it('D. 충돌 확률 — 회원 번호 공간이 90만이고 재배포마다 새로 뽑는다', () => {
    // 서버 코드: `SHV-${Math.floor(100000 + Math.random()*900000)}` → 900,000가지.
    const SPACE = 900_000;
    console.log('  회원 수 M 명이 (재배포로 누적된) 번호를 뽑을 때 최소 1건 충돌 확률:');
    for (const m of [10, 30, 50, 100, 300, 1000, 2000]) {
      // 생일 문제 근사 1 - exp(-m(m-1)/2N)
      const p = 1 - Math.exp((-m * (m - 1)) / (2 * SPACE));
      console.log(`    M=${String(m).padStart(4)} 명 → ${(p * 100).toFixed(2)} %`);
    }
    console.log('  ※ M은 「사람 수」가 아니라 「지금까지 발급된 번호의 총수」다.');
    console.log('    한 사람이 R번 재배포를 겪으면 R개의 번호를 쓴다 → M = 사람 수 × 재배포 횟수.');
    expect(SPACE).toBe(900_000);
  });
});
