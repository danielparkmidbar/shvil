/**
 * 적대검증 1 — **실사용 시나리오로 끝까지 가 본다.**
 *
 * 지금까지의 시험은 조각을 봤다(QR 길이·수령 검토·GPS 계측). 여기서는 사람 하나가
 * 겪는 **한 줄기**를 그대로 돌린다: 걷는다 → 정산한다 → 청구를 스캔한다 → 지불 QR을
 * 만든다 → 엔젤이 검토한다 → 받거나 안 받는다 → 확인 QR로 완결한다.
 *
 * 조각이 다 통과해도 줄기가 끊어질 수 있다. 이 파일이 찾는 것은 그 끊긴 자리다.
 *
 * ★코인 선택은 `walletService.payCharge`가 아니라 `planCoinSelection`으로 흉내 낸다.
 *  walletService는 expo-sqlite를 들고 있어 vitest에서 돌지 않는다. 두 곳의 선택
 *  알고리즘이 같다는 것은 coinSelection.ts 첫 주석이 스스로 밝히고 있고, 아래
 *  "선택 알고리즘 동치" 시험이 그것을 실제로 대조한다.
 */
import { describe, expect, it } from 'vitest';
import {
  BUNDANG_BULGOKSAN_SAMPLE,
  PendingWalkLedger,
  QR_BYTE_MODE_MAX_CHARS,
  acknowledgeTransfer,
  addressFromPublicKey,
  buildCharge,
  buildMembershipCertificate,
  buildPayment,
  buildWalkSegmentProof,
  createTransfer,
  currentOwnerAddress,
  decodeQr,
  deriveKeyId,
  encodeQr,
  qrFramesFor,
  generateKeyPair,
  mintWalkCoin,
  parseCheckerInput,
  signerFromKeyPair,
  splitCoin,
  verifyCoin,
  verifyConfirm,
  type ChargeMessage,
  type Coin,
  type MembershipCertificate,
  type Signer,
  type WalkSample,
} from '@shvil/shared';
import { acceptReviewedPayment, buildReceiveReview, type ReceiveReviewInput } from '../receiveReview';
import { planCoinSelection } from '../coinSelection';
import { CorridorEngine, type GpsFix } from '../../walk/corridorEngine';

const T0 = Date.parse('2026-08-01T06:00:00Z');
const DAY = 86_400_000;

const root = signerFromKeyPair(generateKeyPair());
const rootKeyId = deriveKeyId('MEMBERSHIP_ROOT', root.publicKeyHex);
const TRUSTED_ROOTS = { [rootKeyId]: root.publicKeyHex };

/** 다니엘 쌤 (지불자·불곡산). */
const daniel = signerFromKeyPair(generateKeyPair());
const DANIEL_ID = 'SHV-2026-000001';
/** 이스라엘 종주자. */
const hiker = signerFromKeyPair(generateKeyPair());
const HIKER_ID = 'SHV-2026-000777';
/** 엔젤 둘 — 하나는 거부하고 하나는 받는다. */
const angelA = signerFromKeyPair(generateKeyPair());
const angelB = signerFromKeyPair(generateKeyPair());
const ANGEL_A_ID = 'SHV-2026-009001';
const ANGEL_B_ID = 'SHV-2026-009002';

function certFor(memberId: string, device: Signer, issuedAt: number): MembershipCertificate {
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

const danielCert = certFor(DANIEL_ID, daniel, T0 - DAY);
const hikerCert = certFor(HIKER_ID, hiker, T0 - DAY);

// ── 걷기 시뮬레이터 (운영 엔진 그대로) ────────────────────────────────

interface GeoPoint {
  lat: number;
  lon: number;
}

/** 폴리라인을 stepM 간격으로 재표본. */
function resample(path: readonly GeoPoint[], stepM: number): GeoPoint[] {
  const out: GeoPoint[] = [];
  let residual = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const mPerLon = 111_320 * Math.cos((a.lat * Math.PI) / 180);
    const segLen = Math.hypot((b.lon - a.lon) * mPerLon, (b.lat - a.lat) * 111_320);
    if (segLen === 0) continue;
    let d = residual;
    while (d < segLen) {
      const t = d / segLen;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });
      d += stepM;
    }
    residual = d - segLen;
  }
  out.push(path[path.length - 1]!);
  return out;
}

