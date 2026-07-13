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
  /** 만료 — 주기 갱신 강제(무결성 재확인). 만료 증서로 만든 코인은 거부. */
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
  | { valid: false; reason: 'BAD_SIGNATURE' | 'UNTRUSTED_ROOT' | 'EXPIRED' | 'MALFORMED' };

/**
 * 수신 지갑의 로컬 증서 검증.
 * @param trustedRootKeys 앱에 핀된 신뢰 루트 (keyId → publicKeyHex)
 * @param now 현재 시각 (만료 판정)
 */
export function verifyMembershipCertificate(
  cert: MembershipCertificate,
  trustedRootKeys: Record<string, string>,
  now: number,
): MembershipVerdict {
  if (cert.v !== 1 || !cert.memberId || !cert.devicePublicKey) return { valid: false, reason: 'MALFORMED' };
  const trusted = trustedRootKeys[cert.issuerKeyId];
  if (!trusted || trusted !== cert.issuerPublicKey) return { valid: false, reason: 'UNTRUSTED_ROOT' };
  if (now >= cert.expiresAt) return { valid: false, reason: 'EXPIRED' };
  if (!verifyObject(certPayload(cert), cert.signature, cert.issuerPublicKey)) {
    return { valid: false, reason: 'BAD_SIGNATURE' };
  }
  return { valid: true };
}
