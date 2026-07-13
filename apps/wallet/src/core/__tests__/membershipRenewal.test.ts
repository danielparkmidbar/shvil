/**
 * 회원 증서 갱신 판정 테스트 (보안 감사 C-2).
 * 만료 임박·부재 시 갱신 대상으로 본다 — 만료된 증서로 만든 코인은 수신 거부되므로
 * 온라인일 때 미리 재발급한다. 순수 로직 (expo·네트워크 무관).
 */
import { describe, expect, it } from 'vitest';
import type { MembershipCertificate } from '@shvil/shared';
import { RENEWAL_WINDOW_MS, isMembershipRenewalDue } from '../membershipRenewal';

const NOW = 1_000_000_000_000;

function certExpiringAt(expiresAt: number): MembershipCertificate {
  return {
    v: 1,
    memberId: 'SHV-000001',
    devicePublicKey: 'dev-pub',
    integrity: 'VERIFIED',
    issuedAt: NOW - RENEWAL_WINDOW_MS,
    expiresAt,
    issuerKeyId: 'membership-root-2026',
    issuerPublicKey: 'root-pub',
    signature: 'sig',
  };
}

describe('isMembershipRenewalDue', () => {
  it('증서가 없으면 갱신 대상 (가입했으나 아직 미발급)', () => {
    expect(isMembershipRenewalDue(null, NOW)).toBe(true);
  });

  it('만료가 창(3일)보다 멀면 갱신 불필요', () => {
    expect(isMembershipRenewalDue(certExpiringAt(NOW + RENEWAL_WINDOW_MS + 1), NOW)).toBe(false);
  });

  it('만료가 창 안이면 갱신 대상', () => {
    expect(isMembershipRenewalDue(certExpiringAt(NOW + RENEWAL_WINDOW_MS - 1), NOW)).toBe(true);
  });

  it('이미 만료됐어도 갱신 대상', () => {
    expect(isMembershipRenewalDue(certExpiringAt(NOW - 1), NOW)).toBe(true);
  });
});
