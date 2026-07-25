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
 * 인정된다. 운영에서는 실 연동이 없으면 안전 기본값 UNVERIFIED를 반환한다 — 미검증
 * 기기를 VERIFIED로 오인하지 않는다(fail-closed).
 *
 * ── 실연동 (2026-07-26, 다니엘 쌤 "기기무결성 연동부터") ──────────────────
 * 다니엘 쌤 지적이 이 작업의 근거다: "앱 코드를 바꾸면 앱 무결성이 손상되잖아."
 * 생체 인증·인간 한계·회랑 판정은 전부 **앱 안의 검사**라 변조 앱이 지우면 그만이다.
 * 무결성 인증만이 그 층 바깥에서 "이 앱이 진짜인가"를 증언하며, 이것이 있어야
 * "앱을 고친다"는 선택지가 값을 잃는다(변조 앱의 코인은 VERIFIED를 못 받아 거부된다).
 *
 * Android는 playIntegrity.ts가 Google에 토큰을 제출해 판정을 받는다. 재생·중계 공격은
 * 서버 발급 1회용 챌린지 + 기기 공개키 결속 nonce로 막는다(integrity_challenges).
 * iOS App Attest는 Apple 개발자 계정이 필요해 아직 미연동이며, 그동안 iOS는 UNVERIFIED로
 * 남는다 — 이 한계는 등급 정책에서 정직하게 다룬다(제3조).
 */
import type { DatabaseSync } from 'node:sqlite';
import type { IntegrityLevel } from '@shvil/shared';
import {
  integrityNonce,
  playIntegrityConfigFromEnv,
  verifyPlayIntegrityToken,
  type PlayIntegrityConfig,
} from './playIntegrity';

export type IntegrityPlatform = 'android' | 'ios';

/** 챌린지 유효 시간 — 무결성 토큰 획득에 넉넉하되 재사용 창을 좁게. */
export const INTEGRITY_CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface IntegrityContext {
  db: DatabaseSync;
  devMode: boolean;
  /** 미지정(undefined) 시 환경변수에서 읽는다. null이면 실검증 없이 UNVERIFIED. */
  playConfig?: PlayIntegrityConfig | null;
  /**
   * Play Store 배포 후 단계에서 켠다 — 앱이 Play로 인식되지 않으면 등급을 강등한다.
   * 닫힌 시험(sideload APK)에서는 꺼 둔다: UNRECOGNIZED_VERSION이 정상이기 때문이다.
   */
  requirePlayRecognized?: boolean;
}

/**
 * 무결성 토큰을 검증해 IntegrityLevel을 반환한다 (동기 — 기존 계약 유지).
 *
 * devMode 모의 전용 경로다. 운영 검증은 외부 API 호출이 필요하므로
 * verifyIntegrityAsync를 쓴다. 이 함수는 운영에서 호출되면 통과시키지 않는다.
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
  // 운영에서 이 동기 경로로 오면 실검증을 할 수 없으므로 안전 기본값.
  void platform;
  void token;
  return 'UNVERIFIED';
}

/**
 * 무결성 챌린지 등록 — 기기가 이 값을 nonce 재료로 삼아 무결성 토큰을 받아온다.
 * 챌린지는 기기 공개키에 결속되고 1회만 소비된다(재사용·중계 차단).
 */
export function issueIntegrityChallenge(
  ctx: IntegrityContext,
  devicePublicKey: string,
  challenge: string,
  now: number,
): { challenge: string; expiresAt: number } {
  const expiresAt = now + INTEGRITY_CHALLENGE_TTL_MS;
  // 같은 기기의 미소비 챌린지는 폐기한다 — 여러 개를 쌓아두고 고르는 것을 막는다.
  ctx.db
    .prepare('DELETE FROM integrity_challenges WHERE device_public_key = ? AND consumed_at IS NULL')
    .run(devicePublicKey);
  ctx.db
    .prepare(
      `INSERT INTO integrity_challenges (challenge, device_public_key, issued_at, expires_at, consumed_at)
       VALUES (?, ?, ?, ?, NULL)`,
    )
    .run(challenge, devicePublicKey, now, expiresAt);
  return { challenge, expiresAt };
}

