/**
 * 발행 개인키 봉인 저장 (보안 감사 H-2).
 * DB에 개인키가 평문으로 남지 않고, 운영은 KEK가 필수임을 검증.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { deriveKeyId, isSealed } from '@shvil/shared';
import { createDb, kvGet } from '../src/db';
import {
  archivedPublicKeys,
  recordPublicKey,
  resolveKek,
  SealedKeystore,
  trustedKeysForPurposes,
} from '../src/keystore';

const savedEnv = process.env.SHVIL_KEK;
afterEach(() => {
  if (savedEnv === undefined) delete process.env.SHVIL_KEK;
  else process.env.SHVIL_KEK = savedEnv;
});

describe('SealedKeystore', () => {
  it('발행 개인키는 kv에 봉인되어 저장된다 (평문 아님)', () => {
    process.env.SHVIL_KEK = 'c'.repeat(64);
    const db = createDb(':memory:');
    const ks = new SealedKeystore(db, false);
    const signer = ks.loadOrCreateSigner('promoKey');

    const stored = kvGet(db, 'promoKey')!;
    expect(isSealed(stored)).toBe(true);
    expect(stored).not.toContain(signer.publicKeyHex); // 봉인문에 원문 흔적 없음
    // 재로드 시 같은 키를 복원
    const ks2 = new SealedKeystore(db, false);
    expect(ks2.loadOrCreateSigner('promoKey').publicKeyHex).toBe(signer.publicKeyHex);
  });

  it('레거시 평문 키는 자동 재봉인된다', () => {
    process.env.SHVIL_KEK = 'd'.repeat(64);
    const db = createDb(':memory:');
    // 평문 저장(구버전 시뮬레이션)
    db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run(
      'claimKey',
      JSON.stringify({ publicKeyHex: 'aa', secretKeyHex: 'bb' }),
    );
    const ks = new SealedKeystore(db, false);
    ks.loadOrCreateSigner('claimKey');
    expect(isSealed(kvGet(db, 'claimKey')!)).toBe(true); // 재봉인됨
  });

  it('운영(devMode=false)에서 KEK 환경변수가 없으면 기동 실패 (fail-closed)', () => {
    delete process.env.SHVIL_KEK;
    expect(() => resolveKek(false)).toThrow(/SHVIL_KEK/);
  });

  it('개발(devMode=true)에서는 KEK 없이도 폴백으로 동작한다', () => {
    delete process.env.SHVIL_KEK;
    expect(resolveKek(true)).toBeTruthy();
    const db = createDb(':memory:');
    const ks = new SealedKeystore(db, true);
    expect(ks.loadOrCreateSigner('rewardKey').publicKeyHex).toMatch(/^[0-9a-f]+$/);
  });
});

/**
 * ★공개키 이력 (2026-07-26) — 키를 회전해도 옛 코인이 죽지 않아야 한다.
 *
 * 증서 만료라는 킬 스위치를 없애도, `/keys`가 현행 키만 내려보내면 **루트 회전이
 * 그대로 킬 스위치로 남는다.** 회전 이후 새로 설치한 지갑은 옛 루트를 배울 길이
 * 없고, 서버 자신도 루트를 하나만 들고 있어 옛 코인을 INVALID로 판정했다.
 */
const ROOT_A = 'aa'.repeat(32);
const ROOT_B = 'bb'.repeat(32);
const PROMO_A = 'cc'.repeat(32);

describe('공개키 이력 — 회전해도 옛 키가 사라지지 않는다', () => {
  it('회전(새 키 재료 = 새 유도 이름)은 이력에 더해질 뿐, 옛 키를 지우지 않는다', () => {
    const db = createDb(':memory:');
    const idA = deriveKeyId('MEMBERSHIP_ROOT', ROOT_A);
    const idB = deriveKeyId('MEMBERSHIP_ROOT', ROOT_B);
    recordPublicKey(db, { keyId: idA, publicKey: ROOT_A, purpose: 'MEMBERSHIP_ROOT' });
    // 회전 — 새 키를 만들면 이름이 그 키에서 유도되어 저절로 달라진다(규격 I-1).
    recordPublicKey(db, { keyId: idB, publicKey: ROOT_B, purpose: 'MEMBERSHIP_ROOT' });

    const roots = trustedKeysForPurposes(db, ['MEMBERSHIP_ROOT']);
    // 옛 루트가 그대로 있다 = 회전 전에 만든 코인이 회전 후에도 검증된다.
    expect(roots[idA]).toBe(ROOT_A);
    expect(roots[idB]).toBe(ROOT_B);
  });

  it('같은 keyId에 다른 공개키가 와도 바꾸지 않는다 (바꿔치기 차단 · 지갑 규칙과 동일)', () => {
    const db = createDb(':memory:');
    const id = deriveKeyId('ANGEL_BONUS', PROMO_A);
    recordPublicKey(db, { keyId: id, publicKey: PROMO_A, purpose: 'ANGEL_BONUS' });
    recordPublicKey(db, { keyId: id, publicKey: ROOT_B, purpose: 'ANGEL_BONUS' });

    expect(archivedPublicKeys(db)).toHaveLength(1);
    expect(trustedKeysForPurposes(db, ['ANGEL_BONUS'])[id]).toBe(PROMO_A);
  });

  it('용도가 다른 키는 섞이지 않는다 — 루트가 발행 키로 새어 나가지 않는다', () => {
    const db = createDb(':memory:');
    const rootId = deriveKeyId('MEMBERSHIP_ROOT', ROOT_A);
    const promoId = deriveKeyId('ANGEL_BONUS', PROMO_A);
    recordPublicKey(db, { keyId: rootId, publicKey: ROOT_A, purpose: 'MEMBERSHIP_ROOT' });
    recordPublicKey(db, { keyId: promoId, publicKey: PROMO_A, purpose: 'ANGEL_BONUS' });

    expect(trustedKeysForPurposes(db, ['ANGEL_BONUS'])).toEqual({ [promoId]: PROMO_A });
    expect(trustedKeysForPurposes(db, ['MEMBERSHIP_ROOT'])).toEqual({ [rootId]: ROOT_A });
  });
});

