/**
 * 검증 가능한 신뢰 지표 (C안 — 검증가능신뢰_설계.md, 헌법 제3조·제9조).
 *
 * 별점(주관 점수)이 위조를 막지 못하므로(R-1e), 신뢰의 주 지표를 "위조가 어려운
 * 사실"로 옮긴다. 이 라우트는 그 사실들을 집계해 뱃지·숫자·일자로만 반환한다
 * (자연어 없음 — noUiStrings). 문구·해석은 각 클라이언트 사전 몫이다.
 *
 * ── 무엇이 신뢰가 되나 (위조 견고성 순) ─────────────────────────────
 *  - claimsApproved: claims 투표(N명 인정) — 혼자 못 만든다.
 *  - walkTier: 교차 목격된(corroborated=1) 걷기 실적의 구간 뱃지. 생산자 본인이
 *    아닌 회원이 목격한 증명만 센다 → 서명 없는 자기 신고로는 못 부풀린다.
 *    정확한 dSHV는 응답에 없다(구간만) — 개인 재정 비노출(설계 §3).
 *  - certificates: 사진+데이터 자기 제출(투표 없음) — 보조 지표.
 *  - memberSinceDay / angelSinceDay: 서명된 가입·등록 시점 — 소급 위조 불가.
 *  - angel.guestbookCards / firstHosting: 실제 손님 서명·접대 증빙 이력(보조).
 *  - leaderboardVerified: 검토단 검증 등재 여부만(자기신고 raw 수치는 안 나감).
 *
 * ── 프라이버시 게이트 (자발 공개) ───────────────────────────────────
 * trust_disclosures.visible=1인 회원만 집계가 나간다. 미공개·미가입은 동일하게
 * { visible:false }만 반환한다 — 회원 존재 여부 오라클이 되지 않는다(설계 §3).
 * 이 지표들은 개인 실적일 뿐 "누가 누구와" 관계를 담지 않는다(헌법 제9조).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { trustDayOf, walkTierOf, type TrustSummary } from '@shvil/shared';

export interface TrustMemberRow {
  member_id: string;
  device_public_key: string;
}

export interface TrustContext {
  db: DatabaseSync;
  authenticate: (req: FastifyRequest) => TrustMemberRow | null;
}

/**
 * 한 회원의 검증 가능한 신뢰 지표를 집계한다 (공개 여부와 무관한 순수 집계 —
 * 게이트는 라우트에서 건다). 전부 위조 난이도가 명시된 사실이며 자연어가 없다.
 */
export function computeTrustSummary(db: DatabaseSync, memberId: string): TrustSummary | null {
  const member = db.prepare('SELECT created_at FROM members WHERE member_id = ?').get(memberId) as
    | { created_at: number }
    | undefined;
  if (!member) return null;

  const claimsApproved = (
    db.prepare("SELECT COUNT(*) AS n FROM claims WHERE member_id = ? AND status = 'APPROVED'").get(memberId) as {
      n: number;
    }
  ).n;
  const certFull = (
    db.prepare("SELECT COUNT(*) AS n FROM certificates WHERE member_id = ? AND kind = 'FULL'").get(memberId) as {
      n: number;
    }
  ).n;
  const certSection = (
    db.prepare("SELECT COUNT(*) AS n FROM certificates WHERE member_id = ? AND kind = 'SECTION'").get(memberId) as {
      n: number;
    }
  ).n;

  // 교차 목격된 증명만 합산한다 (corroborated=1). 자기 신고 지문은 신뢰 실적이
  // 아니다 — 정확 액수는 walkTier 구간으로만 나가고 밖으로 노출하지 않는다.
  const corroboratedDshv = (
    db
      .prepare(
        'SELECT COALESCE(SUM(total_dshv), 0) AS s FROM walk_proof_stats WHERE producer_member = ? AND corroborated = 1',
      )
      .get(memberId) as { s: number }
  ).s;

  const angelRow = db.prepare('SELECT registered_at FROM angels WHERE member_id = ?').get(memberId) as
    | { registered_at: number }
    | undefined;
  const angel = angelRow
    ? {
        guestbookCards: (
          db.prepare('SELECT COUNT(*) AS n FROM guestbook WHERE angel_member_id = ?').get(memberId) as { n: number }
        ).n,
        firstHosting:
          db.prepare("SELECT 1 FROM promo_grants WHERE member_id = ? AND kind = 'FIRST_HOSTING'").get(memberId) !==
          undefined,
        angelSinceDay: trustDayOf(angelRow.registered_at),
      }
    : null;

  const leaderboardVerified =
    db.prepare('SELECT 1 FROM leaderboard WHERE member_id = ? AND verified = 1').get(memberId) !== undefined;

  return {
    claimsApproved,
    certificatesFull: certFull,
    certificatesSection: certSection,
    walkTier: walkTierOf(corroboratedDshv),
    memberSinceDay: trustDayOf(member.created_at),
    angel,
    leaderboardVerified,
  };
}

