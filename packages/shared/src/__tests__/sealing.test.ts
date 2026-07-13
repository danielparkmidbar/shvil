import { describe, expect, it } from 'vitest';
import { isSealed, openSecret, sealSecret } from '../sealing';

const KEK = 'a'.repeat(64); // 32바이트 hex

describe('발행 개인키 봉인 저장 (보안 감사 H-2)', () => {
  it('봉인→해제 왕복이 무손실이다', () => {
    // 봉인문은 hex 문자열이므로, 평문 노출 검사는 hex에 존재할 수 없는 마커로 한다
    // (짧은 hex 시퀀스는 랜덤 논스·암호문에 우연히 나타날 수 있음).
    const secret = JSON.stringify({ publicKeyHex: 'ab', secretKeyHex: 'SECRET-MARKER-Z' });
    const sealed = sealSecret(secret, KEK);
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain('SECRET-MARKER-Z'); // 평문 비밀이 노출되지 않는다
    expect(openSecret(sealed, KEK)).toBe(secret);
  });

  it('같은 평문도 매번 다른 봉인문을 낸다 (랜덤 논스)', () => {
    expect(sealSecret('x', KEK)).not.toBe(sealSecret('x', KEK));
  });

  it('틀린 KEK로는 해제할 수 없다 (AEAD 인증)', () => {
    const sealed = sealSecret('secret', KEK);
    expect(() => openSecret(sealed, 'b'.repeat(64))).toThrow();
  });

  it('봉인문 변조는 해제 실패로 드러난다', () => {
    const sealed = sealSecret('secret', KEK);
    const tampered = sealed.slice(0, -2) + '00';
    expect(() => openSecret(tampered, KEK)).toThrow();
  });

  it('hex가 아닌 KEK 문자열도 sha256으로 키 유도해 동작한다', () => {
    const sealed = sealSecret('secret', 'my-passphrase');
    expect(openSecret(sealed, 'my-passphrase')).toBe('secret');
  });

  it('봉인되지 않은 값은 isSealed=false, openSecret은 거부', () => {
    expect(isSealed('{"plain":true}')).toBe(false);
    expect(() => openSecret('{"plain":true}', KEK)).toThrow();
  });
});
