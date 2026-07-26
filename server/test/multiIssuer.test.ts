/**
 * ★제2 발행자 — 두 발행자가 실제로 공존하는가 (규격 9장 · 다니엘 쌤 방침의 코드 증명).
 *
 * > "다른 사람이 다른 방식의 코인 생성기를 만들어도 된다. 그가 쉬빌코인과 같은 코드
 * >  체계의 코인을 생산한다면 — 달러 인쇄기를 다른 누군가가 만들어도 된다."
 *
 * 이 파일은 그 말이 코드에서 성립하는지를 **두 개의 진짜 배포**로 확인한다.
 * `buildApp`을 두 번 부르면 각자 다른 DB·다른 봉인 키 재료를 갖는, 서로 남남인
 * 발행자 둘이 생긴다 — 오픈소스 서버를 받아 자기 배포를 세운 사람과 같은 상황이다.
 *
 * ── 고치기 전에는 무슨 일이 일어났나 (실측) ──────────────────────────
 * 두 배포의 keyId가 **같은 문자열 리터럴**이라 신뢰 목록의 같은 슬롯을 두고 충돌했다.
 * 슬롯을 차지한 쪽이 유일한 발행 권위가 되고 진 쪽 코인은 전량 무효. 서명이 뚫린 게
 * 아니라 **화폐 정체성이 우연으로 결정**되는 병이었다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PendingWalkLedger,
  acceptKeyBindings,
  buildWalkSegmentProof,
  deriveKeyId,
  mintWalkCoin,
  verifyCoin,
  type Coin,
  type MembershipCertificate,
  type WalkSample,
} from '@shvil/shared';
import { buildApp } from '../src/app';
import { register, type TestIdentity } from './utils';

/** 발행자 A — 원조 배포(다니엘 쌤). */
const issuerA = buildApp({ dbPath: ':memory:', devMode: true });
/** 발행자 B — 같은 오픈소스 코드로 남이 세운 배포. */
const issuerB = buildApp({ dbPath: ':memory:', devMode: true });

interface KeyInfo {
  keyId: string;
  publicKey: string;
  purpose: string;
}

async function keysOf(app: typeof issuerA): Promise<KeyInfo[]> {
  const res = await app.inject({ method: 'GET', url: '/keys' });
  return (res.json() as { keys: KeyInfo[] }).keys;
}

/** 정상 보행으로 WALK 코인 민팅 (증서 첨부). */
function mintWalk(id: TestIdentity, membership: MembershipCertificate): Coin {
  const ledger = new PendingWalkLedger({ memberId: id.memberId });
  let t = membership.issuedAt + 3600_000; // 가입 → 증서 → 걷기 → 정산 (실제 순서)
  for (let i = 0; i < 50; i++) {
    const sample: WalkSample = {
      durationS: 72,
      distanceM: 100,
      steps: 140,
      tier: 'ON_COURSE',
      timestamp: t,
      courseId: 'shvil-israel',
    };
    ledger.recordSample(sample);
    t += 72_000;
  }
  return mintWalkCoin(buildWalkSegmentProof(ledger.settleOnSpend(t)!, id.signer, { membership }));
}

let walkerA: TestIdentity;
let walkerB: TestIdentity;
let coinA: Coin;
let coinB: Coin;
let keysA: KeyInfo[];
let keysB: KeyInfo[];

beforeAll(async () => {
  await issuerA.ready();
  await issuerB.ready();
  walkerA = await register(issuerA, '+972-50-a1', 'a1@example.org', 'A의 워커', 'dev-verified');
  walkerB = await register(issuerB, '+1-555-b1', 'b1@example.org', 'B의 워커', 'dev-verified');
  coinA = mintWalk(walkerA, walkerA.cert!);
  coinB = mintWalk(walkerB, walkerB.cert!);
  keysA = await keysOf(issuerA);
  keysB = await keysOf(issuerB);
});

afterAll(async () => {
  await issuerA.close();
  await issuerB.close();
});

