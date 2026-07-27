/**
 * ★적대검증 2026-07-28 — 「서버 열쇠」 복구 경로가 새 공격 통로인가.
 *
 * 앞선 작업이 배포 키 TOFU 핀에 **사람이 푸는 문**을 달았다. 이 파일은 그 문을 실제로
 * 두드려 본다. 합성 시나리오가 아니라 **운영 코드 그대로**다 —
 * `core/directory.ts`(kv·API만 모의)와 `core/distributionGuard.ts`,
 * `core/pinRecovery.ts`, 그리고 걷기는 운영 `CorridorEngine`을 쓴다.
 *
 * 이 파일이 재현하는 것(전부 실제로 통과한다):
 *  ① 공격자가 핀 불일치를 **의도적으로** 일으켜 화면을 띄울 수 있다.
 *  ② ★공격자가 화면의 `newKeyId`를 위조하려 해도 **이제는 통하지 않는다** — 아래 ①-b.
 *  ③ ★"횟수가 늘면 진짜일 가능성이 크다"는 조언은 **삭제됐다** — 아래 ①-d.
 *  ④ 사용자가 (정직한 이름을 단) 공격자를 받으면 발행 권위가 갈아끼워진다 — 남는 위험.
 *  ⑤ 그래도 **보유 코인은 죽지 않고 0층은 산다** — 그 부분은 설계대로다.
 *
 * ── ★2026-07-28 수리 후 갱신 ────────────────────────────────────────
 * ①-b·①-d가 재현한 두 구멍은 고쳤다. 이 파일은 이제 **고쳐졌다는 사실**을 못박는
 * 회귀 테스트다(구멍을 되살리면 여기가 먼저 깨진다). ①-e 이후는 여전히 **남는 위험**을
 * 재현한다 — 사람이 지문을 확인하지 않고 받으면 무슨 일이 벌어지는지.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUNDANG_BULGOKSAN_SAMPLE,
  PendingWalkLedger,
  addressFromPublicKey,
  buildCharge,
  buildGrant,
  buildMembershipCertificate,
  buildPayment,
  buildWalkSegmentProof,
  decodeQr,
  deriveKeyId,
  encodeQr,
  generateKeyPair,
  isSelfDerivedKeyId,
  mintGrantCoin,
  mintWalkCoin,
  signDistribution,
  signerFromKeyPair,
  verifyCoin,
  verifyMembershipCertificate,
  type Signed,
  type Signer,
  type WalkSample,
} from '@shvil/shared';
import { CorridorEngine, type GpsFix } from '../../walk/corridorEngine';

// ── kv·기기 의존을 걷어내고 **운영 directory.ts를 그대로** 부른다 ──────

const kv = new Map<string, string>();

vi.mock('../db', () => ({
  kvGet: async (k: string) => kv.get(k) ?? null,
  kvSet: async (k: string, v: string) => {
    kv.set(k, v);
  },
  kvDelete: async (k: string) => {
    kv.delete(k);
  },
  loadCoinsForSync: async () => [],
}));
vi.mock('../identity', () => ({ isProvisionalMemberId: () => false }));
vi.mock('../integrity', () => ({
  getIntegrityToken: async () => ({ platform: 'android', token: 'tok' }),
}));
vi.mock('../walletService', async () => {
  const shared = await import('@shvil/shared');
  return {
    wallet: {
      identity: {
        memberId: 'SHV-2026-000001',
        signer: shared.signerFromKeyPair(shared.generateKeyPair()),
        membership: undefined,
      },
      applyMembership: async () => {},
    },
  };
});

import {
  acceptPinChange,
  getTrustedIssuerKeys,
  getTrustedRootKeys,
  loadCachedCourses,
  loadPinChangeNotice,
  rejectPinChange,
  syncCourses,
  syncFlaggedList,
} from '../directory';
import { DIST_PIN_KEY } from '../distributionGuard';
import { PIN_AT_KEY } from '../pinRecovery';
import { acceptReviewedPayment, buildReceiveReview } from '../receiveReview';

// ── 두 세계: 진짜 서버 / 공격자 서버 ────────────────────────────────

interface Deployment {
  dist: Signer;
  root: Signer;
  promo: Signer;
  rootKeyId: string;
  promoKeyId: string;
  distKeyId: string;
}

function deployment(): Deployment {
  const dist = signerFromKeyPair(generateKeyPair());
  const root = signerFromKeyPair(generateKeyPair());
  const promo = signerFromKeyPair(generateKeyPair());
  return {
    dist,
    root,
    promo,
    rootKeyId: deriveKeyId('MEMBERSHIP_ROOT', root.publicKeyHex),
    promoKeyId: deriveKeyId('ANGEL_BONUS', promo.publicKeyHex),
    distKeyId: deriveKeyId('DISTRIBUTION', dist.publicKeyHex),
  };
}

const REAL = deployment();
const EVIL = deployment();

const T0 = Date.parse('2026-08-01T06:00:00Z');
const DAY = 86_400_000;

/** 이 배포가 `/keys`로 내려보내는 목록. */
function keyRows(d: Deployment) {
  return [
    { keyId: d.rootKeyId, publicKey: d.root.publicKeyHex, purpose: 'MEMBERSHIP_ROOT' },
    { keyId: d.promoKeyId, publicKey: d.promo.publicKeyHex, purpose: 'ANGEL_BONUS' },
  ];
}

