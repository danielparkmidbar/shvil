/**
 * 발행자 식별자 — keyId 유도와 이름 해소 (규격 9.2 I-1·I-2·I-3).
 *
 * > 다니엘 쌤 2026-07-26:
 * > **"다른 사람이 다른 방식의 코인 생성기를 만들어도 된다. 달러 인쇄기를 다른
 * >  누군가가 만들어도 된다. 나의 발명은 쉬빌코인이라는 화폐를 발명한 것이다."**
 *
 * ── 무엇이 그것을 막고 있었나 (실측 재현 완료) ────────────────────────
 * 발행 키 이름(`keyId`)이 `server/src/app.ts`에 **문자열 리터럴로 박혀** 있었다
 * (`membership-root-2026` 등 6개). 키 재료는 배포마다 새로 생성되지만 **이름은 모든
 * 배포가 같다.** 그런데 검증 측 신뢰 목록은 `Record<keyId, publicKey>`라 한 이름에
 * 공개키 **하나**만 담긴다.
 *
 * → 두 발행자의 키 목록을 합치는 순간 한 슬롯을 두고 충돌한다. 슬롯을 차지한 쪽이
 *   **그 순간 유일한 화폐 발행 권위**가 되고, 진 쪽의 코인은 전량 `UNTRUSTED_ROOT` /
 *   `UNTRUSTED_ISSUER`가 된다. **서명이 뚫린 게 아니라 화폐 정체성이 우연으로
 *   결정된다.**
 *
 * ── 해법 1: 이름을 공개키에서 유도한다 (I-1) ──────────────────────────
 * 이름이 키 재료에서 나오면 배포마다 달라지므로 **애초에 같은 슬롯을 쓰지 않는다.**
 * 신뢰 목록의 자료구조(`Record<string, string>`)는 그대로다 — 항목이 하나 더 들어갈 뿐.
 *
 * ── 해법 2: ★이름은 권위를 갖지 않는다 (I-3) ─────────────────────────
 * 유도만으로는 부족하다는 것이 실측의 첫 발견이었고, **별칭(옛 이름) 슬롯이 여전히
 * 선착순이라는 것**이 두 번째 발견이었다(적대검증 2026-07-26 재현). 어느 쪽도
 * "누가 이 이름을 가질 자격이 있는가"를 암호로 답할 수 없어서 생긴 문제다.
 *
 * 그래서 질문 자체를 버렸다. **이름이 아니라 공개키가 권위를 갖는다:**
 *  · 신뢰 목록에 들어갈 때 — 이름은 언제나 공개키에서 **다시 유도해** 적는다
 *    (`acceptKeyBindings`). 남의 이름을 참칭한 항목은 자기 이름으로 **고쳐 적히므로**
 *    아무 슬롯도 빼앗지 못한다. 슬롯 다툼이 구조적으로 사라진다.
 *  · 코인을 검증할 때 — 코인이 옛 이름을 달고 있으면, 코인이 **함께 들고 다니는
 *    공개키**가 그 용도로 신뢰되는지를 본다(`isTrustedKeyBinding`). 이름은 조회 색인일
 *    뿐이고 판정의 근거가 아니다.
 *
 * 그 결과 **옛 이름 슬롯을 누가 차지하든 옛 코인이 죽지 않는다.** 공격자가
 * `membership-root-2026`을 선점해도 원조의 옛 증서는 원조 공개키로 통과하고, 두
 * 발행자의 옛 이름 코인이 한 지갑에서 **동시에** 유효할 수 있다.
 *
 * ── 옛 화폐는 죽지 않는다 (I-2) ──────────────────────────────────────
 * 이미 발급된 증서·GRANT 안의 `issuerKeyId`는 **서명 대상 안에 박혀 있어**
 * (`certPayload`에 `issuerKeyId` 포함, `buildGrant`는 unsigned 전체를 서명) 사후에
 * 고칠 수 없다. 그래서 옛 이름을 **여섯 개로 고정해 명시**하고(`LEGACY_KEY_ID_ALIASES`),
 * 그 이름을 만나면 공개키로 해소한다. 유통 중인 코인은 한 개도 무효가 되지 않는다.
 *
 * ── 이 파일이 못 하는 것 (정직화 · 제3조) ───────────────────────────
 * 1. **"누구를 신뢰 목록에 넣는가"는 여기서 풀리지 않는다.** 그것은 암호가 아니라
 *    커뮤니티의 문제다(규격 9.4, docs/발행자_되는_법.md).
 * 2. **옛 이름은 신원을 증명하지 않는다.** `membership-root-2026`이 박힌 코인을 보고
 *    "원조 발행자가 만든 것"이라고 말할 수 없다 — 내가 신뢰 목록에 넣은 발행자라면
 *    누구든 그 이름을 쓸 수 있다. 발행자를 구별하려면 **공개키(유도 이름)**를 봐야 한다.
 *    옛 이름이 원조를 뜻한다고 적은 문서·화면이 있으면 고쳐야 한다.
 * 3. **유출된 키의 폐기**는 여기 없다(서명된 revocation — 미구현).
 */