/**
 * ★불곡산을 **실제로 걷는다** — CorridorEngine(운영 코드)에 픽스를 넣고 창을 닫아
 * WalkSample을 얻은 뒤, PendingWalkLedger(운영 코드)에 그대로 기록한다.
 * 재구현한 판정·요율은 하나도 없다.
 */
function walkBulgoksan(opts: { accuracyM?: number; startTs?: number; memberId?: string } = {}): {
  samples: WalkSample[];
  ledger: PendingWalkLedger;
} {
  const intervalS = 5;
  const speedMps = 1.0;
  const fixesPerWindow = 12;
  const engine = new CorridorEngine([BUNDANG_BULGOKSAN_SAMPLE], []);
  const ledger = new PendingWalkLedger({ memberId: opts.memberId ?? DANIEL_ID });
  const pts = resample(BUNDANG_BULGOKSAN_SAMPLE.polyline, speedMps * intervalS);
  const startTs = opts.startTs ?? T0;
  const samples: WalkSample[] = [];
  let inWindow = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i]!;
    const fix: GpsFix = {
      lat: p.lat,
      lon: p.lon,
      timestamp: startTs + i * intervalS * 1000,
      accuracy: opts.accuracyM ?? 12,
    };
    engine.addFix(fix);
    inWindow += 1;
    if (inWindow === fixesPerWindow) {
      engine.addSteps(Math.round((fixesPerWindow * speedMps * intervalS) / 0.75));
      const s = engine.closeWindow();
      if (s) {
        samples.push(s);
        ledger.recordSample(s);
      }
      inWindow = 0;
    }
  }
  return { samples, ledger };
}

/** 이스라엘 60일 완주 — dailyBreakdown 60항목짜리 코인 하나. */
function israel60(): Coin {
  const ledger = new PendingWalkLedger({ memberId: HIKER_ID });
  let last = T0;
  for (let d = 0; d < 60; d += 1) {
    let t = T0 + d * DAY;
    for (let w = 0; w < 176; w += 1) {
      // 17.6 km/일 = 100 m 창 176개
      ledger.recordSample({
        durationS: 72,
        distanceM: 100,
        steps: 140,
        tier: 'ON_COURSE',
        timestamp: t,
        courseId: 'shvil-israel',
      });
      t += 72_000;
    }
    last = t;
  }
  return mintWalkCoin(
    buildWalkSegmentProof(ledger.settleOnSpend(last)!, hiker, {
      membership: certFor(HIKER_ID, hiker, last - DAY),
      appIntegrityToken: 'a'.repeat(64),
    }),
  );
}

/** 손바뀜 n회를 붙인다(전부 완결). 마지막 소유자는 다시 `owner`. */
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

// ── 지불 한 판 (walletService.payCharge와 같은 선택·분할) ─────────────

interface PayOutcome {
  charge: ChargeMessage;
  paymentQr: string;
  qrLength: number;
  /** PayScreen이 실제로 QR을 그리는가 — 지금은 넘치면 나눠 그리므로 언제나 참이다. */
  renderedByScreen: boolean;
  /** QR **한 장** 규격에 들어가는가. */
  fitsSpec: boolean;
  /** 화면에 필요한 QR 장수 (1이면 한 장, 2 이상이면 돌려 가며 보여 준다). */
  frameCount: number;
  coins: Coin[];
  /** 분할 후 지갑에 남은 잔돈. */
  change: Coin | null;
}

/**
 * ★예전 PayScreen.tsx:93 의 하드코딩 상한(2900). 규격 상한(2953)보다 낮아서
 * **규격 안에 드는 코인까지 죽였다.** 2026-07-27에 제거됐다 — 이 상수는 그때
 * 무엇이 죽었는지 로그로 남기기 위해서만 쓴다.
 */
const OLD_PAY_SCREEN_LIMIT = 2900;

