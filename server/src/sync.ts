/**
 * 기회적 동기화 — 사후 이상 탐지 (보안 감사 H-1, 지시서 2.3·3장 4~5절).
 *
 * 지갑이 온라인이 될 때 코인 지문을 제출하면 서버가 대조한다:
 *  ① 이중 사용: 같은 (coinId, 체인 길이)에 서로 다른 소유자 = 오프라인 분기.
 *     분기점 소유자(마지막 링크의 지불자)가 이중 지불자 → 소명 대기 목록 자동 등재.
 *  ② 초과 생성: 같은 회원의 걷기 증명 일자별 합산이 인간 한계(일 400 / 주 3,000 dSHV)
 *     초과 → 생산자 등재.
 *
 * 이것은 거래 승인이 아니다. 거래는 이미 두 기기 서명으로 완결됐고, 여기서의
 * 포착은 소명 책임 절차(3장 5절)의 입구일 뿐이다. 등재는 신규 수령만 보류시키고
 * 이미 유통 중인 정상 코인·타인의 거래는 영향받지 않는다.
 * 포착 현황은 익명 카운트로 공시된다 (투명성 페이지).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { addressFromPublicKey, type CoinFingerprint } from '@shvil/shared';

export interface SyncMemberRow {
  member_id: string;
  device_public_key: string;
}

export interface SyncContext {
  db: DatabaseSync;
  authenticate: (req: FastifyRequest) => SyncMemberRow | null;
  /** 인간 한계 (확정 파라미터): 일 400 dSHV / 7일 3,000 dSHV. */
  dailyMaxDshv: number;
  weeklyMaxDshv: number;
}

interface SightingRow {
  chain_len: number;
  owner_address: string;
  last_from_address: string | null;
}

