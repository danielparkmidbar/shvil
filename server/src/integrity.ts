/**
 * 기기 무결성 검증 훅 (보안 감사 C-2, 방어선 1선 — 지시서 3장).
 *
 * 서버는 가입/갱신 시 기기 무결성(Android Play Integrity / iOS App Attest)을
 * 검증하고, 그 판정을 IntegrityLevel로 요약해 회원 증서에 각인한다. 변조·에뮬레이터·
 * 루팅 기기는 VERIFIED 판정을 못 받아, 발급 증서의 무결성 수준이 낮거나 UNVERIFIED로
 * 남고, 수신 지갑의 증서 검증 정책에서 거부·보류된다.
 *
 * 이 서버 자체는 거래를 승인하지 않는다. 무결성 검증은 "민팅 자격 확립"이며
 * 거래 승인이 아니다 — 거래는 계속 두 기기의 로컬에서 오프라인으로 완결된다.
 *
 * 보안 감사 C-1 게이팅 존중: 무결성 모의(dev-verified/dev-basic)는 devMode에서만
 * 인정된다. 운영에서는 실 연동 전까지 안전 기본값 UNVERIFIED를 반환한다 — 미검증
 * 기기를 VERIFIED로 오인하지 않는다.
 */
import type { IntegrityLevel } from '@shvil/shared';

export type IntegrityPlatform = 'android' | 'ios';

/**
 * 무결성 토큰을 검증해 IntegrityLevel을 반환한다.
 *
 * @param platform 'android'(Play Integrity) | 'ios'(App Attest). 그 외는 UNVERIFIED.
 * @param token    클라이언트가 플랫폼 무결성 API로 받은 토큰(운영) 또는 모의 토큰(개발).
 * @param devMode  개발 모드에서만 모의 토큰을 인정.
 */
export function verifyIntegrityToken(
  platform: string | undefined,
  token: string | undefined,
  devMode: boolean,
): IntegrityLevel {
  // 개발 모드: 실 무결성 API 없이 레벨을 모의한다 (C-1: devMode 한정).
  if (devMode) {
    if (token === 'dev-verified') return 'VERIFIED';
    if (token === 'dev-basic') return 'BASIC';
    return 'UNVERIFIED';
  }

  // 운영: 실제 플랫폼 무결성 검증.
  // TODO(운영): Google Play Integrity API / Apple App Attest 서버 검증 연동.
  //   - android: Play Integrity 토큰을 Google API로 복호·검증 → deviceIntegrity의
  //     MEETS_DEVICE_INTEGRITY면 VERIFIED, MEETS_BASIC_INTEGRITY면 BASIC.
  //   - ios: App Attest attestation/assertion을 Apple 루트로 검증 → VERIFIED.
  // 외부 의존이 연동되기 전까지는 안전 기본값(UNVERIFIED)을 반환한다.
  void platform;
  void token;
  return 'UNVERIFIED';
}
