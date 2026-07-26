/**
 * ★소급 무효화 수리 (M16-B) — 2026-07-26.
 *
 * 다니엘 쌤:
 * > "화폐 발행자는 위조 방지를 최선을 다해 하지만 위조 방지 시스템도 업그레이드한다.
 * >  **새 방지 시스템이 나온다고 옛 화폐가 가짜가 되지는 않는다.**"
 *
 * ── 무엇이 뚫려 있었나 ────────────────────────────────────────────────
 * `verifyCoin`이 회원 증서를 **검사 시각**으로 재고 있었다(coin.ts:297 → membership.ts:82
 * `now >= cert.expiresAt`). 그래서 같은 코인·같은 걷기가
 *   민팅 +1일  → { valid: true }
 *   민팅 +31일 → { valid: false, reasons: ['BAD_MEMBERSHIP'] } → checkAuthenticity **FORGED**
 * 사람은 아무 잘못도 하지 않았는데 30일 뒤 자기 돈이 위폐가 되었다. 수령 자체도 막혔다
 * (qr.ts acceptPayment → throw).
 *
 * ── 그러나 그냥 만료를 없애면 더 나쁘다 ────────────────────────────────
 * `proof.settledAt`은 **폰이 적고 폰이 서명하는 값**이다(공격자 제어 필드). 만료를 없애면
 * 유출된 증서(+ 그 기기 개인키) 하나로 **영원히** 소급 발행할 수 있다.
 *
 * ── 그래서 비대칭으로 갈랐다 ──────────────────────────────────────────
 * 판정 기준을 "검사 시각"에서 "**증서가 서명으로 증언하는 민팅 창**"으로 옮겼다.
 *   창 = [issuedAt − 1일, issuedAt + 4×유효기간]  (운영 30일 TTL → 발급 후 120일)
 * 창의 두 끝이 전부 **서버가 서명한 값**에서만 나오므로, `settledAt`이 공격자 제어여도
 * 공격자는 **창을 넓힐 수 없다.** 결과:
 *   · 옛 코인은 만들어질 때 창 안이었으므로 **영원히** 창 안이다 → 죽지 않는다.
 *   · 창 밖 시각으로 새로 만드는 것(소급 발행)은 거부된다.
 *
 * 이 파일의 네 축이 그 계약이다.
 */
import { describe, expect, it } from 'vitest';
import { generateKeyPair, signerFromKeyPair, type Signer } from '../crypto';
import { PendingWalkLedger } from '../ledger';
import { buildWalkSegmentProof } from '../proof';
import {
  MINT_WINDOW_TTL_MULTIPLE,
  buildMembershipCertificate,
  certificateCoversMint,
  membershipMintWindow,
  verifyMembershipCertificate,
  verifyMembershipForMint,
  type MembershipCertificate,
} from '../membership';
import { mintWalkCoin, verifyCoin } from '../coin';
import { checkAuthenticity, checkCoinAuthenticity, MAX_SEGMENT_SPAN_DAYS } from '../authenticity';
import type { Coin } from '../types';
import { walkKm } from './helpers';

const DAY = 86_400_000;
const ROOT_KEY_ID = 'membership-root-2026';
const root = signerFromKeyPair(generateKeyPair());
const roots = { [ROOT_KEY_ID]: root.publicKeyHex };
const device = signerFromKeyPair(generateKeyPair());

/** 증서 발급 시각 = 이 사람이 가입한 날. 운영 유효기간과 같은 30일. */
const ISSUED_AT = Date.parse('2026-01-10T09:00:00Z');
const TTL_MS = 30 * DAY;
/** 실제로 걷고 정산한 시각 — 증서 발급 5일 뒤. 완전히 정상적인 민팅이다. */
const MINT_AT = ISSUED_AT + 5 * DAY;

function cert(overrides: Partial<Parameters<typeof buildMembershipCertificate>[0]> = {}, signer: Signer = root) {
  return buildMembershipCertificate(
    {
      memberId: 'SHV-100001',
      devicePublicKey: device.publicKeyHex,
      integrity: 'VERIFIED',
      issuedAt: ISSUED_AT,
      expiresAt: ISSUED_AT + TTL_MS,
      issuerKeyId: ROOT_KEY_ID,
      ...overrides,
    },
    signer,
  );
}

