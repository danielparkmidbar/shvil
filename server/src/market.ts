/**
 * 코인 마켓 + 에스크로 (지시서 5장 4절).
 *
 * 흐름: 엔젤 무정가 리스팅 → 구매자 가격 제시 → 엔젤 승인 → 에스크로:
 * 구매자 USDC 예치 확인 → 코인 이전(두 지갑의 서명 체인) → USDC 방출(수수료 차감).
 *
 * 서버의 역할은 에스크로 상태 관리뿐이다. SHV 이전 자체는 판매자의 지불 서명과
 * 구매자의 확인 서명으로 완결된다 — 서버는 두 서명 사이를 운반하고 상태를
 * 전이시킬 뿐, 이전을 승인하지 않는다.
 *
 * 수수료: 체결 시 2.5% 제안(결정 대기 5번) — 운영 재원. 대면 지불은 영구 무료.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import {
  addressFromPublicKey,
  currentOwnerAddress,
  verifyCoin,
  type Coin,
} from '@shvil/shared';
import { MockChainAdapter, type ChainAdapter } from './chain';

export interface MarketMemberRow {
  member_id: string;
  device_public_key: string;
}

export interface MarketContext {
  db: DatabaseSync;
  authenticate: (req: FastifyRequest) => MarketMemberRow | null;
  chain: ChainAdapter;
  /** 수수료 (basis points). 제안 250 = 2.5% — 결정 대기 5번. */
  feeBps: number;
  devMode: boolean;
  trustedIssuerKeys: Record<string, string>;
}

interface ListingRow {
  id: number;
  seller_member: string;
  amount_dshv: number;
  status: string;
  created_at: number;
}

interface OfferRow {
  id: number;
  listing_id: number;
  buyer_member: string;
  total_usdc_micro: number;
  status: string;
  created_at: number;
}

interface EscrowRow {
  id: number;
  offer_id: number;
  status: string;
  deposit_ref: string;
  coins_json: string | null;
  fee_usdc_micro: number;
  payout_address: string | null;
}