/**
 * 서버 한 대를 흉내 낸다. `distKeyIdClaim`을 주면 **서명 메타의 이름만** 바꿔치기한다 —
 * 그것이 ②에서 재현하는 공격이다(이름은 서명 대상 안에 있지만, 서명하는 자가
 * 공격자 자신이므로 공격자가 원하는 값을 넣을 수 있다).
 */
function serve(d: Deployment, path: string, distKeyIdClaim = d.distKeyId): Signed<object> {
  const now = Date.now();
  const body =
    path === '/keys'
      ? { keys: keyRows(d) }
      : path === '/courses'
        ? { courses: [] }
        : path === '/limits/flagged'
          ? { members: [] }
          : { treasures: [] };
  return signDistribution(body, d.dist, distKeyIdClaim, now);
}

/** 지금 이 지갑이 접속하고 있는 서버 (테스트가 중간에 갈아치운다). */
let currentServer: ((path: string) => Signed<object> | 'OFFLINE') | null = null;

function installFetch(): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = new URL(url).pathname;
    const out = currentServer?.(path);
    if (!out || out === 'OFFLINE') throw new TypeError('Network request failed');
    return new Response(JSON.stringify(out), { status: 200 });
  }) as typeof fetch;
}

const savedFetch = globalThis.fetch;
beforeEach(() => {
  kv.clear();
  installFetch();
});
afterEach(() => {
  globalThis.fetch = savedFetch;
  currentServer = null;
});

/** 정상 상태를 만든다: 진짜 서버에 붙어 TOFU 핀을 박는다. */
async function pinToRealServer(): Promise<void> {
  currentServer = (p) => serve(REAL, p);
  await syncCourses();
  expect(kv.get(DIST_PIN_KEY)).toBe(REAL.dist.publicKeyHex);
  expect(kv.get(PIN_AT_KEY)).toBeTruthy();
}

// ══ ① MITM — 화면을 띄울 수 있는가 ══════════════════════════════════

