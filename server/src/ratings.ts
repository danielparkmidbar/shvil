/**
 * 상호 별점 게시 (M7-B — 별점_프라이버시_결정 안 B, 헌법 제5조·제9조).
 *
 * 게스트북(guestbook.ts)과 **같은 신뢰 모델**이다. 별점은 E2E 서명 카드로
 * 피평가자 지갑에 도착하고(rating.ts), 서버는 원본 카드를 절대 보지 못한다.
 * 피평가자가 받은 별점 중 하나를 자기 프로필에 자발 게시하면 서버가 그 내용만
 * 보관한다 — 열람은 웹·앱 누구나 공개로 본다.
 *
 * ── 프라이버시 핵심 (안 B가 서버에서 지켜지는 지점) ─────────────────────
 * 이 라우트 어디에도 "평가자↔피평가자 관계"를 저장하는 필드가 없다:
 *   - ratings 테이블은 subject_member_id(피평가자)만 회원 번호로 갖고, 평가자는
 *     닉네임(from_display_name)만 남긴다 (게스트북과 동일).
 *   - 관계 증명(relationProof)은 게시 본문에 받지 않는다 — 그것은 E2E 카드 안에만
 *     있고 피평가자 지갑이 검증한다. 서버로 오면 "누가 누구 집에 묵었나"가 남으므로.
 * 따라서 서버가 해킹돼도 투숙 관계망은 유출되지 않는다 — 서버는 관계를 모른다.
 *
 * "받은 총 개수"(공개율 분모)는 서버가 카운트하지 않는다 (카운트하면 접대 횟수가
 * 남는다). 대신 피평가자가 게시 시 자기 로컬 수신 총수를 자발 신고한다
 * (rating_disclosures) — 관계를 담지 않는 단일 숫자다. 축소 신고로 공개율을
 * 부풀릴 여지는 남는 위험이며, 안 B의 자발 공개 사상에서 감수한다.
 *
 * ── 정직화 (적대적 검증 반영, 2026-07-16) ─────────────────────────────
 * 서버는 별점의 진위를 검증하지 못한다 — 평가자 서명이 게시 본문에 없기 때문이다
 * (있으면 서버가 평가자 신원을 알게 돼 안 B가 무너진다). 따라서 **프로필 주인이
 * 서명 없는 가짜 5★를 임의 닉네임으로 자기 프로필에 날조 게시할 수 있다.** 이 근본
 * 한계의 해결은 다니엘 쌤 결정 대기다 (별점_프라이버시_결정.md R-1d). 이 라우트가
 * 할 수 있는 완화는 (1) 피평가자당 게시 상한(MAX_RATINGS_PER_SUBJECT)으로 무제한
 * 날조 쓰기를 막는 것, (2) 공개 별점을 "참고 지표"로만 표시하도록 클라이언트에
 * 맡기는 것뿐이다. 이 라우트는 평가자 신원/관계를 저장하는 필드를 절대 두지 않는다.
 *
 * noUiStrings: GET 응답은 사용자 원문(닉네임·후기)·코드·ID·숫자뿐 — 서버가 만든
 * 자연어 UI 문구는 없다. review/from_display_name은 번역 대상이 아닌 사용자 콘텐츠
 * 이므로 noUiStrings 검사 대상 엔드포인트가 아니다 (게스트북 message와 동일 예외).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { RATING_DIRECTIONS, type RatingDirection } from '@shvil/shared';

export interface RatingsMemberRow {
  member_id: string;
  device_public_key: string;
}

export interface RatingsContext {
  db: DatabaseSync;
  authenticate: (req: FastifyRequest) => RatingsMemberRow | null;
}

const RATING_ID_RE = /^rat-[0-9a-f]{16}$/;
/** 저장·조회 상한 — 사용자 원문 그대로지만 폭주를 막는 방어 한도 (스키마와 무관). */
const REVIEW_MAX = 200;
const NAME_MAX = 100;
const STARS_MIN = 1;
const STARS_MAX = 5;
/** 공개 열람 페이지 크기 — 최근 것부터. */
const RATINGS_PAGE = 100;
/**
 * 피평가자당 게시 상한 (M7-B 조건 3 — 무제한 쓰기 DoS·자기 날조 폭주 완화).
 * 서버는 별점의 진위를 못 본다(안 B) → 프로필 주인이 가짜 별점을 무한정 게시하는
 * 것을 근본적으로 막을 수는 없지만(R-1d 결정 대기), 최소한 저장 폭주는 상한으로
 * 막는다. 정상 이용에는 넉넉하고(한 사람이 실제 받는 별점은 이보다 훨씬 적다),
 * 초과 시 429 에러 코드로 거부한다 (자연어 문구 아님 — noUiStrings 원칙).
 */
const MAX_RATINGS_PER_SUBJECT = 200;

interface RatingRow {
  rating_id: string;
  stars: number;
  review: string | null;
  from_display_name: string;
  direction: string;
  created_at: number;
}

