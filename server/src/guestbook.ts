/**
 * 게스트북 (M7-A — 서비스 재조정 §4-5, 헌법 제5조 감사의 화폐).
 *
 * 빈집 방명록의 디지털판이다 (다니엘 쌤 경험: 엔젤이 빈집을 내어주면 리스트들은
 * 쪽지·감사 카드를 남기고 간다). 엔젤이 자기가 받은 감사 카드 중 하나를 자기
 * 프로필의 방명록에 자발 게시한다 — 열람은 웹·앱 누구나 공개로 볼 수 있다.
 *
 * ── 신뢰 모델 (E2E 원본을 못 보는데 게시를 신뢰하는 이유) ─────────────
 * 감사 카드는 E2E 암호 메시지다 (thanksCard.ts). 서버는 암호문 봉투만 중계하며
 * 카드 원본(작성자의 makePublic 동의 여부 포함)을 절대 보지 못한다. 따라서:
 *   - 작성자(리스트)의 makePublic=true 동의를 확인하는 것은 엔젤 지갑의 몫이다.
 *     지갑은 makePublic=false인 카드에는 "게스트북에 공개" 버튼을 노출하지 않는다.
 *   - 서버는 게시 요청을 보낸 주체가 이 방명록의 주인(엔젤)임을 서명으로 인증한 뒤,
 *     본문을 그대로 신뢰해 저장한다. 게시 결정 자체가 엔젤의 자발 행위이므로
 *     (R-4/프라이버시 안전) — 엔젤은 자기가 받은 카드만 자기 방명록에 올린다.
 * 이 신뢰 경계는 헌법 제9조(서버 불간섭)와 정합한다: 서버는 무엇도 승인하지 않고,
 * 자발 공개된 내용을 보관·배포할 뿐이다.
 *
 * noUiStrings: 이 라우트의 GET 응답은 사용자 원문 데이터(닉네임·메시지·여정)와
 * 코드·ID·숫자뿐이다 — 서버가 만든 자연어 UI 문구는 없다. message/journey_line은
 * 번역 대상이 아닌 사용자 콘텐츠이므로 noUiStrings 검사의 대상 엔드포인트가 아니다
 * (엔젤 name·conditions·리더보드 표시명이 그렇듯 — noUiStrings.test.ts 참조).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { THANKS_CARD_TEMPLATES, type ThanksCardTemplate } from '@shvil/shared';

export interface GuestbookMemberRow {
  member_id: string;
  device_public_key: string;
}

export interface GuestbookContext {
  db: DatabaseSync;
  authenticate: (req: FastifyRequest) => GuestbookMemberRow | null;
}

const CARD_ID_RE = /^thx-[0-9a-f]{16}$/;
/** 저장·조회 상한 — 사용자 원문 그대로지만 폭주를 막는 방어 한도 (스키마와 무관). */
const MESSAGE_MAX = 500;
const NAME_MAX = 100;
const JOURNEY_MAX = 200;
/** 방명록 공개 열람 페이지 크기 — 최근 것부터. */
const GUESTBOOK_PAGE = 100;

interface GuestbookRow {
  card_id: string;
  from_display_name: string;
  template: string;
  message: string;
  journey_line: string | null;
  created_at: number;
}

export function registerGuestbook(app: FastifyInstance, ctx: GuestbookContext): void {
  const { db, authenticate } = ctx;

  /**
   * 게스트북 게시 (엔젤의 서명 인증) — 자기가 받은 감사 카드 하나를 공개 게시.
   * 본문에 카드 내용 그대로 저장한다 (엔젤 지갑이 makePublic 동의를 이미 확인).
   * 서버는 원본 카드를 못 보므로 게시 요청을 엔젤 서명으로만 신뢰한다 (위 신뢰 모델).
   */
  app.post('/guestbook', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const body = req.body as {
      cardId?: string;
      fromDisplayName?: string;
      template?: string;
      message?: string;
      journeyLine?: string;
    } | null;
    if (!body?.cardId || !CARD_ID_RE.test(body.cardId)) {
      return reply.code(400).send({ error: 'cardId (thx-16hex) required' });
    }
    if (!THANKS_CARD_TEMPLATES.includes(body.template as ThanksCardTemplate)) {
      return reply.code(400).send({ error: 'invalid template' });
    }
    const template: ThanksCardTemplate = body.template as ThanksCardTemplate;
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const fromDisplayName = typeof body.fromDisplayName === 'string' ? body.fromDisplayName.trim() : '';
    if (message === '' || message.length > MESSAGE_MAX) {
      return reply.code(400).send({ error: 'message length out of range' });
    }
    if (fromDisplayName === '' || fromDisplayName.length > NAME_MAX) {
      return reply.code(400).send({ error: 'fromDisplayName required' });
    }
    const journeyLine =
      typeof body.journeyLine === 'string' && body.journeyLine.trim() !== ''
        ? body.journeyLine.trim().slice(0, JOURNEY_MAX)
        : null;

    // card_id UNIQUE — 같은 카드 이중 게시는 409 (엔젤이 이미 올렸다).
    if (db.prepare('SELECT 1 FROM guestbook WHERE card_id = ?').get(body.cardId)) {
      return reply.code(409).send({ error: 'card already published' });
    }
    db.prepare(
      `INSERT INTO guestbook (angel_member_id, card_id, from_display_name, template, message, journey_line, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(member.member_id, body.cardId, fromDisplayName, template, message, journeyLine, Date.now());
    return { published: true, cardId: body.cardId };
  });

  /** 게시 철회 (엔젤의 서명 인증) — 자기 방명록의 카드만 지울 수 있다. */
  app.delete('/guestbook/:cardId', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const cardId = (req.params as { cardId: string }).cardId;
    const result = db
      .prepare('DELETE FROM guestbook WHERE card_id = ? AND angel_member_id = ?')
      .run(cardId, member.member_id);
    if (result.changes === 0) return reply.code(404).send({ error: 'not found' });
    return { removed: true, cardId };
  });

  /**
   * 공개 열람 (웹·앱, 비서명) — 회원 번호 노출 금지: from_display_name(닉네임)만.
   * member= 로 특정 엔젤의 방명록을, 미지정 시 최근 전체를 돌려준다.
   */
  app.get('/guestbook', async (req) => {
    const q = req.query as { member?: string };
    const rows = (
      q.member
        ? db
            .prepare(
              `SELECT card_id, from_display_name, template, message, journey_line, created_at
               FROM guestbook WHERE angel_member_id = ? ORDER BY created_at DESC LIMIT ?`,
            )
            .all(q.member, GUESTBOOK_PAGE)
        : db
            .prepare(
              `SELECT card_id, from_display_name, template, message, journey_line, created_at
               FROM guestbook ORDER BY created_at DESC LIMIT ?`,
            )
            .all(GUESTBOOK_PAGE)
    ) as unknown as GuestbookRow[];
    const memberFilter = q.member;
    const total = memberFilter
      ? (db.prepare('SELECT COUNT(*) AS n FROM guestbook WHERE angel_member_id = ?').get(memberFilter) as { n: number }).n
      : (db.prepare('SELECT COUNT(*) AS n FROM guestbook').get() as { n: number }).n;
    return {
      // 회원 번호는 어디에도 없다 — 게시자(엔젤)도 작성자(리스트)도 닉네임만.
      total,
      cards: rows.map((r) => ({
        cardId: r.card_id,
        fromDisplayName: r.from_display_name,
        template: r.template,
        message: r.message,
        journeyLine: r.journey_line,
        createdAt: r.created_at,
      })),
    };
  });
}
