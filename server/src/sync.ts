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
import { isOverproductionCode, type CoinFingerprint, type FlagReasonCode } from '@shvil/shared';
import { checkFork, checkOverproduction } from './anomaly';

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

export function registerSync(app: FastifyInstance, ctx: SyncContext): void {
  const { db, authenticate } = ctx;
  const limits = { dailyMaxDshv: ctx.dailyMaxDshv, weeklyMaxDshv: ctx.weeklyMaxDshv };

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
      checkFork(db, fp, now);
      checkOverproduction(db, fp, limits, now);
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

  /**
   * 이상 포착 현황 (익명 카운트) — 투명성 페이지 공시 (지시서 3장 4절).
   * 숫자만 반환한다. 설명 문구는 각 웹의 i18n 사전 몫이다 (서버는 UI 문장을 만들지 않는다).
   */
  app.get('/transparency/anomalies', async () => {
    const flagged = db
      .prepare("SELECT reason_code FROM flagged_members WHERE status = 'PENDING'")
      .all() as unknown as { reason_code: FlagReasonCode }[];
    return {
      pendingTotal: flagged.length,
      doubleSpendSuspects: flagged.filter((f) => f.reason_code === 'DOUBLE_SPEND_SUSPECT').length,
      overproductionSuspects: flagged.filter((f) => isOverproductionCode(f.reason_code)).length,
      sightings: (db.prepare('SELECT COUNT(*) AS n FROM coin_sightings').get() as { n: number }).n,
    };
  });
}
