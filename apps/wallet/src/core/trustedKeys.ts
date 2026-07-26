/**
 * 신뢰 키 캐시 병합 + 검증용 접기 (순수 로직 — expo 모듈 import 금지, vitest 대상).
 *
 * ── 무엇이 뚫려 있었나 (2026-07-26 실측) ──────────────────────────────
 * `directory.ts`의 `fetchKeyInfos`가 서버 응답을 **캐시에 통째로 덮어쓰고** 있었다.
 * 서버 `/keys`는 **현행 키만** 내려보내므로(이력 목록이 없다), 루트 키를 한 번
 * 회전하는 순간 지갑 캐시에서 옛 키가 **소멸**하고, 보유 중인 모든 옛 WALK 코인이
 * `UNKNOWN_MEMBERSHIP_ROOT`가 된다. 발행 키(엔젤 보너스·보물)도 똑같다.
 *
 * ★이건 다발행자·소급 무효화 논의와 **무관하게 지금도 코인을 죽이는 버그**다.
 * 키 회전은 유출 사건이 아니다 — 옛 루트가 서명한 옛 증서는 여전히 정직하게 서명된
 * 것이고, 옛 키의 개인키가 공격자 손에 넘어간 것이 아니다. 그러니 옛 키를 지울 이유가
 * 없다. 지우면 옛 화폐만 죽는다.
 *
 * ── 병합 규칙: keyId 단위 TOFU ───────────────────────────────────────
 * 1. **새 keyId는 더한다.** 회전은 새 ID로 온다(유도 ID는 새 키 재료에서 새 이름이
 *    나온다). 그래서 더하기만 해도 회전이 그대로 동작한다.
 * 2. **이미 아는 keyId의 공개키는 절대 바꾸지 않는다.** 같은 ID에 다른 키가 오는 것은
 *    회전이 아니라 **바꿔치기**다(서버 침해·MITM). 배포 서명 핀(H-3)이 1차 방어이고,
 *    이것이 2차 방어다. 첫 응답이 진실의 기준이 된다.
 * 3. **사라진 keyId를 지우지 않는다.** 서버가 목록에서 뺐다는 사실만으로 이미 유통 중인
 *    옛 코인을 죽일 수는 없다.
 *
 * ── ★0. 이름 정규화 (2026-07-26 추가 — 규격 9.2 I-3) ─────────────────
 * 위 세 규칙은 "먼저 만난 발행자가 슬롯을 영구히 차지한다"까지만 만든다. 옛 하드코딩
 * 이름(`membership-root-2026`)은 **모든 배포가 같은 이름**이므로, 제2 발행자가 나오면
 * 슬롯을 두고 충돌하고 진 쪽 코인이 전량 무효가 된다. 그래서 들어오는 항목의 이름을
 * **공개키에서 다시 유도해 적는다**(`acceptKeyBindings` — 화폐 규격의 일부다).
 * 남의 이름을 참칭한 항목은 자기 이름으로 고쳐 적히므로 아무 슬롯도 빼앗지 못한다.
 * 옛 이름은 신뢰 목록에 들어가지 않고, 코인을 검증할 때 공개키로 해소된다
 * (`isTrustedKeyBinding` — 그래서 옛 이름 슬롯 선점으로 옛 코인을 죽일 수 없다).
 *
 * ★**캐시는 검산하지 않는다.** 캐시에 있는 것은 이 지갑이 **이미 신뢰하기로 한** 키다.
 * 검산으로 캐시를 청소하면, 앱을 업데이트한 그 순간 유도 이름을 배우지 못한 옛 키가
 * 사라지고 **보유 중인 옛 코인이 전부 죽는다.** 그것이 이 작업이 고치려는 바로 그 병이다.
 * 관문은 "새로 들어오는 것"에만 세운다.
 *
 * ── 이 규칙이 못 하는 것 (정직화 · 제3조) ────────────────────────────
 * 키가 **실제로 유출**되었을 때 폐기할 방법이 여기에는 없다. 그건 "목록에서 빼기"가
 * 아니라 **명시적 폐기 목록**(서명된 revocation)의 문제이며 아직 구현되어 있지 않다.
 * 그리고 **"누구를 신뢰 목록에 넣는가"도 여기서 풀리지 않는다** — 이 파일은 신뢰하기로
 * 한 발행자들이 서로를 덮어쓰지 않게 할 뿐이다(규격 9.4).
 */
