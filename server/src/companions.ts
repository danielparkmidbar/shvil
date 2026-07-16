/**
 * 동행 찾기 게시판 (M8 — 서비스 재조정 §4-6, R-6).
 *
 * 다니엘 쌤: "자신의 여정을 나누고 함께 여행할 사람을 미리 만드는 공간." 게시자가
 * 여정(구간·대략 날짜·팀 규모)을 공개 모집하고, 관심 있는 사람은 지갑 1:1 E2E
 * 메시지로 접촉한다. 서버는 게시글만 안다 — 관심 표명·팀 조율은 E2E다.
 *
 * ── 신뢰·프라이버시 모델 (게스트북·별점과 형제 + 엔젤 디렉토리와 형제) ─────────
 *  - 자발 공개: 동행 게시글은 공개 모집이므로 게시자가 자기 여정을 스스로 공개한다
 *    (게스트북·별점과 같은 사상). 서버는 게시자 서명으로 게시·수정·삭제를 인증한다.
 *  - 연락 핸들 공개: 공개 열람 응답은 화면 표시 신원으로 display_name(닉네임)을 주되,
 *    author_member_id·messaging_public_key를 **연락 라우팅 핸들**로 함께 준다 — 이는
 *    엔젤 디렉토리(GET /angels)가 memberId·messagingPublicKey를 공개해 접촉을 가능케
 *    하는 것과 동일하다. memberId는 실명·전화·이메일이 아닌 가명 라우팅 ID다.
 *  - ★확정 팀 관계 비저장 (헌법 제9조·재조정 §4-6 금지 조항): 이 라우트 어디에도
 *    "누가 누구와 팀"을 저장하는 필드가 없다. 관심 표명은 E2E 메시지(암호문)라
 *    서버가 못 보고, 팀 구성 자체가 서버로 오지 않는다. 서버가 아는 것은 게시글까지다.
 *
 * noUiStrings: GET 응답은 사용자 원문(닉네임·한마디·여정)·코드·ID·숫자뿐 — 서버가
 * 만든 자연어 UI 문구는 없다. note/displayName은 번역 대상이 아닌 사용자 콘텐츠이므로
 * noUiStrings 검사 대상 엔드포인트가 아니다 (게스트북 message와 동일 예외 패턴).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import {
  COMPANION_OPEN_LIMIT,
  COMPANION_STATUSES,
  isCompanionPostId,
  newCompanionPostId,
  regionById,
  validateCompanionInput,
  validateCompanionUpdate,
  type CompanionMode,
  type CompanionStatus,
} from '@shvil/shared';

export interface CompanionsMemberRow {
  member_id: string;
  device_public_key: string;
}

export interface CompanionsContext {
  db: DatabaseSync;
  authenticate: (req: FastifyRequest) => CompanionsMemberRow | null;
}

/** 공개 열람 페이지 크기 — 최근 것부터. */
const COMPANIONS_PAGE = 100;

interface CompanionRow {
  post_id: string;
  author_member_id: string;
  display_name: string;
  region_id: string;
  course_id: string | null;
  from_date: string;
  to_date: string;
  party_size_current: number;
  party_size_target: number;
  mode: string;
  note: string | null;
  status: string;
  created_at: number;
  messaging_public_key: string;
}

function projectListing(r: CompanionRow) {
  return {
    postId: r.post_id,
    // 화면 표시 신원은 닉네임. authorMemberId·messagingPublicKey는 E2E 접촉·딥링크용
    // 라우팅 핸들이다 (엔젤 디렉토리와 동일 — 실명·전화·이메일이 아닌 가명 ID).
    displayName: r.display_name,
    authorMemberId: r.author_member_id,
    messagingPublicKey: r.messaging_public_key,
    regionId: r.region_id,
    courseId: r.course_id,
    fromDate: r.from_date,
    toDate: r.to_date,
    partySizeCurrent: r.party_size_current,
    partySizeTarget: r.party_size_target,
    mode: r.mode,
    note: r.note,
    status: r.status,
    createdAt: r.created_at,
  };
}

