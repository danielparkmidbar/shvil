/**
 * 배포 서명 가드 — TOFU 핀 (보안 감사 H-3). 순수 로직 (expo 미의존, vitest 대상).
 *
 * 서버의 배포 데이터(신뢰 키 목록·소명 대기 목록·코스)는 `_sig`로 서명되어 온다.
 * 지갑은 첫 수신에서 배포 공개키를 고정(TOFU)하고, 이후 모든 배포를 그 키로
 * 검증한다. 검증 실패 = 조작 의심 → throw. 호출부(directory.ts)는 기존 캐시를
 * 유지하고 갱신만 거부한다 — 앱 동작은 계속된다(오프라인 우선과 동일 원리).
 *
 * ── ★2026-07-27 — 벽돌이 되지 않게 (복구 경로) ────────────────────────
 * 지금까지 핀이 한 번 어긋나면 **앱을 지우기 전까지 영구히** 갱신이 막혔다. 해제 경로가
 * 코드에 없었다(`kvDelete`는 정의만 되어 있고 호출부가 0곳이었다). 서버 재배포로 배포 키가
 * 바뀌면 그 폰은 새 코스도, 새 발행자 목록도, 소명 목록도 영원히 못 배웠다.
 *
 * 그렇다고 **자동으로 풀면 안 된다** — 자동 해제는 곧 중간자(MITM) 통로다. "다른 키로
 * 서명해서 보내면 지갑이 새 키를 믿는다"가 되면 핀이 없는 것과 같다.
 *
 * 그래서 이렇게 한다: 여전히 **거부하되**, 무슨 일이 일어났는지 알 수 있는 **후보**를
 * 예외에 실어 보낸다. 호출부가 그것을 kv에 적어 두고, 화면이 사람에게 보여주고,
 * **사람이 결정한다.** 사람이 아무것도 안 하면 예전과 완전히 같다(= 거부 유지).
 *
 * ── ★2026-07-28 — 사람이 대조하는 값을 공격자가 고르지 못하게 ─────────
 * 적대검증이 재현한 구멍: 후보에 실리던 `newKeyId`가 **서버가 주장한 값 그대로**였다.
 * 중간자가 진짜 서버의 이름을 베껴 넣으면 화면이 지시하는 "`/health`의 이름과 대조하세요"가
 * **공격자를 통과시켰다.** 지금은 지갑이 제시된 공개키에서 이름을 **직접 유도**하고, 서버
 * 주장과 다르면 `nameVerified: false`로 표시한다. 이름은 공개키의 해시이므로 공격자가
 * 고를 수 없다.
 */
import { tryDeriveKeyId, verifyDistribution, type Signed } from '@shvil/shared';

/** kv 저장 키 — 배포 공개키 TOFU 핀. */
export const DIST_PIN_KEY = 'distKeyPin.v1';

export interface GuardedBody<T> {
  body: T;
  /** 최초 수신(TOFU)일 때 저장할 배포 공개키. 이미 핀이 있으면 null. */
  pinToStore: string | null;
}

/** 핀과 다른 키로 서명된 배포 — 사람에게 보여줄 후보. */
export interface PinChangeCandidate {
  /** 새 서버가 제시한 배포 공개키. */
  newPublicKey: string;
  /**
   * ★배포 키 이름 — **지갑이 그 공개키에서 직접 유도한 값이다.** 서버 주장이 아니다.
   *
   * 적대검증 2026-07-28 ①-b: 예전에는 `_sig.distKeyId`를 그대로 실어 화면에 띄웠다.
   * 그 값은 서명 대상 안에 있지만 **서명하는 자가 공격자 자신**이므로 아무 값이나 넣을 수
   * 있었고, 중간자는 진짜 서버의 이름을 그대로 베껴 넣었다. 화면은 "서버 `/health`의
   * 이름과 대조하세요"라고 안내하므로, 사용자가 **깨끗한 기기로 성실히 대조해도 통과**했다.
   * 지금은 지갑이 스스로 유도하므로 이 값은 공격자가 고를 수 없다 —
   * 이름 = SHA256(제시한 공개키) 이기 때문이다.
   */
  newKeyId: string;
  /**
   * ★서버가 주장한 이름이 그 공개키에서 유도한 값과 **같았는가.**
   *
   * false = 규격을 따르는 서버가 낼 수 없는 응답이다(규격 9.2 I-1). 정직한 회전이라면
   * 언제나 true다. 그래서 false는 "설명 가능한 사고"가 아니라 **위조 신호**로 다룬다 —
   * 화면이 수락 버튼을 아예 내리고, `acceptPinChange`도 이중으로 거부한다.
   */
  nameVerified: boolean;
  /** 서버가 이 응답에 서명한 시각(서버 주장 — 판정 근거가 아니다). */
  signedAt: number;
}

/**
 * 핀 불일치 — 갱신은 거부하되, 사람이 판단할 재료를 들고 나간다.
 *
 * `candidate`가 null이면 **제시된 키로도 서명이 성립하지 않는다**(= 본문 변조).
 * 그때는 사람에게 물을 것도 없다 — 후보로 올리지 않는다.
 */
export class DistributionPinMismatchError extends Error {
  readonly candidate: PinChangeCandidate | null;
  constructor(candidate: PinChangeCandidate | null) {
    super('배포 서명 검증 실패(KEY_PIN_MISMATCH) — 캐시 갱신을 거부합니다');
    this.name = 'DistributionPinMismatchError';
    this.candidate = candidate;
  }
}

export function guardDistribution<T extends object>(
  response: Signed<T>,
  pinnedKey: string | null,
): GuardedBody<T> {
  const verdict = verifyDistribution(response, pinnedKey ?? undefined);
  if (!verdict.valid) {
    if (verdict.reason === 'KEY_PIN_MISMATCH') {
      // ★핀을 빼고 다시 검증한다 — "제시된 키로 서명이 성립하는가"만 본다.
      //   성립해야 사람에게 물을 값어치가 있는 후보다. 성립하지 않으면 그냥 쓰레기다.
      //   이것이 신뢰를 넓히지 않는다: 이 시점에도 갱신은 여전히 거부되고, 핀은 그대로다.
      const selfSigned = verifyDistribution(response);
      const sig = response._sig;
      // ★이름은 **우리가 유도한다.** 서버 주장(`sig.distKeyId`)은 대조용으로만 본다.
      const derivedKeyId = selfSigned.valid ? tryDeriveKeyId('DISTRIBUTION', sig.distPublicKey) : null;
      throw new DistributionPinMismatchError(
        derivedKeyId
          ? {
              newPublicKey: sig.distPublicKey,
              newKeyId: derivedKeyId,
              nameVerified: sig.distKeyId === derivedKeyId,
              signedAt: sig.signedAt,
            }
          : null,
      );
    }
    throw new Error(`배포 서명 검증 실패(${verdict.reason}) — 캐시 갱신을 거부합니다`);
  }
  const { _sig, ...body } = response;
  void _sig;
  return { body: body as unknown as T, pinToStore: pinnedKey ? null : verdict.distPublicKey };
}
