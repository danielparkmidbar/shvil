/**
 * ★수령 자율 (헌법 제9조) — "수용 여부는 언제나 엔젤의 결정"을 코드로 못박는다.
 *
 * 재현됐던 결함: `acceptPayment`가 검사 통과 즉시 `acknowledgeTransfer` + 확인 서명을
 * 만들어 **스캔 = 수령 확정**이었다. 동시에 반대 방향으로도 틀려 있었다 — 자격 미증명·
 * 소명 대기·인간 한계는 앱이 대신 **거절**했다. 둘 다 결정을 사람에게서 뺏은 것이다.
 *
 * 이 파일이 지키는 불변식:
 *  1. 검토는 아무것도 서명하지 않는다.
 *  2. 거부해도 지불자의 코인은 살아 있고 다시 쓸 수 있다.
 *  3. 산술적으로 불가능한 것만 막고(BLOCK), 나머지는 엔젤이 정한다(STOP).
 *  4. 코어 판정과 팩 판정은 절대 섞이지 않는다.
 */
import { describe, expect, it } from 'vitest';
import {
  PendingWalkLedger,
  addressFromPublicKey,
  buildCharge,
  buildGrant,
  buildMembershipCertificate,
  buildPayment,
  buildWalkSegmentProof,
  currentOwnerAddress,
  deriveKeyId,
  generateKeyPair,
  mintGrantCoin,
  mintWalkCoin,
  signerFromKeyPair,
  verifyCoin,
  verifyConfirm,
  type ChargeMessage,
  type Coin,
  type MembershipCertificate,
  type RulePack,
  type Signer,
  type WalkSample,
} from '@shvil/shared';
import { acceptReviewedPayment, buildReceiveReview, type ReceiveReviewInput } from '../receiveReview';

const T0 = Date.parse('2026-07-01T06:00:00Z');
const NOW = T0 + 4 * 3600_000;

const root = signerFromKeyPair(generateKeyPair());
const rootKeyId = deriveKeyId('MEMBERSHIP_ROOT', root.publicKeyHex);
const promo = signerFromKeyPair(generateKeyPair());
const promoKeyId = deriveKeyId('ANGEL_BONUS', promo.publicKeyHex);

const payer = signerFromKeyPair(generateKeyPair());
const angel = signerFromKeyPair(generateKeyPair());
const PAYER_ID = 'SHV-100001';
const ANGEL_ID = 'SHV-900001';
const ANGEL_ADDRESS = addressFromPublicKey(angel.publicKeyHex);
const PAYER_ADDRESS = addressFromPublicKey(payer.publicKeyHex);

const cert: MembershipCertificate = buildMembershipCertificate(
  {
    memberId: PAYER_ID,
    devicePublicKey: payer.publicKeyHex,
    integrity: 'VERIFIED',
    issuedAt: T0,
    expiresAt: T0 + 30 * 24 * 3600_000,
    issuerKeyId: rootKeyId,
  },
  root,
);

const TRUSTED_ROOTS = { [rootKeyId]: root.publicKeyHex };
const TRUSTED_ISSUERS = { [promoKeyId]: promo.publicKeyHex };

/** 코스 위 100 m 창을 n번 걸어 만든 코인. 50창 = 5,000 m = 50 dSHV. */
function walkCoin(windows: number, device: Signer = payer, memberId: string = PAYER_ID, withCert = true): Coin {
  const ledger = new PendingWalkLedger({ memberId });
  let t = T0 + 3600_000;
  for (let i = 0; i < windows; i++) {
    const sample: WalkSample = {
      durationS: 72,
      distanceM: 100,
      steps: 140,
      tier: 'ON_COURSE',
      timestamp: t,
      courseId: 'bundang-bulgoksan',
    };
    ledger.recordSample(sample);
    t += 72_000;
  }
  const draft = ledger.settleManual(t)!;
  return mintWalkCoin(buildWalkSegmentProof(draft, device, withCert ? { membership: cert } : {}));
}

function grantCoin(): Coin {
  return mintGrantCoin(
    buildGrant(
      {
        kind: 'ANGEL_BONUS',
        memberId: PAYER_ID,
        amountDshv: 200,
        reference: 'angel-registration',
        recipientPublicKey: payer.publicKeyHex,
        issuerKeyId: promoKeyId,
        issuedAt: T0,
      },
      promo,
    ),
  );
}

function chargeFor(amountDshv: number): ChargeMessage {
  return buildCharge(
    { chargeId: 'chg-test', angelMemberId: ANGEL_ID, amountDshv, serviceType: 'MEAL', createdAt: NOW },
    angel,
  );
}

