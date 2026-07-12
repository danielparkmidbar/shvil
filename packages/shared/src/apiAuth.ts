/**
 * 디렉토리 서버 요청 인증 — 기기 키 서명 방식.
 *
 * 비밀번호·세션 토큰 없이, 가입 시 등록한 기기 공개키로 요청을 서명한다.
 * 서버의 역할은 신원 확인뿐이며 거래 승인과 무관하다.
 */
import { sha256Hex, signObject, verifyObject, type Signer } from './crypto';

export const AUTH_HEADER_MEMBER = 'x-shvil-member';
export const AUTH_HEADER_TS = 'x-shvil-ts';
export const AUTH_HEADER_SIG = 'x-shvil-sig';

/** 허용 시계 오차 (오프라인 순례 후 재접속 감안, ±10분). */
export const AUTH_MAX_SKEW_MS = 10 * 60 * 1000;

function authPayload(memberId: string, method: string, path: string, bodyText: string, timestamp: number) {
  return {
    t: 'shvil-api-auth-v1',
    memberId,
    method: method.toUpperCase(),
    path,
    bodyHash: sha256Hex(bodyText),
    timestamp,
  };
}

export function buildAuthHeaders(
  memberId: string,
  signer: Signer,
  method: string,
  path: string,
  bodyText: string,
  now: number,
): Record<string, string> {
  return {
    [AUTH_HEADER_MEMBER]: memberId,
    [AUTH_HEADER_TS]: String(now),
    [AUTH_HEADER_SIG]: signObject(authPayload(memberId, method, path, bodyText, now), signer),
  };
}

export interface VerifyAuthArgs {
  memberId: string;
  timestampHeader: string;
  signatureHeader: string;
  method: string;
  path: string;
  bodyText: string;
  devicePublicKey: string;
  now: number;
}

export function verifyAuthHeaders(args: VerifyAuthArgs): boolean {
  const ts = Number(args.timestampHeader);
  if (!Number.isFinite(ts) || Math.abs(args.now - ts) > AUTH_MAX_SKEW_MS) return false;
  return verifyObject(
    authPayload(args.memberId, args.method, args.path, args.bodyText, ts),
    args.signatureHeader,
    args.devicePublicKey,
  );
}
