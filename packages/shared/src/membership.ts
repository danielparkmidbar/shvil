/**
 * 회원 증서 (Membership Certificate) — 무결성 방어선 1·3선의 결속 (지시서 3장, 보안 감사 C-2).
 *
 * 문제: 온디바이스 민팅에서 회원 번호가 기기 키에 결속되지 않으면, 변조 앱이 임의
 * 회원 번호 + 새 기기 키로 유효 서명 코인을 무제한 생성할 수 있다(인간 한계가
 * 회원당이므로 신규 번호 남발 = 무한 복제).
 *
 * 해법: 거래는 그대로 오프라인·무승인으로 두되, **민팅 자격을 증서로 사전 확립**해
 * 계보에 각인한다. 서버가 가입/주기 갱신 시 기기 무결성(Play Integrity / App Attest)을
 * 검증하고, 통과하면 이 증서를 루트 키로 서명해 발급한다:
 *   - 변조·에뮬레이터·루팅 기기 → 무결성 실패 → 증서 미발급 → 그 코인은 수신 검증에서 거부.
 *   - 회원 번호 ↔ 기기 공개키가 서버 서명으로 결속 → 임의 회원 번호 위조 불가.
 *
 * 증서 발급만 온라인(가입 시 + 만료 전 갱신), 거래·민팅은 계속 오프라인.
 * 수신 지갑은 서버 루트 공개키(앱에 핀)로 증서를 로컬 검증한다 — 승인이 아니라 위조 검사.
 *
 * ── ★2026-07-26: 만료의 두 용도를 분리했다 (다니엘 쌤 원칙) ──────────────
 *
 * > "화폐 발행자는 위조 방지를 최선을 다해 하지만 위조 방지 시스템도 업그레이드한다.
 * >  **새 방지 시스템이 나온다고 옛 화폐가 가짜가 되지는 않는다.**"
 *
 * 이전 코드는 `now(검사 시각) >= cert.expiresAt`으로 판정했다. 그래서 같은 코인이
 * 민팅+1일에는 유효하고 민팅+31일에는 `BAD_MEMBERSHIP` → 위폐 감지기가 **FORGED**를
 * 띄웠다. 사람은 아무 잘못도 하지 않았는데 30일 뒤 자기 돈이 가짜가 된다. 1990년에
 * 발행된 지폐가 지금도 법정통화인 것과 정면으로 어긋난다.
 *
 * 그런데 만료를 그냥 없애면 더 큰 구멍이 열린다. 민팅 시각(`proof.settledAt`)은
 * **폰이 스스로 적고 자기 키로 서명하는 값**이라 공격자 제어 필드다. 만료가 없으면
 * 한 번 발급된 증서(+ 그 기기 개인키)로 **영원히** 소급 발행할 수 있다.
 *
 * 그래서 답은 "만료 폐지"가 아니라 **비대칭 분리**다. 만료에는 원래 두 용도가 있었다:
 *
 *   (가) **갱신 판정** — "지금 이 증서를 다시 받아야 하는가?"
 *        → 검사 시각이 당연히 들어간다. 서버·지갑의 갱신 로직이 쓴다.
 *        → `verifyMembershipCertificate(cert, roots, now)`
 *
 *   (나) **코인 검증** — "이 코인이 정당한 자격으로 만들어졌는가?"
 *        → 검사 시각이 **절대 들어가면 안 된다.** 대신 코인이 주장하는 민팅 시각이
 *          증서가 증언할 수 있는 창 안인지만 본다. 검사 시각과 무관하므로
 *          **1년 뒤에 봐도 30년 뒤에 봐도 같은 답**이 나온다.
 *        → `verifyMembershipForMint(cert, roots, settledAt)`
 *
 * (나)의 창은 **서버가 서명한 두 값(issuedAt·expiresAt)에서만** 유도된다 —
 * 공격자가 못 고치는 값이다. 그래서 `settledAt`이 공격자 제어여도 공격자가 고를 수
 * 있는 범위는 그 증서의 창 안으로 묶인다. 옛 코인은 언제나 자기 증서의 창 안에
 * 있으므로 하나도 죽지 않는다.
 */
import { signObject, verifyObject, type Signer } from './crypto';

/** 기기 무결성 수준 — 서버가 Play Integrity / App Attest 판정을 요약해 담는다. */
export type IntegrityLevel =
  | 'VERIFIED' // MEETS_DEVICE_INTEGRITY / App Attest 유효
  | 'BASIC' // 기본 무결성만 (에뮬레이터 아님 정도)
  | 'UNVERIFIED'; // 무결성 미확인 (개발·폴백)

