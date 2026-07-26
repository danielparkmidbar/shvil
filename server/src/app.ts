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
import { randomBytes } from 'node:crypto';
import {
  ANGEL_BONUS_DSHV,
  AUTH_HEADER_MEMBER,
  AUTH_HEADER_SIG,
  AUTH_HEADER_TS,
  INT_TRAIL_ANGELS,
  INT_TRAIL_ANGELS_SOURCE,
  INT_TRAIL_ANGELS_UPDATED,
  INT_TRAIL_ANGEL_REGIONS,
  RECOMMENDED_PRICES_DSHV,
  TARGET_COUNTRY_COUNT,
  WORLD_TRAILS,
  addressFromPublicKey,
  buildGrant,
  liveRegions,
  buildMembershipCertificate,
  currentOwnerAddress,
  sha256Hex,
  signDistribution,
  snapToPrivacyGrid,
  verifyAuthHeaders,
  verifyCoin,
  type Coin,
  type IntegrityLevel,
  type MembershipCertificate,
  type MessageEnvelope,
  type SignedGrant,
} from '@shvil/shared';
import { createDb } from './db';
import { SealedKeystore } from './keystore';
import {
  issueIntegrityChallenge,
  verifyIntegrityAsync,
  verifyIntegrityToken,
  type IntegrityContext,
} from './integrity';
import { haversineKm } from './geo';
import { MockChainAdapter, type ChainAdapter } from './chain';
import { registerMarket } from './market';
import { registerCommunity } from './community';
// 배포 코스 목록의 단일 진실 원천 — /courses와 발행 라우트가 같은 함수를 본다.
import { distributedCourses } from './courses';
import { registerGuestbook } from './guestbook';
import { registerRatings } from './ratings';
import { registerCompanions } from './companions';
import { registerTreasures, treasureTransparency } from './treasure';
import { registerSpotTreasures, spotTransparency } from './spotTreasure';
import { registerSync } from './sync';
import { registerBackup } from './backup';
import { registerTrust, trustSummariesFor } from './trust';

export const PROMO_KEY_ID = 'promo-angel-2026';
export const CLAIM_KEY_ID = 'community-claim-2026';
export const REWARD_KEY_ID = 'community-reward-2026';
/** 보물 마이닝 발행 키 ID (M9) — 기간·수량 한정, 투명성 공시 대상 (T-3). */
export const TREASURE_KEY_ID = 'promo-treasure-2026';
/** 회원 증서 발행 루트 키 ID — 지갑이 신뢰 루트로 핀한다 (보안 감사 C-2). */
export const MEMBERSHIP_ROOT_KEY_ID = 'membership-root-2026';
/** 배포 서명 키 ID — 신뢰 발행 키 목록·소명 목록·코스 데이터 서명 (보안 감사 H-3). */
export const DISTRIBUTION_KEY_ID = 'distribution-2026';
/**
 * 첫 접대 증빙 코인의 최소 금액 (dSHV) — 권장 가격표에서 역산 (④ 금액 하한).
 *
 * 증빙 요건이 "타인이 만든 코인 1개를 이전받아 보유"뿐이어서, 0.1 SHV(1 dSHV)짜리
 * 코인 하나로 30 SHV 보너스를 받을 수 있었다. 하한의 근거는 권장 가격표
 * (RECOMMENDED_PRICES_DSHV: BED 100 / MEAL 50 / SHOWER 30 / FULL_PACKAGE 180)에서
 * **가장 싼 접대인 샤워 30 dSHV(3 SHV)**다 — 실제로 접대를 했다면 최소한 그만큼은
 * 받았을 것이므로, 그 아래는 접대의 증빙이 될 수 없다.
 *
 * ★잠자리(100)·풀패키지(180)로 올리지 않는 이유: 샤워만 내어주는 엔젤도 똑같은
 *  순환의 참여자다(제7조). 하한을 높이면 가장 소박한 접대를 한 사람이 보너스를 받지
 *  못한다 — 막는 것보다 배제하는 것이 커진다. 방어의 목적은 "0.1 SHV 증빙" 차단이지
 *  접대의 크기를 심사하는 것이 아니다(제9조 불간섭).
 */
