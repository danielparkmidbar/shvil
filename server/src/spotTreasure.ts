/**
 * 스팟 보물 (M12 — docs/몸인증_보물마이닝_설계.md 4장).
 *
 * 사업자가 자기 사업장에 코인을 숨겨 손님을 유인한다. M10 무기명 벽-QR 바우처는
 * 두 차례 적대적 감사로 폐기됐다(무기명 베어러는 이중지불을 못 막는다). M12는 그
 * 실패를 피해 **서버 회계**로 간다 — M9(treasure.ts)와 같은 "수량 한정 발행 회계"이며
 * 거래 승인이 아니다(헌법 제9조 정합).
 *
 * 서버의 역할은 셋뿐이다:
 *  1. 예치(소각) 검증 (POST /spot/deposit): 사업자가 자기 코인을 보물 리저브로
 *     이전(소각)했음을 verifyCoin + 소유 + 미소비(coin_id UNIQUE)로 확인하고, 그
 *     동량을 스팟 예치 잔고(deposit_total_dshv)로 등록한다. **발행이 아니라 재배포**.
 *  2. 선착순 지급 회계 (POST /spot/claim): 유효기간·1인 1회·선착순 잔여를 확인하고
 *     TREASURE 그랜트(민팅은 폰)를 발행한다. 잔여는 예치에서 유도되므로 발행이
 *     예치를 넘을 수 없다(★총량 보존 불변식).
 *  3. 배포 (GET /spot): 맵 표시용 — **잔여 > 0인 것만**. 코인이 없으면 맵에 안 뜬다
 *     (다니엘 쌤 결정 2번). 위치는 사업장이라 공개(눈금화 없음).
 *
 * 도메인 오류는 자연어가 아니라 코드로 응답한다(noUiStrings — 문구는 클라이언트가 조립).
 * 무기명 베어러/QR에 비밀키는 절대 싣지 않는다 — QR은 spot_id만 담고 그랜트는 서버가
 * 인증된 회원에게만 발행한다.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import {
  buildGrant,
  coinFingerprint,
  isValidSpotTreasureSpec,
  signDistribution,
  spotHasRemaining,
  spotRemainingSlots,
  spotTotalSlots,
  verifySpotDeposit,
  type Coin,
  type Signer,
} from '@shvil/shared';
import { checkFork, checkOverproduction } from './anomaly';

/**
 * V-2 (적대적 검증) — /spot/deposit DoS 방어 상한.
 *  - 배열 길이: /sync/coins의 500보다 낮춘 100. 예치는 코인 하나마다 전체 계보를
 *    verifyCoin으로 검증하므로(분할이면 부모까지 재귀) sync 지문 대조보다 무겁다.
 *  - SPLIT 재귀 깊이: verifyCoin이 SPLIT 부모를 재귀 검증하므로, 악의적으로 깊게
 *    중첩된 SPLIT 계보는 검증을 폭주시킬 수 있다. 검증 전에 깊이를 잘라 막는다.
 *    (현실 분할 깊이는 잔돈 처리로 한 자릿수 — 32는 넉넉한 방어선이다.)
 */
export const SPOT_DEPOSIT_MAX_COINS = 100;
export const SPOT_DEPOSIT_MAX_SPLIT_DEPTH = 32;

/** SPLIT 계보 중첩 깊이가 max를 넘으면 true (재귀 없이 부모 사슬만 훑는다). */
function splitDepthExceeds(coin: Coin, max: number): boolean {
  let depth = 0;
  let c: Coin = coin;
  while (c.provenance.kind === 'SPLIT') {
    depth += 1;
    if (depth > max) return true;
    c = c.provenance.parent;
  }
  return false;
}

export interface SpotMemberRow {
  member_id: string;
  device_public_key: string;
}

