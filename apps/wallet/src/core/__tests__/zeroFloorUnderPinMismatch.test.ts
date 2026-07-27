/**
 * ★0층 보호 — 핀 불일치(서버 재배포·키 회전) 상태에서 **"설치하고 걸으면 끝"이 사는가.**
 *
 * 0층은 신성불가침이다(다니엘 쌤). 서버 키가 바뀌든, 사용자가 새 키를 거절하든,
 * 걷기·정산·민팅·QR 대면 지불·수령은 **서버 0회로** 끝까지 되어야 한다. 이 파일은 그것을
 * 운영 코드로 확인해 못박는다 — 나중에 누가 sync 실패를 앱 전체의 실패로 바꾸면 여기서 터진다.
 *
 * 전제: 배포 키가 바뀌어 `guardDistribution`이 거부한다. 그 결과 지갑에서 실패하는 것은
 * `syncCourses`·`syncFlaggedList`·`syncTreasures`·`fetchKeyInfos`(→캐시 폴백)뿐이다.
 */
import { describe, expect, it } from 'vitest';
import {
  BUNDANG_BULGOKSAN_SAMPLE,
  PendingWalkLedger,
  addressFromPublicKey,
  buildCharge,
  buildMembershipCertificate,
  buildPayment,
  buildWalkSegmentProof,
  decodeQr,
  deriveKeyId,
  encodeQr,
  generateKeyPair,
  mintWalkCoin,
  signDistribution,
  signerFromKeyPair,
  verifyCoin,
  type Coin,
  type Signer,
  type WalkSample,
} from '@shvil/shared';
import { CorridorEngine, type GpsFix } from '../../walk/corridorEngine';
import { guardDistribution } from '../distributionGuard';
import { acceptReviewedPayment, buildReceiveReview } from '../receiveReview';

const T0 = Date.parse('2026-08-01T06:00:00Z');
const DAY = 86_400_000;

/** 옛 배포(핀됨) / 새 배포(재배포 후) 두 벌의 서버 키. */
const oldDist = signerFromKeyPair(generateKeyPair());
const newDist = signerFromKeyPair(generateKeyPair());
const oldRoot = signerFromKeyPair(generateKeyPair());
const newRoot = signerFromKeyPair(generateKeyPair());
const OLD_ROOT_ID = deriveKeyId('MEMBERSHIP_ROOT', oldRoot.publicKeyHex);
const NEW_ROOT_ID = deriveKeyId('MEMBERSHIP_ROOT', newRoot.publicKeyHex);

const walker = signerFromKeyPair(generateKeyPair());
const angel = signerFromKeyPair(generateKeyPair());
const WALKER_ID = 'SHV-2026-000001';
const ANGEL_ID = 'SHV-2026-009001';

interface GeoPoint {
  lat: number;
  lon: number;
}

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

/** 운영 엔진으로 불곡산을 실제로 걷는다 (walkService가 쓰는 내장 폴백 코스). */
function walkBulgoksan(memberId: string): { samples: WalkSample[]; ledger: PendingWalkLedger } {
  const intervalS = 5;
  const speedMps = 1.0;
  const fixesPerWindow = 12;
  // ★서버 캐시 없이 **내장 코스만** 넣는다 — 이것이 walkService의 오프라인 폴백이다.
  const engine = new CorridorEngine([BUNDANG_BULGOKSAN_SAMPLE], []);
  const ledger = new PendingWalkLedger({ memberId });
  const pts = resample(BUNDANG_BULGOKSAN_SAMPLE.polyline, speedMps * intervalS);
  const samples: WalkSample[] = [];
  let inWindow = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i]!;
    const fix: GpsFix = { lat: p.lat, lon: p.lon, timestamp: T0 + i * intervalS * 1000, accuracy: 12 };
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

function certFrom(root: Signer, keyId: string, memberId: string, device: Signer, issuedAt: number) {
  return buildMembershipCertificate(
    {
      memberId,
      devicePublicKey: device.publicKeyHex,
      integrity: 'VERIFIED',
      issuedAt,
      expiresAt: issuedAt + 30 * DAY,
      issuerKeyId: keyId,
    },
    root,
  );
}

/** 지불 한 판 — 검토까지. */
function payAndReview(coin: Coin, trustedRootKeys: Record<string, string>) {
  const amount = coin.amountDshv;
  const charge = buildCharge(
    { chargeId: 'chg-temp', angelMemberId: ANGEL_ID, amountDshv: amount, serviceType: 'SHOWER', createdAt: T0 + DAY },
    angel,
  );
  const payment = buildPayment(charge, [coin], WALKER_ID, walker, T0 + DAY);
  const decoded = decodeQr(encodeQr(payment));
  if (decoded.type !== 'shvil/payment') throw new Error('지불 QR이 아니다');
  const review = buildReceiveReview({
    charge,
    payment: decoded,
    angelAddress: addressFromPublicKey(angel.publicKeyHex),
    knownCoinIds: new Set(),
    flaggedMemberIds: [],
    knownCoins: [],
    trustedRootKeys,
    trustedIssuerKeys: {},
    requireIntegrityToken: false,
    rulePacks: [],
    now: T0 + DAY,
  });
  return { charge, payment: decoded, review };
}