function reviewOf(coins: Coin[], over: Partial<ReceiveReviewInput> = {}) {
  const amount = coins.reduce((s, c) => s + c.amountDshv, 0);
  const charge = (over.charge as ChargeMessage | undefined) ?? chargeFor(amount);
  const payment = over.payment ?? buildPayment(charge, coins, PAYER_ID, payer, NOW);
  return buildReceiveReview({
    charge,
    payment,
    angelAddress: ANGEL_ADDRESS,
    knownCoinIds: new Set<string>(),
    flaggedMemberIds: [],
    knownCoins: [],
    trustedRootKeys: TRUSTED_ROOTS,
    trustedIssuerKeys: TRUSTED_ISSUERS,
    requireIntegrityToken: false,
    rulePacks: [],
    now: NOW,
    ...over,
  });
}

describe('검토는 아무것도 서명하지 않는다 (제9조 1)', () => {
  it('평범한 지불은 깨끗하게 통과하고 빠른 길이 열린다 (제8조)', () => {
    const coin = walkCoin(50);
    const r = reviewOf([coin]);
    expect(r.blocked).toBe(false);
    expect(r.clean).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.coreVerdict).toBe('AUTHENTIC');
    expect(r.extendedVerdict).toBe('AUTHENTIC');
    expect(r.amountDshv).toBe(50);
    expect(r.coins[0]!.producerMemberId).toBe(PAYER_ID);
    expect(r.coins[0]!.handovers).toBe(0);
    expect(r.coins[0]!.distanceM).toBe(5000);
    console.log(
      `   평범한 지불: ${r.amountDshv / 10} SHV · 코어 ${r.coreVerdict} · 내 기준 ${r.extendedVerdict} · 발견 ${r.findings.length}건 · clean=${r.clean}`,
    );
  });

  it('검토를 돌려도 코인에는 확인 서명이 붙지 않는다 (아직 수령이 아니다)', () => {
    const coin = walkCoin(50);
    const charge = chargeFor(50);
    const payment = buildPayment(charge, [coin], PAYER_ID, payer, NOW);
    buildReceiveReview({
      charge,
      payment,
      angelAddress: ANGEL_ADDRESS,
      knownCoinIds: new Set(),
      flaggedMemberIds: [],
      knownCoins: [],
      trustedRootKeys: TRUSTED_ROOTS,
      trustedIssuerKeys: TRUSTED_ISSUERS,
      requireIntegrityToken: false,
      rulePacks: [],
      now: NOW,
    });
    const link = payment.coins[0]!.transferChain[0]!;
    // 지불자 서명만 있고 수령자 확인 서명은 없다 = 미완결.
    expect(link.fromSignature.length).toBeGreaterThan(0);
    expect(link.toSignature ?? null).toBeNull();
  });
});

describe('확정 단계 — "받는다"를 고른 뒤에만 서명이 생긴다', () => {
  it('확인 QR이 지불자 쪽 검증(verifyConfirm)을 통과하고 코인이 엔젤 소유가 된다', () => {
    const coin = walkCoin(50);
    const charge = chargeFor(50);
    const payment = buildPayment(charge, [coin], PAYER_ID, payer, NOW);
    const review = reviewOf([coin], { charge, payment });
    const accepted = acceptReviewedPayment(review, charge, payment, angel);
    expect(verifyConfirm(accepted.confirm, charge)).toBe(true);
    expect(accepted.coins).toHaveLength(1);
    expect(currentOwnerAddress(accepted.coins[0]!)).toBe(ANGEL_ADDRESS);
    // 완결된 코인은 미완결 허용 없이도 검증을 통과한다.
    expect(verifyCoin(accepted.coins[0]!, { trustedRootKeys: TRUSTED_ROOTS }).valid).toBe(true);
    expect(accepted.confirm.coinIds).toEqual([coin.id]);
  });

  it('내 앞으로 오지 않은 코인은 확정 단계에서도 거절한다 (마지막 방어선)', () => {
    const coin = walkCoin(50);
    const otherAngel = signerFromKeyPair(generateKeyPair());
    const charge = buildCharge(
      { chargeId: 'chg-other', angelMemberId: 'SHV-900003', amountDshv: 50, serviceType: null, createdAt: NOW },
      otherAngel,
    );
    const payment = buildPayment(charge, [coin], PAYER_ID, payer, NOW);
    // 엉뚱한 엔젤이 남 앞으로 온 지불을 확정하려 한다.
    // (`acknowledgeTransfer`가 먼저 잡고, 통과하더라도 우리 소유자 재확인이 잡는다.)
    const review = reviewOf([coin], { charge, payment });
    // 검토 단계가 먼저 BLOCK을 낸다 (내 앞으로 온 코인이 아니다).
    expect(review.blocked).toBe(true);
    expect(() => acceptReviewedPayment(review, charge, payment, angel)).toThrow(/수령할 수 없습니다/);
    // ★그 앞 단계를 전부 건너뛰고 확정 함수만 불러도 여전히 막힌다 — 마지막 방어선.
    expect(() => acceptReviewedPayment({ ...review, blocked: false }, charge, payment, angel)).toThrow(
      /signer is not the recipient|내 앞으로 온 코인이 아닙니다/,
    );
  });
});