export interface SpotContext {
  db: DatabaseSync;
  authenticate: (req: FastifyRequest) => SpotMemberRow | null;
  /** 스팟 발행 키 — 기존 보물(TREASURE) 발행 키 재사용 (몸인증_설계 재사용 지침). */
  spotSigner: Signer;
  spotKeyId: string;
  /** 보물 리저브 키 — 예치 코인의 소각 수령 주소(공개키). 절대 서명·소비하지 않는다. */
  reserveSigner: Signer;
  /** 배포 서명 키 — GET /spot 응답에 _sig 부착 (보안 감사 H-3). */
  distSigner: Signer;
  distKeyId: string;
  /** verifyCoin 신뢰 발행 키 (예치 코인 계보 검증용). */
  trustedIssuerKeys: Record<string, string>;
  /**
   * 인간 한계 (확정 파라미터, sync와 동일): 일 400 dSHV / 7일 3,000 dSHV.
   * ★V-3: 예치도 이 한계로 초과생성 탐지를 받는다 — fake-walk 세탁 차단 (아래 예치 참조).
   */
  dailyMaxDshv: number;
  weeklyMaxDshv: number;
  /**
   * V-1 완화 — 회원당 스팟 청구 버스트 상한 (원격 자동화 무력화용). 사람은 물리적으로
   * 창 안에 이만큼 다른 스팟을 스캔할 수 없으므로 정상 이용에는 보이지 않는다. Sybil
   * (계정 다수)·1인 원격 청구 자체는 막지 못한다 — 근본 완화는 R-스팟-현장결속(결정 대기).
   */
  claimRateWindowMs?: number;
  claimRateMaxPerWindow?: number;
}

interface SpotRow {
  spot_id: string;
  region_id: string;
  sponsor_member: string;
  display_name: string;
  lat: number;
  lon: number;
  per_claim_dshv: number;
  deposit_total_dshv: number;
  issued_count: number;
  valid_from: number;
  valid_until: number;
  status: string;
  created_at: number;
}

/** 스팟 요약(회계 파생값 포함) — 사업자 목록·응답 공용. */
function spotAccounting(row: SpotRow) {
  return {
    spotId: row.spot_id,
    regionId: row.region_id,
    sponsorMemberId: row.sponsor_member,
    displayName: row.display_name,
    location: { lat: row.lat, lon: row.lon },
    perClaimDshv: row.per_claim_dshv,
    // 규모(예치 총액)·선착순 인원(총 슬롯)·감소 양상(남은 수량) — 맵의 판단 정보.
    depositTotalDshv: row.deposit_total_dshv,
    totalSlots: spotTotalSlots(row.deposit_total_dshv, row.per_claim_dshv),
    remainingSlots: spotRemainingSlots(row.deposit_total_dshv, row.per_claim_dshv, row.issued_count),
    issuedCount: row.issued_count,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    status: row.status,
  };
}