import { hexToBytes } from '@noble/hashes/utils';
import { sha256Hex } from './crypto';

/**
 * 유도 keyId의 해시 부분 길이 (hex 문자 수). 규격 고정값.
 *
 * ★32 hex = **128비트**. 처음에는 16 hex(64비트)였는데, 적대검증이 다표적 환경의
 * 여유 부족을 지적했다 — 배포가 D개면 "아무 배포와나 충돌"의 비용이 2^64/D로 줄고,
 * 충돌이 성립하는 순간 **한쪽 발행자의 화폐가 통째로 죽는** 원래의 병이 되살아난다.
 * 화폐는 영구히 유통되는데 절단폭은 고정이므로, **유도 이름이 유통되기 전인 지금**
 * 128비트로 못박는다. 이후에 바꾸면 별칭이 하나 더 늘어난다.
 */
export const KEY_ID_HASH_HEX_LEN = 32;

/**
 * 용도 → keyId 접두사. **규격이 못박는 표다.**
 *
 * `/keys` 응답의 `purpose` 필드는 대문자 열거값(`MEMBERSHIP_ROOT`…)이고, keyId
 * 접두사는 옛 이름과 같은 소문자 슬러그(`membership-root`…)다. 둘이 어긋나 있어서
 * (설계 문서는 슬러그를, 코드는 열거값을 썼다) 유도식의 입력이 모호했다 —
 * 이 표가 그 모호함을 없앤다. 제3의 발행자는 **이 표 그대로** 구현해야 한다.
 *
 * ★새 용도를 더하려면 이 표에 먼저 넣어야 한다. 표에 없는 용도는 유도할 수 없고,
 * 신뢰 목록에도 들어가지 못한다(발행 측은 기동 시점에 예외로 터진다).
 */
export const KEY_ID_SLUGS = {
  MEMBERSHIP_ROOT: 'membership-root',
  ANGEL_BONUS: 'promo-angel',
  COMMUNITY_CLAIM: 'community-claim',
  COMMUNITY_REWARD: 'community-reward',
  TREASURE: 'promo-treasure',
  DISTRIBUTION: 'distribution',
} as const;

/** 규격이 정의한 발행 키 용도. */
export type KeyPurpose = keyof typeof KEY_ID_SLUGS;

/** 회원 증서에 서명하는 루트 용도 — `verifyCoin`의 `trustedRootKeys`가 되는 것. */
export const ROOT_KEY_PURPOSE = 'MEMBERSHIP_ROOT' as const;

/**
 * ★**코인을 발행할 수 있는** 용도 (GRANT 서명) — `trustedIssuerKeys`가 되는 것.
 *
 * 명시적 열거인 이유: 지갑이 "MEMBERSHIP_ROOT가 아닌 전부"를 발행 키로 접고 있어서
 * **배포 서명 키(DISTRIBUTION)까지 코인 발행 권위로 인정**하고 있었다(적대검증 재현 —
 * 배포 키로 서명한 GRANT 코인이 지갑에서는 유효, 서버에서는 무효였다). 배포 키는
 * `/keys`·`/courses` 응답에 `_sig`를 붙이는 키이지 화폐를 찍는 키가 아니다.
 * 다발행자 세계에서 **"어떤 용도의 키가 무엇을 발행할 수 있는가"는 화폐 규격의 일부**다.
 */
export const ISSUER_KEY_PURPOSES = [
  'ANGEL_BONUS',
  'COMMUNITY_CLAIM',
  'COMMUNITY_REWARD',
  'TREASURE',
] as const satisfies readonly KeyPurpose[];

/** 공개키 표기 규약: **소문자 hex 64자**(ed25519 32바이트)만 인정한다. */
const PUBLIC_KEY_HEX_RE = /^[0-9a-f]{64}$/;

/** 이 용도가 규격에 있는가 (타입 가드). */
export function isKeyPurpose(purpose: string): purpose is KeyPurpose {
  return Object.prototype.hasOwnProperty.call(KEY_ID_SLUGS, purpose);
}

/** 이 용도의 키가 코인을 발행할 수 있는가 (GRANT 서명 권위). */
export function isIssuerPurpose(purpose: string): boolean {
  return (ISSUER_KEY_PURPOSES as readonly string[]).includes(purpose);
}

