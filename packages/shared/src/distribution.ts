/**
 * 배포 데이터 서명 (보안 감사 H-3).
 *
 * 신뢰 발행 키 목록·소명 대기 목록·코스 데이터가 서명 없이 배포되면, 중간자(MITM)가
 * (a) 발행 공개키를 교체해 위조 GRANT 코인을 통과시키거나, (b) 소명 목록을 조작해
 * 정상 회원 코인을 차단/악성 회원을 통과시키거나, (c) 코스 폴리라인을 주입할 수 있다.
 *
 * 해법: 서버가 배포 응답 본문을 배포 서명 키로 서명해 `_sig`를 붙이고, 지갑은 그
 * 공개키를 TOFU(첫 수신 시 핀)로 고정한 뒤 이후 모든 배포를 검증한다. 배포 키가
 * 바뀌면(키 회전 또는 공격) 검증이 실패해 지갑이 캐시 갱신을 거부한다.
 *
 * (전송 계층 TLS·인증서 피닝은 배포 인프라 항목 — 이 애플리케이션 서명은 그와 독립적인
 *  이중 방어다.)
 */
import { signObject, verifyObject, type Signer } from './crypto';

export interface DistributionSig {
  distKeyId: string;
  distPublicKey: string;
  signedAt: number;
  signature: string;
}

/** 배포 응답 = 본문 + _sig. 본문(_sig 제외)이 서명 대상이다. */
export type Signed<T> = T & { _sig: DistributionSig };

/** 서버: 본문에 배포 서명을 붙인다. */
export function signDistribution<T extends object>(
  body: T,
  distSigner: Signer,
  distKeyId: string,
  now: number,
): Signed<T> {
  const meta = { distKeyId, distPublicKey: distSigner.publicKeyHex, signedAt: now };
  // 서명 대상: 본문 + 서명 메타(키 회전·시각 고정). signature 자체는 제외.
  const signature = signObject({ body, meta }, distSigner);
  return { ...body, _sig: { ...meta, signature } };
}

export type DistributionVerdict =
  | { valid: true; distPublicKey: string }
  | { valid: false; reason: 'NO_SIGNATURE' | 'BAD_SIGNATURE' | 'KEY_PIN_MISMATCH' };

/**
 * 지갑: 배포 응답을 검증한다.
 * @param pinnedDistPublicKey TOFU로 이전에 고정한 배포 공개키 (없으면 첫 수신 — 핀 대조 생략).
 */
export function verifyDistribution<T extends object>(
  response: Signed<T>,
  pinnedDistPublicKey?: string,
): DistributionVerdict {
  const sig = response._sig;
  if (!sig || !sig.signature || !sig.distPublicKey) return { valid: false, reason: 'NO_SIGNATURE' };
  if (pinnedDistPublicKey && pinnedDistPublicKey !== sig.distPublicKey) {
    return { valid: false, reason: 'KEY_PIN_MISMATCH' };
  }
  const { _sig, ...body } = response as Signed<T> & Record<string, unknown>;
  const meta = { distKeyId: sig.distKeyId, distPublicKey: sig.distPublicKey, signedAt: sig.signedAt };
  if (!verifyObject({ body, meta }, sig.signature, sig.distPublicKey)) {
    return { valid: false, reason: 'BAD_SIGNATURE' };
  }
  return { valid: true, distPublicKey: sig.distPublicKey };
}
