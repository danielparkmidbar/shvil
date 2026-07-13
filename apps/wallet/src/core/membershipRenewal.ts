/**
 * 회원 증서 갱신 판정 (순수 로직 — expo 모듈 import 금지, vitest 대상).
 *
 * 증서는 만료가 있다(무결성 재확인 강제). 만료된 증서로 만든 코인은 수신 검증에서
 * 거부되므로, 만료 임박 시(또는 부재 시) 온라인일 때 미리 갱신을 시도한다.
 */
import type { MembershipCertificate } from '@shvil/shared';

/** 만료 이 시간 전부터 갱신 대상으로 본다 (3일). */
export const RENEWAL_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * 갱신이 필요한가? 증서가 없으면(가입했으나 아직 미발급) true, 만료 창 안이면 true.
 * @param cert 현재 보관 중인 증서 (없으면 null)
 * @param now 현재 시각 (ms)
 */
export function isMembershipRenewalDue(
  cert: MembershipCertificate | null,
  now: number,
  windowMs: number = RENEWAL_WINDOW_MS,
): boolean {
  if (!cert) return true;
  return now >= cert.expiresAt - windowMs;
}