/**
 * ★규격 조항 I-1 — 발행 키 이름은 공개키에서 유도한다.
 *
 * ```
 * keyId = <slug> + "-" + SHA256(공개키 32바이트)[0:32 hex]
 * ```
 *
 * ★**해시 입력은 hex 문자열이 아니라 디코드한 32바이트다.** 근거는 `crypto.ts`의
 * `addressFromPublicKey`가 이미 바이트를 쓴다는 것 — 한 화폐 안에서 같은 재료를 두
 * 가지 방식으로 해시하면 다른 언어로 구현한 발행자가 반드시 어긋난다. 두 방식은
 * 완전히 다른 값을 낸다(`keyId.test.ts`가 그 사실 자체를 벡터로 고정한다).
 * 표기 규약도 함께 못박는다: 공개키는 **소문자 hex 64자**.
 *
 * @throws 용도가 규격에 없거나 공개키 표기가 규약에 어긋나면 — 발급 측 실수를 조용히
 *         통과시키지 않기 위해 던진다. 검산 측은 `tryDeriveKeyId`를 쓴다.
 */
export function deriveKeyId(purpose: KeyPurpose | string, publicKeyHex: string): string {
  if (!isKeyPurpose(purpose)) throw new Error(`알 수 없는 키 용도: ${purpose}`);
  if (!PUBLIC_KEY_HEX_RE.test(publicKeyHex)) {
    throw new Error('공개키는 소문자 hex 64자여야 합니다 (규격 I-1 표기 규약)');
  }
  return `${KEY_ID_SLUGS[purpose]}-${sha256Hex(hexToBytes(publicKeyHex)).slice(0, KEY_ID_HASH_HEX_LEN)}`;
}

/** 유도 시도 — 입력이 규약에 어긋나면 null (검산 경로용). */
export function tryDeriveKeyId(purpose: string, publicKeyHex: string): string | null {
  if (!isKeyPurpose(purpose) || !PUBLIC_KEY_HEX_RE.test(publicKeyHex)) return null;
  return deriveKeyId(purpose, publicKeyHex);
}

// ── I-2 옛 이름 (2026-07-26 이전에 발급된 것) ─────────────────────

/**
 * ★옛 하드코딩 keyId의 **명시적** 목록 — 이 여섯 개뿐이다.
 *
 * 2026-07-26 이전에 발급된 모든 회원 증서·GRANT 안에 이 이름들이 **서명 대상으로**
 * 박혀 있다. 고칠 수 없으므로 계속 검증되어야 한다. 목록을 코드에 박아 예외의 크기를
 * 여섯 개로 고정한다 — 아무 이름이나 "옛 이름입니다" 하고 주장할 수 없다.
 *
 * ★이 이름들은 **신원을 뜻하지 않는다.** 여기 있다는 것은 "이 이름을 만나면 코인이
 * 들고 있는 공개키로 해소하라"는 뜻일 뿐, "이 이름 = 원조 발행자"가 아니다.
 * 제2 발행자는 이 이름들을 **주장하지 않아야 한다**(규격 9.3 의무 2번). 주장해도
 * 남의 코인을 죽이지는 못하지만, 그 코인이 누구 것인지 사람이 헷갈리게 된다.
 */
export const LEGACY_KEY_ID_ALIASES: Readonly<Record<string, KeyPurpose>> = {
  'membership-root-2026': 'MEMBERSHIP_ROOT',
  'promo-angel-2026': 'ANGEL_BONUS',
  'community-claim-2026': 'COMMUNITY_CLAIM',
  'community-reward-2026': 'COMMUNITY_REWARD',
  'promo-treasure-2026': 'TREASURE',
  'distribution-2026': 'DISTRIBUTION',
};

/** 이 이름이 명시적 옛 이름 목록에 있는가 — 있으면 그 이름이 고정하는 용도. */
export function legacyAliasPurpose(keyId: string): KeyPurpose | undefined {
  return Object.prototype.hasOwnProperty.call(LEGACY_KEY_ID_ALIASES, keyId)
    ? LEGACY_KEY_ID_ALIASES[keyId]
    : undefined;
}

// ── I-3 이름 해소 ────────────────────────────────────────────────

/** `/keys` 항목의 최소 모양 — 지갑·서버가 각자의 타입으로 넘긴다. */
export interface KeyBinding {
  keyId: string;
  publicKey: string;
  purpose: string;
}

function isWellFormed(b: KeyBinding): boolean {
  return (
    !!b &&
    typeof b.keyId === 'string' &&
    typeof b.publicKey === 'string' &&
    typeof b.purpose === 'string' &&
    isKeyPurpose(b.purpose) &&
    PUBLIC_KEY_HEX_RE.test(b.publicKey)
  );
}

/** 이 이름이 이 공개키에서 유도된 것인가 (규격형 항목인가). */
export function isSelfDerivedKeyId(b: KeyBinding): boolean {
  if (!isWellFormed(b)) return false;
  return tryDeriveKeyId(b.purpose, b.publicKey) === b.keyId;
}