export function registerSpotTreasures(app: FastifyInstance, ctx: SpotContext): void {
  const { db, authenticate } = ctx;
  const reservePublicKey = ctx.reserveSigner.publicKeyHex;

  const getSpot = (spotId: string) =>
    db.prepare('SELECT * FROM spot_treasures WHERE spot_id = ?').get(spotId) as SpotRow | undefined;

  // ── 스팟 생성 (사업자 서명) ─────────────────────────────────────
  // 예치 전 상태(deposit_total=0)로 등록된다 — 맵에는 뜨지 않는다(잔여 0).
  app.post('/spot', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const body = req.body as {
      spotId?: string;
      regionId?: string;
      displayName?: string;
      location?: { lat?: number; lon?: number };
      perClaimDshv?: number;
      validFrom?: number;
      validUntil?: number;
    } | null;
    const spec = {
      spotId: body?.spotId,
      regionId: body?.regionId,
      sponsorMemberId: member.member_id, // 서명자를 사업자로 결속 (클라이언트 신뢰 안 함)
      displayName: body?.displayName,
      location: body?.location,
      perClaimDshv: body?.perClaimDshv,
      validFrom: body?.validFrom,
      validUntil: body?.validUntil,
    };
    if (!isValidSpotTreasureSpec(spec)) return reply.code(400).send({ error: 'INVALID_SPOT_SPEC' });
    if (getSpot(spec.spotId)) return reply.code(409).send({ error: 'SPOT_ID_TAKEN' });

    db.prepare(
      `INSERT INTO spot_treasures
        (spot_id, region_id, sponsor_member, display_name, lat, lon, per_claim_dshv,
         deposit_total_dshv, issued_count, valid_from, valid_until, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 'OPEN', ?)`,
    ).run(
      spec.spotId,
      spec.regionId,
      member.member_id,
      spec.displayName,
      spec.location.lat,
      spec.location.lon,
      spec.perClaimDshv,
      spec.validFrom,
      spec.validUntil,
      Date.now(),
    );
    // reservePublicKey를 함께 준다 — 사업자 지갑이 예치 소각 이전을 이 주소로 만든다.
    return { spotId: spec.spotId, created: true, reservePublicKey };
  });

  // ── 예치(충전) — 사업자가 자기 코인을 리저브로 소각한 만큼 잔고 등록 ──
  app.post('/spot/deposit', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const body = req.body as { spotId?: string; coins?: Coin[] } | null;
    if (typeof body?.spotId !== 'string' || !Array.isArray(body.coins) || body.coins.length === 0) {
      return reply.code(400).send({ error: 'SPOT_DEPOSIT_FIELDS_REQUIRED' });
    }
    // V-2: 무제한 배열 DoS 방어 — 길이 상한(코드 에러, 자연어 금지).
    if (body.coins.length > SPOT_DEPOSIT_MAX_COINS) {
      return reply.code(400).send({ error: 'TOO_MANY_DEPOSIT_COINS' });
    }
    const row = getSpot(body.spotId);
    if (!row) return reply.code(404).send({ error: 'UNKNOWN_SPOT' });
    if (row.sponsor_member !== member.member_id) return reply.code(403).send({ error: 'NOT_SPOT_SPONSOR' });
    if (row.status !== 'OPEN') return reply.code(409).send({ error: 'SPOT_CLOSED' });
    const now = Date.now();
    if (now > row.valid_until) return reply.code(409).send({ error: 'SPOT_OUT_OF_VALIDITY' });

    // 각 코인: (a)진짜 코인 (b)사업자 소유 (c)리저브 소각 — 순수 함수로 검증.
    // (d)미소비(이중 예치): coin_id UNIQUE. 하나라도 실패하면 예치 전체를 거부한다.
    let depositedDshv = 0;
    const check = {
      sponsorPublicKey: member.device_public_key,
      reservePublicKey,
      verifyOptions: { trustedIssuerKeys: ctx.trustedIssuerKeys },
    };
    const accepted: { coinId: string; amountDshv: number; fp: ReturnType<typeof coinFingerprint> }[] = [];
    const seen = new Set<string>();
    for (const coin of body.coins) {
      // V-2: 검증 전에 SPLIT 재귀 깊이를 잘라 verifyCoin 폭주를 막는다.
      if (splitDepthExceeds(coin, SPOT_DEPOSIT_MAX_SPLIT_DEPTH)) {
        return reply.code(400).send({ error: 'DEPOSIT_COIN_TOO_DEEP' });
      }
      const verdict = verifySpotDeposit(coin, check);
      if (!verdict.valid) {
        return reply.code(400).send({ error: 'INVALID_DEPOSIT_COIN', reasons: verdict.reasons });
      }
      if (seen.has(coin.id) || db.prepare('SELECT 1 FROM spot_deposits WHERE coin_id = ?').get(coin.id)) {
        return reply.code(409).send({ error: 'COIN_ALREADY_DEPOSITED' });
      }
      seen.add(coin.id);
      accepted.push({ coinId: coin.id, amountDshv: verdict.amountDshv, fp: coinFingerprint(coin) });
      depositedDshv += verdict.amountDshv;
    }

    const limits = { dailyMaxDshv: ctx.dailyMaxDshv, weeklyMaxDshv: ctx.weeklyMaxDshv };
    for (const a of accepted) {
      // ★V-3 (적대적 검증 — 헌법 중요): 예치 소각 코인을 sync와 **동일한** 초과생성
      //   탐지 경로에 연결한다. 악성 사업자가 자가 서명 WALK 코인(금액 상한 없음)을
      //   민팅해 예치하면 진짜 TREASURE 계보로 재배포되는데(발행 우회 세탁), 이 검사가
      //   그 fake-walk 증명을 walk_proof_stats에 등재하고 생산자의 일/주 인간 한계
      //   초과를 포착해 소명 대기 등재한다 — 예치가 fake-walk 방어(sync 기반 탐지)를
      //   우회하는 조용한 세탁 경로가 되지 않게 한다. 목격 저장 **전에** 호출한다.
      checkFork(db, a.fp, now);
      // 예치자(사업자)를 목격자로 넘긴다 — 남의 걷기 코인을 예치하면 그 생산자의
      // 증명이 교차 목격으로 신뢰 실적 승격(C). 자가 민팅 fake-walk 예치는 생산자=
      // 예치자라 승격되지 않는다(V-3 세탁 방어와 같은 방향: 자기 코인은 실적 안 됨).
      checkOverproduction(db, a.fp, limits, now, member.member_id);

      db.prepare(
        'INSERT INTO spot_deposits (coin_id, spot_id, sponsor_member, amount_dshv, deposited_at) VALUES (?, ?, ?, ?, ?)',
      ).run(a.coinId, row.spot_id, member.member_id, a.amountDshv, now);
      // 사후 이중지불 탐지 강화(H-1): 소각 코인의 지문을 목격으로 남긴다. 사업자가
      // 같은 코인을 다른 곳에 이중 지불하면 같은 (coinId, chainLen)에 다른 소유자가
      // 나타나 분기로 포착돼 사업자가 소명 대기 등재된다.
      db.prepare(
        `INSERT OR IGNORE INTO coin_sightings
          (coin_id, chain_len, owner_address, last_from_address, producer_member, amount_dshv, root_kind, reporter_member, reported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        a.fp.coinId,
        a.fp.chainLen,
        a.fp.ownerAddress,
        a.fp.lastFromAddress ?? null,
        a.fp.producerMemberId,
        a.fp.amountDshv,
        a.fp.rootKind,
        member.member_id,
        now,
      );
    }
    db.prepare('UPDATE spot_treasures SET deposit_total_dshv = deposit_total_dshv + ? WHERE spot_id = ?').run(
      depositedDshv,
      row.spot_id,
    );

    const updated = getSpot(row.spot_id)!;
    return {
      spotId: row.spot_id,
      depositedDshv,
      depositTotalDshv: updated.deposit_total_dshv,
      totalSlots: spotTotalSlots(updated.deposit_total_dshv, updated.per_claim_dshv),
      remainingSlots: spotRemainingSlots(updated.deposit_total_dshv, updated.per_claim_dshv, updated.issued_count),
    };
  });

  // ── 선착순 지급 (스캐너=회원 서명) — 회계 1회 ──────────────────────
  // ★현장 결속 없음(V-1, 적대적 검증): 이 청구는 spotId만 알면 원격으로 가능하다 —
  //   서버는 스캐너가 실제로 스팟에 있는지 검증하지 않는다. 위치 증명 부재는 서버가
  //   위치를 볼 수 없다는 헌법 제9조 제약의 직접 귀결이다(GET /spot이 spotId·위치를
  //   공개하므로 스캔 없이도 청구 가능). 따라서 이 왕복은 "존 도착 인증"이 아니라
  //   수량 한정 발행의 회계일 뿐이다. 근본 완화(M9 몸-걸음 인증 결합)는 R-스팟-현장결속
  //   (다니엘 쌤 결정 대기). 아래는 원격 자동화만 무디게 하는 회원당 버스트 상한이다.
  app.post('/spot/claim', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const body = req.body as { spotId?: string } | null;
    if (typeof body?.spotId !== 'string') return reply.code(400).send({ error: 'SPOT_CLAIM_FIELDS_REQUIRED' });
    const row = getSpot(body.spotId);
    if (!row) return reply.code(404).send({ error: 'UNKNOWN_SPOT' });

    const now = Date.now();
    if (now < row.valid_from || now > row.valid_until) {
      return reply.code(409).send({ error: 'SPOT_OUT_OF_VALIDITY' });
    }
    if (row.status !== 'OPEN') return reply.code(409).send({ error: 'SPOT_CLOSED' });
    // 1인 1회 — 스캔 지급·스탬프 공용.
    if (db.prepare('SELECT 1 FROM spot_claims WHERE spot_id = ? AND member_id = ?').get(row.spot_id, member.member_id)) {
      return reply.code(409).send({ error: 'SPOT_ALREADY_CLAIMED' });
    }
    // V-1 완화: 회원당 청구 버스트 상한 (창 안 최근 청구 수 대조 — 기존 spot_claims.claimed_at
    // 재사용, 새 테이블 없음). 사람이 물리적으로 창 안에 이만큼 다른 스팟을 돌 수 없으므로
    // 정상 이용에는 보이지 않고, 1인 계정의 대량 원격 자동화만 무디게 한다. Sybil(계정
    // 다수)은 못 막는다 — 근본 완화는 R-스팟-현장결속(결정 대기). 상한/창은 컨텍스트 설정.
    const windowMs = ctx.claimRateWindowMs ?? 60_000;
    const maxPerWindow = ctx.claimRateMaxPerWindow ?? 30;
    const recent = db
      .prepare('SELECT COUNT(*) AS n FROM spot_claims WHERE member_id = ? AND claimed_at > ?')
      .get(member.member_id, now - windowMs) as { n: number };
    if (recent.n >= maxPerWindow) {
      return reply.code(429).send({ error: 'SPOT_CLAIM_RATE_LIMITED' });
    }

    const funded = spotHasRemaining(row.deposit_total_dshv, row.per_claim_dshv, row.issued_count);
    // 잔여 0이면서 이미 발행이 있었다면 선착순 소진(에러). 발행이 하나도 없으면
    // 미충전(코인 없음) — 위치 확인 스탬프만 준다(다니엘 쌤: "안 담으면 스탬프만").
    if (!funded && row.issued_count > 0) {
      return reply.code(409).send({ error: 'SPOT_EXHAUSTED' });
    }

    // amountDshv>0(잔여 있음) → TREASURE 그랜트 발행(민팅은 폰). 미충전 → 스탬프 기록만.
    const grant = funded
      ? buildGrant(
          {
            kind: 'TREASURE',
            memberId: member.member_id,
            amountDshv: row.per_claim_dshv,
            // 계보에 남는 근거: 스팟 ID + 회원(이동 원자료·좌표 아님).
            reference: `spot:${row.spot_id}:${member.member_id}`,
            recipientPublicKey: member.device_public_key,
            issuerKeyId: ctx.spotKeyId,
            issuedAt: now,
          },
          ctx.spotSigner,
        )
      : null;

    try {
      db.prepare('INSERT INTO spot_claims (spot_id, member_id, grant_json, claimed_at) VALUES (?, ?, ?, ?)').run(
        row.spot_id,
        member.member_id,
        grant ? JSON.stringify(grant) : null,
        now,
      );
    } catch {
      // UNIQUE(spot_id, member_id) 경합 — 위 검사와 동시 요청이 겹친 경우.
      return reply.code(409).send({ error: 'SPOT_ALREADY_CLAIMED' });
    }
    if (funded) {
      // ★총량 보존의 회계: 발행 수를 1 늘린다. 슬롯 수(=floor(예치/1인당))를 넘길 수
      //   없다 — 위 spotHasRemaining이 잔여 0이면 여기 오지 않는다.
      db.prepare('UPDATE spot_treasures SET issued_count = issued_count + 1 WHERE spot_id = ?').run(row.spot_id);
    }

    return grant
      ? { spotId: row.spot_id, amountDshv: row.per_claim_dshv, grant }
      : { spotId: row.spot_id, amountDshv: 0, stamp: true };
  });

  // ── 스팟 마감 (사업자 서명) — 남은 예치 소각분은 회수되지 않는다(소각) ──
  app.post('/spot/close', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const body = req.body as { spotId?: string } | null;
    if (typeof body?.spotId !== 'string') return reply.code(400).send({ error: 'SPOT_CLAIM_FIELDS_REQUIRED' });
    const row = getSpot(body.spotId);
    if (!row) return reply.code(404).send({ error: 'UNKNOWN_SPOT' });
    if (row.sponsor_member !== member.member_id) return reply.code(403).send({ error: 'NOT_SPOT_SPONSOR' });
    db.prepare("UPDATE spot_treasures SET status = 'CLOSED' WHERE spot_id = ?").run(row.spot_id);
    return { spotId: row.spot_id, status: 'CLOSED' };
  });

  // ── 맵 배포 (공개, 배포 서명) — 잔여 > 0인 것만 (코인 없으면 미표시) ──
  // ★정찰 위험(V-4, 적대적 검증): 이 공개 GET은 스팟 위치 + 예치 총액 + 잔여 슬롯을
  //   그대로 드러낸다 — 인증 없이 어디에 얼마가 남았는지 정찰할 수 있다. 이는 맵에서
  //   "걸어갈지 말지 결정"하게 하려는 다니엘 쌤 결정 2번의 직접 귀결(위치·규모 공개가
  //   기능 요건)이며, spotId 노출은 곧 원격 청구 가능성(V-1)과 이어진다. 남는 위험으로
  //   문서에 명시(몸인증_보물마이닝_설계 4장 R-스팟-현장결속) — 근본 완화는 결정 대기.
  app.get('/spot', async (req) => {
    const q = req.query as { region?: string };
    const now = Date.now();
    const rows = (
      q.region
        ? db
            .prepare(
              "SELECT * FROM spot_treasures WHERE region_id = ? AND status = 'OPEN' AND valid_from <= ? AND valid_until >= ?",
            )
            .all(q.region, now, now)
        : db
            .prepare("SELECT * FROM spot_treasures WHERE status = 'OPEN' AND valid_from <= ? AND valid_until >= ?")
            .all(now, now)
    ) as unknown as SpotRow[];
    const spots = rows
      .map(spotAccounting)
      // ★다니엘 쌤 결정 2번: 코인이 없으면(잔여 0) 맵에 표시하지 않는다.
      .filter((s) => s.remainingSlots > 0)
      .map((s) => ({
        spotId: s.spotId,
        regionId: s.regionId,
        displayName: s.displayName,
        location: s.location, // 사업장 — 공개 위치(눈금화 없음). 공개 수위는 다니엘 쌤 확인.
        perClaimDshv: s.perClaimDshv, // 1인당 규모
        totalSlots: s.totalSlots, // 선착순 인원
        remainingSlots: s.remainingSlots, // 감소 양상(남은 수량)
        depositTotalDshv: s.depositTotalDshv, // 규모
        validUntil: s.validUntil,
      }));
    // reservePublicKey를 함께 배포 — 사업자 지갑이 예치 소각 이전을 이 주소로 만든다.
    return signDistribution({ spots, reservePublicKey }, ctx.distSigner, ctx.distKeyId, now);
  });

  // ── 내 스팟 목록 (사업자 서명) — 미충전 포함 전체 + 회계 ──────────
  app.get('/spot/mine', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const rows = db
      .prepare('SELECT * FROM spot_treasures WHERE sponsor_member = ? ORDER BY created_at DESC')
      .all(member.member_id) as unknown as SpotRow[];
    return { spots: rows.map(spotAccounting), reservePublicKey };
  });
}

/** 투명성 공시용 집계 — 예치 총액·발행 총액·발행 수 (숫자만, T-3). */
export function spotTransparency(db: DatabaseSync): {
  spotDepositedDshv: number;
  spotIssuedDshv: number;
  spotIssuedCount: number;
} {
  const dep = db.prepare('SELECT COALESCE(SUM(amount_dshv), 0) AS d FROM spot_deposits').get() as { d: number };
  const iss = db
    .prepare('SELECT COALESCE(SUM(issued_count * per_claim_dshv), 0) AS d, COALESCE(SUM(issued_count), 0) AS n FROM spot_treasures')
    .get() as { d: number; n: number };
  return { spotDepositedDshv: dep.d, spotIssuedDshv: iss.d, spotIssuedCount: iss.n };
}
