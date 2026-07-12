/**
 * 쉬빌 디렉토리 서버 (지시서 1장).
 *
 * 담당: ① 가입(전화 OTP + 이메일) → 회원 번호 발급 ② 엔젤 디렉토리(지도·프로필)
 * ③ 메신저 릴레이(E2E 암호문만 중계) ④ 코스 데이터 배포 ⑤ 프로모션 발행
 * (엔젤 등록 20 + 첫 접대 30 SHV — 기간·수량 한정 서명 키).
 *
 * 이 서버에는 거래 승인 기능이 없다. 지불·수령·검증은 전부 두 기기의 로컬에서
 * 완결된다. 첫 접대 보너스의 코인 증빙 검사는 "프로모션 지급 자격 확인"이지
 * 거래 승인이 아니다 — 거래는 제출 전에 이미 완결되어 있다.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { DatabaseSync } from 'node:sqlite';
import {
  ANGEL_BONUS_DSHV,
  AUTH_HEADER_MEMBER,
  AUTH_HEADER_SIG,
  AUTH_HEADER_TS,
  SHVIL_ISRAEL_NORTH_SAMPLE,
  addressFromPublicKey,
  buildGrant,
  currentOwnerAddress,
  generateKeyPair,
  sha256Hex,
  signerFromKeyPair,
  verifyAuthHeaders,
  verifyCoin,
  type Coin,
  type KeyPair,
  type MessageEnvelope,
  type SignedGrant,
} from '@shvil/shared';
import { createDb, kvGet, kvSet } from './db';
import { haversineKm } from './geo';

export const PROMO_KEY_ID = 'promo-angel-2026';
const OTP_TTL_MS = 10 * 60 * 1000;

export interface AppOptions {
  dbPath?: string;
  /** 엔젤 등록 보너스 수량 한정 (확정 파라미터: 기간·수량 한정 — 기본 500가정). */
  registrationQuota?: number;
  /** 개발 모드: OTP 코드를 응답에 포함 (실 SMS 발송은 운영 연동 항목). */
  devMode?: boolean;
}

interface MemberRow {
  member_id: string;
  phone_hash: string;
  email: string;
  display_name: string | null;
  device_public_key: string;
  messaging_public_key: string;
}

interface AngelRow {
  member_id: string;
  name: string;
  lat: number;
  lon: number;
  services_json: string;
  capacity: number;
  conditions: string | null;
  visible: number;
}

function phoneHash(phone: string): string {
  return sha256Hex(`shvil-phone|${phone.replace(/[^0-9+]/g, '')}`);
}

function rawBodyOf(req: FastifyRequest): string {
  return (req as FastifyRequest & { rawBody?: string }).rawBody ?? '';
}

