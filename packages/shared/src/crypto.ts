/**
 * 서명·해시 프리미티브 (ed25519 + sha256, 순수 JS — RN/Node/브라우저 공용).
 *
 * 실제 기기에서는 개인키를 보안 영역(iOS Secure Enclave / Android StrongBox)에
 * 보관한다. 이 모듈의 KeyPair는 테스트·서버·프로모션 키 용도이며, 앱(M1)은
 * 동일 인터페이스(Signer)를 보안 영역 기반으로 구현해 끼운다.
 */
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { stableStringify } from './canonical.js';

export interface KeyPair {
  publicKeyHex: string;
  secretKeyHex: string;
}

/** 서명 주체 추상화 — 앱은 보안 영역 서명으로 대체 구현한다. */
export interface Signer {
  publicKeyHex: string;
  sign(messageBytes: Uint8Array): string; // hex signature
}

export function generateKeyPair(): KeyPair {
  const secret = ed25519.utils.randomPrivateKey();
  return {
    secretKeyHex: bytesToHex(secret),
    publicKeyHex: bytesToHex(ed25519.getPublicKey(secret)),
  };
}

export function signerFromKeyPair(kp: KeyPair): Signer {
  return {
    publicKeyHex: kp.publicKeyHex,
    sign: (msg) => bytesToHex(ed25519.sign(msg, hexToBytes(kp.secretKeyHex))),
  };
}

export function verifySignature(signatureHex: string, messageBytes: Uint8Array, publicKeyHex: string): boolean {
  try {
    return ed25519.verify(hexToBytes(signatureHex), messageBytes, hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

export function sha256Hex(input: string | Uint8Array): string {
  return bytesToHex(sha256(typeof input === 'string' ? utf8ToBytes(input) : input));
}

/** 지갑 주소 = 공개키 sha256 해시 앞 40 hex + 프리픽스. */
export function addressFromPublicKey(publicKeyHex: string): string {
  return `shv1${sha256Hex(hexToBytes(publicKeyHex)).slice(0, 40)}`;
}

/** 객체를 정준 직렬화해 서명한다. */
export function signObject(payload: unknown, signer: Signer): string {
  return signer.sign(utf8ToBytes(stableStringify(payload)));
}

/** 객체 서명 검증. */
export function verifyObject(payload: unknown, signatureHex: string, publicKeyHex: string): boolean {
  return verifySignature(signatureHex, utf8ToBytes(stableStringify(payload)), publicKeyHex);
}

/** 객체의 정준 해시. */
export function hashObject(payload: unknown): string {
  return sha256Hex(stableStringify(payload));
}