export const HOSTING_EVIDENCE_MIN_DSHV = RECOMMENDED_PRICES_DSHV.SHOWER;
const OTP_TTL_MS = 10 * 60 * 1000;
/** 회원 증서 유효기간 — 만료 전 갱신으로 무결성 재확인 강제 (30일). */
const MEMBERSHIP_CERT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AppOptions {
  dbPath?: string;
  /** 엔젤 등록 보너스 수량 한정 (확정 파라미터: 기간·수량 한정 — 기본 500가정). */
  registrationQuota?: number;
  /**
   * 첫 접대 보너스 수량 한정 — 등록 보너스와 **같은 방식·같은 주입 경로**.
   * 확정 파라미터가 "등록 20 + 첫 접대 30 SHV (기간·수량 한정)"인데 첫 접대에만
   * quota가 없어 코드와 주석이 어긋나 있었다(제3조 정직화). 기본값은 등록과 동일한
   * 500명분 — 다니엘 쌤이 다른 수를 정하시면 이 옵션으로 주입한다.
   */
  firstHostingQuota?: number;
  /** 개발 모드: OTP 코드를 응답에 포함 (실 SMS 발송은 운영 연동 항목). */
  devMode?: boolean;
  /** 스테이블코인 체인 어댑터 — 체인 확정(결정 대기 1번) 전까지 Mock. */
  chain?: ChainAdapter;
  /** 마켓 수수료 (bp). 제안 250 = 2.5% — 결정 대기 5번. */
  feeBps?: number;
  /** 코스 공식 승격 기준 완주 인원 (지시서: 100명). */
  promotionThreshold?: number;
  /** 클레임 인정 투표 기준 인원 (제안 5명 — 결정 대기 8번). */
  claimVoteThreshold?: number;
  /** 1인당 클레임 월 한도 (제안 2회 — 결정 대기 8번). */
  claimMonthlyLimit?: number;
  /**
   * 발행 개인키 봉인 KEK 직접 주입 (보안 감사 H-2). 지정 시 SHVIL_KEK 환경변수보다
   * 우선한다. 테스트가 devMode=false 서버를 환경변수 오염 없이 세우기 위한 용도 —
   * 운영은 이 값을 코드로 넘기지 말고 SHVIL_KEK 환경변수로 주입한다.
   */
  kek?: string;
  /**
   * R-스팟-현장결속: 걸음당 최소 소요 시간(ms). 기본은 운영 상수(0.3초/걸음).
   * 테스트가 실시간 대기 없이 현장 결속 흐름을 검증하기 위한 주입 지점이다 —
   * 운영은 이 값을 넘기지 않는다(기본값이 물리적 하한).
   */
  presenceMinMsPerStep?: number;
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
  /** M6 예약 (R-3): 자발 공개 "지금 손님 받기 가능" 여부 + 갱신 시각. */
  available: number;
  availability_updated_at: number | null;
}

function phoneHash(phone: string): string {
  return sha256Hex(`shvil-phone|${phone.replace(/[^0-9+]/g, '')}`);
}

function rawBodyOf(req: FastifyRequest): string {
  return (req as FastifyRequest & { rawBody?: string }).rawBody ?? '';
}

/** 잠자리 유형별 수용 인원 한도 — 1~20 정수만 저장 (0/미지정 = 미제공). */
const BED_COUNT_MAX = 20;

/**
 * services 방어 검증 (2026-07-15 — 잠자리 복수 선택): 클라이언트를 신뢰하지
 * 않으므로 services.beds는 room/sofa/tent의 정수 1~20만 남기고 나머지는
 * 버린다. 유효한 항목이 하나도 없으면 beds 자체를 제거한다 (옛 레코드와 동일한
 * 폴백 경로). beds 외 필드는 그대로 통과 — 기존 계약(bed/internet/shower/meal) 유지.
 */
function sanitizeServices(services: unknown): unknown {
  if (services === null || typeof services !== 'object' || Array.isArray(services)) {
    return services ?? {};
  }
  const s = services as Record<string, unknown>;
  if (s.beds === undefined) return services;
  const { beds, ...rest } = s;
  const clean: Record<string, number> = {};
  if (beds !== null && typeof beds === 'object' && !Array.isArray(beds)) {
    for (const kind of ['room', 'sofa', 'tent'] as const) {
      const v = (beds as Record<string, unknown>)[kind];
      if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= BED_COUNT_MAX) {
        clean[kind] = v;
      }
    }
  }
  return Object.keys(clean).length > 0 ? { ...rest, beds: clean } : rest;
}

