/**
 * 발행 개인키 봉인 저장 (보안 감사 H-2).
 * DB에 개인키가 평문으로 남지 않고, 운영은 KEK가 필수임을 검증.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { isSealed } from '@shvil/shared';
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
describe('공개키 이력 — 회전해도 옛 키가 사라지지 않는다', () => {
  it('회전(새 keyId)은 이력에 더해질 뿐, 옛 키를 지우지 않는다', () => {
    const db = createDb(':memory:');
    recordPublicKey(db, { keyId: 'membership-root-2026', publicKey: 'aa', purpose: 'MEMBERSHIP_ROOT' });
    // 다음 해 회전 — 이름 규약에 연도가 있으므로 새 keyId로 온다.
    recordPublicKey(db, { keyId: 'membership-root-2027', publicKey: 'bb', purpose: 'MEMBERSHIP_ROOT' });

    const roots = trustedKeysForPurposes(db, ['MEMBERSHIP_ROOT']);
    // 옛 루트가 그대로 있다 = 2026년에 만든 코인이 2027년에도 검증된다.
    expect(roots['membership-root-2026']).toBe('aa');
    expect(roots['membership-root-2027']).toBe('bb');
  });

  it('같은 keyId에 다른 공개키가 와도 바꾸지 않는다 (바꿔치기 차단 · 지갑 규칙과 동일)', () => {
    const db = createDb(':memory:');
    recordPublicKey(db, { keyId: 'promo-angel-2026', publicKey: 'aa', purpose: 'ANGEL_BONUS' });
    recordPublicKey(db, { keyId: 'promo-angel-2026', publicKey: 'ZZ', purpose: 'ANGEL_BONUS' });

    expect(archivedPublicKeys(db)).toHaveLength(1);
    expect(trustedKeysForPurposes(db, ['ANGEL_BONUS'])['promo-angel-2026']).toBe('aa');
  });

  it('용도가 다른 키는 섞이지 않는다 — 루트가 발행 키로 새어 나가지 않는다', () => {
    const db = createDb(':memory:');
    recordPublicKey(db, { keyId: 'membership-root-2026', publicKey: 'root', purpose: 'MEMBERSHIP_ROOT' });
    recordPublicKey(db, { keyId: 'promo-angel-2026', publicKey: 'promo', purpose: 'ANGEL_BONUS' });

    expect(trustedKeysForPurposes(db, ['ANGEL_BONUS'])).toEqual({ 'promo-angel-2026': 'promo' });
    expect(trustedKeysForPurposes(db, ['MEMBERSHIP_ROOT'])).toEqual({ 'membership-root-2026': 'root' });
  });
});
