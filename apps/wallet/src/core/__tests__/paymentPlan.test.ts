/**
 * ★"종주자가 자기 코인을 못 쓴다"가 정말 끝났는가.
 *
 * 적대검증에서 재현된 것 세 가지를 여기서 하나씩 되짚는다.
 *  (가) 화면 상수 2,900 때문에 **규격 안(2,901~2,953)에 드는 코인이 죽었다.**
 *  (나) 엔젤이 받은 코인 3장(잠자리 10 SHV)이 한 장을 넘어 **지불 자체가 불가능했다.**
 *  (다) 실패해도 **분할은 이미 커밋되어 되돌릴 수 없었다** — 재시도할수록 코인이 부서졌다.
 *
 * 여기서는 조각이 아니라 **왕복 전체**를 돈다: 계획 → 지불 QR(여러 장이면 나눔) →
 * 카메라가 조각을 모음 → decodeQr → 엔젤 검토 → 수령 → 확인 서명 검증.
 * 중간에 재구현한 로직은 없다 — 전부 운영 코드를 부른다.
 */
import { describe, expect, it } from 'vitest';
import {
  PendingWalkLedger,
  QR_BYTE_MODE_MAX_CHARS,
  QrFrameCollector,
  acknowledgeTransfer,
  addressFromPublicKey,
  buildCharge,
  buildMembershipCertificate,
  buildWalkSegmentProof,
  createTransfer,
  decodeQr,
  deriveKeyId,
  encodeQr,
  qrFramesFor,
  generateKeyPair,
  mintWalkCoin,
  signerFromKeyPair,
  verifyCoin,
  verifyConfirm,
  type ChargeMessage,
  type Coin,
  type Signer,
} from '@shvil/shared';
import { planPayment } from '../paymentPlan';
import { acceptReviewedPayment, buildReceiveReview } from '../receiveReview';

const T0 = Date.parse('2026-08-01T06:00:00Z');
const DAY = 86_400_000;

const root = signerFromKeyPair(generateKeyPair());
const rootKeyId = deriveKeyId('MEMBERSHIP_ROOT', root.publicKeyHex);
const TRUSTED_ROOTS = { [rootKeyId]: root.publicKeyHex };

const hiker = signerFromKeyPair(generateKeyPair());
const HIKER_ID = 'SHV-2026-000777';
const angel = signerFromKeyPair(generateKeyPair());
const ANGEL_ID = 'SHV-2026-009001';
const ANGEL_ADDRESS = addressFromPublicKey(angel.publicKeyHex);

function certFor(memberId: string, device: Signer, issuedAt: number) {
  return buildMembershipCertificate(
    {
      memberId,
      devicePublicKey: device.publicKeyHex,
      integrity: 'VERIFIED',
      issuedAt,
      expiresAt: issuedAt + 30 * DAY,
      issuerKeyId: rootKeyId,
    },
    root,
  );
}

/** 걷기 코인 하나 — days일 × kmPerDay. dailyBreakdown 항목이 days개 붙는다. */
function walkCoin(owner: Signer, memberId: string, days: number, kmPerDay: number, startDay = 0): Coin {
  const l = new PendingWalkLedger({ memberId });
  let last = T0;
  for (let d = 0; d < days; d += 1) {
    let t = T0 + (startDay + d) * DAY;
    for (let w = 0; w < Math.round(kmPerDay * 10); w += 1) {
      l.recordSample({ durationS: 72, distanceM: 100, steps: 140, tier: 'ON_COURSE', timestamp: t, courseId: 'shvil-israel' });
      t += 72_000;
    }
    last = t;
  }
  return mintWalkCoin(
    buildWalkSegmentProof(l.settleOnSpend(last)!, owner, {
      membership: certFor(memberId, owner, last - DAY),
      appIntegrityToken: 'a'.repeat(64),
    }),
  );
}

/** 손바뀜 n회 — 마지막 소유자는 다시 owner (그래야 다시 낼 수 있다). */
function withHistory(coin: Coin, n: number, owner: Signer): Coin {
  let c = coin;
  let cur = owner;
  for (let i = 0; i < n; i += 1) {
    const next = i === n - 1 ? owner : signerFromKeyPair(generateKeyPair());
    c = createTransfer(c, cur, next.publicKeyHex, T0 + i * 1000);
    c = acknowledgeTransfer(c, next);
    cur = next;
  }
  return c;
}

function chargeFor(amountDshv: number, now = T0 + 61 * DAY): ChargeMessage {
  return buildCharge(
    { chargeId: 'chg-plan', angelMemberId: ANGEL_ID, amountDshv, serviceType: 'SHOWER', createdAt: now },
    angel,
  );
}