export function buildApp(options: AppOptions = {}): FastifyInstance & { db: DatabaseSync } {
  const db = createDb(options.dbPath ?? ':memory:');
  const quota = options.registrationQuota ?? 500;
  const devMode = options.devMode ?? true;

  // 프로모션 서명 키 — 기간·수량 한정 발급 키. 지갑들은 GET /keys/promo로 신뢰 목록에 넣는다.
  let promoPair: KeyPair;
  const savedKey = kvGet(db, 'promoKey');
  if (savedKey) {
    promoPair = JSON.parse(savedKey) as KeyPair;
  } else {
    promoPair = generateKeyPair();
    kvSet(db, 'promoKey', JSON.stringify(promoPair));
  }
  const promoSigner = signerFromKeyPair(promoPair);

  const app = Fastify({ logger: false });

  // 서명 검증을 위해 수신 원문(raw body)을 보존한다.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as FastifyRequest & { rawBody?: string }).rawBody = body as string;
    try {
      done(null, body === '' ? null : JSON.parse(body as string));
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  /** 서명 요청 인증 — 가입 시 등록한 기기 키로 검증. 실패 시 null. */
  function authenticate(req: FastifyRequest): MemberRow | null {
    const memberId = req.headers[AUTH_HEADER_MEMBER];
    const ts = req.headers[AUTH_HEADER_TS];
    const sig = req.headers[AUTH_HEADER_SIG];
    if (typeof memberId !== 'string' || typeof ts !== 'string' || typeof sig !== 'string') return null;
    const member = db.prepare('SELECT * FROM members WHERE member_id = ?').get(memberId) as
      | MemberRow
      | undefined;
    if (!member) return null;
    const ok = verifyAuthHeaders({
      memberId,
      timestampHeader: ts,
      signatureHeader: sig,
      method: req.method,
      path: req.url.split('?')[0]!,
      bodyText: rawBodyOf(req),
      devicePublicKey: member.device_public_key,
      now: Date.now(),
    });
    return ok ? member : null;
  }

  function issueGrant(member: MemberRow, kind: 'REGISTRATION' | 'FIRST_HOSTING', now: number): SignedGrant {
    const grant = buildGrant(
      {
        kind: 'ANGEL_BONUS',
        memberId: member.member_id,
        amountDshv: kind === 'REGISTRATION' ? ANGEL_BONUS_DSHV.REGISTRATION : ANGEL_BONUS_DSHV.FIRST_HOSTING,
        reference: kind === 'REGISTRATION' ? 'angel-registration' : 'angel-first-hosting',
        recipientPublicKey: member.device_public_key,
        issuerKeyId: PROMO_KEY_ID,
        issuedAt: now,
      },
      promoSigner,
    );
    db.prepare('INSERT INTO promo_grants (member_id, kind, grant_json, issued_at) VALUES (?, ?, ?, ?)').run(
      member.member_id,
      kind,
      JSON.stringify(grant),
      now,
    );
    return grant;
  }

  function grantCount(kind: string): number {
    const row = db.prepare('SELECT COUNT(*) AS n FROM promo_grants WHERE kind = ?').get(kind) as { n: number };
    return row.n;
  }

  function hasGrant(memberId: string, kind: string): boolean {
    return (
      db.prepare('SELECT 1 FROM promo_grants WHERE member_id = ? AND kind = ?').get(memberId, kind) !==
      undefined
    );
  }

  // ── 가입 (의무 정보는 전화 OTP + 이메일뿐 — 지시서 2.1) ────────

  app.post('/auth/otp', async (req, reply) => {
    const body = req.body as { phone?: string } | null;
    if (!body?.phone) return reply.code(400).send({ error: 'phone required' });
    const code = String(Math.floor(100000 + Math.random() * 900000));
    db.prepare('INSERT OR REPLACE INTO otp (phone_hash, code, expires_at) VALUES (?, ?, ?)').run(
      phoneHash(body.phone),
      code,
      Date.now() + OTP_TTL_MS,
    );
    // TODO(운영): 실 SMS 발송 연동. 개발 모드에서는 코드를 응답으로 돌려준다.
    return devMode ? { sent: true, devCode: code } : { sent: true };
  });

  app.post('/auth/register', async (req, reply) => {
    const body = req.body as {
      phone?: string;
      code?: string;
      email?: string;
      displayName?: string;
      devicePublicKey?: string;
      messagingPublicKey?: string;
    } | null;
    if (!body?.phone || !body.code || !body.email || !body.devicePublicKey || !body.messagingPublicKey) {
      return reply.code(400).send({ error: 'phone, code, email, devicePublicKey, messagingPublicKey required' });
    }
    const ph = phoneHash(body.phone);
    const otp = db.prepare('SELECT code, expires_at FROM otp WHERE phone_hash = ?').get(ph) as
      | { code: string; expires_at: number }
      | undefined;
    if (!otp || otp.code !== body.code || otp.expires_at < Date.now()) {
      return reply.code(401).send({ error: 'invalid or expired code' });
    }
    if (db.prepare('SELECT 1 FROM members WHERE phone_hash = ?').get(ph)) {
      return reply.code(409).send({ error: 'phone already registered' });
    }

    // 회원 번호 발급 — 이후 이 회원이 생성하는 모든 코인에 새겨진다.
    let memberId = '';
    do {
      memberId = `SHV-${String(Math.floor(100000 + Math.random() * 900000))}`;
    } while (db.prepare('SELECT 1 FROM members WHERE member_id = ?').get(memberId));

    // TODO(운영): 이메일 실존 확인 링크 발송. 개발 모드에서는 즉시 확인 처리.
    db.prepare(
      `INSERT INTO members (member_id, phone_hash, email, email_verified, display_name,
        device_public_key, messaging_public_key, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
    ).run(memberId, ph, body.email, body.displayName ?? null, body.devicePublicKey, body.messagingPublicKey, Date.now());
    db.prepare('DELETE FROM otp WHERE phone_hash = ?').run(ph);
    return { memberId };
  });

  // ── 코스 데이터 배포 (원본: shvilist.org 코스 등록부 — M4 연동) ──

  app.get('/courses', async () => ({ courses: [SHVIL_ISRAEL_NORTH_SAMPLE] }));

  // ── 엔젤 디렉토리 ──────────────────────────────────────────────

  app.get('/angels', async (req) => {
    const q = req.query as { lat?: string; lon?: string; radiusKm?: string };
    const rows = db
      .prepare(
        `SELECT a.*, m.messaging_public_key, m.device_public_key FROM angels a
         JOIN members m ON m.member_id = a.member_id WHERE a.visible = 1`,
      )
      .all() as unknown as (AngelRow & { messaging_public_key: string; device_public_key: string })[];

    const origin =
      q.lat !== undefined && q.lon !== undefined
        ? { lat: Number(q.lat), lon: Number(q.lon) }
        : null;
    const radiusKm = q.radiusKm !== undefined ? Number(q.radiusKm) : 50;

    const angels = rows
      .map((r) => {
        const location = { lat: r.lat, lon: r.lon };
        const distanceKm = origin ? haversineKm(origin, location) : null;
        return {
          memberId: r.member_id,
          name: r.name,
          location,
          services: JSON.parse(r.services_json) as unknown,
          capacity: r.capacity,
          conditions: r.conditions,
          visible: true,
          messagingPublicKey: r.messaging_public_key,
          devicePublicKey: r.device_public_key,
          ...(distanceKm !== null ? { distanceKm: Math.round(distanceKm * 10) / 10 } : {}),
        };
      })
      .filter((a) => !origin || (a as { distanceKm?: number }).distanceKm! <= radiusKm)
      .sort((a, b) => ((a as { distanceKm?: number }).distanceKm ?? 0) - ((b as { distanceKm?: number }).distanceKm ?? 0));

    return { angels };
  });

  app.put('/angels/me', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const body = req.body as {
      name?: string;
      location?: { lat?: number; lon?: number };
      services?: unknown;
      capacity?: number;
      conditions?: string;
      visible?: boolean;
    } | null;
    if (!body?.name || typeof body.location?.lat !== 'number' || typeof body.location?.lon !== 'number') {
      return reply.code(400).send({ error: 'name and location required' });
    }

    const isNew =
      db.prepare('SELECT 1 FROM angels WHERE member_id = ?').get(member.member_id) === undefined;
    db.prepare(
      `INSERT OR REPLACE INTO angels
        (member_id, name, lat, lon, services_json, capacity, conditions, visible, registered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT registered_at FROM angels WHERE member_id = ?), ?))`,
    ).run(
      member.member_id,
      body.name,
      body.location.lat,
      body.location.lon,
      JSON.stringify(body.services ?? {}),
      body.capacity ?? 1,
      body.conditions ?? null,
      body.visible === false ? 0 : 1,
      member.member_id,
      Date.now(),
    );

    // 엔젤 등록 보너스 (등록 20 SHV — 수량 한정, 1인 1회). 민팅은 엔젤 폰에서.
    let registrationGrant: SignedGrant | undefined;
    if (isNew && !hasGrant(member.member_id, 'REGISTRATION') && grantCount('REGISTRATION') < quota) {
      registrationGrant = issueGrant(member, 'REGISTRATION', Date.now());
    }

    return { profile: { memberId: member.member_id, name: body.name }, registrationGrant };
  });

  // ── 첫 접대 보너스 (지불 수령 증빙 — 승인 아님, 프로모션 자격 확인) ──

  app.post('/angels/first-hosting', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    if (!db.prepare('SELECT 1 FROM angels WHERE member_id = ?').get(member.member_id)) {
      return reply.code(400).send({ error: 'not a registered angel' });
    }
    if (hasGrant(member.member_id, 'FIRST_HOSTING')) {
      return reply.code(409).send({ error: 'first hosting bonus already issued' });
    }
    const body = req.body as { coin?: Coin } | null;
    const coin = body?.coin;
    if (!coin) return reply.code(400).send({ error: 'coin evidence required' });

    if (db.prepare('SELECT 1 FROM hosting_evidence WHERE coin_id = ?').get(coin.id)) {
      return reply.code(409).send({ error: 'coin already used as evidence' });
    }
    // 증빙 검사: 완결된 이전 체인 + 소유자 = 이 엔젤 + 타인이 생성한 코인.
    const verdict = verifyCoin(coin, { trustedIssuerKeys: { [PROMO_KEY_ID]: promoSigner.publicKeyHex } });
    if (!verdict.valid) return reply.code(400).send({ error: `invalid coin: ${verdict.reasons.join(',')}` });
    if (coin.transferChain.length < 1) return reply.code(400).send({ error: 'coin was not received via transfer' });
    if (currentOwnerAddress(coin) !== addressFromPublicKey(member.device_public_key)) {
      return reply.code(400).send({ error: 'coin is not owned by this angel' });
    }
    if (coin.memberId === member.member_id) {
      return reply.code(400).send({ error: 'self-minted coin cannot prove hosting' });
    }

    db.prepare('INSERT INTO hosting_evidence (coin_id, member_id, submitted_at) VALUES (?, ?, ?)').run(
      coin.id,
      member.member_id,
      Date.now(),
    );
    return { grant: issueGrant(member, 'FIRST_HOSTING', Date.now()) };
  });

  // ── 메신저 릴레이 (서버는 암호문만 본다 — 지시서 1장) ──────────

  app.post('/messages', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const body = req.body as { envelope?: MessageEnvelope } | null;
    const env = body?.envelope;
    if (!env || env.type !== 'shvil/msg' || !env.ciphertextHex) {
      return reply.code(400).send({ error: 'invalid envelope' });
    }
    if (env.fromMemberId !== member.member_id) {
      return reply.code(403).send({ error: 'sender mismatch' });
    }
    if (!db.prepare('SELECT 1 FROM members WHERE member_id = ?').get(env.toMemberId)) {
      return reply.code(404).send({ error: 'unknown recipient' });
    }
    const result = db
      .prepare('INSERT INTO messages (to_member, envelope_json, created_at) VALUES (?, ?, ?)')
      .run(env.toMemberId, JSON.stringify(env), Date.now());
    return { id: Number(result.lastInsertRowid) };
  });

  app.get('/messages', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const q = req.query as { sinceId?: string };
    const sinceId = q.sinceId !== undefined ? Number(q.sinceId) : 0;
    const rows = db
      .prepare('SELECT id, envelope_json FROM messages WHERE to_member = ? AND id > ? ORDER BY id LIMIT 200')
      .all(member.member_id, sinceId) as { id: number; envelope_json: string }[];
    return { messages: rows.map((r) => ({ id: r.id, envelope: JSON.parse(r.envelope_json) as MessageEnvelope })) };
  });

  // ── 공개 정보 ─────────────────────────────────────────────────

  app.get('/keys/promo', async () => ({ keyId: PROMO_KEY_ID, publicKey: promoSigner.publicKeyHex }));

  /** 투명성 페이지 데이터 — 프로모션 발행 현황 공시 (지시서 2.4, 5장). */
  app.get('/transparency/promo', async () => ({
    registrationIssued: grantCount('REGISTRATION'),
    firstHostingIssued: grantCount('FIRST_HOSTING'),
    registrationQuota: quota,
  }));

  return Object.assign(app, { db });
}
