/**
 * 배포 서명 가드 — TOFU 핀 (보안 감사 H-3). 순수 로직 (expo 미의존, vitest 대상).
 *
 * 서버의 배포 데이터(신뢰 키 목록·소명 대기 목록·코스)는 `_sig`로 서명되어 온다.
 * 지갑은 첫 수신에서 배포 공개키를 고정(TOFU)하고, 이후 모든 배포를 그 키로
 * 검증한다. 검증 실패 = 조작 의심 → throw. 호출부(directory.ts)는 기존 캐시를
 * 유지하고 갱신만 거부한다 — 앱 동작은 계속된다(오프라인 우선과 동일 원리).
 */
import { verifyDistribution, type Signed } from '@shvil/shared';

/** kv 저장 키 — 배포 공개키 TOFU 핀. */
export const DIST_PIN_KEY = 'distKeyPin.v1';

export interface GuardedBody<T> {
  body: T;
  /** 최초 수신(TOFU)일 때 저장할 배포 공개키. 이미 핀이 있으면 null. */
  pinToStore: string | null;
}

export function guardDistribution<T extends object>(
  response: Signed<T>,
  pinnedKey: string | null,
): GuardedBody<T> {
  const verdict = verifyDistribution(response, pinnedKey ?? undefined);
  if (!verdict.valid) {
    throw new Error(`배포 서명 검증 실패(${verdict.reason}) — 캐시 갱신을 거부합니다`);
  }
  const { _sig, ...body } = response;
  void _sig;
  return { body: body as unknown as T, pinToStore: pinnedKey ? null : verdict.distPublicKey };
}