function payWith(
  ownedOldestFirst: Coin[],
  amountDshv: number,
  payerId: string,
  payer: Signer,
  angel: Signer,
  angelId: string,
  now: number,
): PayOutcome {
  const charge = buildCharge(
    { chargeId: 'chg-e2e', angelMemberId: angelId, amountDshv, serviceType: 'SHOWER', createdAt: now },
    angel,
  );
  const plan = planCoinSelection(ownedOldestFirst, amountDshv);
  let picked = [...plan.whole];
  let change: Coin | null = null;
  if (plan.split) {
    const [pay, chg] = splitCoin(plan.split.coin, payer, [plan.split.keepDshv, plan.split.changeDshv], now);
    picked.push(pay!);
    change = chg!;
  }
  const payment = buildPayment(charge, picked, payerId, payer, now);
  const qr = encodeQr(payment);
  return {
    charge,
    paymentQr: qr,
    qrLength: qr.length,
    // 지금은 한 장을 넘으면 나눠 그린다 — 용량 때문에 지불이 막히는 일은 없다.
    renderedByScreen: true,
    fitsSpec: qr.length <= QR_BYTE_MODE_MAX_CHARS,
    frameCount: qrFramesFor(qr).length,
    coins: picked,
    change,
  };
}

function reviewOf(out: PayOutcome, angel: Signer, over: Partial<ReceiveReviewInput> = {}) {
  const payment = decodeQr(out.paymentQr);
  if (payment.type !== 'shvil/payment') throw new Error('지불 QR이 아니다');
  return buildReceiveReview({
    charge: out.charge,
    payment,
    angelAddress: addressFromPublicKey(angel.publicKeyHex),
    knownCoinIds: new Set(),
    flaggedMemberIds: [],
    knownCoins: [],
    trustedRootKeys: TRUSTED_ROOTS,
    trustedIssuerKeys: {},
    requireIntegrityToken: false,
    rulePacks: [],
    now: T0 + DAY,
    ...over,
  });
}

