/**
 * 암호화 지갑 백업 (지시서 2.3, 보안 감사 L-2).
 *
 * 확정 코인 목록을 니모닉 파생 백업 키로 암호화한 blob으로 만든다. 서버는 이 blob을
 * 보관만 하며 내용을 볼 수 없다(종단간). 폰 분실 시 니모닉으로 키를 되살려 blob을
 * 복호화해 확정 코인을 복구한다.
 *
 * 위치 비저장·잠정 제외: 백업에는 확정 코인만 담는다. 잠정 누적·좌표는 담지 않는다.
 */
import { sealSecret, openSecret } from './sealing';
import { stableStringify } from './canonical';
import { sha256Hex } from './crypto';
import type { Coin } from './types';

export interface WalletBackup {
  v: 1;
  memberId: string;
  /** 확정 코인만 (OWNED). 잠정 누적·좌표 없음. */
  coins: Coin[];
  createdAt: number;
}

/** 백업을 백업 키로 봉인해 저장·업로드용 문자열(blob)을 만든다. */
export function encryptBackup(backup: WalletBackup, backupKeyHex: string): string {
  return sealSecret(stableStringify(backup), backupKeyHex);
}

/** blob을 복호화해 백업을 복원한다 (틀린 키·변조 시 throw). */
export function decryptBackup(blob: string, backupKeyHex: string): WalletBackup {
  const parsed = JSON.parse(openSecret(blob, backupKeyHex)) as WalletBackup;
  if (parsed.v !== 1 || !Array.isArray(parsed.coins)) throw new Error('백업 형식이 올바르지 않습니다');
  return parsed;
}

/** blob의 지문 — 서버가 중복 업로드를 감지하거나 무결성 확인에 쓸 수 있다(내용 노출 없음). */
export function backupDigest(blob: string): string {
  return sha256Hex(blob);
}