/**
 * ★대면 지불 한 판을 **끝까지** 돈다. 카메라가 조각을 뒤섞어 준 상황까지 재현한다.
 * 돌려주는 것은 실제로 완결된 코인들 — 여기까지 왔다면 그 지불은 현실에서 성립한다.
 */
function fullRoundTrip(owned: Coin[], amountDshv: number, now = T0 + 61 * DAY) {
  const charge = chargeFor(amountDshv, now);
  const plan = planPayment({ owned, charge, payerMemberId: HIKER_ID, signer: hiker, now });

  // 지불자 화면: 한 장이면 한 장, 넘으면 나눠서 돌린다.
  const qrText = encodeQr(plan.payment);
  const frames = qrFramesFor(qrText);

  // 엔젤 카메라: 조각을 (뒤죽박죽으로) 모은다.
  const collector = new QrFrameCollector();
  let scanned: string | null = null;
  if (frames.length === 1) {
    scanned = frames[0]!;
  } else {
    for (const f of [...frames].reverse()) {
      const r = collector.add(f);
      if (r.status === 'DONE') scanned = r.text;
    }
  }
  if (scanned === null) throw new Error('조각을 모으지 못했다');
  expect(scanned).toBe(qrText);

  const payment = decodeQr(scanned);
  if (payment.type !== 'shvil/payment') throw new Error('지불 QR이 아니다');

  const review = buildReceiveReview({
    charge,
    payment,
    angelAddress: ANGEL_ADDRESS,
    knownCoinIds: new Set<string>(),
    flaggedMemberIds: [],
    knownCoins: [],
    trustedRootKeys: TRUSTED_ROOTS,
    trustedIssuerKeys: {},
    requireIntegrityToken: false,
    rulePacks: [],
    now,
  });
  expect(review.blocked, `수령이 막혔다: ${review.findings.map((f) => f.title).join(' / ')}`).toBe(false);

  const accepted = acceptReviewedPayment(review, charge, payment, angel);
  expect(verifyConfirm(accepted.confirm, charge)).toBe(true);
  for (const c of accepted.coins) {
    expect(verifyCoin(c, { trustedRootKeys: TRUSTED_ROOTS }).valid).toBe(true);
  }
  return { plan, qrLength: qrText.length, frames: frames.length, review, accepted };
}

