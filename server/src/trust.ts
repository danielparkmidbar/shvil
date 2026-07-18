/**
 * 검증 가능한 신뢰 지표 (C안 — 검증가능신뢰_설계.md, 헌법 제3조·제9조).
 *
 * 별점(주관 점수)이 위조를 막지 못하므로(R-1e), 신뢰의 주 지표를 "위조가 어려운
 * 사실"로 옮긴다. 이 라우트는 그 사실들을 집계해 뱃지·숫자·일자로만 반환한다
 * (자연어 없음 — noUiStrings). 문구·해석은 각 클라이언트 사전 몫이다.
 *
 * ── 무엇이 신뢰가 되나 (위조 견고성 순) ─────────────────────────────
 *  - claimsApproved: claims 투표(N명 인정) — 혼자 못 만든다.
 *  - walkTier: **서버가 verifyCoin으로 검증한** 걷기 코인의 구간 뱃지 (안 A).
 *    조작 JSON은 서명이 없어 검증을 통과하지 못하므로 뱃지를 부풀릴 수 없다.
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
import {
  addressFromPublicKey,
  coinFingerprint,
  currentOwnerAddress,
  trustDayOf,
  verifyCoin,
  walkTierOf,
  type Coin,
  type TrustSummary,
} from '@shvil/shared';

export interface TrustMemberRow {
  member_id: string;
  device_public_key: string;
}

/**
 * 검증 크레딧 정책 (안 A) — 어떤 코인을 "진짜 걷기 실적"으로 인정할지.
 * 서버가 verifyCoin으로 서명·계보를 검증할 때 쓰는 신뢰 루트들이다.
 */
export interface TrustCreditOptions {
  /** GRANT 계보 검증용 신뢰 발행 키 (walk 코인엔 직접 안 쓰이나 분할 부모 검증에 필요). */
  trustedIssuerKeys: Record<string, string>;
  /** 회원 증서 신뢰 루트 — 걷기 코인의 무결성 증서 검증 (보안 감사 C-2). */
  trustedRootKeys: Record<string, string>;
  /**
   * 무결성 증서를 필수로 볼지. 운영(devMode=false)에서는 true —
   * **인증된 앱에서 생성된 걷기 코인만** 실적이 된다 (결정 대기 3번 필수화 확정).
   * 개발·테스트에서는 false (모의 증서가 없는 코인도 흐름 검증 가능).
   */
  requireIntegrity: boolean;
}

export interface TrustContext {
  db: DatabaseSync;
  authenticate: (req: FastifyRequest) => TrustMemberRow | null;
  credit: TrustCreditOptions;
}

/** creditVerifiedWalk 결과 — 호출부가 집계·응답에 쓴다 (자연어 아님). */
export type TrustCreditResult = 'CREDITED' | 'SELF' | 'INVALID' | 'NOT_WALK';

/**
 * 검증된 걷기 실적 적재 (안 A의 핵심) — 이 함수만이 walkTier에 영향을 준다.
 *
 * ★부풀림이 불가능한 이유: 여기서 서버가 **직접 verifyCoin**을 돌린다. 조작 JSON은
 *  생산자 기기 키의 서명이 없으므로 BAD_PROOF_SIGNATURE로 탈락한다. 적재되는 금액도
 *  제출자가 주장한 값이 아니라 **서명된 증명 안의 일자합**에서만 온다.
 *  운영에서는 무결성 증서(VERIFIED)까지 요구해 인증된 앱 발행분만 인정한다.
 *
 * ★자기 크레딧 금지: 생산자 본인이 제출하면 적재하지 않는다 — 코인이 실제로 남의
 *  손에 넘어간(유통된) 것만 실적이 된다. 호출부는 제출자의 실보유·예치를 별도 확인한다.
 *
 * proofHash를 PK로 두어 분할 형제·중복 제출이 이중 계상되지 않는다.
 * 남는 한계: 루팅 기기의 GPS 위조 자체는 서명이 유효하므로 여기서 못 걸러낸다 —
 * 그것은 코인 발행 전체가 지는 근본 한계이며 무결성 인증·인간 한계·소명이 맡는다.
 */
