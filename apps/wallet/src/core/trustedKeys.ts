/**
 * 신뢰 키 캐시 병합 (순수 로직 — expo 모듈 import 금지, vitest 대상).
 *
 * ── 무엇이 뚫려 있었나 (2026-07-26 실측) ──────────────────────────────
 * `directory.ts`의 `fetchKeyInfos`가 서버 응답을 **캐시에 통째로 덮어쓰고** 있었다.
 * 서버 `/keys`는 **현행 키만** 내려보내므로(이력 목록이 없다), 루트 키를
 * `membership-root-2026` → `membership-root-2027`로 한 번 회전하는 순간
 * 지갑 캐시에서 2026 키가 **소멸**하고, 보유 중인 모든 옛 WALK 코인이
 * `UNKNOWN_MEMBERSHIP_ROOT`가 된다. 발행 키(엔젤 보너스·보물)도 똑같다.
 *
 * ★이건 다발행자·소급 무효화 논의와 **무관하게 지금도 코인을 죽이는 버그**다.
 * 키 회전은 유출 사건이 아니다 — 옛 루트가 서명한 옛 증서는 여전히 정직하게 서명된
 * 것이고, 옛 키의 개인키가 공격자 손에 넘어간 것이 아니다. 그러니 옛 키를 지울 이유가
 * 없다. 지우면 옛 화폐만 죽는다.
 *
 * ── 병합 규칙: keyId 단위 TOFU ───────────────────────────────────────
 * 1. **새 keyId는 더한다.** 회전은 새 ID로 온다(이름 규약이 이미 연도를 담고 있다:
 *    `membership-root-2026`). 그래서 더하기만 해도 회전이 그대로 동작한다.
 * 2. **이미 아는 keyId의 공개키는 절대 바꾸지 않는다.** 같은 ID에 다른 키가 오는 것은
 *    회전이 아니라 **바꿔치기**다(서버 침해·MITM). 배포 서명 핀(H-3)이 1차 방어이고,
 *    이것이 2차 방어다. 첫 응답이 진실의 기준이 된다.
 * 3. **사라진 keyId를 지우지 않는다.** 서버가 목록에서 뺐다는 사실만으로 이미 유통 중인
 *    옛 코인을 죽일 수는 없다.
 *
 * ── 이 규칙이 못 하는 것 (정직화 · 제3조) ────────────────────────────
 * 키가 **실제로 유출**되었을 때 폐기할 방법이 여기에는 없다. 그건 "목록에서 빼기"가
 * 아니라 **명시적 폐기 목록**(서명된 revocation)의 문제이며 아직 구현되어 있지 않다.
 * docs/소급무효화_경로.md의 잔여 위험 항목을 보라.
 */

/** 서버 `/keys` 응답 항목 (api.ts의 TrustedKeyInfo와 같은 모양 — 순수 모듈이라 재선언한다). */
export interface KeyInfoLike {
  keyId: string;
  publicKey: string;
  purpose: string;
}

/**
 * 캐시된 목록에 새 응답을 **누적**한다. 캐시 순서를 보존하고 새 키를 뒤에 붙인다.
 * @param cached 지금까지 알고 있던 키 (없으면 빈 배열)
 * @param incoming 방금 받은(배포 서명 검증을 통과한) 키 목록
 */
export function mergeTrustedKeyInfos<T extends KeyInfoLike>(cached: readonly T[], incoming: readonly T[]): T[] {
  const merged: T[] = [];
  const seen = new Set<string>();
  for (const k of cached) {
    if (!k || typeof k.keyId !== 'string' || typeof k.publicKey !== 'string') continue;
    if (seen.has(k.keyId)) continue; // 캐시가 오염된 경우에도 첫 항목만 남긴다
    seen.add(k.keyId);
    merged.push(k);
  }
  for (const k of incoming) {
    if (!k || typeof k.keyId !== 'string' || typeof k.publicKey !== 'string') continue;
    // 규칙 2: 아는 keyId면 공개키를 바꾸지 않는다(바꿔치기 차단).
    if (seen.has(k.keyId)) continue;
    seen.add(k.keyId);
    merged.push(k);
  }
  return merged;
}
