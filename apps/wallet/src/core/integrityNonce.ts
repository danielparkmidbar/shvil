/**
 * 무결성 nonce 계산 (순수 — expo 모듈 import 금지, vitest 대상).
 *
 * ★서버 server/src/playIntegrity.ts의 integrityNonce와 **문자열 구성·인코딩이 정확히
 * 같아야 한다.** 어긋나면 모든 검증이 NONCE_MISMATCH로 떨어져 아무도 VERIFIED를 받지
 * 못한다. 그래서 이 파일을 순수 모듈로 분리해 테스트로 고정한다.
 */
import { sha256Hex } from '@shvil/shared';

/** 16진 문자열 → base64url (Play Integrity nonce 형식). */
export function hexToBase64Url(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  // RN에는 Buffer가 없을 수 있으므로 globalThis.btoa를 우선 쓴다.
  const b64 =
    typeof globalThis.btoa === 'function'
      ? globalThis.btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 문자열 → SHA-256 → base64url. 서버 `createHash('sha256').digest('base64url')`와 동일. */
export function sha256Base64Url(input: string): string {
  return hexToBase64Url(sha256Hex(input));
}

/**
 * 서버 챌린지 + 기기 공개키 → Play Integrity nonce.
 * 서버: sha256(`shvil-integrity|${challenge}|${devicePublicKey}`).base64url
 */
export function buildIntegrityNonce(challenge: string, devicePublicKey: string): string {
  // ★서버와 같은 길이 접두 방식 — 단순 연결은 ('a|b','c')와 ('a','b|c')를 구분하지
  //   못한다(테스트가 잡아냈다). RN에는 Buffer가 없을 수 있어 TextEncoder로 잰다.
  const byteLen = (v: string) =>
    typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(v).length : Buffer.byteLength(v, 'utf8');
  const part = (v: string) => `${byteLen(v)}:${v}`;
  return sha256Base64Url(`shvil-integrity|${part(challenge)}|${part(devicePublicKey)}`);
}
