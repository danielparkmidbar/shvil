/**
 * L-2 암호화 지갑 백업/복구 (지시서 2.3): 업로드는 서명 인증, 복구 조회는
 * 회원 번호 없이 기기 키 소유 증명만으로. 서버는 blob 내용을 못 본다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildAuthHeaders,
  deriveIdentityFromMnemonic,
  encryptBackup,
  decryptBackup,
  generateMessagingKeyPair,
  generateMnemonic,
  signerFromKeyPair,
  type Coin,
  type WalletBackup,
} from '@shvil/shared';
import { buildApp } from '../src/app';
import { buildRecoverSignaturePayload } from '../src/backup';
import { mintWalkCoinFor, T0, type TestIdentity } from './utils';

const app = buildApp({ dbPath: ':memory:', devMode: true });
const MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

let user: TestIdentity;
let coin: Coin;

/** 니모닉 파생 기기 키로 가입 (실제 앱과 동일 — 기기 키가 니모닉에서 유도됨). */
async function registerWithMnemonic(mnemonic: string, phone: string): Promise<TestIdentity> {
  const { deviceKeyPair } = deriveIdentityFromMnemonic(mnemonic);
  const signer = signerFromKeyPair(deviceKeyPair);
  const msg = generateMessagingKeyPair();
  const { devCode } = (await app.inject({ method: 'POST', url: '/auth/otp', payload: { phone } })).json() as {
    devCode: string;
  };
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      phone,
      code: devCode,
      email: 'bk@x.io',
      displayName: '백업유저',
      devicePublicKey: signer.publicKeyHex,
      messagingPublicKey: msg.publicKeyHex,
    },
  });
  const { memberId } = reg.json() as { memberId: string };
  return { memberId, signer, msg };
}

async function signedPost(who: TestIdentity, url: string, body: unknown) {
  const bodyText = JSON.stringify(body);
  return app.inject({
    method: 'POST',
    url,
    headers: { ...buildAuthHeaders(who.memberId, who.signer, 'POST', url, bodyText, Date.now()), 'content-type': 'application/json' },
    payload: bodyText,
  });
}

beforeAll(async () => {
  await app.ready();
  user = await registerWithMnemonic(MNEMONIC, '+82-10-backup');
  coin = mintWalkCoinFor(user, 12);
});

afterAll(async () => {
  await app.close();
});

/** 니모닉 기기 키로 복구 조회 헤더 서명 (회원 번호 없이). */
function recoverHeaders(mnemonic: string, now: number): Record<string, string> {
  const { deviceKeyPair } = deriveIdentityFromMnemonic(mnemonic);
  const signer = signerFromKeyPair(deviceKeyPair);
  return {
    'x-shvil-device-pubkey': signer.publicKeyHex,
    'x-shvil-ts': String(now),
    'x-shvil-sig': signer.sign(buildRecoverSignaturePayload(signer.publicKeyHex, now)),
  };
}

describe('암호화 지갑 백업 (보안 감사 L-2)', () => {
  it('업로드는 서명 인증 필수', async () => {
    const res = await app.inject({ method: 'POST', url: '/backup', payload: { blob: 'x' } });
    expect(res.statusCode).toBe(401);
  });

  it('회원이 백업 blob을 업로드한다 (서버는 내용을 못 본다)', async () => {
    const { backupKeyHex } = deriveIdentityFromMnemonic(MNEMONIC);
    const backup: WalletBackup = { v: 1, memberId: user.memberId, coins: [coin], createdAt: T0 };
    const blob = encryptBackup(backup, backupKeyHex);

    const res = await signedPost(user, '/backup', { blob });
    expect(res.statusCode).toBe(200);
    // 서버 DB에 blob은 있으나 코인 ID 평문은 없다
    const stored = (app.db.prepare('SELECT blob FROM wallet_backups').get() as { blob: string }).blob;
    expect(stored).not.toContain(coin.id);
  });

  it('복구: 회원 번호 없이 니모닉 기기 키 서명만으로 blob을 되찾아 복호화한다', async () => {
    const now = Date.now();
    const res = await app.inject({ method: 'GET', url: '/backup', headers: recoverHeaders(MNEMONIC, now) });
    expect(res.statusCode).toBe(200);
    const { blob } = res.json() as { blob: string };
    const { backupKeyHex } = deriveIdentityFromMnemonic(MNEMONIC);
    const restored = decryptBackup(blob, backupKeyHex);
    expect(restored.coins[0]!.id).toBe(coin.id);
    expect(restored.memberId).toBe(user.memberId);
  });

  it('다른 니모닉(다른 기기 주소)으로는 남의 백업을 조회할 수 없다', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/backup',
      headers: recoverHeaders(generateMnemonic(), Date.now()),
    });
    expect(res.statusCode).toBe(404); // 그 주소엔 백업 없음
  });

  it('오래된 복구 서명은 거부 (재전송 방지)', async () => {
    const stale = Date.now() - 11 * 60 * 1000;
    const res = await app.inject({ method: 'GET', url: '/backup', headers: recoverHeaders(MNEMONIC, stale) });
    expect(res.statusCode).toBe(401);
  });
});
