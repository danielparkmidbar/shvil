/**
 * ★지불 QR 크기 회귀 — **필드가 하나 늘면 대면 지불이 죽는다.**
 *
 * 2026-07-27 실측: 회원 증서를 받은 정상 지갑의 지불 QR이 이전 0회에 2,941자였다.
 * QR 바이트 모드 상한(오류정정 L)이 2,953자이므로 **12자 여유**였고, 손이 한 번만
 * 바뀌면 3,839자로 QR 자체가 만들어지지 않았다. 그때까지 아무도 몰랐다 — 이 값을
 * 지켜보는 시험이 없었기 때문이다. 그래서 여기서 대표 시나리오의 길이를 못박는다.
 *
 * 이 시험이 깨졌다면 둘 중 하나다.
 *  (가) 전송 인코딩을 고쳤다 → 새 값이 **작아졌는지** 확인하고 표를 갱신하라.
 *  (나) 코인·증명·증서에 필드를 더했다 → **그 필드가 QR 몇 자인지 알고 더하는 것인지**
 *       스스로에게 물어라. 값이 커지는 변경은 여유가 얼마 남았는지 함께 적어야 한다.
 *
 * 키·시각을 전부 고정했으므로 길이는 결정적이다(ed25519 서명도 결정적).
 */
import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex } from '@noble/hashes/utils';
import { signerFromKeyPair, type Signer } from '../crypto';
import { PendingWalkLedger } from '../ledger';
import { buildWalkSegmentProof } from '../proof';
import { buildMembershipCertificate } from '../membership';
import { acceptPayment, buildCharge, buildPayment, encodeQr, decodeQr, QR_BYTE_MODE_MAX_CHARS } from '../qr';
import { acknowledgeTransfer, createTransfer, mintWalkCoin, splitCoin } from '../coin';
import type { Coin, WalkSample } from '../types';

// ── 고정 키 (시험 전용 — 값이 결정적이어야 길이를 못박을 수 있다) ────────
function fixedSigner(seedByte: number): Signer {
  const secret = new Uint8Array(32).fill(seedByte);
  return signerFromKeyPair({
    secretKeyHex: bytesToHex(secret),
    publicKeyHex: bytesToHex(ed25519.getPublicKey(secret)),
  });
}

const dev = fixedSigner(0x11);
const angel = fixedSigner(0x22);
const root = fixedSigner(0x33);

const T0 = Date.parse('2026-05-01T06:00:00Z');
const DAY = 86_400_000;
const MEMBER = 'SHV-2026-000123';

const cert = buildMembershipCertificate(
  {
    memberId: MEMBER,
    devicePublicKey: dev.publicKeyHex,
    integrity: 'VERIFIED',
    issuedAt: T0 - 5 * DAY,
    expiresAt: T0 - 5 * DAY + 30 * DAY,
    issuerKeyId: 'membership-root-2026',
  },
  root,
);

function sample(o: Partial<WalkSample> = {}): WalkSample {
  return { durationS: 72, distanceM: 100, steps: 140, tier: 'ON_COURSE', timestamp: T0, courseId: 'shvil-israel', ...o };
}

function walkDay(l: PendingWalkLedger, km: number, dayStart: number, courseId: string): void {
  const n = Math.round(km * 10);
  let t = dayStart;
  for (let i = 0; i < n; i += 1) {
    const v = l.recordSample(sample({ timestamp: t, courseId }));
    if (!v.accepted) throw new Error(`시험 준비 실패: 창이 기각됐다 (${v.reason})`);
    t += 72_000;
  }
}

/** 실기기 시험 조건 그대로: 회원 증서 + 무결성 토큰 64자(해시 길이)를 붙인 코인. */
function mintCoin(days: number, kmPerDay: number, courseId: string, startDay = 0): Coin {
  const l = new PendingWalkLedger({ memberId: MEMBER });
  let last = T0;
  for (let d = 0; d < days; d += 1) {
    const start = T0 + (startDay + d) * DAY;
    walkDay(l, kmPerDay, start, courseId);
    last = start + Math.round(kmPerDay * 10) * 72_000;
  }
  return mintWalkCoin(
    buildWalkSegmentProof(l.settleOnSpend(last)!, dev, { membership: cert, appIntegrityToken: 'a'.repeat(64) }),
  );
}

