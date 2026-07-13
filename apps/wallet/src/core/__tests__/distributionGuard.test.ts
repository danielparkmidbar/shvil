import { describe, expect, it } from 'vitest';
import { generateKeyPair, signDistribution, signerFromKeyPair } from '@shvil/shared';
import { guardDistribution } from '../distributionGuard';

const dist = signerFromKeyPair(generateKeyPair());
const T0 = Date.parse('2026-07-13T00:00:00Z');

function signedKeys() {
  return signDistribution(
    { keys: [{ keyId: 'promo-angel-2026', publicKey: 'aabb', purpose: 'ANGEL_BONUS' }] },
    dist,
    'distribution-2026',
    T0,
  );
}

describe('배포 서명 가드 — TOFU 핀 (보안 감사 H-3)', () => {
  it('최초 수신: 검증 통과 + 배포 공개키를 핀으로 반환 (TOFU)', () => {
    const { body, pinToStore } = guardDistribution(signedKeys(), null);
    expect(body.keys[0]!.keyId).toBe('promo-angel-2026');
    expect(pinToStore).toBe(dist.publicKeyHex);
  });

  it('핀 보유 후: 같은 키 서명은 통과하고 재핀하지 않는다', () => {
    const { pinToStore } = guardDistribution(signedKeys(), dist.publicKeyHex);
    expect(pinToStore).toBeNull();
  });

  it('본문 변조(발행 키 교체)는 거부 — 캐시 갱신 차단', () => {
    const res = signedKeys();
    const tampered = { ...res, keys: [{ keyId: 'promo-angel-2026', publicKey: 'EVIL', purpose: 'ANGEL_BONUS' }] };
    expect(() => guardDistribution(tampered, dist.publicKeyHex)).toThrow(/배포 서명 검증 실패/);
  });

  it('다른 키로 서명한 응답은 핀 불일치로 거부 (배포 키 바꿔치기)', () => {
    const rogue = signerFromKeyPair(generateKeyPair());
    const rogueRes = signDistribution({ keys: [] }, rogue, 'distribution-2026', T0);
    expect(() => guardDistribution(rogueRes, dist.publicKeyHex)).toThrow(/KEY_PIN_MISMATCH/);
  });
});