/**
 * ★유도식 검산 관문 (2026-07-26 — 규격 9.2 I-3).
 *
 * 이력에 들어간 키는 `/keys`로 배포되어 남의 지갑의 신뢰 목록이 된다. 검산 없이
 * 넣으면 이 서버가 **남의 유도 이름을 참칭한 키를 대신 배포하는 통로**가 된다.
 */
describe('이력 등재 관문 — 유도되지 않은 이름은 들어가지 못한다', () => {
  it('유도 이름이 아닌 항목은 던진다 (조용히 건너뛰지 않는다)', () => {
    const db = createDb(':memory:');
    expect(() =>
      recordPublicKey(db, { keyId: 'membership-root-2099', publicKey: ROOT_A, purpose: 'MEMBERSHIP_ROOT' }),
    ).toThrow(/유도/);
    expect(archivedPublicKeys(db)).toHaveLength(0);
  });

  it('★남의 공개키에서 유도된 이름에 자기 키를 붙이면 거부된다 (참칭 차단)', () => {
    const db = createDb(':memory:');
    expect(() =>
      recordPublicKey(db, {
        keyId: deriveKeyId('MEMBERSHIP_ROOT', ROOT_A), // A의 이름
        publicKey: ROOT_B, // B의 키
        purpose: 'MEMBERSHIP_ROOT',
      }),
    ).toThrow(/유도/);
  });

  it('★옛 이름은 아무도 새로 적지 못한다 — 원조도, 제2 발행자도', () => {
    // 옛 이름은 모든 배포가 같이 쓰던 칸이라, 누구든 새로 적으면 다시 선착순 다툼이 된다.
    // 적지 않아도 옛 코인은 죽지 않는다 — 검증 측이 공개키로 해소한다
    // (packages/shared `isTrustedKeyBinding`, legacyKeyIdSurvival.test.ts).
    const db = createDb(':memory:');
    recordPublicKey(db, {
      keyId: deriveKeyId('MEMBERSHIP_ROOT', ROOT_A),
      publicKey: ROOT_A,
      purpose: 'MEMBERSHIP_ROOT',
    });
    expect(() =>
      recordPublicKey(db, { keyId: 'membership-root-2026', publicKey: ROOT_A, purpose: 'MEMBERSHIP_ROOT' }),
    ).toThrow(/유도/);
    expect(() =>
      recordPublicKey(db, { keyId: 'membership-root-2026', publicKey: ROOT_B, purpose: 'MEMBERSHIP_ROOT' }),
    ).toThrow(/유도/);
    expect(trustedKeysForPurposes(db, ['MEMBERSHIP_ROOT'])['membership-root-2026']).toBeUndefined();
  });

  it('규격에 없는 용도는 기동 시점에 터진다 (용도 문자열은 유도식의 입력이다)', () => {
    const db = createDb(':memory:');
    expect(() => recordPublicKey(db, { keyId: 'x', publicKey: ROOT_A, purpose: 'SPOT_RESERVE' })).toThrow(/유도/);
  });

  it('★업그레이드 경로: 앞선 버전이 적어 둔 옛 이름은 검산에 걸려 사라지지 않는다', () => {
    const db = createDb(':memory:');
    // 이전 버전(하드코딩 이름)이 이미 적어 둔 상태를 그대로 재현한다.
    db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run(
      'publicKeyArchive',
      JSON.stringify([
        { keyId: 'membership-root-2026', publicKey: ROOT_A, purpose: 'MEMBERSHIP_ROOT', firstSeenAt: 1 },
      ]),
    );
    // 새 버전이 기동하며 유도 이름을 하나 더 적는다(같은 키 재료 = 같은 공개키).
    recordPublicKey(db, {
      keyId: deriveKeyId('MEMBERSHIP_ROOT', ROOT_A),
      publicKey: ROOT_A,
      purpose: 'MEMBERSHIP_ROOT',
    });
    const roots = trustedKeysForPurposes(db, ['MEMBERSHIP_ROOT']);
    // 옛 이름과 새 이름이 **둘 다** 실린다 = 옛 증서·새 증서가 모두 산다(유통 코인 0개 무효).
    expect(roots['membership-root-2026']).toBe(ROOT_A);
    expect(roots[deriveKeyId('MEMBERSHIP_ROOT', ROOT_A)]).toBe(ROOT_A);
  });
});
