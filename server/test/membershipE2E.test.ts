/**
 * C-2 엔드투엔드: 서버 발급 회원 증서로 실제 위조 차단이 작동하는지 검증.
 * (서버 증서 발급 → 코어 verifyCoin 결속 검증 전 경로를 한 번에 확인)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PendingWalkLedger,
  buildWalkSegmentProof,
  generateKeyPair,
  mintWalkCoin,
  signerFromKeyPair,
  verifyCoin,
  type Coin,
  type MembershipCertificate,
  type WalkSample,
} from '@shvil/shared';
import { buildApp } from '../src/app';
import { register, type TestIdentity } from './utils';

const app = buildApp({ dbPath: ':memory:', devMode: true });

/**
 * 걷기 시작 시각.
 *
 * ★2026-07-26: 예전에는 `Date.parse('2026-07-10T06:00:00Z')` 고정값이었다. 그런데
 * 서버는 증서를 **실제 현재 시각**으로 발급하므로, 그 픽스처는 "증서가 생기기 2주 전에
 * 정산된 코인"이라는 현실에 없는 물건이었다. 코인 검증이 검사 시각 대신
 * **민팅 시각 ∈ 증서 창**을 보게 되면서 그 모순이 드러났다(`MEMBERSHIP_OUT_OF_WINDOW`).
 *
 * 실제 지갑에서는 이런 코인이 나올 수 없다: `settledAt`은 정산하는 순간의 시각이고,
 * 그때 지갑이 들고 있는 증서는 이미 발급된 것이다. 그래서 픽스처를 현실에 맞춘다 —
 * 증서 발급 직후에 걷는다. (하한을 없애는 것은 답이 아니다. 없애면 유출 증서로
 * "증서 생기기 이전" 시각을 채우는 소급 발행이 무제한으로 열린다.)
 */
let T0 = 0;

let honest: TestIdentity;
let trustedRootKeys: Record<string, string> = {};

/** 정상 보행으로 WALK 코인 민팅 (증서 첨부 선택). */
function mintWalk(id: TestIdentity, membership: MembershipCertificate | null): Coin {
  const ledger = new PendingWalkLedger({ memberId: id.memberId });
  let t = T0;
  for (let i = 0; i < 50; i++) {
    const sample: WalkSample = { durationS: 72, distanceM: 100, steps: 140, tier: 'ON_COURSE', timestamp: t, courseId: 'shvil-israel' };
    ledger.recordSample(sample);
    t += 72_000;
  }
  return mintWalkCoin(
    buildWalkSegmentProof(ledger.settleOnSpend(t)!, id.signer, membership ? { membership } : {}),
  );
}

beforeAll(async () => {
  await app.ready();
  honest = await register(app, '+972-50-c2', 'c2@example.org', '정직한워커', 'dev-verified');
  // 증서 발급 1시간 뒤부터 걷는다 — 실제 지갑의 순서(가입 → 증서 → 걷기 → 정산) 그대로.
  T0 = honest.cert!.issuedAt + 3600_000;
  const keys = ((await app.inject({ method: 'GET', url: '/keys' })).json() as { keys: { keyId: string; publicKey: string }[] }).keys;
  trustedRootKeys = Object.fromEntries(keys.map((k) => [k.keyId, k.publicKey]));
});

afterAll(async () => {
  await app.close();
});

describe('회원 증서 E2E — 무결성 필수 모드 (파일럿 전제)', () => {
  // ★검사 시각을 넘기지 않는다. 2026-07-26부터 코인 검증은 검사 시각과 무관하다 —
  //   같은 코인이면 오늘 보든 30년 뒤에 보든 같은 답이 나온다(다니엘 쌤 원칙).

  it('서버가 가입 시 VERIFIED 증서를 발급하고 루트를 공개한다', () => {
    expect(honest.cert).toBeDefined();
    expect(honest.cert!.integrity).toBe('VERIFIED');
    expect(honest.cert!.memberId).toBe(honest.memberId);
    expect(honest.cert!.devicePublicKey).toBe(honest.signer.publicKeyHex);
    expect(trustedRootKeys[app.keyIds.membershipRoot]).toBeDefined();
  });

  it('정품 증서를 품은 코인은 필수 모드 검증을 통과한다', () => {
    const coin = mintWalk(honest, honest.cert!);
    const verdict = verifyCoin(coin, { requireIntegrityToken: true, trustedRootKeys });
    expect(verdict.valid).toBe(true);
  });

  it('위조 시나리오: 변조 앱이 증서 없이 임의 회원 번호로 만든 코인은 거부', () => {
    const attacker = signerFromKeyPair(generateKeyPair());
    const forged = mintWalk({ memberId: 'SHV-000000', signer: attacker, msg: honest.msg }, null);
    const verdict = verifyCoin(forged, { requireIntegrityToken: true, trustedRootKeys });
    expect(verdict.valid).toBe(false);
    expect(verdict.reasons).toContain('MISSING_INTEGRITY_TOKEN');
  });

  it('위조 시나리오: 남의 증서를 빌려 다른 기기 키로 서명한 코인은 결속 불일치로 거부', () => {
    const attacker = signerFromKeyPair(generateKeyPair());
    // 정직한 사용자의 증서(honest.cert)를 그대로 붙이되 서명은 attacker 기기 키로
    const coin = mintWalk({ memberId: honest.memberId, signer: attacker, msg: honest.msg }, honest.cert!);
    const verdict = verifyCoin(coin, { requireIntegrityToken: true, trustedRootKeys });
    expect(verdict.valid).toBe(false);
    // 증서의 devicePublicKey(정직한 사용자)와 증명 서명 키(attacker)가 불일치
    expect(verdict.reasons).toContain('MEMBERSHIP_MISMATCH');
  });

  it('갱신: 만료 임박 증서를 /auth/certificate로 재발급받는다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/certificate',
      headers: {
        ...(await import('@shvil/shared')).buildAuthHeaders(
          honest.memberId,
          honest.signer,
          'POST',
          '/auth/certificate',
          JSON.stringify({ integrityToken: 'dev-verified', platform: 'android' }),
          Date.now(),
        ),
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ integrityToken: 'dev-verified', platform: 'android' }),
    });
    expect(res.statusCode).toBe(200);
    const { membershipCertificate } = res.json() as { membershipCertificate: MembershipCertificate };
    expect(membershipCertificate.integrity).toBe('VERIFIED');
    expect(membershipCertificate.devicePublicKey).toBe(honest.signer.publicKeyHex);
  });
});
