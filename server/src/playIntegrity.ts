/**
 * Play Integrity API 서버 검증 (보안 감사 C-2 실연동 — 방어선 1선).
 *
 * 기기가 받아온 무결성 토큰을 Google에 제출해 복호·판정을 받고, 그 결과를
 * IntegrityLevel로 요약한다. 이 판정은 회원 증서에 각인되어 코인 계보를 따라 이동하며,
 * 수신 지갑이 로컬에서 검증한다.
 *
 * ── 이것이 왜 방어의 뿌리인가 (다니엘 쌤 2026-07-26) ──────────────────────
 * "앱 코드를 바꾸면 앱 무결성이 손상되잖아" — 정확하다. 생체 인증·인간 한계·회랑 판정은
 * 전부 **앱 안의 검사**라 변조 앱이 지우면 그만이다. 무결성 인증만이 그 층 **바깥**에서
 * "이 앱이 진짜인가"를 증언한다. 이것이 있어야 "앱을 고친다"는 선택지가 값을 잃는다 —
 * 변조 앱이 만든 코인은 VERIFIED 증서를 못 받아 다른 지갑이 거부하기 때문이다.
 *
 * ── 헌법 제9조 정합 (거래 승인이 아니다) ──────────────────────────────────
 * 이 검증은 **민팅 자격 확립**이지 거래 승인이 아니다. 서버는 가입·증서 갱신 시점에만
 * 개입하고, 이후 지불·수령·검증은 계속 두 기기의 로컬에서 오프라인으로 완결된다.
 * 서버가 무결성을 근거로 개별 거래를 막는 순간 선을 넘는 것이며, 이 모듈은 그런 경로를
 * 제공하지 않는다 — 반환값은 오직 증서에 각인될 등급뿐이다.
 *
 * ── 재생 공격 방어 (nonce 결속) ──────────────────────────────────────────
 * 서버가 1회용 챌린지를 발급하고 기기 공개키를 묶어 nonce를 만든다. 서버는 (1) 자기가 낸
 * 챌린지인지 (2) 소비되지 않았는지 (3) 이 기기 키의 것인지를 대조한다.
 *
 * ★막지 못하는 것 (정직화 — 제3조): 이것은 "**증명 오라클 중계**"를 막지 못한다.
 *  공격자가 자기 키쌍을 만들어 그 키로 챌린지를 받고, 깨끗한 폰에서 그 nonce로 토큰을
 *  받아 제출하면 VERIFIED가 자기 키에 결속된다 — 공격자가 곧 그 키의 소유자이기
 *  때문이다. 원리적 차단은 하드웨어 키 증명(attestation) 병행뿐이며 미구현이다.
 *  여기서 막는 것은 "남의 토큰을 주워 쓰는" 수동적 재사용까지다.
 *
 * 실 API 연동 전(자격증명 미설정)에는 **UNVERIFIED를 반환한다** — 미검증 기기를
 * VERIFIED로 오인하지 않는 안전 기본값이다(fail-closed).
 */
import { createHash } from 'node:crypto';
import type { IntegrityLevel } from '@shvil/shared';

/** Google Play Integrity 복호화 엔드포인트 (Standard/Classic 공용 decodeIntegrityToken). */
const PLAY_INTEGRITY_ENDPOINT = (packageName: string) =>
  `https://playintegrity.googleapis.com/v1/${encodeURIComponent(packageName)}:decodeIntegrityToken`;

/** Google OAuth2 토큰 엔드포인트 (서비스 계정 JWT → 액세스 토큰). */
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export interface PlayIntegrityConfig {
  /** 앱 패키지명 (app.json의 android.package와 일치해야 한다). */
  packageName: string;
  /** 서비스 계정 이메일 — Google Cloud에서 발급. */
  clientEmail: string;
  /** 서비스 계정 개인키 (PEM). 운영에서는 환경변수로 주입한다. */
  privateKeyPem: string;
  /**
   * ★앱 서명 인증서 SHA-256 지문 (base64url, 복수 허용 — 키 교체 대비).
   *
   * 이것이 **앱 동일성의 유일한 고리**다. 패키지명은 공격자가 자기 빌드에서 임의로
   * 정할 수 있으므로(applicationId는 그냥 문자열이다), 패키지명만 대조하면 변조 APK가
   * 그대로 통과한다 — 적대적 검증이 이 경로를 치명으로 지목했다. 서명 키는 EAS
   * 키스토어에 있고 공격자가 가질 수 없으므로, 지문 대조만이 "우리가 빌드한 앱"을
   * 증명한다. 미설정이면 앱 동일성 검사가 없는 것이므로 VERIFIED를 주지 않는다.
   */
  certDigests?: string[];
}

