/**
 * 앱 무결성 토큰 획득 (보안 감사 C-2, 지시서 3장 방어선 1선).
 *
 * 서버는 이 토큰으로 기기 무결성(Play Integrity / App Attest)을 판정하고,
 * 통과하면 회원 증서(MembershipCertificate)를 루트 키로 서명해 발급한다. 토큰은
 * 가입·증서 갱신 시점에만 서버로 제출된다 — 이후 거래·민팅은 계속 오프라인이다
 * (무결성 담보는 발급된 증서에 각인되어 코인 계보를 따라 이동한다).
 *
 * 실토큰(Play Integrity Standard / App Attest assertion)은 네이티브 모듈이 필요해
 * Expo 개발 빌드에서만 동작한다. 지금은 개발 모드 토큰을 반환하며, 서버의 devMode
 * 짝(개발 토큰 수용)과 함께만 통과한다 — 프로덕션 서버는 이 토큰을 거부한다.
 */
import { Platform } from 'react-native';

export interface IntegrityToken {
  /** 무결성 API 종류를 서버가 구분하도록 플랫폼을 함께 전달한다. */
  platform: string;
  /** 무결성 증명 토큰 — 서버가 검증 후 증서를 발급한다. */
  token: string;
}

/**
 * 무결성 토큰을 획득한다.
 *
 * TODO(개발빌드): expo Play Integrity / App Attest 모듈 연동.
 *   - Android: Play Integrity Standard API (integrityToken) → 서버가 Google에 검증 요청.
 *   - iOS: App Attest assertion(DCAppAttest) → 서버가 Apple 루트로 검증.
 *   실제 SDK 호출은 개발 빌드에서만 가능하므로 여기서는 훅만 남긴다.
 */
export async function getIntegrityToken(): Promise<IntegrityToken> {
  // 개발 모드 토큰 — 서버 devMode에서만 수용된다 (프로덕션 서버는 거부).
  return { platform: Platform.OS, token: 'dev-verified' };
}
