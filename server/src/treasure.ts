/**
 * 보물 마이닝 (M9 — docs/몸인증_보물마이닝_설계.md 1장).
 *
 * 서버의 역할은 둘뿐이다:
 *  1. 보물 명세 배포 (GET /treasures — 배포 서명 부착, 기존 /courses 패턴).
 *     지시(legs)가 공개되어도 존에 도착해 몸으로 수행하지 않으면 소용없다.
 *  2. 획득 회계 (POST /treasures/claim) — 수량 한정 발행이므로 잔여 수량·유효기간·
 *     1인 1회를 확인하고 승인서(SignedGrant, kind: TREASURE)를 발행한다.
 *     민팅은 사용자 폰에서다 (기존 격려 코인 흐름 재사용).
 *
 * 서버가 받는 것은 memberId + treasureId + transcriptHash(성공 요약의 해시)뿐이다.
 * **이동 검증은 100% 폰 로컬** — 걸음·방향·좌표를 받는 필드는 존재하지 않는다.
 * 도메인 오류는 자연어가 아니라 코드로 응답한다 (noUiStrings — 문구는 클라이언트가 조립).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import {
  buildGrant,
  isValidTreasureSpec,
  signDistribution,
  type Signer,
  type TreasureSpec,
} from '@shvil/shared';

export interface TreasureMemberRow {
  member_id: string;
  device_public_key: string;
}

export interface TreasureContext {
  db: DatabaseSync;
  authenticate: (req: FastifyRequest) => TreasureMemberRow | null;
  /** 보물 발행 키 (기간·수량 한정 — 투명성 공시 대상, 기존 promo 키 패턴). */
  treasureSigner: Signer;
  treasureKeyId: string;
  /** 배포 서명 키 — GET /treasures 응답에 _sig 부착 (보안 감사 H-3). */
  distSigner: Signer;
  distKeyId: string;
  devMode: boolean;
}

interface TreasureRow {
  treasure_id: string;
  region_id: string;
  spec_json: string;
  amount_dshv: number;
  total_count: number;
  issued_count: number;
  valid_from: number;
  valid_until: number;
}

const TRANSCRIPT_HASH_RE = /^[0-9a-f]{64}$/;

