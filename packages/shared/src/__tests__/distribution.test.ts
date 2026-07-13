import { describe, expect, it } from 'vitest';
import { generateKeyPair, signerFromKeyPair } from '../crypto';
import { signDistribution, verifyDistribution, type Signed } from '../distribution';
import { T0 } from './helpers';

const DIST_KEY_ID = 'dist-2026';
const dist = signerFromKeyPair(generateKeyPair());

function signedKeys() {
  return signDistribution(
    { keys: [{ keyId: 'promo', publicKey: 'aabb', purpose: 'ANGEL_BONUS' }] },
    dist,
    DIST_KEY_ID,
    T0,
  );
}

describe('배포 데이터 서명 (보안 감사 H-3)', () => {
  it('정상 서명은 검증을 통과하고 배포 공개키를 돌려준다', () => {
    const res = signedKeys();
    const verdict = verifyDistribution(res);
    expect(verdict.valid).toBe(true);
    if (verdict.valid) expect(verdict.distPublicKey).toBe(dist.publicKeyHex);
  });

  it('본문 변조(발행 공개키 교체)는 서명 검증에서 걸린다 (MITM 차단)', () => {
    const res = signedKeys();
    const tampered = { ...res, keys: [{ keyId: 'promo', publicKey: 'DEADBEEF', purpose: 'ANGEL_BONUS' }] };
    expect(verifyDistribution(tampered)).toMatchObject({ valid: false, reason: 'BAD_SIGNATURE' });
  });

  it('소명 목록 조작도 동일하게 탐지된다', () => {
    const res = signDistribution({ members: [{ memberId: 'SHV-1' }] }, dist, DIST_KEY_ID, T0);
    const tampered = { ...res, members: [] as { memberId: string }[] };
    expect(verifyDistribution(tampered).valid).toBe(false);
  });

  it('TOFU 핀: 고정한 공개키와 다른 배포 키는 거부 (키 바꿔치기)', () => {
    const res = signedKeys();
    const rogue = signerFromKeyPair(generateKeyPair());
    const rogueRes = signDistribution({ keys: [] }, rogue, DIST_KEY_ID, T0) as Signed<{ keys: unknown[] }>;
    // 지갑이 dist 공개키를 핀했는데, 공격자가 자기 키로 서명한 응답을 내밀면
    expect(verifyDistribution(rogueRes, dist.publicKeyHex)).toMatchObject({ valid: false, reason: 'KEY_PIN_MISMATCH' });
    // 핀과 일치하면 통과
    expect(verifyDistribution(res, dist.publicKeyHex).valid).toBe(true);
  });

  it('서명 없는 응답은 거부 (미서명 배포 차단)', () => {
    const bare = { keys: [] } as unknown as Signed<{ keys: unknown[] }>;
    expect(verifyDistribution(bare)).toMatchObject({ valid: false, reason: 'NO_SIGNATURE' });
  });
});