import { ISSUER_KEY_PURPOSES, ROOT_KEY_PURPOSE, acceptKeyBindings } from '@shvil/shared';

/** 서버 `/keys` 응답 항목 (api.ts의 TrustedKeyInfo와 같은 모양 — 순수 모듈이라 재선언한다). */
export interface KeyInfoLike {
  keyId: string;
  publicKey: string;
  purpose: string;
}

/**
 * 캐시된 목록에 새 응답을 **누적**한다. 캐시 순서를 보존하고 새 키를 뒤에 붙인다.
 * 들어오는 항목은 이름이 공개키에서 다시 유도되어(정규화) 들어온다 — 규격 밖 항목
 * (모르는 용도·표기 위반·낯선 이름)만 조용히 **버린다**. 버려도 캐시는 그대로이므로
 * 앱 동작은 계속된다.
 *
 * @param cached 지금까지 알고 있던 키 (없으면 빈 배열). 정규화 대상이 아니다 —
 *        캐시에 옛 이름으로 들어 있는 항목을 고쳐 쓰면 그 순간 보유 코인이 죽는다.
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
  // ★규칙 0: 이름 정규화 (규격 I-3). 참칭한 이름은 자기 이름으로 고쳐 적힌다.
  for (const k of acceptKeyBindings(incoming)) {
    // 규칙 2: 아는 keyId면 공개키를 바꾸지 않는다(바꿔치기 차단).
    if (seen.has(k.keyId)) continue;
    seen.add(k.keyId);
    merged.push(k);
  }
  return merged;
}

/**
 * 신뢰 목록을 검증 함수가 받는 모양(`Record<keyId, publicKey>`)으로 접는다.
 *
 * ★`verifyCoin`·`verifyMembershipForMint`의 **시그니처와 자료구조는 바뀌지 않았다.**
 * 이름이 발행자마다 달라졌으므로 두 발행자의 키가 서로 다른 슬롯에 들어갈 뿐이다.
 * 여기서 다시 검산하지 않는 이유는 위 "캐시는 검산하지 않는다"와 같다 — 이 함수는
 * 캐시를 읽는 쪽이고, 관문은 병합(`mergeTrustedKeyInfos`)에 있다.
 *
 * ★**용도를 명시적으로 가른다.** 예전에는 "MEMBERSHIP_ROOT가 아니면 전부 발행 키"라
 * 배포 서명 키(DISTRIBUTION)까지 코인 발행 권위로 인정했다 — 배포 키로 서명한 GRANT
 * 코인이 지갑에서는 유효하고 서버에서는 무효인 판정 불일치가 실측으로 재현됐다.
 * 배포 키는 응답 본문에 `_sig`를 붙이는 키이지 화폐를 찍는 키가 아니다. 목록은
 * `@shvil/shared`의 `ISSUER_KEY_PURPOSES`에 있고 서버와 **같은 표**를 본다.
 *
 * @param isRoot true면 회원 증서 루트(MEMBERSHIP_ROOT), false면 코인 발행 키.
 */
export function foldTrustedKeys(infos: readonly KeyInfoLike[], isRoot: boolean): Record<string, string> {
  const wanted: readonly string[] = isRoot ? [ROOT_KEY_PURPOSE] : ISSUER_KEY_PURPOSES;
  const keys: Record<string, string> = {};
  for (const k of infos) {
    if (wanted.includes(k.purpose)) keys[k.keyId] = k.publicKey;
  }
  return keys;
}
