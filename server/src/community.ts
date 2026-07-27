/**
 * 커뮤니티 기능 (shvilist.org 백엔드 — 지시서 6장, 2.5, 2.6, 3장).
 *
 * - 코스 등록부: 제안(후보) → 100명 완주 기록 → 공식 승격 → 앱 배포.
 * - 클레임 게시판: 누락 걸음 구제 — 24시간 내 접수, 커뮤니티 인정 투표(기준 5명),
 *   승인 시 자동 산정(기준 요율, 일 40 SHV 상한)·클레임 발행 키로 승인서 발행.
 *   민팅은 사용자 폰에서 (서버는 승인서만).
 * - 완주 인증 게시판: 요건(사진+데이터) 충족 시 격려 코인 발행 (완주 10 / 구간 3 SHV
 *   제안 — 결정 대기 9번). 1인 1코스 1회.
 *
 * ★발행 라우트(/certificates·/claims)의 courseId는 배포 목록(GET /courses)과 대조한다
 *  (courses.ts — 단일 진실 원천). 등록되지 않은 코스는 거부(fail-closed): 이 대조가
 *  없으면 "1인 1코스 1회"가 "1인 1문자열 1회"가 되어 무한 발행이 열린다.
 * - 탑 100 리더보드: 본인 동의로 거리·생성 총량만 공개 (위치 없음). 검증 엔진의
 *   개연성 상한 기준선으로 연동.
 * - 소명 대기 목록: 이상 생성 포착 회원 번호 배포 — 수신 지갑들이 수령 보류.
 *
 * 어디에도 거래 승인은 없다. 발행은 전부 "승인서(SignedGrant)" — 코인이 되는 것은
 * 사용자 기기의 민팅에서다.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import {
  buildGrant,
  hashObject,
  isFlagReasonCode,
  signDistribution,
  validateCoursePolyline,
  validateCourseSegments,
  type SignedGrant,
  type Signer,
} from '@shvil/shared';
// 발행 라우트의 코스 대조는 GET /courses 배포 목록과 **같은 함수**를 쓴다 (courses.ts).
import { isKnownCourse, knownCourseIds } from './courses';

export interface CommunityMemberRow {
  member_id: string;
  device_public_key: string;
}

export interface CommunityContext {
  db: DatabaseSync;
  authenticate: (req: FastifyRequest) => CommunityMemberRow | null;
  /** 클레임 발행 키 (발행 총량 공시 대상). */
  claimSigner: Signer;
  claimKeyId: string;
  /** 격려 코인 발행 키. */
  rewardSigner: Signer;
  rewardKeyId: string;
  /** 배포 서명 키 — /limits/flagged 응답에 _sig 부착 (보안 감사 H-3). */
  distSigner: Signer;
  distKeyId: string;
  /** 공식 승격 기준 완주 인원 (지시서: 100명. 테스트에서 축소 가능). */
  promotionThreshold: number;
  /** 클레임 인정 투표 기준 인원 (제안 5명 — 결정 대기 8번). */
  claimVoteThreshold: number;
  /** 1인당 클레임 월 한도 (제안 2회 — 결정 대기 8번). */
  claimMonthlyLimit: number;
  /** 클레임 접수 유효 시간 (걷기 발생 후, 지시서 2.5: 24시간). */
  claimWindowMs: number;
  devMode: boolean;
}

/** 격려 코인 보상액 (dSHV) — 제안: 완주 10 / 구간 3 SHV (결정 대기 9번). */
export const REWARD_DSHV = { FULL: 100, SECTION: 30 } as const;

/**
 * 등록되지 않은 코스 거부 응답 (fail-closed).
 * error는 사람이 읽을 수 있는 영문 한 줄, code는 클라이언트가 자국어로 옮길 열쇠다 —
 * 서버는 화면 문장(한국어 등)을 만들지 않는다 (noUiStrings 원칙).
 * 뜻: "등록되지 않은 코스입니다 — 배포 중인 코스 목록에 없습니다."
 */
const UNKNOWN_COURSE_ERROR = {
  error: 'unknown course: not in the distributed course list (GET /courses)',
  code: 'UNKNOWN_COURSE',
} as const;