export function registerMarket(app: FastifyInstance, ctx: MarketContext): void {
  const { db, authenticate, chain, feeBps, devMode } = ctx;

  const getListing = (id: number) =>
    db.prepare('SELECT * FROM listings WHERE id = ?').get(id) as unknown as ListingRow | undefined;
  const getOffer = (id: number) =>
    db.prepare('SELECT * FROM offers WHERE id = ?').get(id) as unknown as OfferRow | undefined;
  const getEscrow = (id: number) =>
    db.prepare('SELECT * FROM escrows WHERE id = ?').get(id) as unknown as EscrowRow | undefined;
  const getMember = (memberId: string) =>
    db.prepare('SELECT member_id, device_public_key FROM members WHERE member_id = ?').get(memberId) as
      | unknown as MarketMemberRow
      | undefined;

  // ── 리스팅: 엔젤이 수량만 올린다. 가격은 정하지 않는다 (무정가). ──

  app.post('/market/listings', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    // 여행하지 않는 엔젤이 코인을 판다 — 판매자는 등록 엔젤이어야 한다 (지시서 0-8).
    if (!db.prepare('SELECT 1 FROM angels WHERE member_id = ?').get(member.member_id)) {
      return reply.code(403).send({ error: 'only registered angels can list coins' });
    }
    const body = req.body as { amountDshv?: number } | null;
    if (!body || !Number.isInteger(body.amountDshv) || body.amountDshv! <= 0) {
      return reply.code(400).send({ error: 'amountDshv (positive integer) required' });
    }
    const result = db
      .prepare("INSERT INTO listings (seller_member, amount_dshv, status, created_at) VALUES (?, ?, 'OPEN', ?)")
      .run(member.member_id, body.amountDshv!, Date.now());
    return { listingId: Number(result.lastInsertRowid) };
  });

  app.get('/market/listings', async () => {
    const rows = db
      .prepare(
        `SELECT l.*, a.name AS seller_name FROM listings l
         LEFT JOIN angels a ON a.member_id = l.seller_member
         WHERE l.status = 'OPEN' ORDER BY l.created_at DESC`,
      )
      .all() as unknown as (ListingRow & { seller_name: string | null })[];
    return {
      listings: rows.map((r) => ({
        listingId: r.id,
        sellerMemberId: r.seller_member,
        sellerName: r.seller_name,
        amountDshv: r.amount_dshv,
        createdAt: r.created_at,
        // 무정가 — 가격 필드는 존재하지 않는다. 구매자가 제시한다.
      })),
    };
  });

  // ── 가격 제시 (구매자) ─────────────────────────────────────────

  app.post('/market/listings/:id/offers', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const listing = getListing(Number((req.params as { id: string }).id));
    if (!listing || listing.status !== 'OPEN') return reply.code(404).send({ error: 'listing not open' });
    if (listing.seller_member === member.member_id) {
      return reply.code(400).send({ error: 'cannot offer on own listing' });
    }
    const body = req.body as { totalUsdcMicro?: number } | null;
    if (!body || !Number.isInteger(body.totalUsdcMicro) || body.totalUsdcMicro! <= 0) {
      return reply.code(400).send({ error: 'totalUsdcMicro (positive integer) required' });
    }
    const result = db
      .prepare(
        "INSERT INTO offers (listing_id, buyer_member, total_usdc_micro, status, created_at) VALUES (?, ?, ?, 'PENDING', ?)",
      )
      .run(listing.id, member.member_id, body.totalUsdcMicro!, Date.now());
    return { offerId: Number(result.lastInsertRowid) };
  });

  app.get('/market/listings/:id/offers', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const listing = getListing(Number((req.params as { id: string }).id));
    if (!listing) return reply.code(404).send({ error: 'listing not found' });
    if (listing.seller_member !== member.member_id) return reply.code(403).send({ error: 'seller only' });
    const rows = db
      .prepare('SELECT * FROM offers WHERE listing_id = ? ORDER BY created_at DESC')
      .all(listing.id) as unknown as OfferRow[];
    return {
      offers: rows.map((o) => ({
        offerId: o.id,
        buyerMemberId: o.buyer_member,
        totalUsdcMicro: o.total_usdc_micro,
        status: o.status,
        createdAt: o.created_at,
      })),
    };
  });

  app.get('/market/my-offers', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const rows = db
      .prepare(
        `SELECT o.*, e.id AS escrow_id, e.status AS escrow_status FROM offers o
         LEFT JOIN escrows e ON e.offer_id = o.id
         WHERE o.buyer_member = ? ORDER BY o.created_at DESC`,
      )
      .all(member.member_id) as unknown as (OfferRow & { escrow_id: number | null; escrow_status: string | null })[];
    return {
      offers: rows.map((o) => ({
        offerId: o.id,
        listingId: o.listing_id,
        totalUsdcMicro: o.total_usdc_micro,
        status: o.status,
        escrowId: o.escrow_id,
        escrowStatus: o.escrow_status,
      })),
    };
  });

  // ── 승인 (엔젤) → 에스크로 생성 ───────────────────────────────

  app.post('/market/offers/:id/approve', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const offer = getOffer(Number((req.params as { id: string }).id));
    if (!offer) return reply.code(404).send({ error: 'offer not found' });
    const listing = getListing(offer.listing_id);
    if (!listing || listing.seller_member !== member.member_id) {
      return reply.code(403).send({ error: 'seller only' });
    }
    if (offer.status !== 'PENDING' || listing.status !== 'OPEN') {
      return reply.code(409).send({ error: 'offer or listing not in approvable state' });
    }
    const body = (req.body ?? {}) as { usdcAddress?: string };
    const fee = Math.floor((offer.total_usdc_micro * feeBps) / 10_000);

    db.prepare("UPDATE offers SET status = 'APPROVED' WHERE id = ?").run(offer.id);
    db.prepare("UPDATE listings SET status = 'ESCROW' WHERE id = ?").run(listing.id);
    const result = db
      .prepare(
        `INSERT INTO escrows (offer_id, status, deposit_ref, coins_json, fee_usdc_micro, payout_address, created_at, updated_at)
         VALUES (?, 'AWAITING_DEPOSIT', '', NULL, ?, ?, ?, ?)`,
      )
      .run(offer.id, fee, body.usdcAddress ?? null, Date.now(), Date.now());
    const escrowId = Number(result.lastInsertRowid);
    const depositRef = chain.createDepositReference(escrowId);
    db.prepare('UPDATE escrows SET deposit_ref = ? WHERE id = ?').run(depositRef, escrowId);

    return { escrowId, depositRef, feeUsdcMicro: fee };
  });

  // ── 에스크로 상태 조회 (당사자 전용) ──────────────────────────

  function escrowParties(escrow: EscrowRow): { listing: ListingRow; offer: OfferRow } | null {
    const offer = getOffer(escrow.offer_id);
    if (!offer) return null;
    const listing = getListing(offer.listing_id);
    if (!listing) return null;
    return { listing, offer };
  }

  app.get('/market/escrows/:id', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const escrow = getEscrow(Number((req.params as { id: string }).id));
    if (!escrow) return reply.code(404).send({ error: 'escrow not found' });
    const parties = escrowParties(escrow);
    if (!parties) return reply.code(500).send({ error: 'inconsistent escrow' });
    const isSeller = parties.listing.seller_member === member.member_id;
    const isBuyer = parties.offer.buyer_member === member.member_id;
    if (!isSeller && !isBuyer) return reply.code(403).send({ error: 'parties only' });

    const buyer = getMember(parties.offer.buyer_member)!;
    return {
      escrowId: escrow.id,
      status: escrow.status,
      depositRef: escrow.deposit_ref,
      amountDshv: parties.listing.amount_dshv,
      totalUsdcMicro: parties.offer.total_usdc_micro,
      feeUsdcMicro: escrow.fee_usdc_micro,
      buyerDevicePublicKey: buyer.device_public_key,
      // 구매자는 판매자가 서명해 올린 코인(미완결 이전)을 여기서 받아 확인 서명한다.
      coins: isBuyer && escrow.coins_json ? (JSON.parse(escrow.coins_json) as Coin[]) : null,
    };
  });

  // ── 입금 확인 ─────────────────────────────────────────────────

  if (devMode) {
    /** 개발·테스트 전용: 구매자 USDC 입금 시뮬레이션 (실체인은 결정 대기 1번 확정 후). */
    app.post('/market/escrows/:id/dev-deposit', async (req, reply) => {
      const escrow = getEscrow(Number((req.params as { id: string }).id));
      if (!escrow || escrow.status !== 'AWAITING_DEPOSIT') {
        return reply.code(409).send({ error: 'escrow not awaiting deposit' });
      }
      const parties = escrowParties(escrow)!;
      if (chain instanceof MockChainAdapter) {
        chain.simulateDeposit(escrow.deposit_ref, parties.offer.total_usdc_micro);
      }
      const ok = await chain.checkDeposit(escrow.deposit_ref, parties.offer.total_usdc_micro);
      if (!ok) return reply.code(400).send({ error: 'deposit not found' });
      db.prepare("UPDATE escrows SET status = 'DEPOSITED', updated_at = ? WHERE id = ?").run(Date.now(), escrow.id);
      return { status: 'DEPOSITED' };
    });
  }

  // ── 코인 이전: 판매자 서명 제출 → 구매자 확인 서명 → 방출 ──────

  app.post('/market/escrows/:id/coins', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const escrow = getEscrow(Number((req.params as { id: string }).id));
    if (!escrow) return reply.code(404).send({ error: 'escrow not found' });
    const parties = escrowParties(escrow)!;
    if (parties.listing.seller_member !== member.member_id) return reply.code(403).send({ error: 'seller only' });
    if (escrow.status !== 'DEPOSITED') {
      return reply.code(409).send({ error: 'deposit must be confirmed before coins' });
    }
    const body = req.body as { coins?: Coin[] } | null;
    const coins = body?.coins;
    if (!coins || coins.length === 0) return reply.code(400).send({ error: 'coins required' });

    const buyer = getMember(parties.offer.buyer_member)!;
    const buyerAddress = addressFromPublicKey(buyer.device_public_key);
    let total = 0;
    for (const coin of coins) {
      // 위조 검사 + 미완결 마지막 링크(구매자 앞 지불 서명) 허용
      const verdict = verifyCoin(coin, { allowPendingLastLink: true, trustedIssuerKeys: ctx.trustedIssuerKeys });
      if (!verdict.valid) {
        return reply.code(400).send({ error: `invalid coin ${coin.id.slice(0, 12)}: ${verdict.reasons.join(',')}` });
      }
      const last = coin.transferChain[coin.transferChain.length - 1];
      if (!last || last.toSignature !== null || last.to !== buyerAddress) {
        return reply.code(400).send({ error: 'coin must carry a pending transfer to the buyer' });
      }
      total += coin.amountDshv;
    }
    if (total !== parties.listing.amount_dshv) {
      return reply.code(400).send({ error: `coin total ${total} != listing amount ${parties.listing.amount_dshv}` });
    }

    db.prepare("UPDATE escrows SET coins_json = ?, status = 'COINS_SUBMITTED', updated_at = ? WHERE id = ?").run(
      JSON.stringify(coins),
      Date.now(),
      escrow.id,
    );
    return { status: 'COINS_SUBMITTED' };
  });

  app.post('/market/escrows/:id/ack', async (req, reply) => {
    const member = authenticate(req);
    if (!member) return reply.code(401).send({ error: 'unauthorized' });
    const escrow = getEscrow(Number((req.params as { id: string }).id));
    if (!escrow) return reply.code(404).send({ error: 'escrow not found' });
    const parties = escrowParties(escrow)!;
    if (parties.offer.buyer_member !== member.member_id) return reply.code(403).send({ error: 'buyer only' });
    if (escrow.status !== 'COINS_SUBMITTED' || !escrow.coins_json) {
      return reply.code(409).send({ error: 'coins not submitted yet' });
    }
    const body = req.body as { coins?: Coin[] } | null;
    const coins = body?.coins;
    if (!coins || coins.length === 0) return reply.code(400).send({ error: 'acknowledged coins required' });

    const submitted = JSON.parse(escrow.coins_json) as Coin[];
    const submittedIds = new Set(submitted.map((c) => c.id));
    const buyerAddress = addressFromPublicKey(member.device_public_key);
    if (coins.length !== submitted.length || coins.some((c) => !submittedIds.has(c.id))) {
      return reply.code(400).send({ error: 'coin set mismatch' });
    }
    for (const coin of coins) {
      // 완결 검증: 구매자 확인 서명까지 포함해 유효해야 한다.
      const verdict = verifyCoin(coin, { trustedIssuerKeys: ctx.trustedIssuerKeys });
      if (!verdict.valid) {
        return reply.code(400).send({ error: `coin not finalized: ${verdict.reasons.join(',')}` });
      }
      if (currentOwnerAddress(coin) !== buyerAddress) {
        return reply.code(400).send({ error: 'coin owner is not the buyer' });
      }
    }

    // 방출: 총액 - 수수료 → 판매자. 수수료는 운영 재원 (투명성 공시 대상).
    const release = parties.offer.total_usdc_micro - escrow.fee_usdc_micro;
    const txId = await chain.release(escrow.payout_address, release);

    db.prepare("UPDATE escrows SET status = 'COMPLETED', coins_json = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(coins),
      Date.now(),
      escrow.id,
    );
    db.prepare("UPDATE offers SET status = 'SETTLED' WHERE id = ?").run(parties.offer.id);
    db.prepare("UPDATE listings SET status = 'SETTLED' WHERE id = ?").run(parties.listing.id);
    db.prepare("UPDATE offers SET status = 'REJECTED' WHERE listing_id = ? AND status = 'PENDING'").run(
      parties.listing.id,
    );

    return { status: 'COMPLETED', txId, releasedUsdcMicro: release, feeUsdcMicro: escrow.fee_usdc_micro };
  });

  // ── 투명성 공시 ───────────────────────────────────────────────

  app.get('/transparency/market', async () => {
    const open = (db.prepare("SELECT COUNT(*) AS n FROM listings WHERE status = 'OPEN'").get() as { n: number }).n;
    const settled = db
      .prepare(
        "SELECT COUNT(*) AS n, COALESCE(SUM(amount_dshv), 0) AS dshv FROM listings WHERE status = 'SETTLED'",
      )
      .get() as { n: number; dshv: number };
    const fees = (
      db.prepare("SELECT COALESCE(SUM(fee_usdc_micro), 0) AS f FROM escrows WHERE status = 'COMPLETED'").get() as {
        f: number;
      }
    ).f;
    // 숫자만 반환한다 — "대면 지불은 영구 무료" 같은 화면 문구는 각 웹의 i18n
    // 사전(transparency.marketNote)이 4개 언어로 갖는다. 서버는 UI 문장을 만들지 않는다.
    return {
      openListings: open,
      settledListings: settled.n,
      settledDshv: settled.dshv,
      collectedFeesUsdcMicro: fees,
      feeBps,
    };
  });
}