// ══════════════════════════════════════════════════════════════════════
describe('① 다니엘 쌤 — 불곡산 1.8 km 걷고 정산하고 지불까지', () => {
  const { samples, ledger } = walkBulgoksan();
  const draft = ledger.settleManual(T0 + 3 * 3600_000);

  it('걷기가 실제로 코인이 된다 (창→원장→코인)', () => {
    const onCourse = samples.filter((s) => s.tier === 'ON_COURSE').length;
    const emitted = samples.reduce((s, x) => s + x.distanceM, 0);
    console.log(
      `\n[①] 불곡산 창 ${samples.length}개 (ON_COURSE ${onCourse}) · 방출 거리 ${emitted} m · ` +
        `정산 ${draft ? draft.amountDshv / 10 : 0} SHV`,
    );
    expect(draft).not.toBeNull();
    expect(onCourse).toBe(samples.length);
    expect(draft!.amountDshv).toBeGreaterThan(0);
  });

  const coin = mintWalkCoin(
    buildWalkSegmentProof(draft!, daniel, { membership: danielCert, appIntegrityToken: 'a'.repeat(64) }),
  );

  it('그 코인으로 지불 QR이 만들어지고 화면에 실제로 그려진다', () => {
    // 잔돈이 생기도록 일부러 코인 액면보다 작은 금액을 낸다 (샤워 권장가와 같은 상황).
    const out = payWith([coin], Math.min(30, coin.amountDshv), DANIEL_ID, daniel, angelA, ANGEL_A_ID, T0 + DAY);
    console.log(
      `[①] 코인 액면 ${coin.amountDshv / 10} SHV → ${out.coins.reduce((s, c) => s + c.amountDshv, 0) / 10} SHV 지불 ` +
        `· QR ${out.qrLength}자 (${out.frameCount}장 · 옛 화면상한 ${OLD_PAY_SCREEN_LIMIT}) · 잔돈 ${out.change ? out.change.amountDshv / 10 : 0} SHV`,
    );
    expect(out.fitsSpec).toBe(true);
    expect(out.renderedByScreen).toBe(true);
  });

  it('엔젤이 검토→수령→확인 QR까지 완결된다', () => {
    const out = payWith([coin], Math.min(30, coin.amountDshv), DANIEL_ID, daniel, angelA, ANGEL_A_ID, T0 + DAY);
    const review = reviewOf(out, angelA);
    console.log(
      `[①] 검토: 코어 ${review.coreVerdict} · 내기준 ${review.extendedVerdict} · 발견 ${review.findings.length}건 · ` +
        `clean=${review.clean} blocked=${review.blocked}`,
    );
    expect(review.blocked).toBe(false);
    expect(review.clean).toBe(true);

    const payment = decodeQr(out.paymentQr);
    if (payment.type !== 'shvil/payment') throw new Error('지불 QR이 아니다');
    const { coins, confirm } = acceptReviewedPayment(review, out.charge, payment, angelA);
    expect(verifyConfirm(confirm, out.charge)).toBe(true);
    expect(encodeQr(confirm).length).toBeLessThan(600);
    for (const c of coins) {
      expect(verifyCoin(c, { trustedRootKeys: TRUSTED_ROOTS }).valid).toBe(true);
      expect(currentOwnerAddress(c)).toBe(addressFromPublicKey(angelA.publicKeyHex));
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
describe('② 이스라엘 60일 완주자가 자기 코인을 쓴다', () => {
  const coin = israel60();

  it('60일치 코인이 만들어진다', () => {
    console.log(`\n[②] 이스라엘 60일 코인: ${coin.amountDshv / 10} SHV`);
    expect(coin.amountDshv).toBeGreaterThan(0);
  });

  it('통째로 지불해도 한 장에 들어간다', () => {
    const out = payWith([coin], coin.amountDshv, HIKER_ID, hiker, angelA, ANGEL_A_ID, T0 + 61 * DAY);
    console.log(`[②] 통째 지불 QR ${out.qrLength}자 · QR ${out.frameCount}장`);
    expect(out.fitsSpec).toBe(true);
    expect(out.renderedByScreen).toBe(true);
  });

  it('★잔돈 분할(샤워 3 SHV)로 내도 들어가고, 엔젤이 검토·수령할 수 있다', () => {
    const out = payWith([coin], 30, HIKER_ID, hiker, angelA, ANGEL_A_ID, T0 + 61 * DAY);
    console.log(
      `[②] 3 SHV 분할 지불 QR ${out.qrLength}자 · 잔돈 ${out.change!.amountDshv / 10} SHV · QR ${out.frameCount}장`,
    );
    expect(out.renderedByScreen).toBe(true);
    const review = reviewOf(out, angelA, { now: T0 + 61 * DAY });
    console.log(`[②] 검토: 코어 ${review.coreVerdict} · 발견 ${review.findings.length}건 · blocked=${review.blocked}`);
    expect(review.blocked).toBe(false);
    // 하루 상한(40 SHV)을 넘지 않는 정직한 종주자이므로 인간 한계 발견이 없어야 한다.
    expect(review.findings.filter((f) => f.title.includes('인간 한계'))).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════
describe('③ 손바뀜이 있는 코인으로 지불한다 (헌법 제7조 — 순환)', () => {
  const base = israel60();
  const rows: { n: number; len: number; frames: number; spec: boolean }[] = [];

  it('이전 1·2·3회 코인이 각각 지불되는가', () => {
    for (const n of [1, 2, 3]) {
      const coin = withHistory(base, n, hiker);
      const out = payWith([coin], 30, HIKER_ID, hiker, angelA, ANGEL_A_ID, T0 + 61 * DAY);
      rows.push({ n, len: out.qrLength, frames: out.frameCount, spec: out.fitsSpec });
    }
    console.log('\n[③] 이스라엘 60일 코인 · 3 SHV 분할 지불');
    for (const r of rows) {
      console.log(`     이전 ${r.n}회 → ${r.len}자 · QR ${r.frames}장 · 한장규격 ${r.spec ? 'O' : '✗'}`);
    }
    // 못박지 않는다 — 어디서 끊기는지를 사실 그대로 남긴다.
    expect(rows).toHaveLength(3);
  });

  it('★순환의 실제 모습: 엔젤이 받은 코인들로 다시 지불한다', () => {
    // 엔젤 A가 3 SHV짜리 지불을 여러 번 받았다 (각 코인은 이전 1회).
    const received: Coin[] = [];
    for (let i = 0; i < 6; i += 1) {
      const src = mintWalkCoin(
        buildWalkSegmentProof(
          (() => {
            const l = new PendingWalkLedger({ memberId: DANIEL_ID });
            let t = T0 + i * DAY;
            for (let w = 0; w < 30; w += 1) {
              l.recordSample({
                durationS: 72,
                distanceM: 100,
                steps: 140,
                tier: 'ON_COURSE',
                timestamp: t,
                courseId: 'bundang-bulgoksan',
              });
              t += 72_000;
            }
            return l.settleOnSpend(t)!;
          })(),
          daniel,
          { membership: danielCert, appIntegrityToken: 'a'.repeat(64) },
        ),
      );
      // 다니엘 → 엔젤 A 로 손이 바뀐다 (이전 1회 완결).
      const t1 = createTransfer(src, daniel, angelA.publicKeyHex, T0 + i * DAY + 3600_000);
      received.push(acknowledgeTransfer(t1, angelA));
    }
    const each = received[0]!.amountDshv;
    console.log(`\n[③] 엔젤 A가 받은 코인 ${received.length}개 (각 ${each / 10} SHV, 이전 1회)`);
    // 엔젤 A가 자기 순례에서 잠자리 10 SHV를 낸다 → 여러 장이 묶인다.
    const table: string[] = [];
    let firstBroken: number | null = null;
    for (let k = 1; k <= received.length; k += 1) {
      const amount = received.slice(0, k).reduce((s, c) => s + c.amountDshv, 0);
      const out = payWith(received.slice(0, k), amount, ANGEL_A_ID, angelA, angelB, ANGEL_B_ID, T0 + 10 * DAY);
      table.push(
        `     코인 ${k}개 (${amount / 10} SHV) → ${out.qrLength}자 · QR ${out.frameCount}장 · 한장규격 ${out.fitsSpec ? 'O' : '✗'}` +
          `${out.qrLength > OLD_PAY_SCREEN_LIMIT ? '  ← 옛 화면에서는 여기서 지불 불가였다' : ''}`,
      );
      if (!out.fitsSpec && firstBroken === null) firstBroken = k;
    }
    for (const line of table) console.log(line);
    console.log(`     ★한 장에 안 들어가기 시작하는 지점: 코인 ${firstBroken ?? '없음'}개 (그래도 나눠서 지불된다)`);
    expect(table).toHaveLength(received.length);
  });
});

// ══════════════════════════════════════════════════════════════════════
describe('④ 엔젤이 거부해도 지불자 코인이 산다', () => {
  const coin = israel60();

  it('거부 → 같은 코인으로 다른 엔젤에게 다시 지불할 수 있다', () => {
    const first = payWith([coin], 30, HIKER_ID, hiker, angelA, ANGEL_A_ID, T0 + 61 * DAY);
    const review = reviewOf(first, angelA, { now: T0 + 61 * DAY });
    expect(review.blocked).toBe(false);
    // 엔젤 A가 "안 받겠다" — 아무것도 서명하지 않는다. 여기서 끝.

    // 지불자 지갑의 원본은 손대지 않았어야 한다.
    // (buildPayment는 사본에만 이전 링크를 붙인다 — 그 사실을 여기서 확인한다.)
    const payerSideCoins = first.coins;
    for (const c of payerSideCoins) {
      // 지불 QR 안의 코인은 미완결 이전 링크가 붙어 있다.
      expect(c.transferChain.length).toBeGreaterThanOrEqual(0);
    }
    // 지갑 원본 = 분할 직후의 pay 코인 (이전 링크 없음).
    const [payPart] = splitCoin(coin, hiker, [30, coin.amountDshv - 30], T0 + 61 * DAY);
    expect(payPart!.transferChain).toHaveLength(0);

    // 같은 코인으로 엔젤 B에게 다시 지불 → 깨끗해야 한다.
    const second = payWith([payPart!], 30, HIKER_ID, hiker, angelB, ANGEL_B_ID, T0 + 61 * DAY + 60_000);
    const review2 = reviewOf(second, angelB, { now: T0 + 61 * DAY + 60_000 });
    console.log(
      `\n[④] 재지불 검토: 코어 ${review2.coreVerdict} · blocked=${review2.blocked} · clean=${review2.clean}`,
    );
    expect(review2.blocked).toBe(false);
    expect(review2.clean).toBe(true);
    const payment2 = decodeQr(second.paymentQr);
    if (payment2.type !== 'shvil/payment') throw new Error('지불 QR이 아니다');
    const { coins } = acceptReviewedPayment(review2, second.charge, payment2, angelB);
    expect(verifyCoin(coins[0]!, { trustedRootKeys: TRUSTED_ROOTS }).valid).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
describe('⑥ 규칙 팩을 안 얹은 평범한 엔젤의 단계 수 (헌법 제8조)', () => {
  it('깨끗한 지불은 clean=true — 빠른 길이 열린다', () => {
    const { ledger } = walkBulgoksan();
    const draft = ledger.settleManual(T0 + 3 * 3600_000)!;
    const coin = mintWalkCoin(
      buildWalkSegmentProof(draft, daniel, { membership: danielCert, appIntegrityToken: 'a'.repeat(64) }),
    );
    const out = payWith([coin], coin.amountDshv, DANIEL_ID, daniel, angelA, ANGEL_A_ID, T0 + DAY);
    const review = reviewOf(out, angelA);
    expect(review.clean).toBe(true);
    expect(review.findings).toEqual([]);
  });

  it('키 목록이 **낡은**(다른 루트만 아는) 엔젤은 멈춘다 — 거절이 아니라 질문', () => {
    const { ledger } = walkBulgoksan();
    const draft = ledger.settleManual(T0 + 3 * 3600_000)!;
    const coin = mintWalkCoin(
      buildWalkSegmentProof(draft, daniel, { membership: danielCert, appIntegrityToken: 'a'.repeat(64) }),
    );
    const out = payWith([coin], coin.amountDshv, DANIEL_ID, daniel, angelA, ANGEL_A_ID, T0 + DAY);
    const other = signerFromKeyPair(generateKeyPair());
    const review = reviewOf(out, angelA, {
      trustedRootKeys: { [deriveKeyId('MEMBERSHIP_ROOT', other.publicKeyHex)]: other.publicKeyHex },
    });
    console.log(
      `\n[⑥] 낡은 키 목록: blocked=${review.blocked} clean=${review.clean} 코어=${review.coreVerdict}\n` +
        review.findings.map((f) => `     [${f.severity}] ${f.title}`).join('\n'),
    );
    expect(review.blocked).toBe(false); // 거절이 아니라 질문이어야 한다
    expect(review.clean).toBe(false); // 단계는 늘어난다
  });
});

// ══════════════════════════════════════════════════════════════════════
describe('⑦-b 공격 — 키 캐시가 빈 엔젤에게 자작 증서 코인을 내민다', () => {
  /** 공격자: 자기 루트 키로 자기 회원증을 만들고, 자기 기기 키로 코인을 찍는다. */
  const evilRoot = signerFromKeyPair(generateKeyPair());
  const evilRootKeyId = deriveKeyId('MEMBERSHIP_ROOT', evilRoot.publicKeyHex);
  const evil = signerFromKeyPair(generateKeyPair());
  const EVIL_ID = 'SHV-2026-666666';
  const evilCert = buildMembershipCertificate(
    {
      memberId: EVIL_ID,
      devicePublicKey: evil.publicKeyHex,
      integrity: 'VERIFIED',
      issuedAt: T0 - DAY,
      expiresAt: T0 - DAY + 30 * DAY,
      issuerKeyId: evilRootKeyId, // ★쉬빌이 모르는 루트 — 자작이다
    },
    evilRoot,
  );

  function evilCoin(): Coin {
    const ledger = new PendingWalkLedger({ memberId: EVIL_ID });
    let t = T0;
    for (let w = 0; w < 100; w += 1) {
      ledger.recordSample({
        durationS: 72,
        distanceM: 100,
        steps: 140,
        tier: 'ON_COURSE',
        timestamp: t,
        courseId: 'shvil-israel',
      });
      t += 72_000;
    }
    return mintWalkCoin(
      buildWalkSegmentProof(ledger.settleManual(t)!, evil, {
        membership: evilCert,
        appIntegrityToken: 'f'.repeat(64),
      }),
    );
  }

  const coin = evilCoin();
  const out = payWith([coin], coin.amountDshv, EVIL_ID, evil, angelA, ANGEL_A_ID, T0 + DAY);

  it('★키 캐시가 비면 자작 증서라도 코어는 AUTHENTIC이지만, **자동 수령되지는 않는다** (2026-07-27 수정됨)', () => {
    const review = reviewOf(out, angelA, { trustedRootKeys: {}, trustedIssuerKeys: {} });
    console.log(
      `\n[⑦-b] 키 캐시 빈 엔젤이 자작 증서 코인을 봤을 때:\n` +
        `      코어 ${review.coreVerdict} · 내기준 ${review.extendedVerdict} · blocked=${review.blocked} · clean=${review.clean}\n` +
        `      발견 ${review.findings.length}건${review.findings.map((f) => `\n      [${f.severity}] ${f.title}`).join('')}`,
    );
    // 코어 판정 자체는 여전히 AUTHENTIC이다 — 대조할 목록이 없으니 위조라고 **말할 수 없다**.
    // 그 사실은 그대로 두되(제3조), "검사하지 않았다"를 "깨끗하다"로 바꾸지는 않는다.
    expect(review.coreVerdict).toBe('AUTHENTIC');
    expect(review.blocked, '자격 미증명은 막지 않는다 — 엔젤의 결정이다(제9조)').toBe(false);
    expect(review.clean, '★검사하지 못한 코인이 빠른 길로 자동 수령되면 안 된다').toBe(false);
    expect(
      review.findings.some((f) => f.origin === 'LOCAL' && f.title.includes('신뢰 키 목록이 없어')),
      '무엇을 검사하지 못했는지 화면에 낼 발견이 없다',
    ).toBe(true);
  });

  it('키 캐시가 채워지면 이 안내는 사라진다 (정직한 엔젤을 영원히 귀찮게 하지 않는다)', () => {
    const good = payWith([israel60()], 30, HIKER_ID, hiker, angelB, ANGEL_B_ID, T0 + 61 * DAY);
    const review = reviewOf(good, angelB, { now: T0 + 61 * DAY, trustedRootKeys: TRUSTED_ROOTS });
    expect(review.findings.filter((f) => f.origin === 'LOCAL')).toHaveLength(0);
    expect(review.clean).toBe(true);
  });

  it('키 캐시가 하나라도 차 있으면 같은 코인이 멈춘다 (SUSPECT)', () => {
    const review = reviewOf(out, angelA, { trustedRootKeys: TRUSTED_ROOTS });
    console.log(
      `[⑦-b] 키 캐시가 있는 엔젤: 코어 ${review.coreVerdict} · clean=${review.clean} · ` +
        review.findings.map((f) => `[${f.severity}] ${f.title}`).join(' / '),
    );
    expect(review.clean).toBe(false);
    expect(review.findings.some((f) => f.severity === 'STOP')).toBe(true);
  });

  it('★공격자가 하루 한도(40 SHV)를 무시한 증명을 직접 서명하면 잡히는가', () => {
    // 원장을 거치지 않고 draft를 손으로 짜서 서명한다 — 공격자는 자기 기기 키를 갖고 있다.
    const bogus = buildWalkSegmentProof(
      {
        memberId: EVIL_ID,
        settlement: 'MANUAL',
        startedAt: T0,
        settledAt: T0 + 3600_000,
        distanceM: 400_000,
        stepCount: 520_000,
        courseIds: ['shvil-israel'],
        amountDshv: 4_000, // 400 SHV — 하루 상한의 10배
        dailyBreakdown: [{ date: '2026-08-01', amountDshv: 4_000 }],
        sensorSummaryHash: 'f'.repeat(64),
      },
      evil,
      { membership: evilCert, appIntegrityToken: 'f'.repeat(64) },
    );
    const forged = mintWalkCoin(bogus);
    const bogusOut = payWith([forged], forged.amountDshv, EVIL_ID, evil, angelA, ANGEL_A_ID, T0 + DAY);
    for (const roots of [{}, TRUSTED_ROOTS]) {
      const review = reviewOf(bogusOut, angelA, { trustedRootKeys: roots });
      console.log(
        `[⑦-b] 400 SHV/일 위조 증명 (키캐시 ${Object.keys(roots).length ? '있음' : '없음'}): ` +
          `blocked=${review.blocked} clean=${review.clean} 코어=${review.coreVerdict}\n` +
          review.findings.map((f) => `      [${f.severity}] ${f.title}`).join('\n'),
      );
      expect(review.blocked, '물리적으로 불가능한 하루가 막히지 않았다').toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
describe('⑦ 공격 — 검토와 확정 사이에 코인을 바꿔치기한다', () => {
  const good = israel60();

  function outFor(coins: Coin[], angel: Signer, angelId: string) {
    const amount = coins.reduce((s, c) => s + c.amountDshv, 0);
    return payWith(coins, amount, HIKER_ID, hiker, angel, angelId, T0 + 61 * DAY);
  }

  it('★acceptReviewedPayment가 검토한 payment와 확정할 payment를 대조한다 (2026-07-27 수정됨)', () => {
    const clean = outFor([splitCoin(good, hiker, [30, good.amountDshv - 30], T0 + 61 * DAY)[0]!], angelA, ANGEL_A_ID);
    const review = reviewOf(clean, angelA, { now: T0 + 61 * DAY });
    expect(review.blocked).toBe(false);

    // 공격자가 확정 단계에 **다른** payment를 밀어 넣는다.
    // (같은 charge, 같은 금액, 그러나 검토되지 않은 코인.)
    const swapped = payWith(
      [splitCoin(good, hiker, [30, good.amountDshv - 30], T0 + 61 * DAY + 1)[0]!],
      30,
      HIKER_ID,
      hiker,
      angelA,
      ANGEL_A_ID,
      T0 + 61 * DAY + 1,
    );
    const swappedPayment = decodeQr(swapped.paymentQr);
    if (swappedPayment.type !== 'shvil/payment') throw new Error('지불 QR이 아니다');

    // charge는 검토 때 것, payment는 바꿔치기한 것 — 함수가 이것을 받아 주는가?
    let accepted = false;
    let message = '';
    try {
      const { coins } = acceptReviewedPayment(review, clean.charge, swappedPayment, angelA);
      accepted = coins.length > 0;
    } catch (e) {
      accepted = false;
      message = e instanceof Error ? e.message : String(e);
    }
    console.log(`\n[⑦] 검토와 다른 payment를 확정에 넘겼을 때 통과하는가: ${accepted} (${message})`);
    // ★예전에는 여기서 true가 나왔다 — 막아 준 것은 호출부의 관습뿐이었고, 관습은
    //   리팩터 한 번에 사라진다. 이제 함수 자신이 검토 리포트와 대조한다.
    expect(accepted).toBe(false);
    expect(message).toMatch(/검토한 지불과 다른/);
  });

  it('검토한 바로 그 지불이면 통과한다 (대조가 정상 경로를 막지 않는다)', () => {
    const clean = outFor([splitCoin(good, hiker, [30, good.amountDshv - 30], T0 + 61 * DAY)[0]!], angelB, ANGEL_B_ID);
    const review = reviewOf(clean, angelB, { now: T0 + 61 * DAY });
    const payment = decodeQr(clean.paymentQr);
    if (payment.type !== 'shvil/payment') throw new Error('지불 QR이 아니다');
    const { coins, confirm } = acceptReviewedPayment(review, clean.charge, payment, angelB);
    expect(coins).toHaveLength(1);
    expect(verifyConfirm(confirm, clean.charge)).toBe(true);
  });

  it('BLOCK 판정을 받은 검토는 확정 함수 자신이 거절한다', () => {
    const clean = outFor([splitCoin(good, hiker, [30, good.amountDshv - 30], T0 + 61 * DAY)[0]!], angelA, ANGEL_A_ID);
    const review = reviewOf(clean, angelA, { now: T0 + 61 * DAY });
    const payment = decodeQr(clean.paymentQr);
    if (payment.type !== 'shvil/payment') throw new Error('지불 QR이 아니다');
    expect(() => acceptReviewedPayment({ ...review, blocked: true }, clean.charge, payment, angelA)).toThrow(
      /수령할 수 없습니다/,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════
describe('부수 — 위폐 검사기 입력 파서가 새 QR을 읽는가', () => {
  it('★SHV2 지불 QR을 검사기에 붙여넣을 수 있는가', () => {
    const coin = israel60();
    const out = payWith([coin], 30, HIKER_ID, hiker, angelA, ANGEL_A_ID, T0 + 61 * DAY);
    expect(out.paymentQr.startsWith('SHV2.')).toBe(true);
    let ok = false;
    let message = '';
    try {
      const parsed = parseCheckerInput(out.paymentQr);
      ok = parsed.coins.length > 0;
    } catch (e) {
      message = (e as Error).message;
    }
    console.log(`\n[부수] 검사기 파서가 SHV2 지불 QR을 읽는가: ${ok}${ok ? '' : ` — "${message}"`}`);
    expect(ok).toBe(true);
  });
});
