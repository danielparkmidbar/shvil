import { describe, expect, it } from 'vitest';
import {
  deriveIdentityFromMnemonic,
  generateMnemonic,
  validateMnemonic,
} from '../mnemonic';
import { encryptBackup, decryptBackup, type WalletBackup } from '../backup';
import { addressFromPublicKey, signerFromKeyPair } from '../crypto';
import { PendingWalkLedger } from '../ledger';
import { buildWalkSegmentProof } from '../proof';
import { mintWalkCoin } from '../coin';
import type { Coin } from '../types';
import { T0, walkKm } from './helpers';

const KNOWN = 'legal winner thank year wave sausage worth useful legal winner thank yellow'; // BIP-39 유효

describe('니모닉 키 복구 (지시서 2.1, 보안 감사 L-2)', () => {
  it('생성한 니모닉은 12단어이고 유효하다', () => {
    const m = generateMnemonic();
    expect(m.split(' ')).toHaveLength(12);
    expect(validateMnemonic(m)).toBe(true);
  });

  it('잘못된 니모닉(체크섬 실패)은 거부', () => {
    expect(validateMnemonic('bogus words that are not valid mnemonic at all zzz zzz zzz zzz')).toBe(false);
    expect(() => deriveIdentityFromMnemonic('invalid')).toThrow(/복구 문구/);
  });

  it('같은 니모닉은 항상 같은 기기·메시징·백업 키를 유도한다 (결정적)', () => {
    const a = deriveIdentityFromMnemonic(KNOWN);
    const b = deriveIdentityFromMnemonic(KNOWN);
    expect(a.deviceKeyPair.publicKeyHex).toBe(b.deviceKeyPair.publicKeyHex);
    expect(a.messagingKeyPair.publicKeyHex).toBe(b.messagingKeyPair.publicKeyHex);
    expect(a.backupKeyHex).toBe(b.backupKeyHex);
  });

  it('다른 니모닉은 다른 키를 유도한다', () => {
    const a = deriveIdentityFromMnemonic(KNOWN);
    const b = deriveIdentityFromMnemonic(generateMnemonic());
    expect(a.deviceKeyPair.publicKeyHex).not.toBe(b.deviceKeyPair.publicKeyHex);
  });

  it('유도된 기기 키로 서명·주소가 정상 동작한다', () => {
    const { deviceKeyPair } = deriveIdentityFromMnemonic(KNOWN);
    const signer = signerFromKeyPair(deviceKeyPair);
    expect(addressFromPublicKey(signer.publicKeyHex)).toMatch(/^shv1/);
    const sig = signer.sign(new TextEncoder().encode('hi'));
    expect(sig).toMatch(/^[0-9a-f]+$/);
  });

  it('용도별 키는 서로 다르다 (기기·메시징·백업 분리)', () => {
    const d = deriveIdentityFromMnemonic(KNOWN);
    expect(d.deviceKeyPair.secretKeyHex).not.toBe(d.messagingKeyPair.secretKeyHex);
    expect(d.deviceKeyPair.secretKeyHex).not.toBe(d.backupKeyHex);
  });
});

describe('암호화 지갑 백업 복원 (지시서 2.3)', () => {
  function walkCoin(memberId: string): Coin {
    const { deviceKeyPair } = deriveIdentityFromMnemonic(KNOWN);
    const signer = signerFromKeyPair(deviceKeyPair);
    const ledger = new PendingWalkLedger({ memberId });
    const end = walkKm(ledger, 12);
    return mintWalkCoin(buildWalkSegmentProof(ledger.settleOnSpend(end)!, signer));
  }

  it('백업→복호화 왕복으로 확정 코인이 복구된다', () => {
    const { backupKeyHex } = deriveIdentityFromMnemonic(KNOWN);
    const coin = walkCoin('SHV-100200');
    const backup: WalletBackup = { v: 1, memberId: 'SHV-100200', coins: [coin], createdAt: T0 };
    const blob = encryptBackup(backup, backupKeyHex);
    // blob은 봉인문이라 코인 ID가 평문으로 노출되지 않는다
    expect(blob).not.toContain(coin.id);

    const restored = decryptBackup(blob, backupKeyHex);
    expect(restored.coins).toHaveLength(1);
    expect(restored.coins[0]!.id).toBe(coin.id);
    expect(restored.memberId).toBe('SHV-100200');
  });

  it('니모닉만으로 백업을 복호화할 수 있다 (폰 분실 복구 경로)', () => {
    const coin = walkCoin('SHV-100200');
    // 원래 폰: 백업 생성
    const origKey = deriveIdentityFromMnemonic(KNOWN).backupKeyHex;
    const blob = encryptBackup({ v: 1, memberId: 'SHV-100200', coins: [coin], createdAt: T0 }, origKey);
    // 새 폰: 니모닉만 입력 → 같은 백업 키 유도 → 복호화 성공
    const recoveredKey = deriveIdentityFromMnemonic(KNOWN).backupKeyHex;
    expect(decryptBackup(blob, recoveredKey).coins[0]!.id).toBe(coin.id);
  });

  it('틀린 니모닉의 백업 키로는 복호화할 수 없다', () => {
    const coin = walkCoin('SHV-100200');
    const blob = encryptBackup({ v: 1, memberId: 'SHV-100200', coins: [coin], createdAt: T0 }, deriveIdentityFromMnemonic(KNOWN).backupKeyHex);
    const wrong = deriveIdentityFromMnemonic(generateMnemonic()).backupKeyHex;
    expect(() => decryptBackup(blob, wrong)).toThrow();
  });
});