/**
 * 실 무결성 검증 (운영 경로).
 *
 * 검사 순서: devMode 모의 → 플랫폼 → 설정 유무 → **챌린지 대조** → Google 판정 →
 * **nonce 대조**. 마지막 nonce 대조가 핵심이다 — 이것이 없으면 진짜 기기에서 받은
 * 토큰을 변조 기기가 그대로 제출하는 중계 공격이 성립한다.
 *
 * 실패는 전부 UNVERIFIED로 수렴한다(fail-closed) — 통신 오류·API 다운을 통과로 삼지
 * 않는다. 대신 등급 정책이 UNVERIFIED에게도 기본 걷기를 허용해 0층을 지킨다.
 */
export async function verifyIntegrityAsync(
  ctx: IntegrityContext,
  args: {
    platform: string | undefined;
    token: string | undefined;
    devicePublicKey: string;
    challenge?: string | undefined;
    now?: number;
  },
): Promise<{ level: IntegrityLevel; reasons: string[] }> {
  const now = args.now ?? Date.now();

  if (ctx.devMode) {
    return { level: verifyIntegrityToken(args.platform, args.token, true), reasons: ['DEV_MODE'] };
  }
  if (!args.token) return { level: 'UNVERIFIED', reasons: ['NO_TOKEN'] };

  // iOS App Attest 미연동 — Apple 개발자 계정이 필요하다 (정직화: 숨기지 않는다).
  if (args.platform === 'ios') return { level: 'UNVERIFIED', reasons: ['IOS_ATTEST_NOT_INTEGRATED'] };
  if (args.platform !== 'android') return { level: 'UNVERIFIED', reasons: ['UNKNOWN_PLATFORM'] };

  const config = ctx.playConfig === undefined ? playIntegrityConfigFromEnv() : ctx.playConfig;
  if (!config) return { level: 'UNVERIFIED', reasons: ['PLAY_INTEGRITY_NOT_CONFIGURED'] };

  // 챌린지 대조 — 발급받지 않은 요청은 여기서 끝난다.
  if (!args.challenge) return { level: 'UNVERIFIED', reasons: ['NO_CHALLENGE'] };
  const row = ctx.db.prepare('SELECT * FROM integrity_challenges WHERE challenge = ?').get(args.challenge) as
    | { challenge: string; device_public_key: string; expires_at: number; consumed_at: number | null }
    | undefined;
  if (!row) return { level: 'UNVERIFIED', reasons: ['CHALLENGE_UNKNOWN'] };
  if (row.consumed_at !== null) return { level: 'UNVERIFIED', reasons: ['CHALLENGE_USED'] };
  if (now > row.expires_at) return { level: 'UNVERIFIED', reasons: ['CHALLENGE_EXPIRED'] };
  if (row.device_public_key !== args.devicePublicKey) {
    return { level: 'UNVERIFIED', reasons: ['CHALLENGE_DEVICE_MISMATCH'] };
  }

  // 챌린지는 결과와 무관하게 여기서 소비한다 — 같은 챌린지로 값을 바꿔가며
  // 재시도하는 무차별 대입을 막는다(스팟 현장결속과 같은 방향).
  ctx.db
    .prepare('UPDATE integrity_challenges SET consumed_at = ? WHERE challenge = ? AND consumed_at IS NULL')
    .run(now, args.challenge);

  let verdict;
  try {
    verdict = await verifyPlayIntegrityToken(args.token, config, {
      ...(ctx.requirePlayRecognized !== undefined
        ? { requirePlayRecognized: ctx.requirePlayRecognized }
        : {}),
    });
  } catch {
    // Google API 오류·다운 — 통과시키지 않는다(fail-closed). 사용자는 재시도할 수 있고,
    // 그동안에도 UNVERIFIED 등급으로 기본 걷기는 계속된다(0층 불변).
    return { level: 'UNVERIFIED', reasons: ['PLAY_API_ERROR'] };
  }

  // ★핵심 대조: 토큰 안의 nonce가 이 챌린지 + 이 기기 키에서 나온 값인가.
  const expected = integrityNonce(args.challenge, args.devicePublicKey);
  if (verdict.nonce !== expected) {
    return { level: 'UNVERIFIED', reasons: [...verdict.reasons, 'NONCE_MISMATCH'] };
  }

  return { level: verdict.level, reasons: verdict.reasons };
}
