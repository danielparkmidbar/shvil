/**
 * 지갑 내 메신저 — 종단간 암호화 봉투 (지시서 0-4, 1장).
 *
 * 서버(릴레이)는 암호문만 중계한다. 평문은 두 기기에서만 존재한다.
 * - 키 합의: X25519 정적-정적 ECDH → HKDF-SHA256
 * - 암호화: XChaCha20-Poly1305 (24바이트 랜덤 논스)
 * - 발신자 인증: 기기 ed25519 키 서명 (회원 번호 ↔ 메시징 키 바인딩은
 *   디렉토리 프로필에서 확인)
 */
import { x25519 } from '@noble/curves/ed25519';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { signObject, verifyObject, type Signer } from './crypto';
import { utf8Decode } from './encoding';

export interface MessagingKeyPair {
  publicKeyHex: string;
  secretKeyHex: string;
}

export function generateMessagingKeyPair(): MessagingKeyPair {
  const secret = x25519.utils.randomPrivateKey();
  return {
    secretKeyHex: bytesToHex(secret),
    publicKeyHex: bytesToHex(x25519.getPublicKey(secret)),
  };
}

/** E2E 봉투 — 서버가 보고 저장하는 것은 이 구조 전체이며, 평문은 없다. */
export interface MessageEnvelope {
  v: 1;
  type: 'shvil/msg';
  fromMemberId: string;
  toMemberId: string;
  /** 발신자 X25519 공개키 — 수신자가 복호화 키를 유도. */
  senderMsgPublicKey: string;
  nonceHex: string;
  ciphertextHex: string;
  sentAt: number;
  /** 발신자 기기 ed25519 서명 (signature 제외 전체) — 발신자 위장 방지. */
  senderDevicePublicKey: string;
  signature: string;
}

function deriveKey(sharedSecret: Uint8Array, nonce: Uint8Array): Uint8Array {
  return hkdf(sha256, sharedSecret, nonce, utf8ToBytes('shvil-msg-v1'), 32);
}

function randomNonce(): Uint8Array {
  const nonce = new Uint8Array(24);
  crypto.getRandomValues(nonce);
  return nonce;
}

export interface SealArgs {
  plaintext: string;
  fromMemberId: string;
  toMemberId: string;
  senderMsgKeyPair: MessagingKeyPair;
  recipientMsgPublicKey: string;
  deviceSigner: Signer;
  now: number;
}

export function sealMessage(args: SealArgs): MessageEnvelope {
  const nonce = randomNonce();
  const shared = x25519.getSharedSecret(
    hexToBytes(args.senderMsgKeyPair.secretKeyHex),
    hexToBytes(args.recipientMsgPublicKey),
  );
  const key = deriveKey(shared, nonce);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(utf8ToBytes(args.plaintext));

  const unsigned = {
    v: 1 as const,
    type: 'shvil/msg' as const,
    fromMemberId: args.fromMemberId,
    toMemberId: args.toMemberId,
    senderMsgPublicKey: args.senderMsgKeyPair.publicKeyHex,
    nonceHex: bytesToHex(nonce),
    ciphertextHex: bytesToHex(ciphertext),
    sentAt: args.now,
    senderDevicePublicKey: args.deviceSigner.publicKeyHex,
  };
  return { ...unsigned, signature: signObject(unsigned, args.deviceSigner) };
}

export interface OpenResult {
  plaintext: string;
  /** 서명 유효 여부 — 디렉토리의 기기 키와 대조는 호출자 몫. */
  signatureValid: boolean;
}

export function openMessage(envelope: MessageEnvelope, myMsgKeyPair: MessagingKeyPair): OpenResult {
  const { signature, ...unsigned } = envelope;
  const signatureValid = verifyObject(unsigned, signature, envelope.senderDevicePublicKey);

  const shared = x25519.getSharedSecret(
    hexToBytes(myMsgKeyPair.secretKeyHex),
    hexToBytes(envelope.senderMsgPublicKey),
  );
  const nonce = hexToBytes(envelope.nonceHex);
  const key = deriveKey(shared, nonce);
  const plainBytes = xchacha20poly1305(key, nonce).decrypt(hexToBytes(envelope.ciphertextHex));
  return { plaintext: utf8Decode(plainBytes), signatureValid };
}