/**
 * 정직한 코인을 **실제 원장 경로**로 만든다 — 손으로 지은 초안이 아니라
 * PendingWalkLedger → settleOnSpend → buildWalkSegmentProof → mintWalkCoin.
 * @param settleAt 정산(민팅) 시각. 걷기는 그 직전 몇 시간 동안 일어난다.
 */
function honestCoin(settleAt: number, membership: MembershipCertificate | null = cert()): Coin {
  const ledger = new PendingWalkLedger({ memberId: 'SHV-100001' });
  // 5 km = 창 50개 × 72초 = 1시간. 정산 시각에서 역산해 시작 시각을 잡는다.
  const startAt = settleAt - 50 * 72_000;
  const last = walkKm(ledger, 5, {}, startAt);
  const draft = ledger.settleOnSpend(last)!;
  return mintWalkCoin(
    buildWalkSegmentProof(draft, device, {
      appIntegrityToken: 'play-integrity',
      ...(membership ? { membership } : {}),
    }),
  );
}

const strict = { trustedRootKeys: roots, requireIntegrityToken: true };

// ── ① 이번 작업의 핵심 ────────────────────────────────────────────────

describe('★30일 뒤에도, 3년 뒤에도, 그때 만든 정상 코인은 유효하다 (다니엘 쌤 원칙)', () => {
  const coin = honestCoin(MINT_AT);

  it('민팅 +1일 · +31일 · +3년 · +30년 — 판정이 한 글자도 달라지지 않는다', () => {
    const checkedAt = {
      '민팅 +1일': MINT_AT + DAY,
      '민팅 +31일 (증서 만료 이후)': MINT_AT + 31 * DAY,
      '민팅 +3년': MINT_AT + 1095 * DAY,
      '민팅 +30년': MINT_AT + 10_950 * DAY,
    };
    for (const [label, now] of Object.entries(checkedAt)) {
      const verdict = verifyCoin(coin, { ...strict, now });
      expect(verdict, label).toEqual({ valid: true, reasons: [] });
    }
  });

  it('검사 시각을 아예 주지 않아도(Date.now() 폴백) 같은 답이다 — 시각이 판정에 없다', () => {
    expect(verifyCoin(coin, strict)).toEqual({ valid: true, reasons: [] });
  });

  it('민팅 +31일에 위폐 감지기를 돌려도 AUTHENTIC이다 (예전에는 FORGED였다)', () => {
    const report = checkCoinAuthenticity(coin, { ...strict, now: MINT_AT + 31 * DAY });
    expect(report.coreFindings).toEqual([]);
    expect(report.coreVerdict).toBe('AUTHENTIC');
  });

  it('★신뢰 루트 캐시가 빈 지갑도 정상 코인을 받는다 (0층 — 설치하고 걸으면 끝)', () => {
    // 설치 직후 산에서 첫 수령을 하는 엔젤의 상태다. 캐시는 온라인 화면에 들어가야
    // 채워지므로 `loadCachedTrustedRootKeys()`가 `{}`를 돌려준다.
    //
    // 예전에는 `if (!roots)`로만 봐서 **빈 객체가 truthy로 통과**했고, 그 결과 증서를
    // 단 정상 코인이 전부 `UNKNOWN_MEMBERSHIP_ROOT`로 수령 거부되었다. 같은 "모른다"인데
    // `undefined`는 통과하고 `{}`는 거부하는, 자바스크립트 값 하나에 걸린 0층 위반이었다.
    expect(verifyCoin(coin, { trustedRootKeys: {} })).toEqual({ valid: true, reasons: [] });
    expect(verifyCoin(coin, {})).toEqual({ valid: true, reasons: [] });

    // 필수화 스위치를 켠 검사자에게는 여전히 fail-closed다 — 모르는 것을 통과시키지 않는다.
    expect(verifyCoin(coin, { trustedRootKeys: {}, requireIntegrityToken: true }).reasons).toEqual([
      'UNKNOWN_MEMBERSHIP_ROOT',
    ]);
    // 그리고 그 경우에도 위조 판정은 아니다.
    expect(checkCoinAuthenticity(coin, { trustedRootKeys: {}, requireIntegrityToken: true }).coreVerdict).not.toBe(
      'FORGED',
    );
  });

  it('오프라인 종주자: 증서 만료 뒤 55일째 정산한 코인도 유효하다 (오늘은 죽던 코인)', () => {
    // 60일 종주 중에는 증서를 갱신할 수 없다(갱신은 온라인 전용). 유예 90일이
    // 정확히 이 사람을 위해 있다.
    const late = honestCoin(ISSUED_AT + 55 * DAY);
    expect(verifyCoin(late, strict)).toEqual({ valid: true, reasons: [] });
  });
});

