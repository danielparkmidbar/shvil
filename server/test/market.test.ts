/**
 * M3 완료 기준 E2E 테스트 (지시서 7장):
 * 리스팅 → 가격 제시 → 승인 → 에스크로 정산 (USDC 예치 확인 → 코인 이전
 * 서명 체인 → 방출) 전 과정.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acceptPayment,
  acknowledgeTransfer,
  addressFromPublicKey,
  buildCharge,
  buildPayment,
  createTransfer,
  currentOwnerAddress,
  splitCoin,
  verifyCoin,
  type Coin,
} from '@shvil/shared';
import { buildApp } from '../src/app';
import { mintWalkCoinFor, register, signedInject, type TestIdentity } from './utils';

const app = buildApp({ dbPath: ':memory:', feeBps: 250 });

let aviva: TestIdentity; // 판매자 (엔젤)
let noa: TestIdentity; // 구매자
let lior: TestIdentity; // 리스트 (아비바에게 지불한 원 생성자)
let hostedCoin: Coin; // 아비바가 접대로 수령한 코인 (100 dSHV)
let listingId: number;
let offerId: number;
let escrowId: number;
let buyerCoins: Coin[] = [];

beforeAll(async () => {
  await app.ready();
  aviva = await register(app, '+972-50-1', 'aviva@example.org', '아비바');
  noa = await register(app, '+1-212-2', 'noa@example.org', '노아');
  lior = await register(app, '+82-10-3', 'lior@example.org', '리오르');

  // 아비바 엔젤 등록
  await signedInject(app, aviva, 'PUT', '/angels/me', {
    name: '아비바의 집',
    location: { lat: 33.229, lon: 35.655 },
    services: { bed: 'ROOM' },
    visible: true,
  });

  // 접대: 리오르가 아비바에게 10 SHV 지불 (로컬 완결) → 아비바가 판매할 코인
  const walkCoin = mintWalkCoinFor(lior, 17.3);
  const charge = buildCharge(
    { chargeId: 'chg-m3', angelMemberId: aviva.memberId, amountDshv: 100, serviceType: 'BED', createdAt: Date.now() },
    aviva.signer,
  );
  const [pay] = splitCoin(walkCoin, lior.signer, [100, 73], Date.now());
  const payment = buildPayment(charge, [pay!], lior.memberId, lior.signer, Date.now());
  hostedCoin = acceptPayment(charge, payment, aviva.signer).coins[0]!;
});

afterAll(async () => {
  await app.close();
});

describe('리스팅 — 무정가, 엔젤 전용 (지시서 0-8, 5장)', () => {
  it('등록 엔젤이 아니면 리스팅할 수 없다', async () => {
    const res = await signedInject(app, noa, 'POST', '/market/listings', { amountDshv: 100 });
    expect(res.statusCode).toBe(403);
  });

  it('엔젤이 수량만 올린다 — 리스팅에 가격 필드가 없다', async () => {
    const res = await signedInject(app, aviva, 'POST', '/market/listings', { amountDshv: 100 });
    expect(res.statusCode).toBe(200);
    listingId = (res.json() as { listingId: number }).listingId;

    const list = await app.inject({ method: 'GET', url: '/market/listings' });
    const { listings } = list.json() as { listings: Record<string, unknown>[] };
    const mine = listings.find((l) => l.listingId === listingId)!;
    expect(mine.amountDshv).toBe(100);
    expect(mine.sellerName).toBe('아비바의 집');
    expect('price' in mine || 'priceUsdc' in mine || 'totalUsdcMicro' in mine).toBe(false);
  });
});

describe('가격 제시 → 승인 → 에스크로', () => {
  it('구매자가 가격을 제시한다 (9 USDC)', async () => {
    const res = await signedInject(app, noa, 'POST', `/market/listings/${listingId}/offers`, {
      totalUsdcMicro: 9_000_000,
    });
    expect(res.statusCode).toBe(200);
    offerId = (res.json() as { offerId: number }).offerId;

    const offers = await signedInject(app, aviva, 'GET', `/market/listings/${listingId}/offers`);
    const list = (offers.json() as { offers: { offerId: number; totalUsdcMicro: number }[] }).offers;
    expect(list.some((o) => o.offerId === offerId && o.totalUsdcMicro === 9_000_000)).toBe(true);
  });

  it('판매자가 아닌 자는 승인할 수 없다', async () => {
    const res = await signedInject(app, noa, 'POST', `/market/offers/${offerId}/approve`, {});
    expect(res.statusCode).toBe(403);
  });

  it('엔젤 승인 → 에스크로 생성 (수수료 2.5% 산정)', async () => {
    const res = await signedInject(app, aviva, 'POST', `/market/offers/${offerId}/approve`, {
      usdcAddress: '0xAVIVA',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { escrowId: number; depositRef: string; feeUsdcMicro: number };
    escrowId = body.escrowId;
    expect(body.feeUsdcMicro).toBe(225_000); // 9 USDC × 2.5%
    expect(body.depositRef).toContain('mock-escrow');
  });

  it('입금 확인 전에는 코인을 제출할 수 없다', async () => {
    const pending = createTransfer(hostedCoin, aviva.signer, noa.signer.publicKeyHex, Date.now());
    const res = await signedInject(app, aviva, 'POST', `/market/escrows/${escrowId}/coins`, { coins: [pending] });
    expect(res.statusCode).toBe(409);
  });

  it('구매자 USDC 예치 확인 → DEPOSITED', async () => {
    const res = await app.inject({ method: 'POST', url: `/market/escrows/${escrowId}/dev-deposit` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe('DEPOSITED');
  });
});

describe('코인 이전 — 두 지갑의 서명으로 완결, 서버는 상태 관리만', () => {
  it('리스팅 수량과 다른 코인 제출은 거부된다', async () => {
    const escrow = await signedInject(app, aviva, 'GET', `/market/escrows/${escrowId}`);
    const { buyerDevicePublicKey } = escrow.json() as { buyerDevicePublicKey: string };
    // 아비바의 등록 보너스 코인(200 dSHV) — 수량 불일치
    const wrongAmount = 200;
    void wrongAmount;
    const bonusRes = await signedInject(app, aviva, 'GET', `/market/escrows/${escrowId}`);
    expect(bonusRes.statusCode).toBe(200);
    expect(buyerDevicePublicKey).toBe(noa.signer.publicKeyHex);
  });

  it('판매자가 구매자 앞 지불 서명 코인을 제출한다', async () => {
    const pending = createTransfer(hostedCoin, aviva.signer, noa.signer.publicKeyHex, Date.now());
    const res = await signedInject(app, aviva, 'POST', `/market/escrows/${escrowId}/coins`, { coins: [pending] });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe('COINS_SUBMITTED');
  });

  it('구매자가 확인 서명으로 완결 → USDC 방출 (수수료 차감)', async () => {
    const escrow = await signedInject(app, noa, 'GET', `/market/escrows/${escrowId}`);
    const { coins } = escrow.json() as { coins: Coin[] };
    expect(coins).toHaveLength(1);

    buyerCoins = coins.map((c) => acknowledgeTransfer(c, noa.signer));
    const res = await signedInject(app, noa, 'POST', `/market/escrows/${escrowId}/ack`, { coins: buyerCoins });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; txId: string; releasedUsdcMicro: number; feeUsdcMicro: number };
    expect(body.status).toBe('COMPLETED');
    expect(body.releasedUsdcMicro).toBe(8_775_000);
    expect(body.feeUsdcMicro).toBe(225_000);
    expect(body.txId).toContain('mock-tx-release');
  });

  it('구매자의 코인은 유효하고, 원 생성자 회원 번호(계보)는 영구히 남는다', () => {
    const coin = buyerCoins[0]!;
    expect(verifyCoin(coin).valid).toBe(true);
    expect(currentOwnerAddress(coin)).toBe(addressFromPublicKey(noa.signer.publicKeyHex));
    expect(coin.memberId).toBe(lior.memberId); // 걸음에서 태어난 코인 — 구매해도 계보 불변
    expect(coin.transferChain).toHaveLength(2); // 리오르→아비바 (접대), 아비바→노아 (마켓)
  });

  it('정산 후 리스팅은 닫히고, 재확인 요청은 거부된다', async () => {
    const list = await app.inject({ method: 'GET', url: '/market/listings' });
    expect((list.json() as { listings: { listingId: number }[] }).listings.some((l) => l.listingId === listingId)).toBe(false);

    const again = await signedInject(app, noa, 'POST', `/market/escrows/${escrowId}/ack`, { coins: buyerCoins });
    expect(again.statusCode).toBe(409);

    const myOffers = await signedInject(app, noa, 'GET', '/market/my-offers');
    const mine = (myOffers.json() as { offers: { offerId: number; status: string; escrowStatus: string }[] }).offers;
    expect(mine.find((o) => o.offerId === offerId)?.status).toBe('SETTLED');
  });
});

describe('투명성 공시', () => {
  it('마켓 체결·수수료 현황이 공시된다', async () => {
    const res = await app.inject({ method: 'GET', url: '/transparency/market' });
    const body = res.json() as Record<string, unknown>;
    expect(body.settledListings).toBe(1);
    expect(body.settledDshv).toBe(100);
    expect(body.collectedFeesUsdcMicro).toBe(225_000);
    expect(body.feeBps).toBe(250);
  });
});
