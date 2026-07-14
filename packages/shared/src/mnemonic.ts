/**
 * 니모닉 복구 (지시서 2.1, 보안 감사 L-2).
 *
 * BIP-39 12단어에서 기기 서명 키(ed25519)·메시징 키(X25519)·백업 암호화 키를
 * 결정적으로 유도한다. 니모닉만 있으면 폰 분실 후 같은 키·주소를 되살릴 수 있다.
 *
 * 니모닉은 진실의 원천이다 — 키는 저장하는 대신 니모닉에서 유도한다. 니모닉 자체는
 * 기기 보안 영역(SecureStore)에 보관하고, 사용자에게 오프라인 백업(적어두기)을
 * 강력 권고한다(강제 아님 — 결정 대기 4번).
 *
 * 확정 코인 복구는 이 키로 복호화하는 암호화 백업(backup.ts)이 담당한다.
 * 잠정 누적은 백업 대상이 아니다(지시서 2.2: 니모닉 백업은 확정 코인만).
 */
import { generateMnemonic as bip39Generate, mnemonicToSeedSync, validateMnemonic as bip39Validate } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { ed25519, x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import type { KeyPair } from './crypto';
import type { MessagingKeyPair } from './messaging';

/** 12단어 니모닉 생성 (128비트 엔트로피). */
export function generateMnemonic(): string {
  return bip39Generate(wordlist, 128);
}

/** 니모닉 유효성(체크섬 포함) 검증. */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39Validate(mnemonic.trim(), wordlist);
}

/** 니모닉 → 시드 → 용도별 32바이트 키 소재. */
function deriveSeed(mnemonic: string, info: string): Uint8Array {
  const seed = mnemonicToSeedSync(mnemonic.trim(), ''); // 패스프레이즈 없음 (v1)
  return hkdf(sha256, seed, utf8ToBytes('shvil-mnemonic-v1'), utf8ToBytes(info), 32);
}

export interface DerivedIdentity {
  deviceKeyPair: KeyPair;
  messagingKeyPair: MessagingKeyPair;
  /** 지갑 백업 암복호용 대칭 키 (hex 32바이트). */
  backupKeyHex: string;
}

/** 니모닉에서 기기·메시징·백업 키를 유도한다 (같은 니모닉 → 항상 같은 키). */
export function deriveIdentityFromMnemonic(mnemonic: string): DerivedIdentity {
  if (!validateMnemonic(mnemonic)) throw new Error('유효하지 않은 복구 문구입니다');

  const deviceSecret = deriveSeed(mnemonic, 'device-ed25519');
  const msgSecret = deriveSeed(mnemonic, 'messaging-x25519');
  const backupKey = deriveSeed(mnemonic, 'backup-key');

  return {
    deviceKeyPair: {
      secretKeyHex: bytesToHex(deviceSecret),
      publicKeyHex: bytesToHex(ed25519.getPublicKey(deviceSecret)),
    },
    messagingKeyPair: {
      secretKeyHex: bytesToHex(msgSecret),
      publicKeyHex: bytesToHex(x25519.getPublicKey(msgSecret)),
    },
    backupKeyHex: bytesToHex(backupKey),
  };
}