export interface MembershipCertificate {
  v: 1;
  memberId: string;
  /** 이 회원 번호에 결속된 기기 공개키 — WALK 증명의 서명 키와 일치해야 한다. */
  devicePublicKey: string;
  integrity: IntegrityLevel;
  issuedAt: number;
  /**
   * 만료 — 주기 갱신 강제(무결성 재확인).
   *
   * ★뜻이 하나 정확해졌다: 이것은 "이 증서로 **새로 민팅할 수 있는 기간**"의 기준이지
   * "이 증서로 만든 코인이 살아 있는 기간"이 **아니다.** 만료 뒤에 검사해도 창 안에서
   * 만들어진 코인은 영원히 유효하다. 창 밖의 정산(= 소급 발행)만 거부된다.
   */
  expiresAt: number;
  /** 발행 루트 키 ID — 지갑이 신뢰 루트 목록에서 공개키를 찾는다. */
  issuerKeyId: string;
  issuerPublicKey: string;
  signature: string;
}

function certPayload(cert: Omit<MembershipCertificate, 'signature'>): Omit<MembershipCertificate, 'signature'> {
  const { v, memberId, devicePublicKey, integrity, issuedAt, expiresAt, issuerKeyId, issuerPublicKey } = cert;
  return { v, memberId, devicePublicKey, integrity, issuedAt, expiresAt, issuerKeyId, issuerPublicKey };
}

/** 서버(루트 키 보유)가 무결성 검증 통과 후 증서를 발급한다. */
export function buildMembershipCertificate(
  fields: {
    memberId: string;
    devicePublicKey: string;
    integrity: IntegrityLevel;
    issuedAt: number;
    expiresAt: number;
    issuerKeyId: string;
  },
  rootSigner: Signer,
): MembershipCertificate {
  const unsigned: Omit<MembershipCertificate, 'signature'> = {
    v: 1,
    ...fields,
    issuerPublicKey: rootSigner.publicKeyHex,
  };
  return { ...unsigned, signature: signObject(certPayload(unsigned), rootSigner) };
}

export type MembershipVerdict =
  | { valid: true }
  | {
      valid: false;
      reason:
        | 'BAD_SIGNATURE'
        | 'UNTRUSTED_ROOT'
        /** (가) 갱신 판정 전용 — 지금 다시 받아야 한다. 코인 검증에는 쓰이지 않는다. */
        | 'EXPIRED'
        /** (나) 코인 검증 전용 — 이 증서가 증언할 수 없는 시각의 정산이다(소급 발행). */
        | 'OUT_OF_MINT_WINDOW'
        | 'MALFORMED';
    };

// ── 민팅 창 (나: 코인 검증) ───────────────────────────────────────

/**
 * 기기 시계 오차 관용 (뒤로 1일).
 *
 * 정산 시각(기기 시계)이 발급 시각(서버 시계)보다 조금 앞설 수 있다.
 * authenticity.ts의 `BREAKDOWN_TZ_TOLERANCE_DAYS`와 같은 폭이다.
 *
 * ★얼마나 넉넉한가: 증서를 받으려면 서명 요청 인증을 통과해야 하는데, 그것이 이미
 * 기기 시계를 서버 시계의 **±10분**(apiAuth.ts `AUTH_MAX_SKEW_MS`) 안으로 묶는다.
 * 즉 증서를 손에 넣은 기기의 시계 오차는 구조적으로 10분 이하이고, 여기서 주는
 * 관용은 그 **144배**다. 정직한 사람을 먼저 지키되(제3조), 이 방향으로 훔칠 수 있는
 * 시간은 하루뿐이다.
 *
 * ★이 하한이 없으면 안 된다: 유출 증서로 "증서가 생기기 이전"의 시각을 주장해 옛
 * 날짜를 채우는 소급 발행이 무제한으로 열린다(창이 아래로 −∞가 된다).
 */
export const MINT_WINDOW_BACK_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/**
 * 민팅 창의 길이 = 증서 유효기간의 몇 배인가. 4배.
 *
 * 운영 유효기간이 30일이므로 창은 **발급 후 120일**(= 유효기간 30일 + 유예 90일)이다.
 * 유예 90일의 근거는 authenticity.ts의 `MAX_SEGMENT_SPAN_DAYS`와 **같다**:
 * 이스라엘 트레일 종주가 45~60일이고, 종주자는 그동안 오프라인일 수 있다. 증서 갱신은
 * 온라인 전용이므로(directory.ts `renewMembershipIfDue`), 유예가 종주 기간보다 짧으면
 * **정직한 종주자가 만든 코인이 태어나자마자 죽는다**. 60일 종주에 한 달의 여유를 더한
 * 값이 90일이다.
 *
 * ★배수로 잡은 이유(중요): 창을 코드 상수(예: "무조건 90일")로 잡으면 그 상수를
 * 나중에 줄이는 순간 **옛 코인이 소급해 죽는다** — 이 작업이 고치려는 바로 그 병이다.
 * 배수로 잡으면 창의 절대 길이가 **그 증서 자신의 서명된 값**에서 나오므로, 서버가
 * 나중에 유효기간 정책을 바꿔도 이미 발급된 증서의 창은 그대로다.
 * (남는 드리프트는 이 배수 자체뿐이다 — docs/소급무효화_경로.md 참조.)
 */