describe('★거부해도 지불자의 코인은 죽지 않는다 (제9조 2)', () => {
  it('지불 QR을 만들어도 지불자 지갑의 원본 코인은 손대지 않는다', () => {
    const coin = walkCoin(50);
    const charge = chargeFor(50);
    const payment = buildPayment(charge, [coin], PAYER_ID, payer, NOW);
    // 원본은 이전 링크가 하나도 붙지 않은 그대로다 (buildPayment는 사본을 만든다).
    expect(coin.transferChain).toHaveLength(0);
    expect(currentOwnerAddress(coin)).toBe(PAYER_ADDRESS);
    expect(verifyCoin(coin, { trustedRootKeys: TRUSTED_ROOTS }).valid).toBe(true);
    // QR 안의 사본에만 미완결 링크가 붙어 있다.
    expect(payment.coins[0]!.transferChain).toHaveLength(1);
  });

  it('엔젤이 거부한 뒤 같은 코인으로 다른 엔젤에게 다시 지불할 수 있다', () => {
    const coin = walkCoin(50);
    // 1차: 엔젤 A에게 지불 → 검토 → 거부(아무것도 서명하지 않음).
    const r1 = reviewOf([coin]);
    expect(r1.blocked).toBe(false);
    // 거부 = 확인 서명을 만들지 않는 것. 지갑 쪽 상태만 버리면 끝이다.

    // 2차: 다른 엔젤 B에게 같은 코인으로 지불.
    const angelB = signerFromKeyPair(generateKeyPair());
    const chargeB = buildCharge(
      { chargeId: 'chg-b', angelMemberId: 'SHV-900002', amountDshv: 50, serviceType: null, createdAt: NOW },
      angelB,
    );
    const paymentB = buildPayment(chargeB, [coin], PAYER_ID, payer, NOW + 1000);
    const rB = buildReceiveReview({
      charge: chargeB,
      payment: paymentB,
      angelAddress: addressFromPublicKey(angelB.publicKeyHex),
      knownCoinIds: new Set(),
      flaggedMemberIds: [],
      knownCoins: [],
      trustedRootKeys: TRUSTED_ROOTS,
      trustedIssuerKeys: TRUSTED_ISSUERS,
      requireIntegrityToken: false,
      rulePacks: [],
      now: NOW + 1000,
    });
    expect(rB.blocked).toBe(false);
    expect(rB.clean).toBe(true);
    console.log('   거부 뒤 재지불: 두 번째 엔젤의 검토도 clean — 코인이 살아 있다');
  });
});