export function creditVerifiedWalk(
  db: DatabaseSync,
  coin: Coin,
  reporterMemberId: string,
  options: TrustCreditOptions,
  now: number,
): TrustCreditResult {
  // 예치 코인은 리저브 앞 미완결 링크로 끝나므로 허용한다 — 걷기 증명의 진위와
  // 무관한 조건이며, 그 앞 체인·계보는 그대로 전부 검증된다.
  const verdict = verifyCoin(coin, {
    trustedIssuerKeys: options.trustedIssuerKeys,
    trustedRootKeys: options.trustedRootKeys,
    requireIntegrityToken: options.requireIntegrity,
    allowPendingLastLink: true,
    now,
  });
  if (!verdict.valid) return 'INVALID';

  const fp = coinFingerprint(coin);
  if (fp.rootKind !== 'WALK' || !fp.proofHash || !fp.dailyBreakdown) return 'NOT_WALK';
  if (reporterMemberId === fp.producerMemberId) return 'SELF';

  // 금액은 서명된 증명의 일자합에서만 — 제출자 주장값을 쓰지 않는다.
  const total = fp.dailyBreakdown.reduce((s, d) => s + d.amountDshv, 0);
  db.prepare(
    `INSERT OR IGNORE INTO walk_verified_credit (proof_hash, producer_member, total_dshv, first_verified_at)
     VALUES (?, ?, ?, ?)`,
  ).run(fp.proofHash, fp.producerMemberId, total, now);
  return 'CREDITED';
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

  // ★서버가 verifyCoin으로 검증한 코인만 합산한다 (안 A). 미검증 sync 지문
  // (walk_proof_stats)은 조작 가능하므로 여기서 절대 읽지 않는다.
  // 정확 액수는 walkTier 구간으로만 나가고 밖으로 노출하지 않는다.
  const verifiedDshv = (
    db
      .prepare('SELECT COALESCE(SUM(total_dshv), 0) AS s FROM walk_verified_credit WHERE producer_member = ?')
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
    walkTier: walkTierOf(verifiedDshv),
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

  /**
   * 검증 실적 기여 (제출자 서명 인증) — 내가 **보유한** 걷기 코인을 올리면 서버가
   * verifyCoin으로 검증해 그 코인을 만든 사람(생산자)의 실적으로 적재한다 (안 A).
   *
   * "내가 받은 코인이 그 사람의 걸음을 증언한다" — 선행의 순환(헌법 제7조)에 맞는
   * 이타적 기여다. 제출자 자신에게는 아무 이득이 없다(자기 코인은 SELF로 배제).
   *
   * 방어:
   *  - 조작 JSON: verifyCoin 실패로 탈락 (서명이 없다). 부풀림의 뿌리를 차단.
   *  - 남의 코인 데이터 도용 기여: 제출자가 **현재 소유자**여야 한다(실보유 증명).
   *  - 자기 크레딧: 생산자 == 제출자면 배제 (유통된 코인만 실적).
   * 응답은 건수뿐 — 어떤 코인이 왜 떨어졌는지 알려주지 않는다(정찰 방지).
   */
  app.post('/trust/coins', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const body = req.body as { coins?: Coin[] } | null;
    const coins = body?.coins;
    if (!Array.isArray(coins) || coins.length === 0 || coins.length > 100) {
      return reply.code(400).send({ error: 'coins (1~100) required' });
    }
    const myAddress = addressFromPublicKey(member.device_public_key);
    const now = Date.now();
    let credited = 0;
    for (const coin of coins) {
      // 실보유 확인 — 남의 코인 데이터를 주워 기여하는 경로를 막는다. 형식 불량
      // 코인은 currentOwnerAddress가 throw할 수 있으므로 관용적으로 건너뛴다.
      try {
        if (currentOwnerAddress(coin) !== myAddress) continue;
      } catch {
        continue;
      }
      if (creditVerifiedWalk(db, coin, member.member_id, ctx.credit, now) === 'CREDITED') credited += 1;
    }
    return { credited };
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