export const MINT_WINDOW_TTL_MULTIPLE = 4;

/**
 * 이 증서가 증언할 수 있는 정산 시각의 범위.
 * 전부 **서버가 서명한 값**(issuedAt·expiresAt)에서만 유도된다 — 공격자가 못 고친다.
 */
export function membershipMintWindow(cert: MembershipCertificate): { from: number; to: number } {
  const ttlMs = cert.expiresAt - cert.issuedAt;
  return {
    from: cert.issuedAt - MINT_WINDOW_BACK_TOLERANCE_MS,
    to: cert.issuedAt + MINT_WINDOW_TTL_MULTIPLE * ttlMs,
  };
}

/**
 * 이 증서로 이 시각의 정산을 덮을 수 있는가. 지갑이 **민팅 직전에** 스스로 물어야 하는
 * 질문이기도 하다 — 덮지 못하는 증서를 첨부하면 그 코인은 태어나자마자 거부된다.
 */
export function certificateCoversMint(cert: MembershipCertificate, settledAt: number): boolean {
  const { from, to } = membershipMintWindow(cert);
  return settledAt >= from && settledAt <= to;
}

// ── 검증 ──────────────────────────────────────────────────────────

/** 시각과 무관한 부분만 — 형식·신뢰 루트·서명. 두 용도가 공유한다. */
function verifySeal(
  cert: MembershipCertificate,
  trustedRootKeys: Record<string, string>,
): MembershipVerdict {
  if (cert.v !== 1 || !cert.memberId || !cert.devicePublicKey) return { valid: false, reason: 'MALFORMED' };
  // 유효기간이 뒤집힌 증서는 창을 유도할 수 없다.
  if (!(cert.expiresAt > cert.issuedAt)) return { valid: false, reason: 'MALFORMED' };
  const trusted = trustedRootKeys[cert.issuerKeyId];
  if (!trusted || trusted !== cert.issuerPublicKey) return { valid: false, reason: 'UNTRUSTED_ROOT' };
  if (!verifyObject(certPayload(cert), cert.signature, cert.issuerPublicKey)) {
    return { valid: false, reason: 'BAD_SIGNATURE' };
  }
  return { valid: true };
}

/**
 * **(가) 갱신 판정** — "지금 이 증서를 다시 받아야 하는가?"
 *
 * ★코인 검증에 쓰지 마라. 검사 시각이 판정에 들어가므로, 이것으로 코인을 재면
 * 같은 코인이 오늘은 진짜이고 다음 달에는 가짜가 된다. 코인에는
 * `verifyMembershipForMint`를 쓴다.
 *
 * @param trustedRootKeys 앱에 핀된 신뢰 루트 (keyId → publicKeyHex)
 * @param now 현재 시각 (만료 판정)
 */
export function verifyMembershipCertificate(
  cert: MembershipCertificate,
  trustedRootKeys: Record<string, string>,
  now: number,
): MembershipVerdict {
  // 기존 순서 유지: 형식 → 루트 → 만료 → 서명.
  if (cert.v !== 1 || !cert.memberId || !cert.devicePublicKey) return { valid: false, reason: 'MALFORMED' };
  const trusted = trustedRootKeys[cert.issuerKeyId];
  if (!trusted || trusted !== cert.issuerPublicKey) return { valid: false, reason: 'UNTRUSTED_ROOT' };
  if (now >= cert.expiresAt) return { valid: false, reason: 'EXPIRED' };
  if (!verifyObject(certPayload(cert), cert.signature, cert.issuerPublicKey)) {
    return { valid: false, reason: 'BAD_SIGNATURE' };
  }
  return { valid: true };
}

/**
 * **(나) 코인 검증** — "이 정산이 이 증서의 자격 안에서 이루어졌는가?"
 *
 * 검사 시각을 인자로 받지 않는다. 그것이 이 함수의 전부다 —
 * **같은 코인이면 언제 검사해도 같은 답이 나온다.**
 *
 * @param settledAt 코인이 주장하는 민팅 시각 (`proof.settledAt`)
 */
export function verifyMembershipForMint(
  cert: MembershipCertificate,
  trustedRootKeys: Record<string, string>,
  settledAt: number,
): MembershipVerdict {
  const seal = verifySeal(cert, trustedRootKeys);
  if (!seal.valid) return seal;
  if (!certificateCoversMint(cert, settledAt)) return { valid: false, reason: 'OUT_OF_MINT_WINDOW' };
  return { valid: true };
}