/** 손바뀜 n회를 붙인다(전부 완결). 마지막 소유자는 다시 dev — 그래야 다시 지불할 수 있다. */
function withHistory(coin: Coin, n: number): Coin {
  let c = coin;
  let owner = dev;
  for (let i = 0; i < n; i += 1) {
    const next = i === n - 1 ? dev : fixedSigner(0x40 + i);
    c = createTransfer(c, owner, next.publicKeyHex, T0 + i * 1000);
    c = acknowledgeTransfer(c, next);
    owner = next;
  }
  return c;
}

interface Measured {
  /** 옛 전송 형식 `SHV1.` (base64url(JSON)) 길이 — 개선 폭을 눈에 보이게 남긴다. */
  legacy: number;
  /** 현재 전송 형식 길이. */
  now: number;
}

function paymentQrLength(coins: Coin[]): Measured {
  const amountDshv = coins.reduce((s, c) => s + c.amountDshv, 0);
  const charge = buildCharge(
    { chargeId: 'chg_01HQ9Z8K7', angelMemberId: 'SHV-2026-000999', amountDshv, serviceType: 'SHOWER', createdAt: T0 },
    angel,
  );
  const payment = buildPayment(charge, coins, MEMBER, dev, T0 + 1);
  const qr = encodeQr(payment);
  const legacy = encodeQr(payment, { format: 'legacy' });
  // 길이만 재고 끝내지 않는다 — 두 형식이 다 되돌아 읽히는지도 같이 본다.
  expect(decodeQr(qr)).toEqual(payment);
  expect(decodeQr(legacy)).toEqual(payment);
  return { legacy: legacy.length, now: qr.length };
}

const bulgoksan = mintCoin(1, 1.55, 'bundang-bulgoksan');
const israel60 = mintCoin(60, 17.6, 'shvil-israel');
const bundle: Coin[] = [];
for (let i = 0; i < 12; i += 1) bundle.push(mintCoin(1, 1.55, 'bundang-bulgoksan', i));

/**
 * 못박은 길이 (문자). 2026-07-27 측정.
 *
 * `fits` = QR 바이트 모드 **한 장**(2,953자)에 들어가는가. false 인 줄은 압축만으로는
 * 한 장에 안 들어간다는 뜻이다 — 압축은 상한을 밀어냈을 뿐 없애지 못했다.
 *
 * ★2026-07-27: 그 줄들도 **이제 지불된다.** 분할 프레임 QR(qrFrames.ts)이 한 장을
 * 넘는 지불을 여러 장으로 나눠 보내기 때문이다. 그래도 이 표는 계속 지킨다 —
 * 한 장으로 끝나는 것이 언제나 더 빠르고 잘 읽히므로, 어느 시나리오가 한 장인지는
 * 여전히 알고 있어야 한다. (프레임 왕복 자체는 qrFrames.test.ts가 본다.)
 */