/** 클레임 산정: 기준 요율 1km = 1 SHV, 일 40 SHV 상한.
 *  난이도 계수 적용은 코스 구간 매핑(등록부 확정) 후속 항목. */
export function assessClaimDshv(distanceM: number): number {
  return Math.min(400, Math.floor(distanceM / 100));
}

function monthKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 7); // YYYY-MM (UTC)
}

export function registerCommunity(app: FastifyInstance, ctx: CommunityContext): void {
  const { db, authenticate } = ctx;

  // ── 코스 등록부 ───────────────────────────────────────────────

  app.post('/courses/proposals', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const body = req.body as {
      courseId?: string;
      name?: string;
      polyline?: { lat: number; lon: number }[];
      segments?: unknown[];
    } | null;
    if (!body?.courseId || !/^[a-z0-9-]{3,64}$/.test(body.courseId)) {
      return reply.code(400).send({ error: 'courseId (kebab-case slug) required' });
    }
    if (!body.name || !Array.isArray(body.polyline) || body.polyline.length < 2) {
      return reply.code(400).send({ error: 'name and polyline (>= 2 points) required' });
    }
    /**
     * ★코스 기하 검증 (2026-07-27) — 여기까지는 polyline이 배열인지만 봤고
     *  `segments`는 `unknown[]`으로 받아 **검증 없이** JSON으로 저장·배포했다.
     *
     *  실행으로 확인된 누수: `corridorHalfWidthM: 50000`을 실은 200m짜리 코스를
     *  제안·승격시키면 `corridorHalfWidthAt`이 그 값을 그대로 써서 **반경 50km 안
     *  어디서나 ON_COURSE**가 됐다 (트레일에서 45km 떨어진 도심 포함).
     *  `difficultyTenths: 99`도 그대로 배포됐다 — 발행 시점 클램프(×4.0)가 있어
     *  경제 피해는 상한이 있었지만 WalkSample에는 99가 실려 나갔다.
     *  승격에는 사람 검토가 없다(완주 기록 100건은 자기신고 정수다). 그러므로
     *  이 경계가 **코인이 생성되는 땅**을 지키는 유일한 지점이다.
     *
     *  값을 조용히 고치지 않고 거부한다 — 제안자가 낸 것과 다른 코스가 배포되면
     *  그것도 정직화 위반이다. 코드만 보내고 문장은 클라이언트 사전 몫(noUiStrings).
     */
    const polylineError = validateCoursePolyline(body.polyline);
    if (polylineError) {
      return reply.code(400).send({ error: 'invalid course polyline', code: polylineError });
    }
    const segments =
      body.segments ?? [{ fromIdx: 0, toIdx: body.polyline.length - 1, terrain: 'OPEN', difficultyTenths: 10 }];
    const segmentError = validateCourseSegments(segments, body.polyline.length);
    if (segmentError) {
      return reply.code(400).send({ error: 'invalid course segments', code: segmentError });
    }
    if (db.prepare('SELECT 1 FROM course_proposals WHERE course_id = ?').get(body.courseId)) {
      return reply.code(409).send({ error: 'courseId already proposed' });
    }
    /**
     * ★배포 중인 courseId는 재사용할 수 없다 (2026-07-27).
     *
     * 여기까지는 `course_proposals` 안에서만 중복을 봤다. 그래서 내장 코스와 같은
     * ID('shvil-israel')로 제안해 승격시키면 `distributedCourses`가 **같은 ID의 코스
     * 둘**을 내보내고, 회랑 엔진(`#judgeFix`)이 두 폴리라인 중 가까운 쪽을 골라
     * 난이도 계수를 매긴다 — 즉 자기 집 앞에 ×4.0 구간을 심을 수 있었다.
     * 위폐가 아니라 **요율 위조**이며, 같은 자리에서 사람마다 보상이 갈린다(제3조).
     * 대조 기준은 여기서도 배포 목록 그 자체다.
     */
    if (knownCourseIds(db).has(body.courseId)) {
      return reply.code(409).send({ error: 'courseId already distributed' });
    }
    db.prepare(
      `INSERT INTO course_proposals (course_id, name, proposer_member, polyline_json, segments_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'CANDIDATE', ?)`,
    ).run(
      body.courseId,
      body.name,
      member.member_id,
      JSON.stringify(body.polyline),
      JSON.stringify(segments),
      Date.now(),
    );
    return { courseId: body.courseId, status: 'CANDIDATE' };
  });

  /** 승격 현황 공개: 후보 코스별 "현재 몇 명" (지시서 6장 3절). */
  app.get('/courses/proposals', async () => {
    const rows = db
      .prepare(
        `SELECT p.course_id, p.name, p.status, p.created_at,
                (SELECT COUNT(*) FROM completion_records c WHERE c.course_id = p.course_id) AS completions
         FROM course_proposals p ORDER BY p.created_at DESC`,
      )
      .all() as unknown as { course_id: string; name: string; status: string; created_at: number; completions: number }[];
    return {
      proposals: rows.map((r) => ({
        courseId: r.course_id,
        name: r.name,
        status: r.status,
        completions: r.completions,
        promotionThreshold: ctx.promotionThreshold,
        createdAt: r.created_at,
      })),
    };
  });

  /** 완주 기록 제출 — 후보 코스 지지. 기준 인원 도달 시 공식 승격. */
  app.post('/courses/:courseId/completions', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const courseId = (req.params as { courseId: string }).courseId;
    const proposal = db.prepare('SELECT * FROM course_proposals WHERE course_id = ?').get(courseId) as
      | { status: string }
      | undefined;
    if (!proposal) return reply.code(404).send({ error: 'unknown course proposal' });
    const body = req.body as { distanceM?: number; days?: number } | null;
    if (!body || !Number.isInteger(body.distanceM) || body.distanceM! <= 0 || !Number.isInteger(body.days) || body.days! <= 0) {
      return reply.code(400).send({ error: 'distanceM and days (positive integers) required' });
    }
    try {
      db.prepare(
        'INSERT INTO completion_records (course_id, member_id, distance_m, days, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(courseId, member.member_id, body.distanceM!, body.days!, Date.now());
    } catch {
      return reply.code(409).send({ error: 'completion already recorded for this member' });
    }
    const count = (
      db.prepare('SELECT COUNT(*) AS n FROM completion_records WHERE course_id = ?').get(courseId) as { n: number }
    ).n;
    let promoted = false;
    if (proposal.status === 'CANDIDATE' && count >= ctx.promotionThreshold) {
      db.prepare("UPDATE course_proposals SET status = 'OFFICIAL' WHERE course_id = ?").run(courseId);
      promoted = true;
    }
    return { courseId, completions: count, promoted };
  });

  // ── 클레임 게시판 (누락 걸음 구제 — 지시서 2.5) ────────────────

  app.post('/claims', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const body = req.body as {
      courseId?: string;
      walkedAt?: number;
      distanceM?: number;
      photos?: string[];
    } | null;
    if (!body?.courseId || !Number.isInteger(body.walkedAt) || !Number.isInteger(body.distanceM) || body.distanceM! <= 0) {
      return reply.code(400).send({ error: 'courseId, walkedAt, distanceM required' });
    }
    // ★코스 대조 (fail-closed) — 서버가 배포하지 않는 코스로는 클레임을 걸 수 없다.
    // 클레임은 5표 투표를 거치지만, 임의 문자열이 허용되면 계정 6개(Sybil)로 존재하지도
    // 않는 코스에 대해 연 960 SHV/인을 뽑을 수 있다 (docs/발행경로_실측_2026-07-26.md §2-2).
    if (!isKnownCourse(db, body.courseId)) {
      return reply.code(400).send(UNKNOWN_COURSE_ERROR);
    }
    if (!Array.isArray(body.photos) || body.photos.length < 1) {
      return reply.code(400).send({ error: 'at least one photo required' });
    }
    const now = Date.now();
    // 하루(24시간) 안에 일어난 실수에 한한다.
    if (now - body.walkedAt! > ctx.claimWindowMs || body.walkedAt! > now) {
      return reply.code(400).send({ error: 'claims must be filed within 24 hours of the walk' });
    }
    // 1인당 클레임 빈도 한도 (제안 월 2회).
    const month = monthKey(now);
    const monthCount = (
      db.prepare('SELECT created_at FROM claims WHERE member_id = ?').all(member.member_id) as unknown as {
        created_at: number;
      }[]
    ).filter((r) => monthKey(r.created_at) === month).length;
    if (monthCount >= ctx.claimMonthlyLimit) {
      return reply.code(429).send({ error: `monthly claim limit (${ctx.claimMonthlyLimit}) reached` });
    }

    const result = db
      .prepare(
        "INSERT INTO claims (member_id, course_id, walked_at, distance_m, photos_json, status, created_at) VALUES (?, ?, ?, ?, ?, 'OPEN', ?)",
      )
      .run(member.member_id, body.courseId, body.walkedAt!, body.distanceM!, JSON.stringify(body.photos), now);
    return { claimId: Number(result.lastInsertRowid), status: 'OPEN' };
  });

  app.get('/claims', async (req) => {
    const q = req.query as { status?: string };
    const rows = (
      q.status
        ? db.prepare('SELECT * FROM claims WHERE status = ? ORDER BY created_at DESC LIMIT 200').all(q.status)
        : db.prepare('SELECT * FROM claims ORDER BY created_at DESC LIMIT 200').all()
    ) as unknown as {
      id: number;
      member_id: string;
      course_id: string;
      walked_at: number;
      distance_m: number;
      photos_json: string;
      status: string;
      created_at: number;
    }[];
    return {
      claims: rows.map((r) => ({
        claimId: r.id,
        memberId: r.member_id,
        courseId: r.course_id,
        walkedAt: r.walked_at,
        distanceM: r.distance_m,
        photos: JSON.parse(r.photos_json) as string[],
        status: r.status,
        votes: (db.prepare('SELECT COUNT(*) AS n FROM claim_votes WHERE claim_id = ?').get(r.id) as { n: number }).n,
        voteThreshold: ctx.claimVoteThreshold,
        createdAt: r.created_at,
      })),
    };
  });

  app.get('/claims/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const r = db.prepare('SELECT * FROM claims WHERE id = ?').get(id) as
      | { id: number; member_id: string; course_id: string; distance_m: number; status: string; grant_json: string | null }
      | undefined;
    if (!r) return reply.code(404).send({ error: 'claim not found' });
    return {
      claimId: r.id,
      memberId: r.member_id,
      courseId: r.course_id,
      distanceM: r.distance_m,
      status: r.status,
      votes: (db.prepare('SELECT COUNT(*) AS n FROM claim_votes WHERE claim_id = ?').get(r.id) as { n: number }).n,
      grant: r.grant_json ? (JSON.parse(r.grant_json) as SignedGrant) : null,
    };
  });

  /** 인정 투표 — 본인 확인(가입) 사용자만, 본인 클레임 불가, 1인 1표. */
  app.post('/claims/:id/vote', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const id = Number((req.params as { id: string }).id);
    const claim = db.prepare('SELECT * FROM claims WHERE id = ?').get(id) as
      | { id: number; member_id: string; course_id: string; walked_at: number; distance_m: number; photos_json: string; status: string }
      | undefined;
    if (!claim) return reply.code(404).send({ error: 'claim not found' });
    if (claim.status !== 'OPEN') return reply.code(409).send({ error: 'claim is not open' });
    if (claim.member_id === member.member_id) {
      return reply.code(400).send({ error: 'cannot vote on own claim' });
    }
    try {
      db.prepare('INSERT INTO claim_votes (claim_id, voter_member, created_at) VALUES (?, ?, ?)').run(
        id,
        member.member_id,
        Date.now(),
      );
    } catch {
      return reply.code(409).send({ error: 'already voted' });
    }
    const votes = (db.prepare('SELECT COUNT(*) AS n FROM claim_votes WHERE claim_id = ?').get(id) as { n: number }).n;

    // 기준 인원 도달 → 자동 산정 + 클레임 발행 키로 승인서 발행 (민팅은 사용자 폰에서).
    if (votes >= ctx.claimVoteThreshold) {
      const claimant = db
        .prepare('SELECT member_id, device_public_key FROM members WHERE member_id = ?')
        .get(claim.member_id) as unknown as CommunityMemberRow;
      const amountDshv = assessClaimDshv(claim.distance_m);
      const grant = buildGrant(
        {
          kind: 'COMMUNITY_CLAIM',
          memberId: claim.member_id,
          amountDshv,
          // 계보에 남는 근거: 게시물 해시 + 인정자 수 (지시서 2.5).
          reference: `claim:${id}:votes:${votes}:${hashObject({
            courseId: claim.course_id,
            walkedAt: claim.walked_at,
            distanceM: claim.distance_m,
            photos: JSON.parse(claim.photos_json) as string[],
          })}`,
          recipientPublicKey: claimant.device_public_key,
          issuerKeyId: ctx.claimKeyId,
          issuedAt: Date.now(),
        },
        ctx.claimSigner,
      );
      db.prepare("UPDATE claims SET status = 'APPROVED', grant_json = ? WHERE id = ?").run(JSON.stringify(grant), id);
      return { votes, status: 'APPROVED', amountDshv };
    }
    return { votes, status: 'OPEN', voteThreshold: ctx.claimVoteThreshold };
  });

  // ── 완주 인증 게시판 (격려 코인 — 지시서 2.6) ─────────────────

  app.post('/certificates', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const body = req.body as {
      courseId?: string;
      kind?: 'FULL' | 'SECTION';
      photos?: string[];
      data?: Record<string, unknown>;
    } | null;
    if (!body?.courseId || (body.kind !== 'FULL' && body.kind !== 'SECTION')) {
      return reply.code(400).send({ error: 'courseId and kind (FULL|SECTION) required' });
    }
    // ★★코스 대조 (fail-closed) — 이 검사가 없으면 아래의 "1인 1코스 1회"
    // (certificates UNIQUE(member_id, course_id, kind))가 "1인 1문자열 1회"가 되어,
    // courseId를 바꿔가며 요청당 13 SHV를 무한히 발행할 수 있다 (rate limit 없음).
    if (!isKnownCourse(db, body.courseId)) {
      return reply.code(400).send(UNKNOWN_COURSE_ERROR);
    }
    // 등록 요건: 완주 인증 사진 + 트레킹 데이터 완비 (지시서 2.6).
    if (!Array.isArray(body.photos) || body.photos.length < 1 || !body.data || Object.keys(body.data).length === 0) {
      return reply.code(400).send({ error: 'photos and trekking data required' });
    }
    // 같은 코스 중복 보상 없음 (1인 1코스 1회).
    if (
      db
        .prepare('SELECT 1 FROM certificates WHERE member_id = ? AND course_id = ? AND kind = ?')
        .get(member.member_id, body.courseId, body.kind)
    ) {
      return reply.code(409).send({ error: 'reward already issued for this course' });
    }

    const amountDshv = REWARD_DSHV[body.kind];
    const grant = buildGrant(
      {
        kind: 'COMMUNITY_REWARD',
        memberId: member.member_id,
        amountDshv,
        reference: `certificate:${body.courseId}:${body.kind}:${hashObject({ photos: body.photos, data: body.data })}`,
        recipientPublicKey: member.device_public_key,
        issuerKeyId: ctx.rewardKeyId,
        issuedAt: Date.now(),
      },
      ctx.rewardSigner,
    );
    const result = db
      .prepare(
        'INSERT INTO certificates (member_id, course_id, kind, photos_json, data_json, grant_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        member.member_id,
        body.courseId,
        body.kind,
        JSON.stringify(body.photos),
        JSON.stringify(body.data),
        JSON.stringify(grant),
        Date.now(),
      );
    return { certificateId: Number(result.lastInsertRowid), grant };
  });

  /** 코스별 완주 갤러리. */
  app.get('/certificates', async (req) => {
    const q = req.query as { courseId?: string };
    const rows = (
      q.courseId
        ? db.prepare('SELECT * FROM certificates WHERE course_id = ? ORDER BY created_at DESC LIMIT 200').all(q.courseId)
        : db.prepare('SELECT * FROM certificates ORDER BY created_at DESC LIMIT 200').all()
    ) as unknown as { id: number; member_id: string; course_id: string; kind: string; photos_json: string; data_json: string; created_at: number }[];
    return {
      certificates: rows.map((r) => ({
        certificateId: r.id,
        memberId: r.member_id,
        courseId: r.course_id,
        kind: r.kind,
        photos: JSON.parse(r.photos_json) as string[],
        data: JSON.parse(r.data_json) as Record<string, unknown>,
        createdAt: r.created_at,
      })),
    };
  });

  // ── 검증 트레커 탑 100 (지역별 — 지시서 6장 7절) ──────────────

  app.post('/leaderboard/enroll', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const body = req.body as {
      region?: string;
      displayName?: string;
      totalDistanceM?: number;
      totalMintedDshv?: number;
      consent?: boolean;
    } | null;
    // 본인 동의하에 공개 — 동의 없이는 등재 불가.
    if (!body?.consent) return reply.code(400).send({ error: 'explicit consent required' });
    if (!body.region || !body.displayName || !Number.isInteger(body.totalDistanceM) || !Number.isInteger(body.totalMintedDshv)) {
      return reply.code(400).send({ error: 'region, displayName, totalDistanceM, totalMintedDshv required' });
    }
    // TODO(운영): 검증 배지는 검토단 부여 절차. 개발 모드에서는 자동 검증 처리.
    db.prepare(
      `INSERT OR REPLACE INTO leaderboard (member_id, region, display_name, total_distance_m, total_minted_dshv, verified, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(member.member_id, body.region, body.displayName, body.totalDistanceM!, body.totalMintedDshv!, ctx.devMode ? 1 : 0, Date.now());
    return { enrolled: true };
  });

  /** 지역별 상위 100 — 거리·생성 총량만 공개, 위치 없음. */
  app.get('/leaderboard', async (req) => {
    const q = req.query as { region?: string };
    const rows = (
      q.region
        ? db
            .prepare('SELECT * FROM leaderboard WHERE region = ? ORDER BY total_minted_dshv DESC LIMIT 100')
            .all(q.region)
        : db.prepare('SELECT * FROM leaderboard ORDER BY total_minted_dshv DESC LIMIT 100').all()
    ) as unknown as { member_id: string; region: string; display_name: string; total_distance_m: number; total_minted_dshv: number; verified: number }[];
    return {
      leaderboard: rows.map((r, i) => ({
        rank: i + 1,
        memberId: r.member_id,
        region: r.region,
        displayName: r.display_name,
        totalDistanceM: r.total_distance_m,
        totalMintedDshv: r.total_minted_dshv,
        verified: r.verified === 1,
      })),
    };
  });

  /**
   * 인간 한계 기준선 배포 — 검증 엔진의 개연성 상한 (지시서 3장 3항).
   * 실측 기반 지역별 튜닝은 파일럿 데이터 축적 후속. 현재는 확정 상한 + 탑 기록 공개.
   */
  app.get('/limits/baseline', async () => {
    const regions = db
      .prepare(
        `SELECT region, MAX(total_minted_dshv) AS top_dshv, COUNT(*) AS members
         FROM leaderboard WHERE verified = 1 GROUP BY region`,
      )
      .all() as unknown as { region: string; top_dshv: number; members: number }[];
    // 숫자만 반환한다 — 기준선의 의미를 설명하는 문구는 각 웹의 i18n 사전 몫이다.
    return {
      dailyMaxDshv: 400,
      weeklyMaxDshv: 3000,
      regions: regions.map((r) => ({ region: r.region, topTotalMintedDshv: r.top_dshv, verifiedMembers: r.members })),
    };
  });

  // ── 소명 대기 목록 (지시서 3장 5절) ───────────────────────────

  /**
   * 지갑 배포용: 이 목록의 회원 번호가 생성한 코인은 수령 보류 대상.
   * 사유는 코드 + 파라미터로만 나간다 (@shvil/shared FlagReason) — 서버는 화면
   * 문장을 만들지 않는다. 소명 절차 설명 문구는 각 클라이언트 사전에 있다.
   */
  app.get('/limits/flagged', async () => {
    const rows = db
      .prepare("SELECT member_id, reason_code, params_json, flagged_at FROM flagged_members WHERE status = 'PENDING'")
      .all() as unknown as { member_id: string; reason_code: string; params_json: string; flagged_at: number }[];
    // 배포 서명(_sig) 부착 — MITM의 소명 목록 조작 차단 (보안 감사 H-3).
    return signDistribution(
      {
        members: rows.map((r) => ({
          memberId: r.member_id,
          reasonCode: r.reason_code,
          params: JSON.parse(r.params_json) as Record<string, string | number>,
          flaggedAt: r.flagged_at,
        })),
      },
      ctx.distSigner,
      ctx.distKeyId,
      Date.now(),
    );
  });

  if (ctx.devMode) {
    // TODO(운영): 자동 포착(동기화 통계·기준선 추월) + 검토단(검증 배지 추첨) 판정 절차.
    // 개발 모드에서는 수동 등재·해제로 흐름을 검증한다.
    app.post('/limits/flagged', async (req, reply) => {
      const body = req.body as { memberId?: string; reasonCode?: string; params?: Record<string, unknown> } | null;
      if (!body?.memberId) return reply.code(400).send({ error: 'memberId required' });
      // 자연어 사유는 받지 않는다 — 코드만. 미지정 시 수동 등재(MANUAL).
      const code = body.reasonCode ?? 'MANUAL';
      if (!isFlagReasonCode(code)) return reply.code(400).send({ error: 'unknown reasonCode' });
      db.prepare(
        "INSERT OR REPLACE INTO flagged_members (member_id, reason_code, params_json, status, flagged_at) VALUES (?, ?, ?, 'PENDING', ?)",
      ).run(body.memberId, code, JSON.stringify(body.params ?? {}), Date.now());
      return { flagged: true };
    });
    app.post('/limits/flagged/:memberId/clear', async (req) => {
      db.prepare("UPDATE flagged_members SET status = 'CLEARED' WHERE member_id = ?").run(
        (req.params as { memberId: string }).memberId,
      );
      return { cleared: true };
    });
  }

  // ── 투명성 공시 ───────────────────────────────────────────────

  app.get('/transparency/community', async () => {
    const claimsApproved = db
      .prepare("SELECT COUNT(*) AS n FROM claims WHERE status = 'APPROVED'")
      .get() as { n: number };
    const claimsOpen = (db.prepare("SELECT COUNT(*) AS n FROM claims WHERE status = 'OPEN'").get() as { n: number }).n;
    const claimGrants = db.prepare("SELECT grant_json FROM claims WHERE grant_json IS NOT NULL").all() as unknown as { grant_json: string }[];
    const claimDshv = claimGrants.reduce((sum, r) => sum + (JSON.parse(r.grant_json) as SignedGrant).amountDshv, 0);
    const certs = db.prepare('SELECT grant_json FROM certificates').all() as unknown as { grant_json: string }[];
    const certDshv = certs.reduce((sum, r) => sum + (JSON.parse(r.grant_json) as SignedGrant).amountDshv, 0);
    const official = (db.prepare("SELECT COUNT(*) AS n FROM course_proposals WHERE status = 'OFFICIAL'").get() as { n: number }).n;
    const candidates = (db.prepare("SELECT COUNT(*) AS n FROM course_proposals WHERE status = 'CANDIDATE'").get() as { n: number }).n;
    return {
      claims: { open: claimsOpen, approved: claimsApproved.n, issuedDshv: claimDshv },
      rewards: { issued: certs.length, issuedDshv: certDshv },
      courses: { official, candidates },
      flaggedPending: (db.prepare("SELECT COUNT(*) AS n FROM flagged_members WHERE status = 'PENDING'").get() as { n: number }).n,
    };
  });
}

// officialCourses는 courses.ts로 옮겼다 — 배포 목록과 발행 라우트의 코스 대조가
// 같은 모듈(단일 진실 원천)을 쓰게 하기 위해서다. 순환 import를 만들지 않는다.
export { officialCourses } from './courses';