export function buildApp(
  options: AppOptions = {},
): FastifyInstance & { db: DatabaseSync; chain: ChainAdapter } {
  const db = createDb(options.dbPath ?? ':memory:');
  const quota = options.registrationQuota ?? 500;
  // 첫 접대 보너스도 수량 한정 — 등록과 같은 기본값(500명분).
  const firstHostingQuota = options.firstHostingQuota ?? 500;
  // 보안 감사 C-1: 기본 false. dev 전용 라우트(devCode 반환·dev-deposit·소명 수동
  // 등재)는 devMode에서만 등록된다. 운영은 환경변수로 명시하지 않는 한 꺼진다.
  const devMode = options.devMode ?? false;
  const chain = options.chain ?? new MockChainAdapter();

  // 발행 서명 키들 — 프로모션(엔젤 보너스)·클레임·격려 코인·회원 증서 루트.
  // 전부 기간·수량/규칙 한정 발급 키이며, 지갑들은 GET /keys로 신뢰 목록에 넣는다.
  // 보안 감사 H-2: 개인키는 KEK로 봉인해 저장한다(평문 저장 금지). KEK는 DB에 없다.
  const keystore = new SealedKeystore(db, devMode, options.kek);
  const promoSigner = keystore.loadOrCreateSigner('promoKey');
  const claimSigner = keystore.loadOrCreateSigner('claimKey');
  const rewardSigner = keystore.loadOrCreateSigner('rewardKey');
  // 보물 발행 키 (M9) — 기존 promo 키 패턴과 동일하게 KEK로 봉인 저장.
  const treasureSigner = keystore.loadOrCreateSigner('treasureKey');
  // 스팟 보물 리저브 키 (M12) — 예치 코인의 소각 수령 주소. 이 키는 절대 서명·소비하지
  // 않는다(코인은 리저브에 영구 봉인=소각). 공개키(주소)만 사용된다. KEK로 봉인 저장.
  const spotReserveSigner = keystore.loadOrCreateSigner('spotReserveKey');
  // 회원 증서 루트 키 — 회원 번호↔기기 공개키를 결속 서명한다 (보안 감사 C-2).
  const membershipRootSigner = keystore.loadOrCreateSigner('membershipRootKey');
  // 배포 서명 키 — /keys·/courses·/limits/flagged 응답 본문에 _sig를 붙여 MITM의
  // 발행키 교체·소명 목록 조작·코스 주입을 차단한다 (보안 감사 H-3). KEK로 봉인 저장.
  const distSigner = keystore.loadOrCreateSigner('distKey');

  /** 무결성 검증 통과 시 회원 번호↔기기 키를 결속한 증서를 발급한다. */
  function issueMembershipCertificate(
    memberId: string,
    devicePublicKey: string,
    integrityToken: string | undefined,
    platform: string | undefined,
    now: number,
    /** 실검증(Play Integrity) 결과 — 비동기 경로에서 미리 판정해 넘긴다. */
    verifiedLevel?: IntegrityLevel,
  ): MembershipCertificate {
    const integrity = verifiedLevel ?? verifyIntegrityToken(platform, integrityToken, devMode);
    return buildMembershipCertificate(
      {
        memberId,
        devicePublicKey,
        integrity,
        issuedAt: now,
        expiresAt: now + MEMBERSHIP_CERT_TTL_MS,
        issuerKeyId: MEMBERSHIP_ROOT_KEY_ID,
      },
      membershipRootSigner,
    );
  }

  const app = Fastify({ logger: false });

  // CORS — shvilangel.org / shvilist.org 웹이 공개 API를 소비한다.
  app.addHook('onRequest', (req, reply, done) => {
    reply.header('access-control-allow-origin', '*');
    reply.header(
      'access-control-allow-headers',
      `content-type, ${AUTH_HEADER_MEMBER}, ${AUTH_HEADER_TS}, ${AUTH_HEADER_SIG}`,
    );
    reply.header('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
      void reply.code(204).send();
      return;
    }
    done();
  });

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

  /**
   * 기기 무결성 컨텍스트 (보안 감사 C-2 실연동).
   * playConfig는 환경변수에서 읽는다(미설정이면 UNVERIFIED로 폴백 — fail-closed).
   * requirePlayRecognized는 Play Store 배포 후 단계에서 켠다 (sideload에서는 정상적으로
   * UNRECOGNIZED_VERSION이 나오므로 닫힌 시험 중에는 끈다).
   */
  const integrityCtx: IntegrityContext = {
    db,
    devMode,
    requirePlayRecognized: process.env.SHVIL_REQUIRE_PLAY_RECOGNIZED === '1',
  };

  /**
   * 무결성 챌린지 발급 — 기기가 이 값으로 nonce를 만들어 Play Integrity 토큰을 받는다.
   * 비인증 라우트다(가입 전에도 필요). 챌린지는 기기 공개키에 결속되고 1회만 쓰인다.
   */
  app.post('/auth/integrity-challenge', async (req, reply) => {
    const body = req.body as { devicePublicKey?: string } | null;
    if (!body?.devicePublicKey || !/^[0-9a-f]{64}$/i.test(body.devicePublicKey)) {
      return reply.code(400).send({ error: 'devicePublicKey required' });
    }
    const challenge = randomBytes(32).toString('base64url');
    const issued = issueIntegrityChallenge(integrityCtx, body.devicePublicKey, challenge, Date.now());
    // 기기가 nonce를 스스로 계산할 수 있도록 챌린지만 준다 (nonce = H(challenge|devicePubKey)).
    return { challenge: issued.challenge, expiresAt: issued.expiresAt };
  });

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
      integrityToken?: string;
      platform?: string;
      /** 무결성 챌린지 (POST /auth/integrity-challenge로 발급받은 값). */
      integrityChallenge?: string;
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

    // 회원 증서 발급 — 회원 번호↔기기 키 결속 (보안 감사 C-2). 무결성 미제출/미검증
    // 기기도 UNVERIFIED 증서를 받되, 수신 지갑 정책이 그 수준을 거부·보류한다.
    // 운영에서는 Play Integrity 실검증 결과를 각인한다 (챌린지·nonce 대조 포함).
    const regVerdict = await verifyIntegrityAsync(integrityCtx, {
      platform: body.platform,
      token: body.integrityToken,
      devicePublicKey: body.devicePublicKey,
      challenge: body.integrityChallenge,
    });
    const membershipCertificate = issueMembershipCertificate(
      memberId,
      body.devicePublicKey,
      body.integrityToken,
      body.platform,
      Date.now(),
      regVerdict.level,
    );
    return { memberId, membershipCertificate };
  });

  // ── 회원 증서 갱신 (만료 전 무결성 재확인 — 보안 감사 C-2) ──────
  // 서명 인증된 회원의 등록 기기 키로 새 증서를 발급한다. 재발급이 항상 가능하므로
  // 증서는 서버에 저장하지 않는다 — 회원 번호↔기기 키는 members 테이블이 원본이다.
  app.post('/auth/certificate', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const body =
      (req.body as { integrityToken?: string; platform?: string; integrityChallenge?: string } | null) ?? {};
    const renewVerdict = await verifyIntegrityAsync(integrityCtx, {
      platform: body.platform,
      token: body.integrityToken,
      devicePublicKey: member.device_public_key,
      challenge: body.integrityChallenge,
    });
    const membershipCertificate = issueMembershipCertificate(
      member.member_id,
      member.device_public_key,
      body.integrityToken,
      body.platform,
      Date.now(),
      renewVerdict.level,
    );
    return { membershipCertificate };
  });

  // ── 코스 데이터 배포 (원본: shvilist.org 코스 등록부 — M4 연동) ──

  app.get('/courses', async () =>
    // 배포 서명(_sig) 부착 (보안 감사 H-3). 기존 소비자는 {courses}만 읽어 하위 호환.
    signDistribution(
      // 기본 코스 + 코스 등록부에서 공식 승격된 코스 (지시서 6장 3절).
      // ★이 목록이 곧 "서버가 아는 코스"다 — 발행 라우트(/certificates·/claims)의
      // 코스 대조도 같은 함수(courses.ts)를 본다. 어긋나면 앱에 보이는 코스인데
      // 서버가 거부하는 상황이 생겨 정직한 사용자가 막힌다.
      { courses: distributedCourses(db) },
      distSigner,
      DISTRIBUTION_KEY_ID,
      Date.now(),
    ),
  );

  /**
   * 세계 트레일 지역 카탈로그 (다니엘 쌤 방향 — 150개국 확장).
   * 이스라엘 국립 트레일이 먼저 런칭(LIVE), 세계 대표 트레일은 확장 예정.
   * 배포 서명 부착 (H-3). 지갑·웹이 지역 선택 메뉴에 쓴다.
   */
  app.get('/regions', async () =>
    signDistribution(
      { regions: WORLD_TRAILS, targetCountryCount: TARGET_COUNTRY_COUNT },
      distSigner,
      DISTRIBUTION_KEY_ID,
      Date.now(),
    ),
  );

  // ── 기존 트레일 엔젤 명단 (INT 커뮤니티 공개 명단 — 참고용) ─────────
  // ★쉬빌 회원이 아니다: 회원 번호·E2E·코인 수령 없음. 클라이언트는 쉬빌 엔젤
  // 디렉토리와 절대 섞지 말고 "기존 트레일 엔젤(참고)"로 구분 표시한다.
  // 데이터 성격·출처·삭제 정책은 @shvil/shared legacyAngels.ts 주석 참조.
  // 응답은 정적 데이터뿐 — details는 원문(영어 사용자 콘텐츠)이고 서버가 만든
  // 자연어 문구는 없다 (noUiStrings — 라벨은 각 클라이언트 사전 몫).
  app.get('/legacy-angels', async () => ({
    source: INT_TRAIL_ANGELS_SOURCE,
    updatedAt: INT_TRAIL_ANGELS_UPDATED,
    regions: INT_TRAIL_ANGEL_REGIONS,
    angels: INT_TRAIL_ANGELS,
  }));

  // ── 엔젤 디렉토리 ──────────────────────────────────────────────

  app.get('/angels', async (req) => {
    const q = req.query as { lat?: string; lon?: string; radiusKm?: string; region?: string };
    // 지역(트레일) 필터 — 150개국 확장. 미지정 시 전체.
    const rows = (
      q.region
        ? db.prepare(
            `SELECT a.*, m.messaging_public_key, m.device_public_key FROM angels a
             JOIN members m ON m.member_id = a.member_id WHERE a.visible = 1 AND a.region_id = ?`,
          ).all(q.region)
        : db.prepare(
            `SELECT a.*, m.messaging_public_key, m.device_public_key FROM angels a
             JOIN members m ON m.member_id = a.member_id WHERE a.visible = 1`,
          ).all()
    ) as unknown as (AngelRow & { messaging_public_key: string; device_public_key: string; region_id: string })[];

    const origin =
      q.lat !== undefined && q.lon !== undefined
        ? { lat: Number(q.lat), lon: Number(q.lon) }
        : null;
    const radiusKm = q.radiusKm !== undefined ? Number(q.radiusKm) : 50;

    // C 신뢰 지표: 엔젤이 자발 공개한 완주·접대 실적 뱃지 (미공개면 키 없음 → null).
    // 손님이 "검증된 실적 있는 엔젤"을 위조 없이 고르는 근거 (검증가능신뢰_설계 §2).
    const trust = trustSummariesFor(db, rows.map((r) => r.member_id));

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
          // R-3: 서버가 공개하는 것은 가능 여부 + 갱신 시각뿐 — 날짜·캘린더 없음.
          available: r.available === 1,
          availabilityUpdatedAt: r.availability_updated_at,
          regionId: r.region_id,
          messagingPublicKey: r.messaging_public_key,
          devicePublicKey: r.device_public_key,
          trust: trust[r.member_id] ?? null,
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
      /** services.beds = 잠자리 유형별 수용 인원 (room/sofa/tent 정수 1~20) — 아래에서 방어 검증. */
      services?: unknown;
      capacity?: number;
      conditions?: string;
      visible?: boolean;
      /** M6 예약 (R-3): "지금 손님 받기 가능" 자발 공개 — 선택. 미지정 시 기존 값 유지. */
      available?: boolean;
      /** 소속 트레일 지역 (150개국 확장). 미지정 시 이스라엘(현재 유일 LIVE). */
      regionId?: string;
    } | null;
    if (!body?.name || typeof body.location?.lat !== 'number' || typeof body.location?.lon !== 'number') {
      return reply.code(400).send({ error: 'name and location required' });
    }
    // LIVE 지역만 엔젤 등록 허용 — 아직 안 열린 트레일엔 등록 불가.
    const regionId = body.regionId ?? 'israel-national';
    if (!liveRegions().some((r) => r.regionId === regionId)) {
      return reply.code(400).send({ error: `region '${regionId}' is not open yet` });
    }

    // R-4 (2026-07-14 확정): 서버는 엔젤의 정확한 좌표를 아예 저장하지 않는다.
    // 지갑이 전송 전에 눈금화하지만, 클라이언트를 신뢰하지 않으므로 여기서
    // 방어적으로 다시 ~1km 눈금(0.01°)으로 반올림한다 (이중 방어).
    const snapped = snapToPrivacyGrid(body.location.lat, body.location.lon);

    const prev = db
      .prepare('SELECT available, availability_updated_at FROM angels WHERE member_id = ?')
      .get(member.member_id) as { available: number; availability_updated_at: number | null } | undefined;
    const isNew = prev === undefined;
    // R-3: available 필드가 명시된 경우에만 갱신 시각을 새로 찍는다 (자발 공개 갱신).
    const available = body.available === undefined ? (prev?.available ?? 1) : body.available ? 1 : 0;
    const availabilityUpdatedAt =
      body.available === undefined ? (prev?.availability_updated_at ?? null) : Date.now();
    db.prepare(
      `INSERT OR REPLACE INTO angels
        (member_id, name, lat, lon, services_json, capacity, conditions, visible, region_id,
         available, availability_updated_at, registered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT registered_at FROM angels WHERE member_id = ?), ?))`,
    ).run(
      member.member_id,
      body.name,
      snapped.lat,
      snapped.lon,
      JSON.stringify(sanitizeServices(body.services)),
      body.capacity ?? 1,
      body.conditions ?? null,
      body.visible === false ? 0 : 1,
      regionId,
      available,
      availabilityUpdatedAt,
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
    // 수량 한정 (③) — 등록 보너스와 같은 방식. ★증빙 소모(hosting_evidence 등재) 전에
    // 검사한다: 소진된 뒤 제출한 정직한 엔젤의 증빙 코인이 헛되이 잠기면 안 된다.
    if (grantCount('FIRST_HOSTING') >= firstHostingQuota) {
      return reply
        .code(409)
        .send({ error: 'first hosting bonus quota exhausted', code: 'FIRST_HOSTING_QUOTA_EXHAUSTED' });
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
    // 금액 하한 (④) — 권장 가격표의 가장 싼 접대(샤워 3 SHV) 미만은 증빙이 될 수 없다.
    // 상세 근거는 HOSTING_EVIDENCE_MIN_DSHV 주석.
    if (coin.amountDshv < HOSTING_EVIDENCE_MIN_DSHV) {
      return reply.code(400).send({
        error: `coin evidence is below the minimum (${HOSTING_EVIDENCE_MIN_DSHV} dSHV = cheapest recommended service)`,
        code: 'EVIDENCE_BELOW_MINIMUM',
        minAmountDshv: HOSTING_EVIDENCE_MIN_DSHV,
      });
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

  /** 신뢰 발행 키 전체 목록 — 지갑이 캐시해 GRANT 계보 검증에 사용. 배포 서명(_sig). */
  app.get('/keys', async () =>
    signDistribution(
      {
        keys: [
          { keyId: PROMO_KEY_ID, publicKey: promoSigner.publicKeyHex, purpose: 'ANGEL_BONUS' },
          { keyId: CLAIM_KEY_ID, publicKey: claimSigner.publicKeyHex, purpose: 'COMMUNITY_CLAIM' },
          { keyId: REWARD_KEY_ID, publicKey: rewardSigner.publicKeyHex, purpose: 'COMMUNITY_REWARD' },
          // 보물 발행 키 (M9) — 지갑이 TREASURE 계보 grant 검증에 사용.
          { keyId: TREASURE_KEY_ID, publicKey: treasureSigner.publicKeyHex, purpose: 'TREASURE' },
          // 회원 증서 신뢰 루트 — 지갑이 핀해 수신 코인의 회원 증서를 검증 (보안 감사 C-2).
          { keyId: MEMBERSHIP_ROOT_KEY_ID, publicKey: membershipRootSigner.publicKeyHex, purpose: 'MEMBERSHIP_ROOT' },
          // 배포 서명 공개키 — 지갑이 TOFU 핀 후 자기 일관성 확인용 (핀 기준은 _sig.distPublicKey).
          { keyId: DISTRIBUTION_KEY_ID, publicKey: distSigner.publicKeyHex, purpose: 'DISTRIBUTION' },
        ],
      },
      distSigner,
      DISTRIBUTION_KEY_ID,
      Date.now(),
    ),
  );

  /** 투명성 페이지 데이터 — 프로모션 발행 현황 공시 (지시서 2.4, 5장).
   *  보물(M9) 집계 포함 — 발행 수·총량 (T-3: 총량·기간 공시, 숫자만). */
  app.get('/transparency/promo', async () => ({
    registrationIssued: grantCount('REGISTRATION'),
    firstHostingIssued: grantCount('FIRST_HOSTING'),
    registrationQuota: quota,
    // 첫 접대도 수량 한정임을 공시한다 — 상한이 있다는 사실이 공개되지 않으면
    // "기간·수량 한정"이라는 말만 남는다 (제3조).
    firstHostingQuota,
    ...treasureTransparency(db),
    // 스팟 보물 (M12) — 예치 총액·발행 총액·발행 수. 발행 ≤ 예치(총량 보존)를 공시로 확인 가능.
    ...spotTransparency(db),
  }));

  const trustedIssuerKeys = {
    [PROMO_KEY_ID]: promoSigner.publicKeyHex,
    [CLAIM_KEY_ID]: claimSigner.publicKeyHex,
    [REWARD_KEY_ID]: rewardSigner.publicKeyHex,
    [TREASURE_KEY_ID]: treasureSigner.publicKeyHex,
  };

  /**
   * C 신뢰 지표(안 A) 검증 크레딧 정책 — 어떤 걷기 코인을 "실적"으로 인정할지.
   * 운영에서는 무결성 증서(VERIFIED)를 요구한다: **인증된 앱에서 생성된 걷기 코인만**
   * 뱃지가 된다 (결정 대기 3번 필수화 확정과 동일 기준). 개발·테스트에서는 모의 증서가
   * 없는 코인으로도 흐름을 검증할 수 있게 완화한다 — devMode는 운영에서 꺼져 있다(C-1).
   */
  const trustCredit = {
    trustedIssuerKeys,
    trustedRootKeys: { [MEMBERSHIP_ROOT_KEY_ID]: membershipRootSigner.publicKeyHex },
    requireIntegrity: !devMode,
  };

  // ── 코인 마켓 + 에스크로 (M3) ─────────────────────────────────
  registerMarket(app, {
    db,
    authenticate,
    chain,
    feeBps: options.feeBps ?? 250,
    devMode,
    trustedIssuerKeys,
  });

  // ── 커뮤니티: 코스 등록부·클레임·격려 코인·탑 100·소명 목록 (M4) ──
  registerCommunity(app, {
    db,
    authenticate,
    claimSigner,
    claimKeyId: CLAIM_KEY_ID,
    rewardSigner,
    rewardKeyId: REWARD_KEY_ID,
    // 배포 서명 키 — /limits/flagged 응답에 _sig 부착 (보안 감사 H-3).
    distSigner,
    distKeyId: DISTRIBUTION_KEY_ID,
    promotionThreshold: options.promotionThreshold ?? 100,
    claimVoteThreshold: options.claimVoteThreshold ?? 5,
    claimMonthlyLimit: options.claimMonthlyLimit ?? 2,
    claimWindowMs: 24 * 60 * 60 * 1000,
    devMode,
  });

  // ── 게스트북 (M7-A): 엔젤이 받은 감사 카드를 자발 공개 게시 ────────
  // 서버는 E2E 원본 카드를 못 본다 — 엔젤 서명으로 인증된 자발 게시만 신뢰한다
  // (신뢰 모델 상세는 guestbook.ts 주석). 공개 조회는 닉네임만, 회원 번호 비노출.
  registerGuestbook(app, { db, authenticate });

  // ── 상호 별점 (M7-B): 피평가자가 받은 별점을 자발 공개 게시 ─────────
  // 게스트북과 같은 신뢰 모델 (안 B). 서버는 E2E 서명 별점 원본을 못 본다 —
  // 피평가자 서명으로 인증된 자발 게시만 신뢰한다. ★프라이버시 핵심: 이 라우트
  // 어디에도 "평가자↔피평가자 관계"를 저장하는 필드가 없다 — 서버는 투숙 관계를
  // 모른다 (평가자는 닉네임만, 관계 증명은 게시 본문에 받지 않는다). ratings.ts 주석.
  registerRatings(app, { db, authenticate });

  // ── 동행 찾기 게시판 (M8): 여정 공유 + 팀 모집 ────────────────────
  // 게스트북·별점과 같은 자발 공개 모델 + 엔젤 디렉토리와 같은 연락 핸들 공개.
  // ★서버는 게시글까지만 안다 — "누가 누구와 팀"이라는 확정 팀 관계를 저장하는
  // 필드가 없다. 관심 표명·팀 조율은 전부 E2E 메시지다 (companions.ts 신뢰 모델).
  // C 신뢰 지표: 게시자가 공개(disclose)한 완주·검증실적 뱃지를 카드에 함께 실어
  // "마음 맞는 경험자와 팀"을 위조 없이 고르게 한다 (검증가능신뢰_설계 §2·§4).
  registerCompanions(app, { db, authenticate });

  // ── 검증 가능한 신뢰 지표 (C — 별점 대신 사실): /trust 조회·자발 공개 ──
  // 위조가 어려운 사실(커뮤니티 인정 완주·검증된 걷기 실적·활동 기간)을 뱃지·
  // 숫자·일자로만 반환한다. 본인이 공개를 선택해야만 노출된다(trust.ts 게이트).
  // ★안 A: 걷기 실적은 서버가 verifyCoin으로 직접 검증한 코인만 집계한다 — 조작
  // 지문(/sync/coins)은 서명이 없어 뱃지에 영향을 주지 못한다.
  registerTrust(app, { db, authenticate, credit: trustCredit });

  // ── 보물 마이닝 (M9): 명세 배포 + 수량 한정 발행 회계 ─────────────
  // 이동 검증은 100% 폰 로컬 — 서버는 걸음·방향·좌표를 받지 않는다.
  registerTreasures(app, {
    db,
    authenticate,
    treasureSigner,
    treasureKeyId: TREASURE_KEY_ID,
    distSigner,
    distKeyId: DISTRIBUTION_KEY_ID,
    devMode,
  });

  // ── 스팟 보물 (M12): 사업자 예치(소각) → 서버 선착순 재배포 ────────
  // 무기명 베어러 금지(M10 폐기). 발행 키는 기존 TREASURE 키 재사용 — 발행이
  // 예치를 넘지 못하도록 슬롯 수를 예치에서 유도한다(총량 보존 불변식).
  registerSpotTreasures(app, {
    db,
    authenticate,
    spotSigner: treasureSigner,
    spotKeyId: TREASURE_KEY_ID,
    reserveSigner: spotReserveSigner,
    distSigner,
    distKeyId: DISTRIBUTION_KEY_ID,
    trustedIssuerKeys,
    // C 신뢰 지표(안 A): 예치된 남의 걷기 코인을 그 생산자의 검증 실적으로 적재.
    credit: trustCredit,
    // ★V-3: 예치 소각 코인을 sync와 동일한 초과생성 탐지에 연결한다 (fake-walk 세탁 차단).
    dailyMaxDshv: 400, // 확정 파라미터: 일 40 SHV
    weeklyMaxDshv: 3000, // 확정: 주 300 SHV
    // R-스팟-현장결속: 현장 수행 최소 소요 시간 (미지정 시 운영 기본 0.3초/걸음).
    ...(options.presenceMinMsPerStep !== undefined
      ? { presenceMinMsPerStep: options.presenceMinMsPerStep }
      : {}),
  });

  // ── 기회적 동기화 — 이중지불·초과 생성 사후 탐지 (보안 감사 H-1) ──
  registerSync(app, {
    db,
    authenticate,
    dailyMaxDshv: 400, // 확정 파라미터: 일 40 SHV
    weeklyMaxDshv: 3000, // 확정: 주 300 SHV
  });

  // ── 암호화 지갑 백업 — 니모닉 복구 지원 (보안 감사 L-2, 지시서 2.3) ──
  registerBackup(app, { db, authenticate, maxSkewMs: 10 * 60 * 1000 });

  return Object.assign(app, { db, chain });
}