function dateToEpochDay(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

export function registerSync(app: FastifyInstance, ctx: SyncContext): void {
  const { db, authenticate } = ctx;

  function flagMember(memberId: string, reason: string, now: number): void {
    // 이미 PENDING이면 유지 (사유 덮어쓰지 않음 — 최초 포착 기록 보존)
    const existing = db.prepare('SELECT status FROM flagged_members WHERE member_id = ?').get(memberId) as
      | { status: string }
      | undefined;
    if (existing?.status === 'PENDING') return;
    db.prepare(
      "INSERT OR REPLACE INTO flagged_members (member_id, reason, status, flagged_at) VALUES (?, ?, 'PENDING', ?)",
    ).run(memberId, reason, now);
  }

  /** 주소 → 회원 번호 (기기 공개키에서 주소 계산). 없으면 null. */
  function memberByAddress(address: string): string | null {
    const rows = db.prepare('SELECT member_id, device_public_key FROM members').all() as unknown as SyncMemberRow[];
    for (const r of rows) {
      if (addressFromPublicKey(r.device_public_key) === address) return r.member_id;
    }
    return null;
  }

  /** ① 이중 사용 검사: 같은 (coinId, chainLen)의 기존 목격과 소유자 분기 대조. */
  function checkFork(fp: CoinFingerprint, now: number): string | null {
    const rows = db
      .prepare('SELECT chain_len, owner_address, last_from_address FROM coin_sightings WHERE coin_id = ? AND chain_len = ?')
      .all(fp.coinId, fp.chainLen) as unknown as SightingRow[];
    for (const row of rows) {
      if (row.owner_address !== fp.ownerAddress && fp.chainLen > 0 && row.last_from_address === fp.lastFromAddress && fp.lastFromAddress) {
        // 분기 확정: 같은 지불자가 같은 코인을 두 수령자에게 — 이중 지불자 등재
        const suspect = memberByAddress(fp.lastFromAddress);
        if (suspect) {
          flagMember(suspect, `이중 사용 의심: 코인 ${fp.coinId.slice(0, 12)}… 분기 (체인 ${fp.chainLen})`, now);
          return suspect;
        }
      }
    }
    return null;
  }

  /** ② 초과 생성 검사: 걷기 증명 합산이 인간 한계 초과 → 생산자 등재. */
  function checkOverproduction(fp: CoinFingerprint, now: number): string | null {
    if (fp.rootKind !== 'WALK' || !fp.proofHash || !fp.dailyBreakdown) return null;
    // proofHash당 1회만 저장 (분할 형제·중복 보고 dedup)
    const exists = db.prepare('SELECT 1 FROM walk_proof_stats WHERE proof_hash = ?').get(fp.proofHash);
    if (!exists) {
      const total = fp.dailyBreakdown.reduce((s, d) => s + d.amountDshv, 0);
      db.prepare(
        'INSERT INTO walk_proof_stats (proof_hash, producer_member, breakdown_json, total_dshv, first_seen) VALUES (?, ?, ?, ?, ?)',
      ).run(fp.proofHash, fp.producerMemberId, JSON.stringify(fp.dailyBreakdown), total, now);
    }

    // 회원 전체 증명 합산 → 일/주 한계 검사
    const rows = db
      .prepare('SELECT breakdown_json FROM walk_proof_stats WHERE producer_member = ?')
      .all(fp.producerMemberId) as unknown as { breakdown_json: string }[];
    const perDay = new Map<number, number>();
    for (const r of rows) {
      for (const d of JSON.parse(r.breakdown_json) as { date: string; amountDshv: number }[]) {
        const day = dateToEpochDay(d.date);
        perDay.set(day, (perDay.get(day) ?? 0) + d.amountDshv);
      }
    }
    const days = [...perDay.keys()].sort((a, b) => a - b);
    for (const day of days) {
      if (perDay.get(day)! > ctx.dailyMaxDshv) {
        const date = new Date(day * 86_400_000).toISOString().slice(0, 10);
        flagMember(fp.producerMemberId, `초과 생성 의심: ${date} 합산 ${perDay.get(day)! / 10} SHV > 일 상한`, now);
        return fp.producerMemberId;
      }
      let week = 0;
      for (let d = day - 6; d <= day; d++) week += perDay.get(d) ?? 0;
      if (week > ctx.weeklyMaxDshv) {
        const date = new Date(day * 86_400_000).toISOString().slice(0, 10);
        flagMember(fp.producerMemberId, `초과 생성 의심: ~${date} 7일 합산 ${week / 10} SHV > 주 상한`, now);
        return fp.producerMemberId;
      }
    }
    return null;
  }

  /**
   * 지문 제출 (서명 인증). 여러 지문 일괄. 대조 결과로 자동 등재가 일어날 수 있으나
   * 응답은 수리 여부뿐 — 제출자가 대조 결과로 타인을 정찰할 수 없게 한다.
   */
  app.post('/sync/coins', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const body = req.body as { fingerprints?: CoinFingerprint[] } | null;
    const fps = body?.fingerprints;
    if (!Array.isArray(fps) || fps.length === 0 || fps.length > 500) {
      return reply.code(400).send({ error: 'fingerprints (1~500) required' });
    }

    const now = Date.now();
    let accepted = 0;
    for (const fp of fps) {
      if (!fp || typeof fp.coinId !== 'string' || !Number.isInteger(fp.chainLen) || typeof fp.ownerAddress !== 'string') {
        continue; // 형식 불량 지문은 무시 (일괄 제출 관용)
      }
      // 대조는 저장 전에 — 기존 목격과 새 지문을 비교해야 분기가 보인다.
      checkFork(fp, now);
      checkOverproduction(fp, now);
      db.prepare(
        `INSERT OR REPLACE INTO coin_sightings
          (coin_id, chain_len, owner_address, last_from_address, producer_member, amount_dshv, root_kind, reporter_member, reported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        fp.coinId,
        fp.chainLen,
        fp.ownerAddress,
        fp.lastFromAddress ?? null,
        fp.producerMemberId,
        fp.amountDshv,
        fp.rootKind,
        member.member_id,
        now,
      );
      accepted += 1;
    }
    return { accepted };
  });

  /** 이상 포착 현황 (익명 카운트) — 투명성 페이지 공시 (지시서 3장 4절). */
  app.get('/transparency/anomalies', async () => {
    const flagged = db
      .prepare("SELECT reason FROM flagged_members WHERE status = 'PENDING'")
      .all() as unknown as { reason: string }[];
    return {
      pendingTotal: flagged.length,
      doubleSpendSuspects: flagged.filter((f) => f.reason.startsWith('이중 사용')).length,
      overproductionSuspects: flagged.filter((f) => f.reason.startsWith('초과 생성')).length,
      sightings: (db.prepare('SELECT COUNT(*) AS n FROM coin_sightings').get() as { n: number }).n,
      note: '동기화 지문 기반 사후 포착 — 거래 승인이 아니며, 소명 통과 시 해제됩니다.',
    };
  });
}