describe('막는 것과 묻는 것을 가른다 (제9조 3)', () => {
  it('서명·계보가 손상된 코인은 BLOCK — 엔젤에게 묻지 않는다', () => {
    const coin = walkCoin(50);
    const charge = chargeFor(50);
    const payment = buildPayment(charge, [coin], PAYER_ID, payer, NOW);
    // 계보를 손으로 바꿔치기 (금액 부풀리기).
    const tampered = JSON.parse(JSON.stringify(payment)) as typeof payment;
    tampered.coins[0]!.amountDshv = 5000;
    const r = buildReceiveReview({
      charge,
      payment: tampered,
      angelAddress: ANGEL_ADDRESS,
      knownCoinIds: new Set(),
      flaggedMemberIds: [],
      knownCoins: [],
      trustedRootKeys: TRUSTED_ROOTS,
      trustedIssuerKeys: TRUSTED_ISSUERS,
      requireIntegrityToken: false,
      rulePacks: [],
      now: NOW,
    });
    expect(r.blocked).toBe(true);
    expect(r.findings.some((f) => f.severity === 'BLOCK')).toBe(true);
    console.log(`   변조 코인: blocked=${r.blocked} / ${r.findings.filter((f) => f.severity === 'BLOCK').length}건 BLOCK`);
  });

  it('이미 가진 코인은 BLOCK (이중 수령)', () => {
    const coin = walkCoin(50);
    const r = reviewOf([coin], { knownCoinIds: new Set([coin.id]) });
    expect(r.blocked).toBe(true);
  });

  it('금액이 청구와 다르면 BLOCK', () => {
    const coin = walkCoin(50);
    const charge = chargeFor(50);
    const payment = buildPayment(charge, [coin], PAYER_ID, payer, NOW);
    const otherCharge = chargeFor(30);
    const r = reviewOf([coin], { charge: otherCharge, payment });
    expect(r.blocked).toBe(true);
  });

  it('★자격 미증명은 막지 않는다 — 엔젤이 보고 정한다 (예전에는 앱이 대신 거절했다)', () => {
    // 검사자가 **다른** 루트 키만 가지고 있는 상황 = 키 목록이 낡았거나 자작 서명이거나.
    const stranger = signerFromKeyPair(generateKeyPair());
    const strangerKeyId = deriveKeyId('MEMBERSHIP_ROOT', stranger.publicKeyHex);
    const coin = walkCoin(50);
    const r = reviewOf([coin], { trustedRootKeys: { [strangerKeyId]: stranger.publicKeyHex } });
    expect(r.blocked).toBe(false); // ★수령이 가능하다
    expect(r.clean).toBe(false); // ★그러나 그냥 지나가지도 않는다
    expect(r.findings.some((f) => f.severity === 'STOP')).toBe(true);
    expect(r.coreVerdict).toBe('SUSPECT');
    console.log(
      `   자격 미증명: blocked=${r.blocked} clean=${r.clean} 코어=${r.coreVerdict}\n     "${r.findings[0]!.title}"`,
    );
  });

  it('★소명 대기 회원의 코인도 막지 않고 보여 준다 (거절도 엔젤의 결정)', () => {
    const coin = walkCoin(50);
    const r = reviewOf([coin], { flaggedMemberIds: [PAYER_ID] });
    expect(r.blocked).toBe(false);
    expect(r.findings.some((f) => f.severity === 'STOP' && f.title.includes('소명 대기'))).toBe(true);
  });

  it('보너스(GRANT) 계보도 발행 키를 모르면 STOP일 뿐 BLOCK이 아니다', () => {
    const coin = grantCoin();
    const other = signerFromKeyPair(generateKeyPair());
    const otherId = deriveKeyId('ANGEL_BONUS', other.publicKeyHex);
    const r = reviewOf([coin], { trustedIssuerKeys: { [otherId]: other.publicKeyHex } });
    expect(r.blocked).toBe(false);
    expect(r.findings.some((f) => f.severity === 'STOP')).toBe(true);
    expect(r.coins[0]!.kind).toBe('GRANT');
  });
});