export function registerTreasures(app: FastifyInstance, ctx: TreasureContext): void {
  const { db, authenticate } = ctx;

  // ── 보물 목록 배포 (유효 기간 내 — 비서명 공개, 배포 서명 부착) ──
  app.get('/treasures', async (req) => {
    const q = req.query as { region?: string };
    const now = Date.now();
    const rows = (
      q.region
        ? db
            .prepare('SELECT * FROM treasures WHERE region_id = ? AND valid_from <= ? AND valid_until >= ?')
            .all(q.region, now, now)
        : db.prepare('SELECT * FROM treasures WHERE valid_from <= ? AND valid_until >= ?').all(now, now)
    ) as unknown as TreasureRow[];
    return signDistribution(
      {
        treasures: rows.map((r) => ({
          ...(JSON.parse(r.spec_json) as TreasureSpec),
          // 잔여 수량 — 소진된 보물은 지갑이 배너를 띄우지 않는다 (숫자만).
          remaining: Math.max(0, r.total_count - r.issued_count),
        })),
      },
      ctx.distSigner,
      ctx.distKeyId,
      now,
    );
  });

  // ── 획득 청구 (서명 인증) — 수량 한정 발행의 회계, 승인 아님 ──
  app.post('/treasures/claim', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const body = req.body as { treasureId?: string; transcriptHash?: string } | null;
    if (typeof body?.treasureId !== 'string' || typeof body.transcriptHash !== 'string') {
      return reply.code(400).send({ error: 'TREASURE_CLAIM_FIELDS_REQUIRED' });
    }
    if (!TRANSCRIPT_HASH_RE.test(body.transcriptHash)) {
      return reply.code(400).send({ error: 'BAD_TRANSCRIPT_HASH' });
    }
    const row = db.prepare('SELECT * FROM treasures WHERE treasure_id = ?').get(body.treasureId) as
      | TreasureRow
      | undefined;
    if (!row) return reply.code(404).send({ error: 'UNKNOWN_TREASURE' });

    const now = Date.now();
    if (now < row.valid_from || now > row.valid_until) {
      return reply.code(409).send({ error: 'TREASURE_OUT_OF_VALIDITY' });
    }
    // 1인 1회.
    if (db.prepare('SELECT 1 FROM treasure_claims WHERE treasure_id = ? AND member_id = ?').get(row.treasure_id, member.member_id)) {
      return reply.code(409).send({ error: 'TREASURE_ALREADY_CLAIMED' });
    }
    // 수량 한정 — 이 회계가 서버 왕복 1회의 존재 이유다.
    if (row.issued_count >= row.total_count) {
      return reply.code(409).send({ error: 'TREASURE_EXHAUSTED' });
    }

    // amountDshv > 0 → 승인서 발행 (민팅은 폰에서). 0 → 스탬프 기록만 (코인 없음).
    const grant =
      row.amount_dshv > 0
        ? buildGrant(
            {
              kind: 'TREASURE',
              memberId: member.member_id,
              amountDshv: row.amount_dshv,
              // 계보에 남는 근거: 보물 ID + 성공 요약 해시 (이동 원자료 아님).
              reference: `treasure:${row.treasure_id}:${body.transcriptHash}`,
              recipientPublicKey: member.device_public_key,
              issuerKeyId: ctx.treasureKeyId,
              issuedAt: now,
            },
            ctx.treasureSigner,
          )
        : null;

    try {
      db.prepare(
        'INSERT INTO treasure_claims (treasure_id, member_id, transcript_hash, grant_json, claimed_at) VALUES (?, ?, ?, ?, ?)',
      ).run(row.treasure_id, member.member_id, body.transcriptHash, grant ? JSON.stringify(grant) : null, now);
    } catch {
      // UNIQUE(treasure_id, member_id) 경합 — 위 검사와 동시 요청이 겹친 경우.
      return reply.code(409).send({ error: 'TREASURE_ALREADY_CLAIMED' });
    }
    db.prepare('UPDATE treasures SET issued_count = issued_count + 1 WHERE treasure_id = ?').run(row.treasure_id);

    return grant
      ? { treasureId: row.treasure_id, amountDshv: row.amount_dshv, grant }
      : { treasureId: row.treasure_id, amountDshv: 0, stamp: true };
  });

  // ── 개발 시드 (devMode 한정 — 기존 /limits/flagged 수동 등재 패턴) ──
  // TODO(운영): 보물 등록은 운영 콘솔/배포 파이프라인 항목. 개발에서는 이 라우트로
  // 샘플 보물을 심어 왕복 흐름을 검증한다.
  if (ctx.devMode) {
    app.post('/treasures', async (req, reply) => {
      const body = req.body as { spec?: unknown } | null;
      const spec = body?.spec;
      if (!isValidTreasureSpec(spec)) return reply.code(400).send({ error: 'INVALID_TREASURE_SPEC' });
      if (db.prepare('SELECT 1 FROM treasures WHERE treasure_id = ?').get(spec.treasureId)) {
        return reply.code(409).send({ error: 'TREASURE_ID_TAKEN' });
      }
      db.prepare(
        `INSERT INTO treasures (treasure_id, region_id, spec_json, amount_dshv, total_count, valid_from, valid_until, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        spec.treasureId,
        spec.regionId,
        JSON.stringify(spec),
        spec.amountDshv,
        spec.totalCount,
        spec.validFrom,
        spec.validUntil,
        Date.now(),
      );
      return { treasureId: spec.treasureId, registered: true };
    });
  }
}

/** 투명성 공시용 집계 — 발행 수·총량 (숫자만, 지시서 2.4·T-3). */
export function treasureTransparency(db: DatabaseSync): { treasureIssued: number; treasureQuota: number } {
  const row = db
    .prepare('SELECT COALESCE(SUM(issued_count), 0) AS issued, COALESCE(SUM(total_count), 0) AS quota FROM treasures')
    .get() as { issued: number; quota: number };
  return { treasureIssued: row.issued, treasureQuota: row.quota };
}
