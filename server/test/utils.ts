/** 서버 테스트 공용 헬퍼 — 가입·서명 요청·걷기 코인 민팅. */
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import {
  PendingWalkLedger,
  buildAuthHeaders,
  buildWalkSegmentProof,
  generateKeyPair,
  generateMessagingKeyPair,
  mintWalkCoin,
  signerFromKeyPair,
  type Coin,
  type MembershipCertificate,
  type MessagingKeyPair,
  type Signer,
  type WalkSample,
} from '@shvil/shared';

export const T0 = Date.parse('2026-07-10T06:00:00Z');

export interface TestIdentity {
  memberId: string;
  signer: Signer;
  msg: MessagingKeyPair;
  /** 가입 응답의 회원 증서 (보안 감사 C-2). 기존 테스트는 무시해도 된다. */
  cert?: MembershipCertificate;
}

export async function register(
  app: FastifyInstance,
  phone: string,
  email: string,
  displayName: string,
  /** 무결성 모의 토큰 (devMode 한정): 'dev-verified' | 'dev-basic'. 미지정 시 미제출. */
  integrityToken?: string,
): Promise<TestIdentity> {
  const signer = signerFromKeyPair(generateKeyPair());
  const msg = generateMessagingKeyPair();
  const otpRes = await app.inject({ method: 'POST', url: '/auth/otp', payload: { phone } });
  const { devCode } = otpRes.json() as { devCode: string };
  const regRes = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      phone,
      code: devCode,
      email,
      displayName,
      devicePublicKey: signer.publicKeyHex,
      messagingPublicKey: msg.publicKeyHex,
      ...(integrityToken !== undefined ? { integrityToken, platform: 'android' } : {}),
    },
  });
  expect(regRes.statusCode).toBe(200);
  const { memberId, membershipCertificate } = regRes.json() as {
    memberId: string;
    membershipCertificate?: MembershipCertificate;
  };
  return {
    memberId,
    signer,
    msg,
    ...(membershipCertificate !== undefined ? { cert: membershipCertificate } : {}),
  };
}

export async function signedInject(
  app: FastifyInstance,
  who: TestIdentity,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
) {
  const path = url.split('?')[0]!;
  const bodyText = body === undefined ? '' : JSON.stringify(body);
  const headers = {
    ...buildAuthHeaders(who.memberId, who.signer, method, path, bodyText, Date.now()),
    ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
  };
  return app.inject({ method, url, headers, ...(body !== undefined ? { payload: bodyText } : {}) });
}

/** 정상 보행 샘플로 코스 위 걷기를 잠정 누적 → 정산 → 민팅. */
export function mintWalkCoinFor(who: TestIdentity, km: number, startAt: number = T0): Coin {
  const ledger = new PendingWalkLedger({ memberId: who.memberId });
  const windows = Math.round(km * 10);
  let t = startAt;
  for (let i = 0; i < windows; i++) {
    const sample: WalkSample = {
      durationS: 72,
      distanceM: 100,
      steps: 140,
      tier: 'ON_COURSE',
      timestamp: t,
      courseId: 'shvil-israel',
    };
    const verdict = ledger.recordSample(sample);
    if (!verdict.accepted) throw new Error('sample rejected');
    t += 72_000;
  }
  return mintWalkCoin(buildWalkSegmentProof(ledger.settleOnSpend(t)!, who.signer));
}