/** 회원이 신뢰 지표를 공개하기로 했는가 (trust_disclosures.visible=1). */
function isDisclosed(db: DatabaseSync, memberId: string): boolean {
  const row = db.prepare('SELECT visible FROM trust_disclosures WHERE member_id = ?').get(memberId) as
    | { visible: number }
    | undefined;
  return row?.visible === 1;
}

export function registerTrust(app: FastifyInstance, ctx: TrustContext): void {
  const { db, authenticate } = ctx;

  /**
   * 신뢰 지표 공개 설정 (본인 서명 인증) — 자발 공개 on/off.
   * 서버는 동의 없이 집계를 노출하지 않는다(설계 §3). 본인은 공개 상태와 무관하게
   * GET /trust/me로 자기 지표를 항상 볼 수 있다.
   */
  app.put('/trust/me', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const body = req.body as { visible?: boolean } | null;
    if (typeof body?.visible !== 'boolean') {
      return reply.code(400).send({ error: 'visible (boolean) required' });
    }
    db.prepare(
      `INSERT INTO trust_disclosures (member_id, visible, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(member_id) DO UPDATE SET visible = excluded.visible, updated_at = excluded.updated_at`,
    ).run(member.member_id, body.visible ? 1 : 0, Date.now());
    return { visible: body.visible };
  });

  /** 본인 지표 조회 (서명 인증) — 공개 여부와 무관하게 자기 것은 항상 본다. */
  app.get('/trust/me', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const trust = computeTrustSummary(db, member.member_id);
    // 본인은 members에 반드시 있으므로 trust는 non-null.
    return { visible: isDisclosed(db, member.member_id), trust };
  });

  /**
   * 공개 조회 (웹·앱, 비서명) — member= 로 특정 회원의 자발 공개 신뢰 지표.
   * 미공개·미가입은 동일하게 { visible:false, trust:null } (존재 오라클 차단).
   * 회원 번호는 조회 파라미터로만 쓰이며 응답 본문엔 다시 담지 않는다.
   */
  app.get('/trust', async (req, reply) => {
    const q = req.query as { member?: string };
    if (!q.member) return reply.code(400).send({ error: 'member required' });
    if (!isDisclosed(db, q.member)) return { visible: false, trust: null };
    const trust = computeTrustSummary(db, q.member);
    if (!trust) return { visible: false, trust: null };
    return { visible: true, trust };
  });
}

/**
 * 여러 회원의 공개 신뢰 지표를 한 번에 (동행 게시판·엔젤 디렉토리 연동용).
 * 공개(visible=1)한 회원만 map에 담는다 — 미공개·미가입은 키가 없다.
 */
export function trustSummariesFor(db: DatabaseSync, memberIds: string[]): Record<string, TrustSummary> {
  const out: Record<string, TrustSummary> = {};
  for (const id of new Set(memberIds)) {
    if (!isDisclosed(db, id)) continue;
    const trust = computeTrustSummary(db, id);
    if (trust) out[id] = trust;
  }
  return out;
}