describe('적대검증 1 — MITM이 「서버 열쇠」 화면을 띄울 수 있는가', () => {
  it('①-a 공격자가 자기 키로 서명해 보내면 갱신이 거부되고 화면 후보가 쌓인다', async () => {
    await pinToRealServer();
    currentServer = (p) => serve(EVIL, p);

    await expect(syncCourses()).rejects.toThrow(/KEY_PIN_MISMATCH/);
    const notice = await loadPinChangeNotice();
    expect(notice).not.toBeNull();
    expect(notice!.pinnedFingerprint).not.toBe(notice!.newFingerprint);
    // 핀은 그대로 — 지갑이 스스로 갈아끼우지 않았다.
    expect(kv.get(DIST_PIN_KEY)).toBe(REAL.dist.publicKeyHex);
  });

  it('①-b ★★[수리됨] 이름 위조가 화면까지 오지 못한다 — 지갑이 이름을 직접 유도한다', async () => {
    await pinToRealServer();
    // 공격자는 중간자이므로 진짜 응답을 볼 수 있다 → 진짜 distKeyId를 그대로 베낀다.
    currentServer = (p) => serve(EVIL, p, REAL.distKeyId);

    await expect(syncCourses()).rejects.toThrow(/KEY_PIN_MISMATCH/);
    const notice = (await loadPinChangeNotice())!;

    // 예전: 화면이 진짜 서버의 이름을 그대로 보여줘, /health 대조가 공격자를 통과시켰다.
    // 지금: 이름은 **제시된 공개키에서 지갑이 유도한 값**이다 → 공격자가 고를 수 없다.
    expect(notice.newKeyId).not.toBe(REAL.distKeyId);
    expect(notice.newKeyId).toBe(deriveKeyId('DISTRIBUTION', EVIL.dist.publicKeyHex));
    expect(isSelfDerivedKeyId({ keyId: notice.newKeyId, publicKey: EVIL.dist.publicKeyHex, purpose: 'DISTRIBUTION' })).toBe(
      true,
    );

    // 그리고 "이름이 열쇠와 맞지 않았다"는 사실이 화면에 실려 **수락 단추가 내려간다.**
    expect(notice.acceptable).toBe(false);
    expect(notice.lines.join(' ')).toMatch(/자기 열쇠와 맞지 않는 이름/);

    // ★관문은 화면이 아니라 경로에 있다 — 화면을 우회해 불러도 핀은 안 바뀐다.
    expect(await acceptPinChange()).toBe(false);
    expect(kv.get(DIST_PIN_KEY)).toBe(REAL.dist.publicKeyHex);
    console.log(
      `[수리] 위조 이름 주장 → 화면 이름=${notice.newKeyId.slice(0, 24)}…(공격자 자신의 값) · 수락 불가`,
    );
  });

  it('①-b2 정직한 회전(이름=자기 유도값)은 그대로 사람에게 물어본다 — 벽돌이 되지 않는다', async () => {
    await pinToRealServer();
    currentServer = (p) => serve(EVIL, p); // EVIL이지만 이름은 자기 열쇠에서 유도한 값
    await expect(syncCourses()).rejects.toThrow(/KEY_PIN_MISMATCH/);
    const notice = (await loadPinChangeNotice())!;
    expect(notice.acceptable).toBe(true);
    expect(notice.newKeyId).toBe(EVIL.distKeyId);
    // ★그러나 지문은 진짜 서버와 다르다 — 사람이 대역 밖에서 확인해야 하는 지점이 여기다.
    expect(notice.newFingerprint).not.toBe(notice.pinnedFingerprint);
  });

  it('①-c 서버가 주장하는 서명 시각(signedAt)도 공격자 마음대로다', async () => {
    await pinToRealServer();
    const forged = signDistribution({ courses: [] }, EVIL.dist, REAL.distKeyId, T0 - 400 * DAY);
    currentServer = () => forged as Signed<object>;
    await expect(syncCourses()).rejects.toThrow(/KEY_PIN_MISMATCH/);
    const raw = JSON.parse(kv.get('distKeyPinPending.v1')!) as { signedAt: number };
    expect(raw.signedAt).toBe(T0 - 400 * DAY); // 검증에 쓰이지 않는 값이 그대로 실린다
  });

  it('①-d ★★[수리됨] 지속 MITM을 정상으로 보이게 하던 조언이 사라졌다', async () => {
    await pinToRealServer();
    currentServer = (p) => serve(EVIL, p);
    for (let i = 0; i < 12; i += 1) await syncCourses().catch(() => {});
    const notice = (await loadPinChangeNotice())!;
    expect(notice.seenCount).toBe(12);
    expect(notice.firstSeenText).not.toBe('알 수 없음');
    // 예전 문구: "횟수가 계속 늘고 지문이 매번 같다면 … 가능성이 큽니다" = 지속 MITM의 모양.
    const all = notice.lines.join(' ');
    expect(all).not.toMatch(/가능성이 큽니다/);
    expect(all).toMatch(/몇 번 봤는지는 진짜인지와 아무 상관이 없습니다/);
    console.log(`[수리] 지속 공격 12회 → 화면은 "횟수는 근거가 아니다 · 전화로 확인하라"만 말한다`);
  });

  it('①-e 사용자가 받으면 공격자가 발행 권위(신뢰 키 목록)를 갈아끼운다 (★남는 위험)', async () => {
    await pinToRealServer();
    // 진짜 서버에서 신뢰 키를 한 번 배운다(정상 상태).
    const rootsBefore = await getTrustedRootKeys();
    expect(rootsBefore[REAL.rootKeyId]).toBe(REAL.root.publicKeyHex);

    // MITM 등장 → 사람이 지문을 확인하지 않고 "받겠습니다"를 누른다.
    // ★이름 위조는 이제 막히므로, 공격자는 **자기 이름을 정직하게** 달고 온다.
    //   즉 남는 방어선은 오직 **사람의 지문 대조**뿐이다 — 그것이 이 테스트의 요지다.
    currentServer = (p) => serve(EVIL, p);
    await syncCourses().catch(() => {});
    expect(await acceptPinChange()).toBe(true);
    expect(kv.get(DIST_PIN_KEY)).toBe(EVIL.dist.publicKeyHex);

    // 다음 동기화에서 공격자의 키가 신뢰 목록에 **누적**된다.
    const roots = await getTrustedRootKeys();
    const issuers = await getTrustedIssuerKeys();
    expect(roots[EVIL.rootKeyId]).toBe(EVIL.root.publicKeyHex);
    expect(issuers[EVIL.promoKeyId]).toBe(EVIL.promo.publicKeyHex);

    // (1) 공격자가 만든 가짜 회원 증서가 이 지갑에서 유효해진다.
    const device = signerFromKeyPair(generateKeyPair());
    const fakeCert = buildMembershipCertificate(
      {
        memberId: 'SHV-2026-666666',
        devicePublicKey: device.publicKeyHex,
        integrity: 'VERIFIED',
        issuedAt: T0,
        expiresAt: T0 + 30 * DAY,
        issuerKeyId: EVIL.rootKeyId,
      },
      EVIL.root,
    );
    expect(verifyMembershipCertificate(fakeCert, roots, T0 + DAY).valid).toBe(true);

    // (2) 공격자가 찍은 가짜 엔젤 보너스 코인이 통과한다.
    const fakeCoin = mintGrantCoin(
      buildGrant(
        {
          kind: 'ANGEL_BONUS',
          memberId: 'SHV-2026-666666',
          amountDshv: 300,
          reference: 'angel-registration',
          recipientPublicKey: device.publicKeyHex,
          issuerKeyId: EVIL.promoKeyId,
          issuedAt: T0,
        },
        EVIL.promo,
      ),
    );
    expect(verifyCoin(fakeCoin, { trustedRootKeys: roots, trustedIssuerKeys: issuers, now: T0 + DAY }).valid).toBe(
      true,
    );
    console.log('[MITM] 수락 후 — 가짜 증서·가짜 보너스 코인(30 SHV) 둘 다 지갑에서 유효');
  });

  it('①-f 그래도 진짜 서버에서 배운 옛 키는 지워지지 않는다 (보유 코인은 안 죽는다)', async () => {
    await pinToRealServer();
    await getTrustedRootKeys();
    currentServer = (p) => serve(EVIL, p);
    await syncCourses().catch(() => {});
    expect(await acceptPinChange()).toBe(true);
    const roots = await getTrustedRootKeys();
    expect(roots[REAL.rootKeyId]).toBe(REAL.root.publicKeyHex); // 옛 루트 그대로
    expect(roots[EVIL.rootKeyId]).toBe(EVIL.root.publicKeyHex); // 새 루트도 함께
  });

  it('①-g ★수락 후에는 진짜 서버가 돌아왔을 때 그쪽이 "수상한 서버"로 보인다 (핀 역전)', async () => {
    await pinToRealServer();
    currentServer = (p) => serve(EVIL, p);
    await syncCourses().catch(() => {});
    expect(await acceptPinChange()).toBe(true);

    // 공격자가 사라지고 진짜 서버로 복귀 → 이제 **진짜 서버가** 거부당한다.
    currentServer = (p) => serve(REAL, p);
    await expect(syncCourses()).rejects.toThrow(/KEY_PIN_MISMATCH/);
    const notice = (await loadPinChangeNotice())!;
    expect(notice.newFingerprint).not.toBe(notice.pinnedFingerprint);
    console.log('[MITM] 한 번 받고 나면 진짜 서버가 다시 "받겠습니까?" 대상이 된다 — 사람은 구별 못 한다');
  });

  it('①-h 본문 변조는 후보조차 되지 않는다 (설계대로 — 물어볼 값어치가 없다)', async () => {
    await pinToRealServer();
    currentServer = (p) => {
      const good = serve(REAL, p) as Signed<object> & { courses?: unknown };
      return { ...good, courses: [{ id: 'fake' }] } as Signed<object>;
    };
    await expect(syncCourses()).rejects.toThrow(/BAD_SIGNATURE/);
    expect(await loadPinChangeNotice()).toBeNull();
  });

  it('①-i 거절하면 옛 핀이 유지되고, 같은 공격이 오면 횟수가 1부터 다시 센다', async () => {
    await pinToRealServer();
    currentServer = (p) => serve(EVIL, p);
    await syncCourses().catch(() => {});
    await rejectPinChange();
    expect(await loadPinChangeNotice()).toBeNull();
    expect(kv.get(DIST_PIN_KEY)).toBe(REAL.dist.publicKeyHex);
    await syncCourses().catch(() => {});
    expect((await loadPinChangeNotice())!.seenCount).toBe(1);
  });
});