describe('코어 판정과 내 팩 판정은 섞이지 않는다 (제9조 4)', () => {
  const myPack: RulePack = {
    v: 1,
    id: 'my-strict',
    name: '내 기준',
    rules: [
      {
        id: 'long-walk',
        scope: 'proof',
        severity: 'FATAL',
        detail: '{distanceM} m짜리 코인은 받지 않기로 정했습니다.',
        when: { op: 'gt', field: 'distanceM', value: 1000 },
      },
    ],
  };

  it('팩이 지목해도 coreVerdict는 그대로다 — 화폐의 공통 답은 하나다', () => {
    const coin = walkCoin(50);
    const withoutPack = reviewOf([coin]);
    const withPack = reviewOf([coin], { rulePacks: [myPack] });
    expect(withoutPack.coreVerdict).toBe('AUTHENTIC');
    expect(withPack.coreVerdict).toBe('AUTHENTIC'); // ★팩이 있어도 코어는 같다
    expect(withPack.extendedVerdict).not.toBe('AUTHENTIC'); // 내 기준으로는 걸렸다
    expect(withPack.blocked).toBe(false); // ★그래도 막지 않는다 — 내가 정하는 것이다
    const packFinding = withPack.findings.find((f) => f.origin === 'PACK');
    expect(packFinding).toBeDefined();
    expect(packFinding!.severity).toBe('STOP');
    expect(packFinding!.packId).toBe('my-strict');
    console.log(
      `   팩 얹기 전/후 코어: ${withoutPack.coreVerdict} → ${withPack.coreVerdict} (불변)\n` +
        `   내 기준: ${withoutPack.extendedVerdict} → ${withPack.extendedVerdict}\n     "${packFinding!.detail}"`,
    );
  });

  it('악성 팩이 코어를 약하게 만들 수 없다 — 손상된 코인은 팩이 뭐라 해도 BLOCK', () => {
    // "전부 통과시켜라"에 해당하는 연산자가 DSL에 없으므로, 가장 관대한 팩을 얹어도
    // 코어 발견은 그대로 남는다.
    const permissive: RulePack = {
      v: 1,
      id: 'permissive',
      name: '무해한 팩',
      rules: [
        {
          id: 'never',
          scope: 'proof',
          severity: 'SIGNAL',
          detail: '절대 걸리지 않는 규칙 {distanceM}',
          when: { op: 'lt', field: 'distanceM', value: -1 },
        },
      ],
    };
    const coin = walkCoin(50);
    const charge = chargeFor(50);
    const payment = buildPayment(charge, [coin], PAYER_ID, payer, NOW);
    const tampered = JSON.parse(JSON.stringify(payment)) as typeof payment;
    tampered.coins[0]!.amountDshv = 5000;
    const r = buildReceiveReview({
      charge,
      payment: tampered,
      angelAddress: ANGEL_ADDRESS,
      knownCoinIds: new Set(),
      flaggedMemberIds: [],
      knownCoins: [],
      trustedRootKeys: TRUSTED_ROOTS,
      trustedIssuerKeys: TRUSTED_ISSUERS,
      requireIntegrityToken: false,
      rulePacks: [permissive],
      now: NOW,
    });
    expect(r.blocked).toBe(true);
    expect(r.appliedPacks).toHaveLength(1);
  });

  it('읽지 못한 팩은 조용히 통과되지 않고 이유가 남는다 (fail-closed)', () => {
    const coin = walkCoin(50);
    const broken = { v: 1, id: 'broken', name: '깨진 팩', rules: [{ id: 'x', scope: 'proof', severity: 'FATAL', detail: 'x', when: { op: 'gt', field: 'coordinates', value: 1 } }] };
    const r = reviewOf([coin], { rulePacks: [broken] });
    expect(r.appliedPacks).toHaveLength(0);
    expect(r.packErrors.length).toBeGreaterThan(0);
    expect(r.findings.some((f) => f.origin === 'LOCAL')).toBe(true);
    expect(r.clean).toBe(false);
    console.log(`   깨진 팩: ${r.packErrors[0]}`);
  });
});

// ══════════════════════════════════════════════════════════════════════
describe('★검사하지 못한 것을 "깨끗하다"고 말하지 않는다 (제3조) — 그러나 없는 경고도 만들지 않는다', () => {
  it('키 목록이 빈 지갑이 **증서 붙은** 코인을 받으면 멈춰서 물어본다', () => {
    const r = reviewOf([walkCoin(50)], { trustedRootKeys: {}, trustedIssuerKeys: {} });
    expect(r.blocked, '자격 미증명은 막지 않는다 (제9조)').toBe(false);
    expect(r.clean, '검사하지 못한 코인이 빠른 길로 자동 수령되면 안 된다').toBe(false);
    const note = r.findings.find((f) => f.origin === 'LOCAL' && f.title.includes('신뢰 키 목록이 없어'));
    expect(note, '무엇을 못 봤는지 말하는 발견이 없다').toBeDefined();
    expect(note!.detail).toContain('위조라는 뜻도, 진짜라는 뜻도 아닙니다');
  });

  it('★미가입 지갑이 만든 (증서 없는) 코인은 그대로 빠른 길로 간다 — 0층을 깨지 않는다', () => {
    // 볼 것이 아예 없었던 경우다. "못 봤다"고 말하면 경고가 값싸지고, 값싼 경고는 무시된다.
    const noCert = walkCoin(50, payer, PAYER_ID, false);
    const r = reviewOf([noCert], { trustedRootKeys: {}, trustedIssuerKeys: {} });
    expect(r.findings.filter((f) => f.origin === 'LOCAL')).toHaveLength(0);
    expect(r.clean).toBe(true);
  });

  it('키 목록이 채워지면 안내가 사라진다 (정직한 엔젤을 영원히 귀찮게 하지 않는다)', () => {
    const r = reviewOf([walkCoin(50)]);
    expect(r.findings.filter((f) => f.origin === 'LOCAL')).toHaveLength(0);
    expect(r.clean).toBe(true);
  });

  it('보너스·보물 코인은 발행 키 목록이 비었을 때 같은 안내를 받는다', () => {
    const r = reviewOf([grantCoin()], { trustedRootKeys: {}, trustedIssuerKeys: {} });
    expect(r.findings.some((f) => f.origin === 'LOCAL')).toBe(true);
    expect(r.clean).toBe(false);
  });
});