/**
 * ★키 목록 병합 관문 — **이름을 공개키에서 다시 유도해 적는다(정규화).**
 *
 * 예전에는 "이름이 유도값과 다르면 버린다"였다. 버리는 것으로도 참칭은 막혔지만 두
 * 가지가 남았다:
 *  · 옛 이름만 싣는 (업그레이드하지 않은) 서버의 목록이 통째로 버려져, 캐시가 빈
 *    지갑이 신뢰 루트를 하나도 못 얻었다 — 그 지갑은 코인을 **하나도 받지 못한다**.
 *  · 옛 이름 슬롯은 여전히 선착순이라, 먼저 도달한 발행자가 그 이름을 차지했다.
 *
 * 정규화는 둘 다 없앤다. 들어온 항목의 **이름 주장을 무시하고** 공개키에서 유도한
 * 이름으로 적으므로,
 *  · 남의 이름을 참칭한 항목은 **자기 이름으로 고쳐 적혀** 아무 슬롯도 빼앗지 못한다.
 *  · 옛 이름만 실린 항목도 **자기 유도 이름으로** 들어와 살아 있는 키가 된다.
 *
 * 이것이 신뢰를 넓히지 않는다는 점이 중요하다 — 어차피 이 목록은 **이미 신뢰하기로 한
 * 출처**(배포 서명 핀을 통과한 서버)에서 온 것이고, 그 출처는 처음부터 자기 유도
 * 이름으로 아무 키나 넣을 수 있었다. 이름을 고쳐 적는다고 새로 할 수 있는 일은 없다.
 *
 * 버리는 것은 **규격 밖 항목**뿐이다(모르는 용도·표기 위반·옛 이름 목록에 없는 낯선
 * 이름). 낯선 이름을 정규화하지 않고 버리는 이유는 그것이 **규격을 따르지 않는 발행기**
 * 라는 신호이기 때문이다 — 조용히 고쳐 주면 그 사실이 드러나지 않는다.
 */
export function acceptKeyBindings<T extends KeyBinding>(incoming: readonly T[]): T[] {
  const accepted: T[] = [];
  const seen = new Set<string>();
  for (const k of incoming) {
    if (!isWellFormed(k)) continue;
    const derived = deriveKeyId(k.purpose, k.publicKey);
    // 규격형이거나(이름이 이미 유도값) 명시된 옛 이름일 때만 받는다.
    if (k.keyId !== derived) {
      const aliasPurpose = legacyAliasPurpose(k.keyId);
      if (aliasPurpose === undefined || aliasPurpose !== k.purpose) continue;
    }
    if (seen.has(derived)) continue;
    seen.add(derived);
    accepted.push(k.keyId === derived ? k : { ...k, keyId: derived });
  }
  return accepted;
}

/**
 * ★검증 관문 — "이 이름·이 공개키의 짝을 신뢰하는가."
 *
 * `verifySeal`(회원 증서)과 `verifyProvenance`(GRANT)가 부른다. 하는 일은 두 가지다:
 *  1. 이름이 신뢰 목록에 있고 그 공개키와 일치하면 통과 — 예전과 똑같은 판정이다.
 *  2. 이름이 **명시된 옛 이름**이면, 코인이 들고 다니는 공개키를 그 용도로 **다시
 *     유도해** 신뢰 목록에서 찾는다. 있으면 통과.
 *
 * 2번이 하는 말: **옛 이름은 조회 색인일 뿐 권위가 아니다.** 그래서
 *  · 옛 이름 슬롯을 누가 차지하고 있든 원조의 옛 코인이 죽지 않는다(선점 무력화),
 *  · 두 발행자의 옛 이름 코인이 한 지갑에서 동시에 유효할 수 있고,
 *  · 이력이 비어 있는 배포를 업그레이드해 옛 이름이 목록에서 빠져도 옛 코인이 산다.
 * 판정의 근거는 언제나 **공개키가 그 용도로 신뢰 목록에 있는가**이며, 서명 자체는
 * 호출부가 그 공개키로 따로 검증한다 — 이 함수는 서명을 대신 봐 주지 않는다.
 *
 * @param trusted 용도별 신뢰 목록 (`trustedRootKeys` 또는 `trustedIssuerKeys`)
 */
export function isTrustedKeyBinding(
  trusted: Record<string, string>,
  keyId: string,
  publicKey: string,
): boolean {
  if (typeof keyId !== 'string' || typeof publicKey !== 'string' || publicKey === '') return false;
  const has = (id: string): boolean => Object.prototype.hasOwnProperty.call(trusted, id);
  if (has(keyId) && trusted[keyId] === publicKey) return true;
  const aliasPurpose = legacyAliasPurpose(keyId);
  if (aliasPurpose === undefined) return false;
  const derived = tryDeriveKeyId(aliasPurpose, publicKey);
  return derived !== null && has(derived) && trusted[derived] === publicKey;
}