describe('두 배포는 같은 이름을 쓰지 않는다 (규격 I-1)', () => {
  it('여섯 개 키 이름이 배포마다 전부 다르다', () => {
    const a = issuerA.keyIds;
    const b = issuerB.keyIds;
    for (const k of ['promo', 'claim', 'reward', 'treasure', 'membershipRoot', 'distribution'] as const) {
      expect(a[k]).not.toBe(b[k]);
    }
  });

  it('이름은 자기 공개키에서 유도된 값이다 — 남이 같은 식으로 검산할 수 있다', () => {
    for (const k of [...keysA, ...keysB]) {
      expect(k.keyId).toBe(deriveKeyId(k.purpose, k.publicKey));
    }
  });

  it('새 배포는 옛 하드코딩 이름(-2026)을 주장하지 않는다 (규격 9.3 의무 2번)', () => {
    for (const k of [...keysA, ...keysB]) {
      expect(k.keyId.endsWith('-2026')).toBe(false);
    }
  });
});

describe('★두 발행자의 코인이 한 지갑에서 동시에 통과한다', () => {
  it('키 목록을 합쳐도 서로를 덮어쓰지 않는다 (슬롯 충돌 소멸)', () => {
    const merged = acceptKeyBindings([...keysA, ...keysB]);
    expect(merged).toHaveLength(keysA.length + keysB.length);
    const roots = merged.filter((k) => k.purpose === 'MEMBERSHIP_ROOT');
    expect(roots).toHaveLength(2); // 예전에는 1개였다 — 그래서 한쪽이 죽었다
  });

  it('★A의 코인과 B의 코인이 **동시에** valid:true (방침의 코드 증명)', () => {
    const merged = acceptKeyBindings([...keysA, ...keysB]);
    const trustedRootKeys = Object.fromEntries(merged.map((k) => [k.keyId, k.publicKey]));
    expect(verifyCoin(coinA, { requireIntegrityToken: true, trustedRootKeys })).toEqual({
      valid: true,
      reasons: [],
    });
    expect(verifyCoin(coinB, { requireIntegrityToken: true, trustedRootKeys })).toEqual({
      valid: true,
      reasons: [],
    });
  });

  it('합치는 순서를 뒤집어도 결과가 같다 — 배열 순서가 화폐를 정하지 않는다', () => {
    const reversed = acceptKeyBindings([...keysB, ...keysA]);
    const trustedRootKeys = Object.fromEntries(reversed.map((k) => [k.keyId, k.publicKey]));
    expect(verifyCoin(coinA, { requireIntegrityToken: true, trustedRootKeys }).valid).toBe(true);
    expect(verifyCoin(coinB, { requireIntegrityToken: true, trustedRootKeys }).valid).toBe(true);
  });

  it('한쪽만 신뢰하면 다른 쪽 코인은 통과하지 못한다 (신뢰 선택은 여전히 사용자의 것)', () => {
    const onlyA = Object.fromEntries(keysA.map((k) => [k.keyId, k.publicKey]));
    expect(verifyCoin(coinA, { requireIntegrityToken: true, trustedRootKeys: onlyA }).valid).toBe(true);
    expect(verifyCoin(coinB, { requireIntegrityToken: true, trustedRootKeys: onlyA }).valid).toBe(false);
  });
});

describe('★사칭 — B가 A의 회원 번호를 찍어도 A의 지갑에서 진품이 되지 못한다', () => {
  it("B가 A의 회원 번호로 발급한 증서는 A의 루트로 검증되지 않는다", async () => {
    // B의 서버에 A의 회원 번호와 같은 형식의 회원이 있다고 해도, 증서는 B의 루트가
    // 서명한 것이다. 예전에는 B가 슬롯을 이기면 이 증서가 A의 지갑에서 통과했다.
    const impostor = await register(issuerB, '+1-555-b2', 'b2@example.org', '사칭', 'dev-verified');
    const fakeCoin = mintWalk(impostor, impostor.cert!);
    const onlyA = Object.fromEntries(keysA.map((k) => [k.keyId, k.publicKey]));
    const verdict = verifyCoin(fakeCoin, { requireIntegrityToken: true, trustedRootKeys: onlyA });
    expect(verdict.valid).toBe(false);

    // 그리고 A의 코인은 같은 목록에서 멀쩡하다 — 한쪽이 다른 쪽을 죽이지 않는다.
    expect(verifyCoin(coinA, { requireIntegrityToken: true, trustedRootKeys: onlyA }).valid).toBe(true);
  });
});
