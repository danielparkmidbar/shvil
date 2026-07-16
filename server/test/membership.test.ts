/**
 * 회원 증서 발급 테스트 (보안 감사 C-2 조치, 방어선 1·3선 결속 — 지시서 3장).
 *
 * 검증: 가입 시 증서 발급·수신 지갑 검증 통과, devMode 무결성 레벨 매핑,
 * /keys에 신뢰 루트 노출, /auth/certificate 갱신, 운영 기본 UNVERIFIED(C-1 게이팅).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyMembershipCertificate, type MembershipCertificate } from '@shvil/shared';
import { buildApp, MEMBERSHIP_ROOT_KEY_ID } from '../src/app';
import { register, signedInject, type TestIdentity } from './utils';

const app = buildApp({ dbPath: ':memory:', devMode: true });

interface KeyEntry {
  keyId: string;
  publicKey: string;
  purpose: string;
}

async function trustedRoots(): Promise<Record<string, string>> {
  const res = await app.inject({ method: 'GET', url: '/keys' });
  const { keys } = res.json() as { keys: KeyEntry[] };
  return Object.fromEntries(keys.map((k) => [k.keyId, k.publicKey]));
}

let roots: Record<string, string>;

beforeAll(async () => {
  await app.ready();
  roots = await trustedRoots();
});

afterAll(async () => {
  await app.close();
});

describe('/keys — 회원 증서 신뢰 루트 노출 (지갑이 핀)', () => {
  it('MEMBERSHIP_ROOT 목적의 루트 키가 포함된다', () => {
    expect(roots[MEMBERSHIP_ROOT_KEY_ID]).toBeDefined();
    expect(roots[MEMBERSHIP_ROOT_KEY_ID]).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('가입 시 회원 증서 발급 (보안 감사 C-2)', () => {
  it('가입 응답에 증서가 포함되고 수신 지갑 검증을 통과한다', async () => {
    const alon = await register(app, '+972-50-777-1111', 'alon@example.org', '알론', 'dev-verified');
    expect(alon.cert).toBeDefined();
    const cert = alon.cert!;
    // 회원 번호 ↔ 기기 공개키가 증서로 결속된다.
    expect(cert.memberId).toBe(alon.memberId);
    expect(cert.devicePublicKey).toBe(alon.signer.publicKeyHex);
    expect(cert.issuerKeyId).toBe(MEMBERSHIP_ROOT_KEY_ID);
    // 수신 지갑이 신뢰 루트로 로컬 검증.
    const verdict = verifyMembershipCertificate(cert, roots, Date.now());
    expect(verdict.valid).toBe(true);
  });

  it('devMode 무결성 레벨 매핑: dev-verified→VERIFIED, dev-basic→BASIC, 미제출→UNVERIFIED', async () => {
    const v = await register(app, '+972-50-777-2222', 'v@example.org', 'V', 'dev-verified');
    const b = await register(app, '+972-50-777-3333', 'b@example.org', 'B', 'dev-basic');
    const u = await register(app, '+972-50-777-4444', 'u@example.org', 'U'); // 미제출
    expect(v.cert!.integrity).toBe('VERIFIED');
    expect(b.cert!.integrity).toBe('BASIC');
    expect(u.cert!.integrity).toBe('UNVERIFIED');
  });

  it('30일 유효기간이 설정된다', async () => {
    const m = await register(app, '+972-50-777-5555', 'm@example.org', 'M', 'dev-verified');
    const ttl = m.cert!.expiresAt - m.cert!.issuedAt;
    expect(ttl).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('신뢰하지 않는 루트로는 검증에 실패한다', async () => {
    const m = await register(app, '+972-50-777-6666', 'm2@example.org', 'M2', 'dev-verified');
    const verdict = verifyMembershipCertificate(m.cert!, { [MEMBERSHIP_ROOT_KEY_ID]: 'ff'.repeat(32) }, Date.now());
    expect(verdict.valid).toBe(false);
  });

  it('만료 후에는 검증에 실패한다', async () => {
    const m = await register(app, '+972-50-777-7777', 'm3@example.org', 'M3', 'dev-verified');
    const verdict = verifyMembershipCertificate(m.cert!, roots, m.cert!.expiresAt + 1);
    expect(verdict.valid).toBe(false);
  });
});

describe('/auth/certificate — 갱신 (만료 전 무결성 재확인)', () => {
  let holder: TestIdentity;

  beforeAll(async () => {
    holder = await register(app, '+972-50-888-0000', 'renew@example.org', '갱신자', 'dev-verified');
  });

  it('서명 인증 없이는 갱신 불가 (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/certificate', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('인증된 회원이 새 증서를 발급받고 검증을 통과한다', async () => {
    const res = await signedInject(app, holder, 'POST', '/auth/certificate', { integrityToken: 'dev-verified', platform: 'android' });
    expect(res.statusCode).toBe(200);
    const { membershipCertificate } = res.json() as { membershipCertificate: MembershipCertificate };
    expect(membershipCertificate.memberId).toBe(holder.memberId);
    expect(membershipCertificate.devicePublicKey).toBe(holder.signer.publicKeyHex);
    expect(membershipCertificate.integrity).toBe('VERIFIED');
    expect(verifyMembershipCertificate(membershipCertificate, roots, Date.now()).valid).toBe(true);
  });
});

describe('C-1 게이팅 존중 — 운영(devMode=false) 기본은 UNVERIFIED', () => {
  it('운영 모드에서는 모의 토큰도 UNVERIFIED로 발급된다', async () => {
    // 운영 모드는 KEK 필수 — 환경변수 오염(다른 테스트의 SHVIL_KEK 삭제)과 무관하게
    // 옵션으로 직접 주입해 테스트를 격리한다.
    const prod = buildApp({ dbPath: ':memory:', devMode: false, kek: 'k'.repeat(64) });
    await prod.ready();
    // OTP 코드는 devMode에서만 응답되므로, 운영 서버에 직접 회원을 심어 검증한다.
    const signer = (await import('@shvil/shared')).signerFromKeyPair(
      (await import('@shvil/shared')).generateKeyPair(),
    );
    const msg = (await import('@shvil/shared')).generateMessagingKeyPair();
    prod.db
      .prepare(
        `INSERT INTO members (member_id, phone_hash, email, email_verified, display_name,
          device_public_key, messaging_public_key, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
      )
      .run('SHV-999999', 'hash-prod', 'p@example.org', '운영', signer.publicKeyHex, msg.publicKeyHex, Date.now());
    const res = await signedInject(
      prod,
      { memberId: 'SHV-999999', signer, msg },
      'POST',
      '/auth/certificate',
      { integrityToken: 'dev-verified', platform: 'android' },
    );
    expect(res.statusCode).toBe(200);
    const { membershipCertificate } = res.json() as { membershipCertificate: MembershipCertificate };
    // devMode=false: 실 연동 전 안전 기본값 — 모의 토큰을 신뢰하지 않는다.
    expect(membershipCertificate.integrity).toBe('UNVERIFIED');
    await prod.close();
  });
});