// ══════════════════════════════════════════════════════════════════════
describe('★대면 지불이 크기 때문에 막히지 않는다 (헌법 제7조 — 순환)', () => {
  const israel60 = walkCoin(hiker, HIKER_ID, 60, 17.6);

  it('이스라엘 60일 완주자가 샤워 3 SHV를 낸다 (분할 · 한 장)', () => {
    const r = fullRoundTrip([israel60], 30);
    console.log(`[가] 60일 코인 → 샤워 3 SHV: ${r.qrLength}자 · QR ${r.frames}장 · ${r.plan.strategy}`);
    expect(r.frames).toBe(1);
    expect(r.accepted.coins).toHaveLength(1);
  });

  it('★손바뀜 5회 코인 — 예전에는 한 장을 넘어 지불이 아예 불가능했다', () => {
    const worn = withHistory(israel60, 5, hiker);
    const r = fullRoundTrip([worn], 30);
    console.log(`[나] 이전 5회 코인 → 3 SHV: ${r.qrLength}자 · QR ${r.frames}장`);
    expect(r.qrLength).toBeGreaterThan(QR_BYTE_MODE_MAX_CHARS); // 한 장에는 여전히 안 들어간다
    expect(r.frames).toBeGreaterThan(1); // 그래도 지불된다
  });

  it('★손바뀜 20회까지 간다 — 순환이 이어져도 화폐가 죽지 않는다', () => {
    for (const n of [8, 12, 20]) {
      const worn = withHistory(israel60, n, hiker);
      const r = fullRoundTrip([worn], 30);
      console.log(`[나] 이전 ${n}회 코인 → 3 SHV: ${r.qrLength}자 · QR ${r.frames}장`);
      expect(r.accepted.coins).toHaveLength(1);
    }
  });

  it('★엔젤이 받은 소액 코인 여러 장으로 잠자리 10 SHV를 낸다 (적대검증에서 막혔던 곳)', () => {
    // 불곡산 왕복급 코인 여러 장 — 각각 이미 손이 한 번 바뀌었다.
    const owned: Coin[] = [];
    for (let i = 0; i < 8; i += 1) {
      owned.push(withHistory(walkCoin(hiker, HIKER_ID, 1, 1.5, i), 1, hiker));
    }
    const each = owned[0]!.amountDshv;
    for (const k of [2, 3, 5, 7]) {
      const amount = each * k;
      const r = fullRoundTrip(owned.slice(0, k), amount);
      console.log(`[다] 코인 ${k}장 (${amount / 10} SHV): ${r.qrLength}자 · QR ${r.frames}장 · ${r.plan.strategy}`);
      expect(r.accepted.coins).toHaveLength(k);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
describe('계획은 자르기 전에 재 본다 (되돌릴 수 없는 분할을 헛되이 만들지 않는다)', () => {
  const coin = walkCoin(hiker, HIKER_ID, 3, 10);

  it('잔액이 모자라면 아무것도 서명하지 않고 던진다', () => {
    const charge = chargeFor(coin.amountDshv + 1000);
    expect(() => planPayment({ owned: [coin], charge, payerMemberId: HIKER_ID, signer: hiker, now: T0 + 61 * DAY })).toThrow(
      /잔액 부족/,
    );
  });

  it('★계획은 지갑을 건드리지 않는다 — 계획을 세워도 원본 코인은 그대로다', () => {
    const before = JSON.stringify(coin);
    const charge = chargeFor(30);
    const plan = planPayment({ owned: [coin], charge, payerMemberId: HIKER_ID, signer: hiker, now: T0 + 61 * DAY });
    expect(plan.split).not.toBeNull();
    // 분할 계획은 만들어졌지만, 원본은 한 글자도 바뀌지 않았다 (저장은 호출부 몫).
    expect(JSON.stringify(coin)).toBe(before);
    expect(coin.transferChain).toHaveLength(0);
  });

  it('같은 입력이면 같은 계획이 나온다 (계획 단계의 서명과 커밋 단계의 서명이 같다)', () => {
    const charge = chargeFor(30);
    const args = { owned: [coin], charge, payerMemberId: HIKER_ID, signer: hiker, now: T0 + 61 * DAY };
    expect(encodeQr(planPayment(args).payment)).toBe(encodeQr(planPayment(args).payment));
  });
});

// ══════════════════════════════════════════════════════════════════════
describe('코인 나이 정책은 바뀌지 않는다', () => {
  it('오래된 것부터가 한 장으로 끝나면 그대로 오래된 것부터 쓴다', () => {
    const old1 = walkCoin(hiker, HIKER_ID, 1, 3, 0);
    const new1 = walkCoin(hiker, HIKER_ID, 1, 3, 5);
    const charge = chargeFor(old1.amountDshv);
    const plan = planPayment({ owned: [old1, new1], charge, payerMemberId: HIKER_ID, signer: hiker, now: T0 + 61 * DAY });
    expect(plan.strategy).toBe('오래된 것부터');
    expect(plan.frameCount).toBe(1);
    expect(plan.coins[0]!.id).toBe(old1.id);
  });

  it('★오래된 것부터가 여러 장이 되는데 다른 조합이 한 장이면 그쪽을 쓴다', () => {
    // 오래된 쪽은 손이 여러 번 바뀌어 무거운 코인 여러 장, 새 쪽은 딱 맞는 가벼운 한 장.
    const heavy: Coin[] = [];
    for (let i = 0; i < 6; i += 1) heavy.push(withHistory(walkCoin(hiker, HIKER_ID, 1, 1.5, i), 4, hiker));
    const amount = heavy.slice(0, 6).reduce((s, c) => s + c.amountDshv, 0);
    const exact = walkCoin(hiker, HIKER_ID, 1, amount / 10, 20);
    expect(exact.amountDshv).toBe(amount);

    const charge = chargeFor(amount);
    const oldestOnly = planPayment({ owned: heavy, charge, payerMemberId: HIKER_ID, signer: hiker, now: T0 + 61 * DAY });
    const withExact = planPayment({
      owned: [...heavy, exact],
      charge,
      payerMemberId: HIKER_ID,
      signer: hiker,
      now: T0 + 61 * DAY,
    });
    console.log(
      `[라] 오래된 것만: ${oldestOnly.qrLength}자 ${oldestOnly.frameCount}장 (${oldestOnly.strategy})\n` +
        `     맞는 한 장이 있을 때: ${withExact.qrLength}자 ${withExact.frameCount}장 (${withExact.strategy})`,
    );
    expect(oldestOnly.frameCount).toBeGreaterThan(1);
    expect(withExact.frameCount).toBe(1);
    expect(withExact.coins).toHaveLength(1);
    expect(withExact.coins[0]!.id).toBe(exact.id);
  });
});