describe('핀 불일치 상태 — 0층이 사는가', () => {
  it('전제 재확인: 재배포 서명은 핀 때문에 거부된다 (동기화 정지)', () => {
    const fresh = signDistribution({ courses: [] }, newDist, 'distribution-x', T0);
    expect(() => guardDistribution(fresh, oldDist.publicKeyHex)).toThrow(/KEY_PIN_MISMATCH/);
    // 가드가 스스로 핀을 갈아끼우는 일은 없다 — pinToStore는 언제나 null.
    // (핀 교체는 오직 사용자가 화면에서 누른 `acceptPinChange`로만 일어난다.)
    const same = signDistribution({ courses: [] }, oldDist, 'distribution-x', T0);
    expect(guardDistribution(same, oldDist.publicKeyHex).pinToStore).toBeNull();
  });

  it('걷기·정산·민팅이 서버 없이 끝까지 된다 (미가입 · 신뢰 키 0개)', () => {
    const { samples, ledger } = walkBulgoksan(WALKER_ID);
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every((s) => s.tier === 'ON_COURSE')).toBe(true);
    const draft = ledger.settleManual(T0 + 3 * 3600_000);
    expect(draft).not.toBeNull();
    expect(draft!.amountDshv).toBeGreaterThan(0);
    const coin = mintWalkCoin(buildWalkSegmentProof(draft!, walker));
    // 신뢰 키 목록이 통째로 비어도 코인이 성립한다 = 0층.
    expect(verifyCoin(coin, { trustedRootKeys: {}, trustedIssuerKeys: {}, now: T0 + DAY }).valid).toBe(true);
    console.log(`[0층] 불곡산 정산 ${coin.amountDshv / 10} SHV · 신뢰키 0개로 verifyCoin 통과`);
  });

  it('QR 대면 지불·수령이 서버 없이 완결된다 (핀 불일치와 무관)', () => {
    const { ledger } = walkBulgoksan(WALKER_ID);
    const coin = mintWalkCoin(buildWalkSegmentProof(ledger.settleManual(T0 + 3 * 3600_000)!, walker));
    const { charge, payment, review } = payAndReview(coin, {});
    expect(review.blocked).toBe(false);
    const accepted = acceptReviewedPayment(review, charge, payment, angel);
    expect(accepted.coins).toHaveLength(1);
    expect(accepted.confirm.chargeId).toBe('chg-temp');
  });

  it('옛(핀된) 루트로 발급된 증서 코인은 낡은 캐시로 계속 검증된다', () => {
    const { ledger } = walkBulgoksan(WALKER_ID);
    const settledAt = T0 + 3 * 3600_000;
    const coin = mintWalkCoin(
      buildWalkSegmentProof(ledger.settleManual(settledAt)!, walker, {
        membership: certFrom(oldRoot, OLD_ROOT_ID, WALKER_ID, walker, T0 - DAY),
        appIntegrityToken: 'a'.repeat(64),
      }),
    );
    const { review } = payAndReview(coin, { [OLD_ROOT_ID]: oldRoot.publicKeyHex });
    expect(review.blocked).toBe(false);
    expect(review.findings).toHaveLength(0);
  });

  // ★"영원히"가 아니다 — 사용자가 「서버 열쇠」 화면에서 새 키를 받으면 /keys가 다시
  //   열리고 새 루트가 캐시에 누적된다(pinRecovery.test.ts). 받지 않는 동안의 모습이 이것이다.
  it('★새 루트로 발급된 증서 코인은 (열쇠를 받기 전까지) 자격 미증명(STOP)이 된다', () => {
    const { ledger } = walkBulgoksan(WALKER_ID);
    const coin = mintWalkCoin(
      buildWalkSegmentProof(ledger.settleManual(T0 + 3 * 3600_000)!, walker, {
        membership: certFrom(newRoot, NEW_ROOT_ID, WALKER_ID, walker, T0 - DAY),
        appIntegrityToken: 'a'.repeat(64),
      }),
    );
    // 핀 때문에 /keys를 못 받으므로 새 루트는 캐시에 영원히 들어오지 못한다.
    const { charge, payment, review } = payAndReview(coin, { [OLD_ROOT_ID]: oldRoot.publicKeyHex });
    const stops = review.findings.filter((f) => f.severity === 'STOP');
    expect(stops.length).toBeGreaterThan(0);
    expect(stops[0]!.title).toMatch(/루트 키를 내 지갑이 모릅니다/);
    // ★그래도 막히지는 않는다 — 엔젤이 보고 받을 수 있다 (제9조).
    expect(review.blocked).toBe(false);
    expect(() => acceptReviewedPayment(review, charge, payment, angel)).not.toThrow();
    console.log(`[재배포 후] 새 루트 코인: STOP ${stops.length}건 · blocked=${review.blocked} (수령은 가능)`);
  });
});
