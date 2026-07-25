/**
 * 기기 무결성 실연동 (보안 감사 C-2) — 챌린지·nonce·fail-closed 검증.
 *
 * ★이 기능이 방어의 뿌리인 이유 (다니엘 쌤 2026-07-26): 앱 안의 모든 검사(생체·인간
 * 한계·회랑)는 변조 앱이 지우면 그만이다. 무결성만이 앱 바깥에서 증언하므로, 이것이
 * 뚫리면 나머지 방어가 전부 무의미해진다.
 *
 * 여기서 고정하는 것:
 *  ① nonce 식이 지갑과 **정확히 일치**한다 (어긋나면 아무도 VERIFIED를 못 받는다)
 *  ② 챌린지는 1회용·기기 결속·만료된다 (재생·중계 공격 차단)
 *  ③ 미설정·오류·미지원 플랫폼은 전부 UNVERIFIED로 수렴한다 (fail-closed)
 *  ④ devMode 모의 토큰은 운영에서 거부된다 (C-1 게이팅)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createDb } from '../src/db';
import {
  INTEGRITY_CHALLENGE_TTL_MS,
  issueIntegrityChallenge,
  verifyIntegrityAsync,
  verifyIntegrityToken,
  type IntegrityContext,
} from '../src/integrity';
import { integrityNonce } from '../src/playIntegrity';

let db: DatabaseSync;
const DEVICE_KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);

/** 운영 모드 컨텍스트 (devMode=false) — playConfig=null이면 실검증 없이 폴백. */
function prodCtx(overrides: Partial<IntegrityContext> = {}): IntegrityContext {
  return { db, devMode: false, playConfig: null, ...overrides };
}

beforeEach(() => {
  db = createDb(':memory:');
});

afterEach(() => {
  db.close();
});