const PINNED: { label: string; legacy: number; now: number; fits: boolean; run: () => Measured }[] = [
  // ── 불곡산 실기기 시험 경로 (1.55km = 2.0 SHV, 왕복 4.0 SHV) ──
  { label: '불곡산 1일 코인 · 이전0', legacy: 2941, now: 1613, fits: true, run: () => paymentQrLength([bulgoksan]) },
  { label: '불곡산 1일 코인 · 이전1', legacy: 3839, now: 1777, fits: true, run: () => paymentQrLength([withHistory(bulgoksan, 1)]) },
  { label: '불곡산 1일 코인 · 이전3', legacy: 5633, now: 2616, fits: true, run: () => paymentQrLength([withHistory(bulgoksan, 3)]) },
  { label: '불곡산 1일 코인 · 이전5', legacy: 7428, now: 3340, fits: false, run: () => paymentQrLength([withHistory(bulgoksan, 5)]) },
  // ── 이스라엘 종주 (dailyBreakdown 60항목) ──
  { label: '이스라엘 60일 코인 · 이전0', legacy: 6020, now: 1956, fits: true, run: () => paymentQrLength([israel60]) },
  { label: '이스라엘 60일 코인 · 이전3', legacy: 8712, now: 2961, fits: false, run: () => paymentQrLength([withHistory(israel60, 3)]) },
  {
    label: '이스라엘 60일 코인 분할 → 샤워 3 SHV',
    legacy: 6783,
    now: 2232,
    fits: true,
    run: () => paymentQrLength([splitCoin(israel60, dev, [israel60.amountDshv - 30, 30], T0)[0]!]),
  },
  // ── 소액 코인 묶음 (불곡산 코인으로 권장가를 내는 경우) ──
  { label: '묶음 2개 (샤워 3 SHV급)', legacy: 5405, now: 2003, fits: true, run: () => paymentQrLength(bundle.slice(0, 2)) },
  { label: '묶음 4개 (식사 5 SHV급)', legacy: 10333, now: 2764, fits: true, run: () => paymentQrLength(bundle.slice(0, 4)) },
  { label: '묶음 5개', legacy: 12797, now: 3143, fits: false, run: () => paymentQrLength(bundle.slice(0, 5)) },
  { label: '묶음 7개 (잠자리 10 SHV급)', legacy: 17725, now: 3904, fits: false, run: () => paymentQrLength(bundle.slice(0, 7)) },
];

describe('지불 QR 크기 회귀', () => {
  const rows = PINNED.map((p) => ({ ...p, measured: p.run() }));

  it('대표 시나리오 길이가 못박은 값과 같다', () => {
    console.log('\n라벨\t옛형식\t현재\t감소\t한장(2953)');
    for (const r of rows) {
      const cut = (100 - (r.measured.now / r.measured.legacy) * 100).toFixed(0);
      console.log(
        `${r.label}\t${r.measured.legacy}\t${r.measured.now}\t${cut}%\t${r.measured.now <= QR_BYTE_MODE_MAX_CHARS ? 'O' : 'X'}`,
      );
    }
    for (const r of rows) {
      expect(r.measured.legacy, `${r.label} — 옛 형식 길이가 바뀌었다 = 메시지 필드가 늘거나 줄었다`).toBe(r.legacy);
      expect(r.measured.now, `${r.label} — 현재 형식 길이가 바뀌었다`).toBe(r.now);
    }
  });

  it('★어느 시나리오가 한 장에 들어가고 어느 것이 아직 안 되는지를 못박는다', () => {
    for (const r of rows) {
      expect(r.measured.now <= QR_BYTE_MODE_MAX_CHARS, `${r.label} — 한 장 수용 여부가 바뀌었다`).toBe(r.fits);
    }
    // 아직 한 장에 안 들어가는 줄이 남아 있다는 것을 잊지 않기 위해 명시적으로 센다.
    expect(rows.filter((r) => !r.fits).length, '한 장에 못 들어가는 시나리오 수').toBe(4);
  });

  it('압축이 어떤 시나리오에서도 손해가 아니다 (auto는 짧은 쪽을 고른다)', () => {
    for (const r of rows) {
      expect(r.measured.now, `${r.label} — 새 형식이 옛 형식보다 길다`).toBeLessThanOrEqual(r.measured.legacy);
    }
  });

  it('청구·확인 QR은 원래 여유롭다 — 지불 다리만 문제였음을 못박는다', () => {
    const charge = buildCharge(
      {
        chargeId: 'chg_01HQ9Z8K7',
        angelMemberId: 'SHV-2026-000999',
        amountDshv: bulgoksan.amountDshv,
        serviceType: 'SHOWER',
        createdAt: T0,
      },
      angel,
    );
    const payment = buildPayment(charge, [bulgoksan], MEMBER, dev, T0 + 1);
    const { confirm } = acceptPayment(charge, payment, angel);
    expect(encodeQr(charge).length).toBeLessThan(600);
    expect(encodeQr(confirm).length).toBeLessThan(600);
    expect(encodeQr(charge, { format: 'legacy' }).length).toBeLessThan(600);
  });
});