/**
 * Play Integrity 판정 결과 요약 — 원본 JSON을 그대로 두지 않고 필요한 것만 뽑는다.
 * (원본에는 기기 식별에 쓰일 수 있는 필드가 있어 로그·저장 대상으로 삼지 않는다.)
 */
export interface IntegrityVerdict {
  level: IntegrityLevel;
  /** 토큰에 실려 돌아온 nonce — 서버가 발급한 챌린지와 대조한다. */
  nonce: string | null;
  /** 판정 근거 코드 (자연어 아님 — 진단·공시용). */
  reasons: string[];
}

/**
 * 챌린지 nonce 계산 — 서버 난수 + 기기 공개키를 함께 묶는다.
 *
 * ★기기 키를 섞는 이유: 챌린지만 묶으면 "진짜 폰이 받은 토큰을 변조 폰이 제출"하는
 * 중계가 가능하다. 기기 키를 넣으면 그 토큰은 **그 키의 소유자만** 쓸 수 있다.
 * Play Integrity의 nonce는 URL-safe Base64 문자열이어야 하므로 해시를 그 형식으로 낸다.
 */
export function integrityNonce(challenge: string, devicePublicKey: string): string {
  // ★길이 접두로 모호성을 제거한다: 단순 구분자 연결은 ('a|b','c')와 ('a','b|c')가
  //   같은 문자열이 되어 결속이 무의미해질 수 있다(테스트가 실제로 잡아냈다).
  //   각 조각 앞에 바이트 길이를 붙이면 어떤 입력 조합도 유일하게 복원된다.
  const part = (v: string) => `${Buffer.byteLength(v, 'utf8')}:${v}`;
  return createHash('sha256')
    .update(`shvil-integrity|${part(challenge)}|${part(devicePublicKey)}`)
    .digest('base64url');
}