// ── ② 소급 발행은 그대로 막힌다 ───────────────────────────────────────

describe('★유출된 증서로 소급 발행한 코인은 거부된다 (창을 넓힐 수는 없다)', () => {
  it('증서 발급 1년 뒤 / 10년 뒤 / 30년 뒤 신규 발행 → 전부 거부', () => {
    for (const days of [365, 3650, 10_950]) {
      const forged = honestCoin(ISSUED_AT + days * DAY);
      const verdict = verifyCoin(forged, strict);
      expect(verdict.valid, `발급 +${days}일`).toBe(false);
      expect(verdict.reasons, `발급 +${days}일`).toEqual(['MEMBERSHIP_OUT_OF_WINDOW']);
    }
  });

  it('증서 발급 **이전**으로 되민 정산(과거 방향)도 거부된다', () => {
    // 유출 증서로 "계정 생성 전"을 주장해 옛 날짜를 채우는 수법. 관용은 ±1일뿐이다.
    const backdated = honestCoin(ISSUED_AT - 10 * DAY);
    expect(verifyCoin(backdated, strict).reasons).toEqual(['MEMBERSHIP_OUT_OF_WINDOW']);
  });

  it('기기 시계 오차 정도(발급 −12시간)는 관용한다 — 정직한 사람을 먼저 지킨다', () => {
    const skewed = honestCoin(ISSUED_AT - 12 * 3600_000);
    expect(verifyCoin(skewed, strict)).toEqual({ valid: true, reasons: [] });
  });

  it('창의 경계: 마지막 1 ms는 통과하고 그 다음 1 ms는 거부된다', () => {
    const { to } = membershipMintWindow(cert());
    expect(verifyCoin(honestCoin(to), strict).valid).toBe(true);
    expect(verifyCoin(honestCoin(to + 1), strict).valid).toBe(false);
  });

  it('창은 서버가 서명한 두 값에서만 나온다 — 증서를 고치면 서명이 깨진다', () => {
    // 공격자가 창을 넓히려면 issuedAt이나 expiresAt을 고쳐야 하는데, 둘 다
    // 서명 대상(certPayload)이다.
    const widened = { ...cert(), expiresAt: ISSUED_AT + 3650 * DAY };
    expect(verifyMembershipForMint(widened, roots, ISSUED_AT + 365 * DAY)).toMatchObject({
      valid: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('유출 증서 1장이 덮을 수 있는 기간은 발급 후 120일 — 유한하고 셀 수 있다', () => {
    const { from, to } = membershipMintWindow(cert());
    expect(to - from).toBe(MINT_WINDOW_TTL_MULTIPLE * TTL_MS + DAY);
    expect((to - ISSUED_AT) / DAY).toBe(120);
    // 유예 90일의 근거는 백데이팅 방어의 창 상한과 같은 뿌리다 (60일 종주 + 한 달).
    expect((to - (ISSUED_AT + TTL_MS)) / DAY).toBe(MAX_SEGMENT_SPAN_DAYS);
  });
});

// ── ③ 만료 증서로 만든 새 코인 ────────────────────────────────────────

describe('★만료 증서로 새로 만든 코인 — 만료의 두 용도가 갈라졌다', () => {
  it('(가) 갱신 판정은 여전히 만료를 본다 — 서버·지갑이 재발급을 결정하는 자리', () => {
    const now = ISSUED_AT + 31 * DAY;
    expect(verifyMembershipCertificate(cert(), roots, now)).toMatchObject({
      valid: false,
      reason: 'EXPIRED',
    });
    // 같은 증서를 (나) 코인 검증의 눈으로 보면, 창 안의 민팅은 그대로 유효하다.
    expect(verifyMembershipForMint(cert(), roots, MINT_AT)).toEqual({ valid: true });
  });

  it('(나) 코인 검증은 만료를 보지 않는다 — 창 밖 정산만 거부한다', () => {
    // 만료 직후(+1일) 정산: 유예 안이므로 통과한다. 오프라인 사용자를 죽이지 않는다.
    expect(certificateCoversMint(cert(), ISSUED_AT + TTL_MS + DAY)).toBe(true);
    // 유예까지 다 지난 뒤 정산: 거부.
    expect(certificateCoversMint(cert(), ISSUED_AT + 121 * DAY)).toBe(false);
  });

  it('만료를 한참 넘긴 증서로 새로 민팅하면 수령이 거부된다', () => {
    const tooLate = honestCoin(ISSUED_AT + 200 * DAY);
    expect(verifyCoin(tooLate, strict).valid).toBe(false);
  });
});

// ── ③-b 유출 증서의 실제 한도 — 하루 상한은 증명들 사이에서도 합산된다 ──

describe('★하루 상한을 증명들 사이에서도 합산한다 (적대 검증 시정)', () => {
  /** 같은 날 안에서 서로 겹치지 않는 증명을 여러 건 쌓는다 — 유출 증서 공격의 모양이다. */
  function burstSameDay(count: number): Coin[] {
    const base = Date.parse('2026-01-15T02:00:00Z'); // ISSUED_AT +5일, 증서 창 안
    return Array.from({ length: count }, (_, i) => honestCoin(base + i * 2 * 3600_000));
  }

  it('하루 상한(40 SHV)을 넘겨 쌓으면 정황으로 잡힌다 — 예전에는 아무 발견도 없었다', () => {
    // 한 장은 5 km = 5 SHV. 9장이면 45 SHV로 하루 상한 40 SHV를 넘는다.
    // 창이 겹치지 않으니 WINDOW_OVERLAP도, 거리를 맞췄으니 MINT_RATE도 걸리지 않는다.
    // 예전에는 하루 상한이 **증명 한 건 안에서만** 합산되어 이 전부가 통과했다.
    const report = checkAuthenticity(burstSameDay(9), strict);
    const daily = report.coreFindings.filter((f) => f.check === 'DAILY_CAP');
    expect(daily.length).toBeGreaterThan(0);
    expect(daily[0]!.detail).toContain('증명');
    expect(daily[0]!.detail).toContain('걸쳐');
  });

  it('정황이지 판정이 아니다 — 이것만으로 FORGED가 되지 않는다', () => {
    // 앱을 다시 깔면 잠정 원장의 mintedByDate가 비어 정직한 사람도 이렇게 보일 수 있다
    // (백업에는 원장 상태가 담기지 않는다). 재설치한 사람을 위폐범으로 지목하지 않는다.
    const report = checkAuthenticity(burstSameDay(9), strict);
    expect(report.coreFindings.every((f) => f.check !== 'DAILY_CAP' || f.severity === 'SIGNAL')).toBe(true);
    expect(report.coreVerdict).not.toBe('FORGED');
  });

  it('상한 안에서는 조용하다 — 하루 여러 번 정산하는 정직한 사람을 지목하지 않는다', () => {
    // 5장 = 25 SHV. 하루에 다섯 번 정산해도 상한 안이면 아무 말도 하지 않는다.
    const report = checkAuthenticity(burstSameDay(5), strict);
    expect(report.coreFindings.filter((f) => f.check === 'DAILY_CAP')).toEqual([]);
  });
});

// ── ④ 어휘 — "증서가 오래됐다"와 "위조다"는 다른 말이다 ────────────────

describe('★만료·창 이탈은 FORGED가 아니다 (어휘 분리)', () => {
  it('창 밖 코인의 판정은 SUSPECT이고, 발견은 UNPROVEN이다', () => {
    const outOfWindow = honestCoin(ISSUED_AT + 365 * DAY);
    const report = checkCoinAuthenticity(outOfWindow, { ...strict, now: ISSUED_AT + 400 * DAY });

    expect(report.coreVerdict).not.toBe('FORGED');
    expect(report.coreVerdict).toBe('SUSPECT');

    const f = report.coreFindings.find((x) => x.check === 'MEMBERSHIP_WINDOW');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('UNPROVEN');
    // 예전 문장은 "서명 또는 계보가 손상되었습니다"였다 — 거짓이다. 서명은 멀쩡하다.
    expect(f!.detail).not.toContain('손상되었습니다');
    expect(f!.detail).toContain('서명·계보도 온전합니다');
    // ★이 부류만은 "위조가 아니다"라고 말해도 된다 — 신뢰하는 루트가 실제로 서명한
    //   증서를 손에 쥐고 있고, 무엇이 부족한지 코인 안에서 확인되기 때문이다.
    expect(report.coreSummary).toContain('위조가 아닙니다');
    // 계보 FATAL은 하나도 없다.
    expect(report.coreFindings.filter((x) => x.severity === 'FATAL')).toEqual([]);
  });

  it('진짜 위조(증서 서명 손상)는 그대로 FORGED다 — 어휘를 나눴다고 무뎌지지 않았다', () => {
    const rogue = signerFromKeyPair(generateKeyPair());
    // 신뢰 루트 목록에 rogue의 keyId를 **그 이름 그대로** 넣어 "루트는 아는데 서명이
    // 안 맞는" 상황을 만든다 = 진짜 위조.
    const forgedCert = cert({}, rogue);
    const tampered: MembershipCertificate = { ...forgedCert, issuerPublicKey: root.publicKeyHex };
    const coin = honestCoin(MINT_AT, tampered);

    const verdict = verifyCoin(coin, strict);
    expect(verdict.reasons).toContain('BAD_MEMBERSHIP');

    const report = checkCoinAuthenticity(coin, strict);
    expect(report.coreVerdict).toBe('FORGED');
    expect(report.coreFindings.some((f) => f.check === 'LINEAGE' && f.severity === 'FATAL')).toBe(true);
  });

  it('신뢰 루트 교체(경로2): 옛 코인은 위조가 아니라 "이 검사자가 루트를 모름"이다', () => {
    const coin = honestCoin(MINT_AT);
    const newRoots = { 'membership-root-2027': signerFromKeyPair(generateKeyPair()).publicKeyHex };

    const verdict = verifyCoin(coin, { trustedRootKeys: newRoots, requireIntegrityToken: true });
    expect(verdict.reasons).toEqual(['UNKNOWN_MEMBERSHIP_ROOT']); // 예전엔 BAD_MEMBERSHIP

    const report = checkCoinAuthenticity(coin, { trustedRootKeys: newRoots, requireIntegrityToken: true });
    expect(report.coreVerdict).not.toBe('FORGED');
    const f = report.coreFindings.find((x) => x.check === 'MEMBERSHIP_UNVERIFIED')!;
    expect(f.severity).toBe('UNPROVEN');
    // ★적대 검증 시정: 예전 문장은 "코인의 흠이 아니라 **검사자의 사정입니다**"라고
    //   단정했다. 그러면 자기 키로 자작 서명한 진짜 위조 코인의 소지자에게도 시스템이
    //   "당신 코인은 멀쩡하고 검사기가 문제다"라고 말해 준다. 검사자 쪽에서는 그 둘을
    //   구별할 수 없으므로, 구별할 수 없다고 말해야 한다(제3조).
    expect(f.detail).not.toContain('코인의 흠이 아니라');
    expect(f.detail).toContain('구별할 수 없습니다');
    expect(f.detail).toContain('자기 키로 서명한');
    expect(report.coreSummary).not.toContain('위조가 아닙니다');
    expect(report.coreSummary).toContain('판정하지 못했습니다');
  });

  it('★자작 서명 위조에 진짜 키 목록을 줘도 "위조가 아니다"라고 말하지 않는다', () => {
    // 공격자가 자기 루트로 자기에게 발급한 증서를 단 코인. 검사자는 **진짜** 루트
    // 목록을 넘긴다 — 그래도 판정은 UNKNOWN_MEMBERSHIP_ROOT다(구별 불가).
    const rogueRoot = signerFromKeyPair(generateKeyPair());
    const selfSigned = honestCoin(MINT_AT, cert({ issuerKeyId: 'rogue-root' }, rogueRoot));

    const report = checkCoinAuthenticity(selfSigned, strict);
    expect(report.coreVerdict).toBe('SUSPECT');
    // 판정은 FORGED가 아니다(옛 코인을 죽이지 않기 위해). 그러나 **말**은 무죄를
    // 선고하지 않는다 — 이 둘을 동시에 지키는 것이 이 수정의 전부다.
    expect(report.coreSummary).not.toContain('위조가 아닙니다');
    expect(report.notes.some((n) => n.includes('구별할 수 없습니다'))).toBe(true);
  });

  it('증서 없는 옛 코인에 필수화 스위치를 켜도 위조 판정이 나오지 않는다 (경로3)', () => {
    const legacy = honestCoin(MINT_AT, null);
    // 스위치 off — 예나 지금이나 유효.
    expect(verifyCoin(legacy).valid).toBe(true);
    // 스위치 on — 수령은 fail-closed로 거부하되,
    expect(verifyCoin(legacy, strict).reasons).toEqual(['MISSING_INTEGRITY_TOKEN']);
    // 판정은 위조가 아니다.
    const report = checkCoinAuthenticity(legacy, strict);
    expect(report.coreVerdict).toBe('SUSPECT');
    expect(report.coreFindings.every((f) => f.severity !== 'FATAL')).toBe(true);
    // ★"증서가 없다"는 "서명한 키를 모른다"와 다른 말이다 — 검사 id를 갈라 두었다.
    //   뭉쳐 두면 증서 제도 이전의 옛 코인에게 "서명한 키가 목록에 없습니다"라는
    //   엉뚱한 설명이 붙고, 키 목록을 갱신하라는 쓸모없는 안내가 나간다.
    expect(report.coreFindings.some((f) => f.check === 'MEMBERSHIP_ABSENT')).toBe(true);
    expect(report.coreSummary).toContain('무결성 증서가 아예 없습니다');
    expect(report.notes.some((n) => n.includes('키 목록을 갱신'))).toBe(false);
  });
});

// ── ⑤ 지갑이 민팅 직전에 물어야 하는 것 ───────────────────────────────

describe('★민팅 시각 증서 검사 — 지갑이 죽은 코인을 만들지 않게 (walletService #settle)', () => {
  /**
   * 동반 결함: 지갑은 민팅 시각에 증서를 전혀 보지 않고 무조건 첨부했다. 증서 갱신은
   * 온라인 전용이므로(directory.ts `renewMembershipIfDue`), 120일 넘게 오프라인이던
   * 사람은 **태어나자마자 수령 거부되는 코인**을 만들었다.
   *
   * 지갑은 이제 `certificateCoversMint`로 먼저 묻는다. 못 덮으면 붙이지 않는다.
   * 아래가 그 선택이 옳은 이유다 — 붙이면 완전히 죽고, 안 붙이면 최소한 살아 있다.
   */
  const WAY_LATE = ISSUED_AT + 200 * DAY;

  it('지갑의 판단 기준: 200일 뒤 정산은 이 증서가 못 덮는다', () => {
    expect(certificateCoversMint(cert(), WAY_LATE)).toBe(false);
  });

  it('덮지 못하는 증서를 붙이면 → 수령 거부 (죽은 코인)', () => {
    expect(verifyCoin(honestCoin(WAY_LATE, cert()), strict).valid).toBe(false);
  });

  it('붙이지 않으면 → 살아 있다. 필수 모드에서도 위조 판정은 아니다', () => {
    const noCert = honestCoin(WAY_LATE, null);
    // 점진 전환 상태(기본)에서는 그대로 유효하다 — 0층은 그대로다.
    expect(verifyCoin(noCert).valid).toBe(true);
    // 필수 모드에서 거부되더라도 "위조"라고 불리지 않는다.
    // (now를 명시한다: "정산 시각이 미래"는 검사 시각에 의존하는 **정당한** 검사다 —
    //  now가 커질수록 통과하기 쉬워질 뿐 옛 코인을 소급해 죽이지 않는다.)
    expect(checkCoinAuthenticity(noCert, { ...strict, now: WAY_LATE + DAY }).coreVerdict).not.toBe('FORGED');
  });
});

// ── ⑥ 결속은 그대로 살아 있는가 (기존 방어선 회귀) ────────────────────

describe('기존 결속 방어는 그대로다', () => {
  it('증서의 기기 키가 증명과 다르면 MEMBERSHIP_MISMATCH (위조 · FATAL)', () => {
    const attacker = signerFromKeyPair(generateKeyPair());
    const coin = honestCoin(MINT_AT, cert({ devicePublicKey: attacker.publicKeyHex }));
    expect(verifyCoin(coin, strict).reasons).toContain('MEMBERSHIP_MISMATCH');
    expect(checkCoinAuthenticity(coin, strict).coreVerdict).toBe('FORGED');
  });

  it('유효기간이 뒤집힌 증서는 MALFORMED — 창을 유도할 수 없다', () => {
    const broken = cert({ expiresAt: ISSUED_AT });
    expect(verifyMembershipForMint(broken, roots, MINT_AT)).toMatchObject({
      valid: false,
      reason: 'MALFORMED',
    });
  });
});