describe('① nonce 식 — 지갑과 서버가 같은 값을 만들어야 한다', () => {
  it('서버 nonce는 길이 접두 조각의 sha256 base64url이다', () => {
    const challenge = 'test-challenge-value';
    // 지갑(integrityNonce.ts)이 계산하는 것과 같은 식을 독립적으로 재현한다.
    // 길이 접두(`N:값`)는 ('a|b','c')와 ('a','b|c')가 같은 nonce가 되는 모호성을 없앤다.
    const part = (v: string) => `${Buffer.byteLength(v, 'utf8')}:${v}`;
    const expected = createHash('sha256')
      .update(`shvil-integrity|${part(challenge)}|${part(DEVICE_KEY)}`)
      .digest('base64url');
    expect(integrityNonce(challenge, DEVICE_KEY)).toBe(expected);
  });

  it('★조각 경계가 모호하지 않다 (구분자 삽입 공격 차단)', () => {
    expect(integrityNonce('a|b', 'c')).not.toBe(integrityNonce('a', 'b|c'));
  });

  it('챌린지나 기기 키가 다르면 nonce가 달라진다 (결속이 실재한다)', () => {
    const a = integrityNonce('c1', DEVICE_KEY);
    expect(integrityNonce('c2', DEVICE_KEY)).not.toBe(a);
    expect(integrityNonce('c1', OTHER_KEY)).not.toBe(a);
  });

  it('nonce는 base64url 문자만 쓴다 (Play Integrity 형식 요건)', () => {
    expect(integrityNonce('c', DEVICE_KEY)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('② 챌린지 — 1회용·기기 결속·만료 (재생·중계 차단)', () => {
  it('발급하면 조회되고 만료 시각이 TTL만큼 뒤다', () => {
    const now = Date.now();
    const issued = issueIntegrityChallenge(prodCtx(), DEVICE_KEY, 'ch-1', now);
    expect(issued.expiresAt).toBe(now + INTEGRITY_CHALLENGE_TTL_MS);
    const row = db.prepare('SELECT * FROM integrity_challenges WHERE challenge = ?').get('ch-1') as {
      device_public_key: string;
      consumed_at: number | null;
    };
    expect(row.device_public_key).toBe(DEVICE_KEY);
    expect(row.consumed_at).toBeNull();
  });

  it('같은 기기가 새로 발급받으면 이전 미소비 챌린지는 폐기된다 (쌓아두기 차단)', () => {
    const now = Date.now();
    issueIntegrityChallenge(prodCtx(), DEVICE_KEY, 'ch-old', now);
    issueIntegrityChallenge(prodCtx(), DEVICE_KEY, 'ch-new', now);
    expect(db.prepare('SELECT 1 FROM integrity_challenges WHERE challenge = ?').get('ch-old')).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM integrity_challenges WHERE challenge = ?').get('ch-new')).toBeDefined();
  });

  it('★남의 챌린지로는 검증할 수 없다 (중계 공격 차단)', async () => {
    const now = Date.now();
    issueIntegrityChallenge(prodCtx(), DEVICE_KEY, 'ch-mine', now);
    // 다른 기기가 그 챌린지를 가져다 쓴다.
    const r = await verifyIntegrityAsync(prodCtx({ playConfig: { packageName: 'p', clientEmail: 'e', privateKeyPem: 'k' } }), {
      platform: 'android',
      token: 'some-token',
      devicePublicKey: OTHER_KEY,
      challenge: 'ch-mine',
      now,
    });
    expect(r.level).toBe('UNVERIFIED');
    expect(r.reasons).toContain('CHALLENGE_DEVICE_MISMATCH');
  });

  it('발급받지 않은 챌린지는 거부된다', async () => {
    const r = await verifyIntegrityAsync(
      prodCtx({ playConfig: { packageName: 'p', clientEmail: 'e', privateKeyPem: 'k' } }),
      { platform: 'android', token: 't', devicePublicKey: DEVICE_KEY, challenge: 'never-issued' },
    );
    expect(r.level).toBe('UNVERIFIED');
    expect(r.reasons).toContain('CHALLENGE_UNKNOWN');
  });

  it('만료된 챌린지는 거부된다', async () => {
    const now = Date.now();
    issueIntegrityChallenge(prodCtx(), DEVICE_KEY, 'ch-old', now);
    const r = await verifyIntegrityAsync(
      prodCtx({ playConfig: { packageName: 'p', clientEmail: 'e', privateKeyPem: 'k' } }),
      {
        platform: 'android',
        token: 't',
        devicePublicKey: DEVICE_KEY,
        challenge: 'ch-old',
        now: now + INTEGRITY_CHALLENGE_TTL_MS + 1,
      },
    );
    expect(r.level).toBe('UNVERIFIED');
    expect(r.reasons).toContain('CHALLENGE_EXPIRED');
  });

  it('★실패한 시도도 챌린지를 소비한다 (같은 챌린지로 무차별 재시도 불가)', async () => {
    const now = Date.now();
    const ctx = prodCtx({ playConfig: { packageName: 'p', clientEmail: 'e', privateKeyPem: 'bad-key' } });
    issueIntegrityChallenge(ctx, DEVICE_KEY, 'ch-burn', now);
    // Google API 호출이 실패한다(가짜 키) — 그래도 챌린지는 소비되어야 한다.
    await verifyIntegrityAsync(ctx, {
      platform: 'android',
      token: 't',
      devicePublicKey: DEVICE_KEY,
      challenge: 'ch-burn',
      now,
    });
    const row = db.prepare('SELECT consumed_at FROM integrity_challenges WHERE challenge = ?').get('ch-burn') as {
      consumed_at: number | null;
    };
    expect(row.consumed_at).not.toBeNull();

    // 두 번째 시도는 CHALLENGE_USED로 막힌다.
    const again = await verifyIntegrityAsync(ctx, {
      platform: 'android',
      token: 't',
      devicePublicKey: DEVICE_KEY,
      challenge: 'ch-burn',
      now,
    });
    expect(again.reasons).toContain('CHALLENGE_USED');
  });
});

describe('③ fail-closed — 실패는 전부 UNVERIFIED로 수렴한다', () => {
  it('토큰이 없으면 UNVERIFIED', async () => {
    const r = await verifyIntegrityAsync(prodCtx(), {
      platform: 'android',
      token: undefined,
      devicePublicKey: DEVICE_KEY,
    });
    expect(r.level).toBe('UNVERIFIED');
    expect(r.reasons).toContain('NO_TOKEN');
  });

  it('Play Integrity 미설정이면 UNVERIFIED (설정 없음을 통과로 삼지 않는다)', async () => {
    const r = await verifyIntegrityAsync(prodCtx(), {
      platform: 'android',
      token: 'dev-verified',
      devicePublicKey: DEVICE_KEY,
      challenge: 'x',
    });
    expect(r.level).toBe('UNVERIFIED');
    expect(r.reasons).toContain('PLAY_INTEGRITY_NOT_CONFIGURED');
  });

  it('iOS는 App Attest 미연동이라 UNVERIFIED (정직하게 사유를 남긴다)', async () => {
    const r = await verifyIntegrityAsync(prodCtx(), {
      platform: 'ios',
      token: 't',
      devicePublicKey: DEVICE_KEY,
    });
    expect(r.level).toBe('UNVERIFIED');
    expect(r.reasons).toContain('IOS_ATTEST_NOT_INTEGRATED');
  });

  it('알 수 없는 플랫폼은 UNVERIFIED', async () => {
    const r = await verifyIntegrityAsync(prodCtx(), {
      platform: 'web',
      token: 't',
      devicePublicKey: DEVICE_KEY,
    });
    expect(r.level).toBe('UNVERIFIED');
    expect(r.reasons).toContain('UNKNOWN_PLATFORM');
  });

  it('Google API 오류는 통과가 아니라 UNVERIFIED다 (fail-open 금지)', async () => {
    const now = Date.now();
    const ctx = prodCtx({ playConfig: { packageName: 'p', clientEmail: 'e', privateKeyPem: 'invalid' } });
    issueIntegrityChallenge(ctx, DEVICE_KEY, 'ch-err', now);
    const r = await verifyIntegrityAsync(ctx, {
      platform: 'android',
      token: 't',
      devicePublicKey: DEVICE_KEY,
      challenge: 'ch-err',
      now,
    });
    expect(r.level).toBe('UNVERIFIED');
    expect(r.reasons).toContain('PLAY_API_ERROR');
  });
});

describe('④ devMode 게이팅 (보안 감사 C-1)', () => {
  it('개발 모드에서만 모의 토큰이 인정된다', async () => {
    const dev = await verifyIntegrityAsync({ db, devMode: true }, {
      platform: 'android',
      token: 'dev-verified',
      devicePublicKey: DEVICE_KEY,
    });
    expect(dev.level).toBe('VERIFIED');
  });

  it('★운영에서는 같은 모의 토큰이 거부된다', async () => {
    const prod = await verifyIntegrityAsync(prodCtx(), {
      platform: 'android',
      token: 'dev-verified',
      devicePublicKey: DEVICE_KEY,
      challenge: 'x',
    });
    expect(prod.level).toBe('UNVERIFIED');
  });

  it('동기 경로는 운영에서 절대 VERIFIED를 주지 않는다', () => {
    expect(verifyIntegrityToken('android', 'dev-verified', false)).toBe('UNVERIFIED');
    expect(verifyIntegrityToken('android', 'dev-verified', true)).toBe('VERIFIED');
    expect(verifyIntegrityToken('android', 'dev-basic', true)).toBe('BASIC');
  });
});