/** 서비스 계정 JWT로 액세스 토큰을 받는다 (playintegrity 스코프). */
async function fetchAccessToken(config: PlayIntegrityConfig): Promise<string> {
  const { createSign } = await import('node:crypto');
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({
      iss: config.clientEmail,
      scope: 'https://www.googleapis.com/auth/playintegrity',
      aud: GOOGLE_TOKEN_ENDPOINT,
      exp: now + 3600,
      iat: now,
    }),
  ).toString('base64url');
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(config.privateKeyPem, 'base64url');

  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`google token ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('google token missing');
  return json.access_token;
}

/**
 * 무결성 토큰을 Google에 제출해 판정을 받는다.
 *
 * 판정 규칙 (Google 응답 → IntegrityLevel):
 *  - deviceIntegrity.deviceRecognitionVerdict에 MEETS_DEVICE_INTEGRITY 포함 → VERIFIED 후보
 *  - MEETS_BASIC_INTEGRITY만 → BASIC (에뮬레이터는 아니나 루팅 의심)
 *  - 아무것도 없음 → UNVERIFIED (변조·에뮬레이터)
 *
 * ★appRecognitionVerdict는 **등급을 낮추는 데만** 쓴다: Play Store 배포 전(sideload)에는
 *  UNRECOGNIZED_VERSION이 정상이므로 이것으로 거부하면 닫힌 시험 자체가 불가능하다.
 *  Play Console 등록·배포가 끝나면 requirePlayRecognized를 켜서 앱 변조까지 막는다
 *  (docs/기기무결성_연동.md 전환 순서).
 */
export async function verifyPlayIntegrityToken(
  token: string,
  config: PlayIntegrityConfig,
  options: { requirePlayRecognized?: boolean } = {},
): Promise<IntegrityVerdict> {
  const accessToken = await fetchAccessToken(config);
  const res = await fetch(PLAY_INTEGRITY_ENDPOINT(config.packageName), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ integrityToken: token }),
  });
  if (!res.ok) throw new Error(`play integrity ${res.status}`);

  const json = (await res.json()) as {
    tokenPayloadExternal?: {
      requestDetails?: { nonce?: string; requestPackageName?: string; timestampMillis?: string };
      appIntegrity?: {
        appRecognitionVerdict?: string;
        packageName?: string;
        certificateSha256Digest?: string[];
        versionCode?: string;
      };
      deviceIntegrity?: { deviceRecognitionVerdict?: string[] };
    };
  };
  const payload = json.tokenPayloadExternal;
  const reasons: string[] = [];
  if (!payload) return { level: 'UNVERIFIED', nonce: null, reasons: ['NO_PAYLOAD'] };

  // 패키지명 대조 — 다른 앱의 토큰을 가져다 쓰는 것을 막는다.
  const reqPkg = payload.requestDetails?.requestPackageName;
  const appPkg = payload.appIntegrity?.packageName;
  if (reqPkg && reqPkg !== config.packageName) reasons.push('PACKAGE_MISMATCH');
  if (appPkg && appPkg !== config.packageName) reasons.push('APP_PACKAGE_MISMATCH');

  // 토큰 신선도 — 오래된 토큰 재사용 차단 (10분).
  const ts = Number(payload.requestDetails?.timestampMillis ?? 0);
  if (ts > 0 && Date.now() - ts > 10 * 60 * 1000) reasons.push('TOKEN_STALE');

  // ★앱 서명 지문 대조 — 변조 APK 차단의 핵심.
  //   패키지명은 공격자가 정할 수 있지만 서명 키는 가질 수 없다. 지문이 없거나
  //   목록에 없으면 "우리가 빌드한 앱"임을 증명하지 못한 것이므로 통과시키지 않는다.
  const digests = payload.appIntegrity?.certificateSha256Digest ?? [];
  let certOk = false;
  if (config.certDigests && config.certDigests.length > 0) {
    certOk = digests.some((d) => config.certDigests!.includes(d));
    if (!certOk) reasons.push(digests.length === 0 ? 'CERT_DIGEST_ABSENT' : 'CERT_DIGEST_MISMATCH');
  } else {
    // 지문 미설정 = 앱 동일성 검사 없음. 이 상태를 통과로 삼지 않는다(fail-closed).
    reasons.push('CERT_DIGEST_NOT_CONFIGURED');
  }

  const device = payload.deviceIntegrity?.deviceRecognitionVerdict ?? [];
  const appVerdict = payload.appIntegrity?.appRecognitionVerdict ?? '';

  let level: IntegrityLevel;
  if (device.includes('MEETS_DEVICE_INTEGRITY')) level = 'VERIFIED';
  else if (device.includes('MEETS_BASIC_INTEGRITY')) level = 'BASIC';
  else {
    level = 'UNVERIFIED';
    reasons.push('DEVICE_INTEGRITY_FAILED');
  }

  // Play 인식 요구 (스토어 배포 후 단계) — 미인식이면 한 등급 강등한다.
  if (options.requirePlayRecognized && appVerdict !== 'PLAY_RECOGNIZED') {
    reasons.push('APP_NOT_PLAY_RECOGNIZED');
    level = level === 'VERIFIED' ? 'BASIC' : 'UNVERIFIED';
  }

  // 대조 실패는 등급을 UNVERIFIED로 떨어뜨린다 (fail-closed).
  // ★서명 지문 관련 실패는 강등이 아니라 **고정**이다 — 변조 APK가 BASIC으로라도
  //   살아남으면 안 된다(BASIC도 P2P 수령이 열리므로).
  if (!certOk) level = 'UNVERIFIED';
  if (reasons.some((r) => r.endsWith('MISMATCH') || r === 'TOKEN_STALE')) level = 'UNVERIFIED';

  return { level, nonce: payload.requestDetails?.nonce ?? null, reasons };
}

/**
 * 환경변수에서 Play Integrity 설정을 읽는다. 하나라도 없으면 null —
 * 호출부는 그때 UNVERIFIED로 폴백한다(미설정 상태를 통과로 만들지 않는다).
 *
 * 운영 주입 (Render 환경변수):
 *   SHVIL_PLAY_PACKAGE        org.shvil.wallet
 *   SHVIL_PLAY_CLIENT_EMAIL   서비스 계정 이메일
 *   SHVIL_PLAY_PRIVATE_KEY    서비스 계정 개인키 PEM (\n 은 실제 줄바꿈으로 변환한다)
 */
export function playIntegrityConfigFromEnv(): PlayIntegrityConfig | null {
  const packageName = process.env.SHVIL_PLAY_PACKAGE;
  const clientEmail = process.env.SHVIL_PLAY_CLIENT_EMAIL;
  const rawKey = process.env.SHVIL_PLAY_PRIVATE_KEY;
  if (!packageName || !clientEmail || !rawKey) return null;
  return { packageName, clientEmail, privateKeyPem: rawKey.replace(/\\n/g, '\n') };
}
