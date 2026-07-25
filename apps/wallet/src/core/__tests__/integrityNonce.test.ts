/**
 * 무결성 nonce 교차 검증 (보안 감사 C-2 실연동).
 *
 * ★이 테스트가 지키는 것: 지갑이 만드는 nonce와 서버가 기대하는 nonce가 **정확히
 * 같아야 한다.** 한 글자라도 어긋나면 모든 검증이 NONCE_MISMATCH로 떨어져 아무도
 * VERIFIED를 받지 못한다 — 그런데 앱은 정상 동작하는 것처럼 보이므로(0층 폴백)
 * 실기기에서만 드러나는 조용한 고장이 된다. 그래서 여기서 고정한다.
 *
 * 서버 식: createHash('sha256').update(`shvil-integrity|${challenge}|${devicePublicKey}`).digest('base64url')
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { buildIntegrityNonce, hexToBase64Url, sha256Base64Url } from '../integrityNonce';

const DEVICE_KEY = 'a'.repeat(64);

/** 서버가 쓰는 것과 같은 계산 (node:crypto 직접) — 비교 기준. */
function serverNonce(challenge: string, devicePublicKey: string): string {
  const part = (v: string) => `${Buffer.byteLength(v, 'utf8')}:${v}`;
  return createHash('sha256')
    .update(`shvil-integrity|${part(challenge)}|${part(devicePublicKey)}`)
    .digest('base64url');
}

describe('hexToBase64Url', () => {
  it('node의 base64url 인코딩과 일치한다', () => {
    const hex = createHash('sha256').update('sample').digest('hex');
    const expected = createHash('sha256').update('sample').digest('base64url');
    expect(hexToBase64Url(hex)).toBe(expected);
  });

  it('패딩(=)과 +/ 문자가 없다 (base64url 요건)', () => {
    for (const s of ['a', 'bb', 'ccc', 'dddd', 'shvil']) {
      const out = sha256Base64Url(s);
      expect(out).not.toContain('=');
      expect(out).not.toContain('+');
      expect(out).not.toContain('/');
      expect(out).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe('★buildIntegrityNonce — 서버와 정확히 일치해야 한다', () => {
  it('여러 챌린지·키 조합에서 서버 계산과 같다', () => {
    const cases: [string, string][] = [
      ['simple', DEVICE_KEY],
      ['with-dash_and_underscore', 'b'.repeat(64)],
      ['MTIzNDU2Nzg5MA', 'c'.repeat(64)],
      ['', DEVICE_KEY],
      ['한글챌린지', DEVICE_KEY], // 비ASCII도 UTF-8로 같게 처리되는지
    ];
    for (const [challenge, key] of cases) {
      expect(buildIntegrityNonce(challenge, key)).toBe(serverNonce(challenge, key));
    }
  });

  it('챌린지·기기 키가 다르면 nonce가 달라진다 (결속이 실재한다)', () => {
    const base = buildIntegrityNonce('c1', DEVICE_KEY);
    expect(buildIntegrityNonce('c2', DEVICE_KEY)).not.toBe(base);
    expect(buildIntegrityNonce('c1', 'd'.repeat(64))).not.toBe(base);
  });

  it('구분자가 실제로 구분한다 (연결 모호성 없음)', () => {
    // 'a|b' + 'c' 와 'a' + 'b|c'가 같은 nonce가 되면 결속이 무의미해진다.
    expect(buildIntegrityNonce('a|b', 'c')).not.toBe(buildIntegrityNonce('a', 'b|c'));
  });
});