export function registerRatings(app: FastifyInstance, ctx: RatingsContext): void {
  const { db, authenticate } = ctx;

  /**
   * 별점 게시 (피평가자의 서명 인증) — 자기가 받은 별점 하나를 공개 게시.
   * 서버는 원본 카드를 못 보므로 게시 요청을 피평가자 서명으로만 신뢰한다.
   * 관계 증명은 받지 않는다 (프라이버시 핵심). 선택적으로 자발 신고 receivedCount로
   * 공개율 분모를 갱신한다 (평가자 정보를 담지 않는 단일 숫자).
   */
  app.post('/ratings', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const body = req.body as {
      ratingId?: string;
      stars?: number;
      review?: string;
      fromDisplayName?: string;
      direction?: string;
      receivedCount?: number;
    } | null;
    if (!body?.ratingId || !RATING_ID_RE.test(body.ratingId)) {
      return reply.code(400).send({ error: 'ratingId (rat-16hex) required' });
    }
    if (
      typeof body.stars !== 'number' ||
      !Number.isInteger(body.stars) ||
      body.stars < STARS_MIN ||
      body.stars > STARS_MAX
    ) {
      return reply.code(400).send({ error: 'stars out of range (1-5 integer)' });
    }
    if (!RATING_DIRECTIONS.includes(body.direction as RatingDirection)) {
      return reply.code(400).send({ error: 'invalid direction' });
    }
    const direction: RatingDirection = body.direction as RatingDirection;
    const fromDisplayName = typeof body.fromDisplayName === 'string' ? body.fromDisplayName.trim() : '';
    if (fromDisplayName === '' || fromDisplayName.length > NAME_MAX) {
      return reply.code(400).send({ error: 'fromDisplayName required' });
    }
    const review =
      typeof body.review === 'string' && body.review.trim() !== ''
        ? body.review.trim().slice(0, REVIEW_MAX)
        : null;

    // 피평가자당 게시 상한 (조건 3) — 무제한 쓰기 DoS 차단. 초과 시 429 코드.
    const existing = (
      db.prepare('SELECT COUNT(*) AS n FROM ratings WHERE subject_member_id = ?').get(member.member_id) as {
        n: number;
      }
    ).n;
    if (existing >= MAX_RATINGS_PER_SUBJECT) {
      return reply.code(429).send({ error: `rating publish limit (${MAX_RATINGS_PER_SUBJECT}) reached` });
    }

    // rating_id UNIQUE — 같은 별점 이중 게시는 409 (피평가자가 이미 올렸다).
    if (db.prepare('SELECT 1 FROM ratings WHERE rating_id = ?').get(body.ratingId)) {
      return reply.code(409).send({ error: 'rating already published' });
    }
    db.prepare(
      `INSERT INTO ratings (subject_member_id, rating_id, stars, review, from_display_name, direction, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(member.member_id, body.ratingId, body.stars, review, fromDisplayName, direction, Date.now());

    // 자발 신고 "받은 총 개수" — 공개율 분모. 게시 수보다 작을 수 없게 방어적으로 최소 보정.
    if (typeof body.receivedCount === 'number' && Number.isInteger(body.receivedCount) && body.receivedCount >= 0) {
      const published = (
        db.prepare('SELECT COUNT(*) AS n FROM ratings WHERE subject_member_id = ?').get(member.member_id) as {
          n: number;
        }
      ).n;
      const received = Math.max(body.receivedCount, published);
      db.prepare(
        `INSERT INTO rating_disclosures (subject_member_id, received_count, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(subject_member_id) DO UPDATE SET received_count = excluded.received_count, updated_at = excluded.updated_at`,
      ).run(member.member_id, received, Date.now());
    }
    return { published: true, ratingId: body.ratingId };
  });

  /** 게시 철회 (피평가자의 서명 인증) — 자기 프로필의 별점만 지울 수 있다. */
  app.delete('/ratings/:ratingId', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const ratingId = (req.params as { ratingId: string }).ratingId;
    const result = db
      .prepare('DELETE FROM ratings WHERE rating_id = ? AND subject_member_id = ?')
      .run(ratingId, member.member_id);
    if (result.changes === 0) return reply.code(404).send({ error: 'not found' });
    return { removed: true, ratingId };
  });

  /**
   * 공개 열람 (웹·앱, 비서명) — 회원 번호 노출 금지: from_display_name(닉네임)만.
   * 평균(×10 정수)·게시 개수·자발 신고 받은 개수(공개율 분모)·게시 카드를 돌려준다.
   */
  app.get('/ratings', async (req, reply) => {
    const q = req.query as { member?: string };
    if (!q.member) return reply.code(400).send({ error: 'member required' });
    const rows = db
      .prepare(
        `SELECT rating_id, stars, review, from_display_name, direction, created_at
         FROM ratings WHERE subject_member_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(q.member, RATINGS_PAGE) as unknown as RatingRow[];
    const agg = db
      .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(stars), 0) AS s FROM ratings WHERE subject_member_id = ?')
      .get(q.member) as { n: number; s: number };
    const publicCount = agg.n;
    // 평균 별점 ×10 정수 (부동소수 회피). 게시분만으로 서버가 집계한다.
    const averageTenths = publicCount === 0 ? 0 : Math.round((agg.s / publicCount) * 10);
    const disclosure = db
      .prepare('SELECT received_count FROM rating_disclosures WHERE subject_member_id = ?')
      .get(q.member) as { received_count: number } | undefined;
    // 자발 신고가 없거나 게시 수보다 작으면 게시 수를 하한으로 (공개율 ≤ 100%).
    const receivedCount = Math.max(disclosure?.received_count ?? publicCount, publicCount);
    return {
      // 회원 번호는 어디에도 없다 — 피평가자도 평가자도 노출하지 않는다(닉네임만).
      averageTenths,
      publicCount,
      receivedCount,
      ratings: rows.map((r) => ({
        ratingId: r.rating_id,
        stars: r.stars,
        review: r.review,
        fromDisplayName: r.from_display_name,
        direction: r.direction,
        createdAt: r.created_at,
      })),
    };
  });
}
