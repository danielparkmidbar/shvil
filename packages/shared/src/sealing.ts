/**
 * 대칭키 봉인(seal) — 저장 시 비밀을 암호화한다 (보안 감사 H-2).
 *
 * 용도: 서버 발행 개인키(promo/claim/reward/membership-root)를 DB에 평문으로 두지
 * 않고, 환경변수로 주입한 키 암호화 키(KEK)로 봉인해 저장한다. DB가 유출되어도
 * KEK 없이는 발행 키를 복원할 수 없다.
 *
 * 알고리즘: XChaCha20-Poly1305 (24바이트 랜덤 논스, AEAD). 형식: "seal.v1.{nonceHex}.{ctHex}".
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha256';
import { utf8Decode, utf8Encode } from './encoding';

const PREFIX = 'seal.v1.';

/** KEK 문자열을 32바이트 키로 정규화 (hex 64자면 그대로, 아니면 sha256). */
function normalizeKey(kek: string): Uint8Array {
  if (/^[0-9a-fA-F]{64}$/.test(kek)) return hexToBytes(kek);
  return sha256(utf8Encode(kek));
}

function randomNonce(): Uint8Array {
  const nonce = new Uint8Array(24);
  crypto.getRandomValues(nonce);
  return nonce;
}

export function sealSecret(plaintext: string, kek: string): string {
  const key = normalizeKey(kek);
  const nonce = randomNonce();
  const ct = xchacha20poly1305(key, nonce).encrypt(utf8Encode(plaintext));
  return `${PREFIX}${bytesToHex(nonce)}.${bytesToHex(ct)}`;
}

export function isSealed(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function openSecret(sealed: string, kek: string): string {
  if (!isSealed(sealed)) throw new Error('openSecret: not a sealed value');
  const [, , nonceHex, ctHex] = sealed.split('.');
  if (!nonceHex || !ctHex) throw new Error('openSecret: malformed sealed value');
  const key = normalizeKey(kek);
  const plain = xchacha20poly1305(key, hexToBytes(nonceHex)).decrypt(hexToBytes(ctHex));
  return utf8Decode(plain);
}
