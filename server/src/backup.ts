/**
 * 암호화 지갑 백업 보관 (지시서 2.3, 보안 감사 L-2).
 *
 * 서버는 종단간 암호화된 blob을 기기 주소별로 보관만 한다 — 내용을 볼 수 없다.
 * 목적은 폰 분실 복구 지원(니모닉으로 키를 되살려 복호화)이다.
 *
 * 인증:
 *  - 업로드(POST): 가입 회원의 서명 인증(기존 헤더) — 기기 공개키로 주소 계산.
 *  - 복구 조회(GET): 회원 번호를 몰라도 되도록, 기기 키 소유 증명만 요구한다.
 *    (blob은 어차피 암호화돼 있어 기기 키 없이는 무의미하다.)
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import {
  addressFromPublicKey,
  backupDigest,
  verifySignature,
} from '@shvil/shared';
import { utf8ToBytes } from '@noble/hashes/utils';
import { stableStringify } from '@shvil/shared';

export interface BackupMemberRow {
  member_id: string;
  device_public_key: string;
}

export interface BackupContext {
  db: DatabaseSync;
  authenticate: (req: FastifyRequest) => BackupMemberRow | null;
  /** 복구 조회 서명 신선도 허용(ms). */
  maxSkewMs: number;
}

const RECOVER_HEADER_PUBKEY = 'x-shvil-device-pubkey';
const RECOVER_HEADER_TS = 'x-shvil-ts';
const RECOVER_HEADER_SIG = 'x-shvil-sig';

/** 복구 조회 서명 대상. */
function recoverPayload(devicePublicKey: string, timestamp: number) {
  return { t: 'shvil-backup-recover-v1', devicePublicKey, timestamp };
}

/** 지갑이 GET /backup에 붙일 헤더를 만들 때 쓰는 것과 동일한 서명 규약(문서용 export). */
export function buildRecoverSignaturePayload(devicePublicKey: string, timestamp: number): Uint8Array {
  return utf8ToBytes(stableStringify(recoverPayload(devicePublicKey, timestamp)));
}

export function registerBackup(app: FastifyInstance, ctx: BackupContext): void {
  const { db, authenticate } = ctx;

  /** 백업 업로드 — 서명 인증. 회원의 기기 주소로 저장(최신 1개). */
  app.post('/backup', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const body = req.body as { blob?: string } | null;
    if (!body?.blob || typeof body.blob !== 'string' || body.blob.length > 5_000_000) {
      return reply.code(400).send({ error: 'blob (string, ≤5MB) required' });
    }
    const address = addressFromPublicKey(member.device_public_key);
    db.prepare(
      'INSERT OR REPLACE INTO wallet_backups (device_address, blob, digest, updated_at) VALUES (?, ?, ?, ?)',
    ).run(address, body.blob, backupDigest(body.blob), Date.now());
    return { stored: true, digest: backupDigest(body.blob) };
  });

  /**
   * 백업 복구 조회 — 회원 번호 불요. 기기 키 소유 증명(서명)만으로 자기 백업을 조회.
   * 니모닉으로 기기 키를 복원한 새 폰이 회원 번호를 모른 채로도 복구할 수 있다.
   */
  app.get('/backup', async (req, reply) => {
    const pubkey = req.headers[RECOVER_HEADER_PUBKEY];
    const ts = req.headers[RECOVER_HEADER_TS];
    const sig = req.headers[RECOVER_HEADER_SIG];
    if (typeof pubkey !== 'string' || typeof ts !== 'string' || typeof sig !== 'string') {
      return reply.code(401).send({ error: 'recovery signature headers required' });
    }
    const timestamp = Number(ts);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > ctx.maxSkewMs) {
      return reply.code(401).send({ error: 'stale or invalid timestamp' });
    }
    if (!verifySignature(sig, buildRecoverSignaturePayload(pubkey, timestamp), pubkey)) {
      return reply.code(401).send({ error: 'invalid recovery signature' });
    }
    const address = addressFromPublicKey(pubkey);
    const row = db.prepare('SELECT blob, digest, updated_at FROM wallet_backups WHERE device_address = ?').get(address) as
      | { blob: string; digest: string; updated_at: number }
      | undefined;
    if (!row) return reply.code(404).send({ error: 'no backup found' });
    return { blob: row.blob, digest: row.digest, updatedAt: row.updated_at };
  });
}
