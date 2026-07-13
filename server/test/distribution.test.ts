/**
 * 배포 엔드포인트 서명 테스트 (보안 감사 H-3).
 *
 * /keys · /courses · /limits/flagged 응답 본문에 배포 서명(_sig)이 붙어
 * 지갑 쪽 verifyDistribution을 통과하고, 본문이 변조되면 검증이 실패함을 확인한다.
 * 또한 /keys가 배포 공개키(DISTRIBUTION)를 노출해 지갑이 TOFU 핀 후 자기 일관성을
 * 확인할 수 있음을 확인한다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyDistribution, type DistributionSig } from '@shvil/shared';
import { buildApp, DISTRIBUTION_KEY_ID } from '../src/app';
import { register, type TestIdentity } from './utils';

const app = buildApp({ dbPath: ':memory:', devMode: true });

/** 배포 응답 = 본문 + _sig (지갑이 verifyDistribution으로 검증). */
type SignedResponse = Record<string, unknown> & { _sig?: DistributionSig };

let flaggedWalker: TestIdentity;

beforeAll(async () => {
  await app.ready();
  // 소명 목록에 실제 항목이 담긴 상태로도 서명이 성립하는지 보려고 한 명 등재한다.
  flaggedWalker = await register(app, '+82-10-9000', 'flagged@example.org', '보류대상');
  await app.inject({
    method: 'POST',
    url: '/limits/flagged',
    payload: { memberId: flaggedWalker.memberId, reason: '기준선 추월' },
  });
});

afterAll(async () => {
  await app.close();
});

async function getSigned(url: string): Promise<SignedResponse> {
  const res = await app.inject({ method: 'GET', url });
  expect(res.statusCode).toBe(200);
  return res.json() as SignedResponse;
}

describe('배포 서명 — 세 엔드포인트가 verifyDistribution을 통과 (H-3)', () => {
  it.each(['/keys', '/courses', '/limits/flagged'])('%s 응답에 유효한 _sig가 붙는다', async (url) => {
    const body = await getSigned(url);
    expect(body._sig).toBeDefined();
    expect(body._sig!.distKeyId).toBe(DISTRIBUTION_KEY_ID);
    expect(body._sig!.distPublicKey).toMatch(/^[0-9a-f]{64}$/);
    const verdict = verifyDistribution(body as SignedResponse & { _sig: DistributionSig });
    expect(verdict.valid).toBe(true);
  });

  it('세 엔드포인트는 동일한 배포 공개키로 서명된다 (단일 배포 키)', async () => {
    const keys = await getSigned('/keys');
    const courses = await getSigned('/courses');
    const flagged = await getSigned('/limits/flagged');
    expect(keys._sig!.distPublicKey).toBe(courses._sig!.distPublicKey);
    expect(courses._sig!.distPublicKey).toBe(flagged._sig!.distPublicKey);
  });

  it('TOFU로 핀한 공개키와 이후 응답이 일치하면 통과, 다른 키를 핀하면 KEY_PIN_MISMATCH', async () => {
    const first = await getSigned('/keys');
    const pinned = first._sig!.distPublicKey;
    const later = await getSigned('/keys');
    expect(verifyDistribution(later as SignedResponse & { _sig: DistributionSig }, pinned).valid).toBe(true);
    const wrongPin = 'ff'.repeat(32);
    const verdict = verifyDistribution(later as SignedResponse & { _sig: DistributionSig }, wrongPin);
    expect(verdict.valid).toBe(false);
    if (!verdict.valid) expect(verdict.reason).toBe('KEY_PIN_MISMATCH');
  });
});

describe('본문 변조 시 서명 검증 실패 (MITM 조작 차단 — H-3)', () => {
  it('/keys 발행 공개키를 교체하면 BAD_SIGNATURE', async () => {
    const body = (await getSigned('/keys')) as { keys: { publicKey: string }[]; _sig: DistributionSig };
    // MITM이 위조 GRANT를 통과시키려 발행 공개키를 갈아끼운 상황.
    body.keys[0]!.publicKey = 'ab'.repeat(32);
    const verdict = verifyDistribution(body);
    expect(verdict.valid).toBe(false);
    if (!verdict.valid) expect(verdict.reason).toBe('BAD_SIGNATURE');
  });

  it('/limits/flagged 회원 번호를 조작하면 BAD_SIGNATURE', async () => {
    const body = (await getSigned('/limits/flagged')) as {
      members: { memberId: string }[];
      _sig: DistributionSig;
    };
    expect(body.members.some((m) => m.memberId === flaggedWalker.memberId)).toBe(true);
    // 악성 회원을 목록에서 지워 수령 보류를 우회하려는 조작.
    body.members = [];
    const verdict = verifyDistribution(body);
    expect(verdict.valid).toBe(false);
    if (!verdict.valid) expect(verdict.reason).toBe('BAD_SIGNATURE');
  });

  it('/courses 폴리라인을 주입하면 BAD_SIGNATURE', async () => {
    const body = (await getSigned('/courses')) as {
      courses: { courseId: string; polyline: unknown[] }[];
      _sig: DistributionSig;
    };
    body.courses.push({ courseId: 'mitm-injected', polyline: [] });
    const verdict = verifyDistribution(body);
    expect(verdict.valid).toBe(false);
    if (!verdict.valid) expect(verdict.reason).toBe('BAD_SIGNATURE');
  });

  it('_sig가 없으면 NO_SIGNATURE', async () => {
    const body = (await getSigned('/keys')) as SignedResponse;
    delete body._sig;
    const verdict = verifyDistribution(body as SignedResponse & { _sig: DistributionSig });
    expect(verdict.valid).toBe(false);
    if (!verdict.valid) expect(verdict.reason).toBe('NO_SIGNATURE');
  });
});

describe('/keys가 배포 공개키를 노출 (지갑 자기 일관성 확인 — H-3)', () => {
  it('DISTRIBUTION 목적 키가 목록에 있고 _sig.distPublicKey와 일치한다', async () => {
    const body = (await getSigned('/keys')) as {
      keys: { keyId: string; publicKey: string; purpose: string }[];
      _sig: DistributionSig;
    };
    const dist = body.keys.find((k) => k.purpose === 'DISTRIBUTION');
    expect(dist).toBeDefined();
    expect(dist!.keyId).toBe(DISTRIBUTION_KEY_ID);
    // 목록에 실린 배포 공개키가 실제 서명 키(_sig)와 동일해야 지갑이 핀을 교차 확인한다.
    expect(dist!.publicKey).toBe(body._sig.distPublicKey);
  });
});