export function registerCompanions(app: FastifyInstance, ctx: CompanionsContext): void {
  const { db, authenticate } = ctx;

  /**
   * 동행 모집 글 등록 (게시자 서명 인증). 여정을 공개 모집한다.
   * 스팸 방지: author당 동시 OPEN 게시글 상한(COMPANION_OPEN_LIMIT) 초과 시 429.
   */
  app.post('/companions', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });

    const body = req.body as Record<string, unknown> | null;
    // 지역 확인은 서버 카탈로그(WORLD_TRAILS)로 — 클라이언트를 신뢰하지 않는다.
    const reasons = validateCompanionInput(body, (id) => regionById(id));
    if (reasons.length > 0) return reply.code(400).send({ error: `invalid input: ${reasons.join(', ')}` });
    const input = body as {
      regionId: string;
      courseId?: string;
      fromDate: string;
      toDate: string;
      partySizeCurrent: number;
      partySizeTarget: number;
      mode: CompanionMode;
      displayName: string;
      note?: string;
    };

    // 동시 OPEN 상한 (스팸 방지) — 초과 시 429 코드 (자연어 아님).
    const openCount = (
      db
        .prepare("SELECT COUNT(*) AS n FROM companions WHERE author_member_id = ? AND status = 'OPEN'")
        .get(member.member_id) as { n: number }
    ).n;
    if (openCount >= COMPANION_OPEN_LIMIT) {
      return reply.code(429).send({ error: `open companion post limit (${COMPANION_OPEN_LIMIT}) reached` });
    }

    const postId = newCompanionPostId();
    const now = Date.now();
    const note = typeof input.note === 'string' && input.note.trim() !== '' ? input.note.trim() : null;
    const courseId = typeof input.courseId === 'string' && input.courseId.trim() !== '' ? input.courseId.trim() : null;
    db.prepare(
      `INSERT INTO companions
        (post_id, author_member_id, display_name, region_id, course_id, from_date, to_date,
         party_size_current, party_size_target, mode, note, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`,
    ).run(
      postId,
      member.member_id,
      input.displayName.trim(),
      input.regionId,
      courseId,
      input.fromDate,
      input.toDate,
      input.partySizeCurrent,
      input.partySizeTarget,
      input.mode,
      note,
      now,
    );
    return { posted: true, postId };
  });

  /**
   * 게시글 상태·인원 갱신 (게시자 서명 인증) — 모집 마감·인원 증감.
   * 자기 글만 수정할 수 있다 (author_member_id 대조). 대상이 없으면 404.
   */
  app.put('/companions/:id', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const postId = (req.params as { id: string }).id;
    if (!isCompanionPostId(postId)) return reply.code(400).send({ error: 'invalid postId' });

    const body = req.body as Record<string, unknown> | null;
    const reasons = validateCompanionUpdate(body);
    if (reasons.length > 0) return reply.code(400).send({ error: `invalid update: ${reasons.join(', ')}` });
    const upd = body as {
      status?: CompanionStatus;
      partySizeCurrent?: number;
      partySizeTarget?: number;
      note?: string;
    };

    const existing = db
      .prepare('SELECT * FROM companions WHERE post_id = ? AND author_member_id = ?')
      .get(postId, member.member_id) as CompanionRow | undefined;
    if (!existing) return reply.code(404).send({ error: 'not found' });

    const status: CompanionStatus = upd.status ?? (existing.status as CompanionStatus);
    const target = upd.partySizeTarget ?? existing.party_size_target;
    const current = upd.partySizeCurrent ?? existing.party_size_current;
    // 정합 방어: current는 target을 넘을 수 없다 (부분 갱신이라 여기서 재대조).
    if (current > target) return reply.code(400).send({ error: 'partySizeCurrent exceeds target' });
    const note =
      upd.note === undefined
        ? existing.note
        : upd.note.trim() === ''
          ? null
          : upd.note.trim();

    db.prepare(
      `UPDATE companions SET status = ?, party_size_current = ?, party_size_target = ?, note = ?
       WHERE post_id = ? AND author_member_id = ?`,
    ).run(status, current, target, note, postId, member.member_id);
    return { updated: true, postId, status, partySizeCurrent: current, partySizeTarget: target };
  });

  /** 게시글 삭제 (게시자 서명 인증) — 자기 글만. 대상이 없으면 404. */
  app.delete('/companions/:id', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const postId = (req.params as { id: string }).id;
    const result = db
      .prepare('DELETE FROM companions WHERE post_id = ? AND author_member_id = ?')
      .run(postId, member.member_id);
    if (result.changes === 0) return reply.code(404).send({ error: 'not found' });
    return { removed: true, postId };
  });

  /**
   * 공개 열람 (웹·앱, 비서명) — 게시자 닉네임 + 여정 + 연락 핸들.
   * 필터: region · course · status · author (전부 선택, AND 결합).
   *  - status 미지정 시 전체 (게시자의 "내 글 관리"는 CLOSED도 봐야 하므로).
   *    공개 게시판은 status=OPEN을 명시해 모집 중인 것만 본다.
   *  - author 필터는 게시자가 자기 글 목록을 관리하기 위한 것이다 (엔젤 디렉토리의
   *    member= 필터와 동일한 성격 — 응답에 실명·전화·이메일 같은 개인정보는 없다).
   */
  app.get('/companions', async (req) => {
    const q = req.query as { region?: string; course?: string; status?: string; author?: string };
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (q.region) {
      clauses.push('c.region_id = ?');
      params.push(q.region);
    }
    if (q.course) {
      clauses.push('c.course_id = ?');
      params.push(q.course);
    }
    if (q.status && COMPANION_STATUSES.includes(q.status as CompanionStatus)) {
      clauses.push('c.status = ?');
      params.push(q.status);
    }
    if (q.author) {
      clauses.push('c.author_member_id = ?');
      params.push(q.author);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT c.*, m.messaging_public_key FROM companions c
         JOIN members m ON m.member_id = c.author_member_id
         ${where} ORDER BY c.created_at DESC LIMIT ?`,
      )
      .all(...params, COMPANIONS_PAGE) as unknown as CompanionRow[];
    return { companions: rows.map(projectListing) };
  });
}