// ══ ④ 0층 — 핀 불일치·서버 부재에서 "설치하고 걸으면 끝"이 사는가 ══

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

/** 운영 `CorridorEngine`으로 불곡산을 실제로 걷는다 — 서버 캐시 없이 내장 코스만 쓴다. */
function walkBulgoksan(memberId: string): { samples: WalkSample[]; ledger: PendingWalkLedger } {
  const engine = new CorridorEngine([BUNDANG_BULGOKSAN_SAMPLE], []);
  const ledger = new PendingWalkLedger({ memberId });
  const pts = resample(BUNDANG_BULGOKSAN_SAMPLE.polyline, 5);
  const samples: WalkSample[] = [];
  let inWindow = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i]!;
    const fix: GpsFix = { lat: p.lat, lon: p.lon, timestamp: T0 + i * 5000, accuracy: 12 };
    engine.addFix(fix);
    inWindow += 1;
    if (inWindow === 12) {
      engine.addSteps(80);
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

describe('적대검증 4 — 0층 파괴: 핀 불일치·비행기 모드에서 걷기·정산·지불', () => {
  it('④-a 핀 불일치 상태에서 걷기→정산→민팅→QR 대면 지불·수령이 끝까지 된다 (서버 0회)', async () => {
    await pinToRealServer();
    currentServer = (p) => serve(EVIL, p);
    await expect(syncCourses()).rejects.toThrow(/KEY_PIN_MISMATCH/);
    await expect(syncFlaggedList()).rejects.toThrow(/KEY_PIN_MISMATCH/);
    expect(await loadPinChangeNotice()).not.toBeNull(); // 화면이 떠 있는 상태 그대로

    const walker = signerFromKeyPair(generateKeyPair());
    const angel = signerFromKeyPair(generateKeyPair());
    const { samples, ledger } = walkBulgoksan('SHV-2026-000001');
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every((s) => s.tier === 'ON_COURSE')).toBe(true);

    const draft = ledger.settleManual(T0 + 3 * 3600_000)!;
    const coin = mintWalkCoin(buildWalkSegmentProof(draft, walker));
    // 신뢰 키 0개로도 성립한다 = 서버 권위와 무관하다.
    expect(verifyCoin(coin, { trustedRootKeys: {}, trustedIssuerKeys: {}, now: T0 + DAY }).valid).toBe(true);

    const charge = buildCharge(
      {
        chargeId: 'chg-1',
        angelMemberId: 'SHV-2026-009001',
        amountDshv: coin.amountDshv,
        serviceType: 'SHOWER',
        createdAt: T0 + DAY,
      },
      angel,
    );
    const payment = buildPayment(charge, [coin], 'SHV-2026-000001', walker, T0 + DAY);
    const decoded = decodeQr(encodeQr(payment));
    if (decoded.type !== 'shvil/payment') throw new Error('지불 QR이 아니다');
    const review = buildReceiveReview({
      charge,
      payment: decoded,
      angelAddress: addressFromPublicKey(angel.publicKeyHex),
      knownCoinIds: new Set(),
      flaggedMemberIds: [],
      knownCoins: [],
      trustedRootKeys: {},
      trustedIssuerKeys: {},
      requireIntegrityToken: false,
      rulePacks: [],
      now: T0 + DAY,
    });
    expect(review.blocked).toBe(false);
    expect(acceptReviewedPayment(review, charge, payment, angel).coins).toHaveLength(1);
    console.log(`[0층·핀불일치] ${coin.amountDshv / 10} SHV 정산 → 대면 지불·수령 완결 (서버 0회)`);
  });

  it('④-b ★비행기 모드: 서버가 아예 없어도 같은 일이 그대로 된다 (첫 설치·핀 없음)', async () => {
    currentServer = () => 'OFFLINE'; // 모든 요청이 네트워크 오류
    await expect(syncCourses()).rejects.toThrow(/연결할 수 없습니다/);
    expect(await loadCachedCourses()).toBeNull(); // 캐시 없음 → 내장 코스로 폴백
    expect(await getTrustedRootKeys()).toEqual({}); // 신뢰 키 0개
    expect(kv.get(DIST_PIN_KEY)).toBeUndefined(); // 핀도 없음
    expect(await loadPinChangeNotice()).toBeNull(); // 화면도 안 뜬다 (조용하다)

    const walker = signerFromKeyPair(generateKeyPair());
    const { samples, ledger } = walkBulgoksan('M-provisional');
    expect(samples.length).toBeGreaterThan(0);
    const coin = mintWalkCoin(buildWalkSegmentProof(ledger.settleManual(T0 + 3 * 3600_000)!, walker));
    expect(coin.amountDshv).toBeGreaterThan(0);
    expect(verifyCoin(coin, { trustedRootKeys: {}, trustedIssuerKeys: {}, now: T0 + DAY }).valid).toBe(true);
    console.log(`[0층·비행기모드] 서버 0회·핀 0개로 ${coin.amountDshv / 10} SHV 생성 및 검증 통과`);
  });

  it('④-c ★서버가 죽어 있어도(부팅 거부 포함) 0층에는 아무 일도 일어나지 않는다', async () => {
    // "부팅 거부"는 지갑에서 보면 그냥 네트워크 실패다 — 위 ④-b와 구별되지 않는다.
    currentServer = () => 'OFFLINE';
    await expect(syncFlaggedList()).rejects.toThrow();
    const walker = signerFromKeyPair(generateKeyPair());
    const { ledger } = walkBulgoksan('SHV-2026-000001');
    expect(mintWalkCoin(buildWalkSegmentProof(ledger.settleManual(T0 + 3 * 3600_000)!, walker)).amountDshv)
      .toBeGreaterThan(0);
  });
});
