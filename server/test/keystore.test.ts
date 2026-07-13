/**
 * 발행 개인키 봉인 저장 (보안 감사 H-2).
 * DB에 개인키가 평문으로 남지 않고, 운영은 KEK가 필수임을 검증.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { isSealed } from '@shvil/shared';
import { createDb, kvGet } from '../src/db';
import { resolveKek, SealedKeystore } from '../src/keystore';

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
