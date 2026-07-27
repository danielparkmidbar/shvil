/**
 * 배포 키 결정적 유도 — 시드 하나에서 이 배포의 모든 발행 키를 만든다 (규격 9.5).
 *
 * ── 무엇이 문제였나 (실측) ────────────────────────────────────────────
 * 발행 개인키 7개가 **서버 SQLite(kv)에만** 있었다. 무료 호스팅의 디스크는 휘발성이라
 * 재배포·재시작 한 번이면 kv가 비고, `SealedKeystore`가 조용히 **새 키를 만든다.**
 * 그 순간 이 서버는 다른 발행자가 되고, 배포 키를 TOFU로 핀한 폰은 코스·신뢰 키·
 * 소명 목록·보물·스팟 갱신이 **재설치 전까지 영구히** 끊긴다.
 *
 * ── 해법: 저장하지 말고 유도한다 ──────────────────────────────────────
 * 시드(`SHVIL_ROOT_SEED`)는 환경변수에 있고 디스크와 함께 사라지지 않는다. 키를 시드에서
 * **결정적으로** 유도하면 DB가 몇 번을 초기화돼도 같은 키가 나온다. 저장소가 아니라
 * **입력**이 권위의 자리가 된다.
 *
 * ── ★세대(generation) ────────────────────────────────────────────────
 * 시드만 있으면 회전이 불가능해진다 — 같은 시드는 영원히 같은 키를 낸다. 그래서 유도식에
 * **세대 번호**를 넣는다. 세대를 올리면 새 키가 나오고, 옛 세대의 **공개키는 세대 0..N을
 * 전부 다시 유도해** 이력에 실을 수 있다(`server/src/app.ts` 기동 절차). 그래서:
 *  · 키를 갈아야 할 때 세대를 올려 회전할 수 있고,
 *  · 옛 공개키가 이력에서 사라지지 않으므로 **옛 코인이 죽지 않는다**(다니엘 쌤 원칙).
 *
 * ★★그러나 **시드 유출에는 세대 회전이 듣지 않는다.** 유출자가 같은 시드로 세대 N+1을
 * 그대로 유도하기 때문이다(적대검증 2026-07-28 ②-e가 위조 증서로 재현). 회전이 뜻을
 * 갖는 경우는 "파생 키 하나만 샜고 시드는 안전할 때"인데, 이 설계에는 그런 경로가 사실상
 * 없다 — 개인키는 전부 시드에서 나온다. 시드가 샜다면 답은 **새 시드 = 새 발행자**이고,
 * 그건 코드가 아니라 사람의 결정이다(docs/서버_키_지속성.md 6장).
 * 이력이 휘발성 kv에 있어도 상관없다 — 시드에서 언제든 재구성되기 때문이다. 커밋
 * 75adfd5가 약속한 "회전해도 옛 코인이 산다"가 여기서 **처음으로 참**이 된다.
 *
 * ── 유도식 (다른 구현이 같은 값을 낼 수 있게 — 화폐 규격의 일부) ──────
 * ```
 * IKM  = 시드 바이트          // 소문자·대문자 hex 64자면 그 32바이트, 아니면 UTF-8 바이트
 * salt = UTF8("shvil-deployment-key/v1")
 * info = UTF8("shvil-deployment-key/v1|" + 슬롯슬러그 + "|" + 세대10진수)
 * sk   = HKDF-SHA256(IKM, salt, info, 32)      // RFC 5869
 * pk   = ed25519.getPublicKey(sk)
 * keyId = deriveKeyId(용도, hex(pk))            // 규격 9.2 I-1 — 기존 유도식 그대로
 * ```
 * 슬롯 슬러그는 아래 `DEPLOYMENT_KEY_SLOTS` 표가 못박는다. 세대는 **10진수 문자열**이며
 * 0으로 채우지 않는다(`0`, `1`, `10`).
 *
 * ★ ed25519의 개인키는 32바이트 시드 그 자체이므로(RFC 8032), HKDF 출력 32바이트를
 *   그대로 개인키로 쓴다. 별도의 클램핑·리덕션이 필요 없다 — 구현 간 어긋날 여지가 없다.
 *
 * ── 이것이 못 하는 것 (정직화 · 제3조) ───────────────────────────────
 * 1. **시드는 kv를 되살리지 않는다.** members·certificates·wallet_backups·escrows·
 *    promo_grants 수량 카운터·spot_deposits는 재배포마다 여전히 죽는다. 시드가 영속시키는
 *    것은 **화폐의 권위**뿐이고 **원장**이 아니다.
 * 2. **시드 하나가 전 세대의 전 키다.** 지금은 "DB + KEK 둘 다"가 필요한데, 시드 방식은
 *    시드 하나로 끝난다. 그리고 위에 적은 대로 **세대 회전은 시드 유출의 대책이 아니다.**
 *    유출된 세대로 이미 발행된 코인은 폐기 목록(미구현)이 없으면 계속 유효하다.
 * 3. **시드 도입 자체가 키를 한 번 바꾼다.** 기존 키는 KEK로 봉인되어 있고 원격으로 꺼낼
 *    경로가 없으므로 이어받을 수 없다. 이미 핀한 폰이 있으면 그 폰은 (B) 복구 화면을 거쳐야
 *    한다.
 */
import { ed25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import type { KeyPair, Signer } from './crypto';
import { signerFromKeyPair } from './crypto';
import { KEY_ID_SLUGS, type KeyPurpose } from './keyId';

/** 유도식 버전 문자열 — salt이자 info 접두사. 바꾸면 모든 키가 바뀐다. */
export const KEY_DERIVATION_SPEC = 'shvil-deployment-key/v1';

/**
 * 유도 슬롯 → 슬러그. **규격이 못박는 표다.**
 *
 * 앞 6개는 `KEY_ID_SLUGS`(규격 9.2)와 **글자 하나까지 같아야 한다** — 어긋나면 같은 키가
 * 서버와 제3 구현에서 다른 이름을 갖는다. `keyDerivation.test.ts`가 그 일치를 못박는다.
 *
 * ★`SPOT_RESERVE`는 여기에만 있다. 스팟 예치 리저브 키는 **서명을 하지 않는 주소**이므로
 * (예치=소각의 수령 주소) 코인 발행 용도가 아니고 `/keys`에도 실리지 않는다. 그래도 시드에서
 * 유도해야 재배포 후 **같은 주소**가 나온다 — 아니면 이미 봉인된 예치 코인이 고아가 된다.
 */
export const DEPLOYMENT_KEY_SLOTS = {
  MEMBERSHIP_ROOT: 'membership-root',
  ANGEL_BONUS: 'promo-angel',
  COMMUNITY_CLAIM: 'community-claim',
  COMMUNITY_REWARD: 'community-reward',
  TREASURE: 'promo-treasure',
  DISTRIBUTION: 'distribution',
  SPOT_RESERVE: 'spot-reserve',
} as const;

export type DeploymentKeySlot = keyof typeof DEPLOYMENT_KEY_SLOTS;

/** `/keys`에 실리는(= keyId를 갖는) 슬롯인가 — SPOT_RESERVE만 아니다. */
export function isPublishedSlot(slot: DeploymentKeySlot): slot is DeploymentKeySlot & KeyPurpose {
  return slot !== 'SPOT_RESERVE';
}

/**
 * 시드 최소 길이 (문자 수).
 *
 * 32자 = hex라면 128비트, 무작위 base64라면 약 192비트. 시드 하나가 전 세대의 전 키이므로
 * 무차별 대입이 성립하지 않는 폭을 하한으로 둔다. **사람이 지어낸 문장은 길어도 시드가 아니다** —
 * 반드시 난수 생성기로 만들어야 한다(`tools/시드생성.mjs`).
 */
export const MIN_ROOT_SEED_LENGTH = 32;

/** 세대 상한 — 실수로 큰 수를 넣어 기동 때마다 수만 번 유도하는 사고를 막는다. */
export const MAX_KEY_GENERATION = 1000;

/** 시드가 하한을 넘는가 (형식 검사만 — 무작위성은 코드가 알 수 없다). */
export function isAcceptableRootSeed(seed: string | undefined | null): seed is string {
  return typeof seed === 'string' && seed.trim().length >= MIN_ROOT_SEED_LENGTH;
}

/**
 * 시드 문자열 → IKM 바이트.
 * hex 64자면 그 32바이트로(대소문자 무관), 아니면 UTF-8 바이트 그대로.
 * `sealing.ts`의 `normalizeKey`와 같은 규약이다 — 한 화폐 안에서 두 규약을 쓰지 않는다.
 */
export function normalizeRootSeed(seed: string): Uint8Array {
  const s = seed.trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return hexToBytes(s.toLowerCase());
  return utf8ToBytes(s);
}

/** 유도식의 info 문자열 — 규격 공개값. 다른 구현이 검산할 수 있게 함수로 내보낸다. */
export function deploymentKeyInfo(slot: DeploymentKeySlot, generation: number): string {
  return `${KEY_DERIVATION_SPEC}|${DEPLOYMENT_KEY_SLOTS[slot]}|${generation}`;
}

function assertGeneration(generation: number): void {
  if (!Number.isInteger(generation) || generation < 0 || generation > MAX_KEY_GENERATION) {
    throw new Error(`키 세대는 0 이상 ${MAX_KEY_GENERATION} 이하의 정수여야 합니다: ${generation}`);
  }
}

/**
 * ★시드 + 슬롯 + 세대 → 키쌍. 같은 입력이면 언제 어디서 돌려도 같은 값이 나온다.
 *
 * @throws 시드가 하한 미만이거나 슬롯·세대가 규격 밖이면. 조용히 약한 키를 만들지 않는다.
 */
export function deriveDeploymentKeyPair(
  rootSeed: string,
  slot: DeploymentKeySlot,
  generation: number,
): KeyPair {
  if (!isAcceptableRootSeed(rootSeed)) {
    throw new Error(`시드는 최소 ${MIN_ROOT_SEED_LENGTH}자여야 합니다 (SHVIL_ROOT_SEED)`);
  }
  if (!Object.prototype.hasOwnProperty.call(DEPLOYMENT_KEY_SLOTS, slot)) {
    throw new Error(`알 수 없는 유도 슬롯: ${slot}`);
  }
  assertGeneration(generation);
  const secret = hkdf(
    sha256,
    normalizeRootSeed(rootSeed),
    utf8ToBytes(KEY_DERIVATION_SPEC),
    utf8ToBytes(deploymentKeyInfo(slot, generation)),
    32,
  );
  return {
    secretKeyHex: bytesToHex(secret),
    publicKeyHex: bytesToHex(ed25519.getPublicKey(secret)),
  };
}

/** 유도한 키쌍의 서명자. */
export function deriveDeploymentSigner(
  rootSeed: string,
  slot: DeploymentKeySlot,
  generation: number,
): Signer {
  return signerFromKeyPair(deriveDeploymentKeyPair(rootSeed, slot, generation));
}

/**
 * 세대 0..generation의 공개키 (오름차순) — **공개키 이력 재구성용.**
 *
 * 기동 때마다 이것을 이력에 다시 적으면, 이력 kv가 재배포로 비어도 옛 세대 공개키가
 * `/keys`에 그대로 다시 실린다. 이것이 "회전해도 옛 코인이 죽지 않는다"를 휘발성 디스크
 * 위에서 성립시키는 유일한 조각이다.
 */
export function deploymentPublicKeyHistory(
  rootSeed: string,
  slot: DeploymentKeySlot,
  generation: number,
): { generation: number; publicKeyHex: string }[] {
  assertGeneration(generation);
  const out: { generation: number; publicKeyHex: string }[] = [];
  for (let g = 0; g <= generation; g += 1) {
    out.push({ generation: g, publicKeyHex: deriveDeploymentKeyPair(rootSeed, slot, g).publicKeyHex });
  }
  return out;
}

/** 슬롯 → 규격 용도(`KeyPurpose`). SPOT_RESERVE는 용도가 없으므로 null. */
export function purposeOfSlot(slot: DeploymentKeySlot): KeyPurpose | null {
  return isPublishedSlot(slot) ? slot : null;
}

/** 규격 9.2 표와 이 표가 어긋나지 않는지 — 테스트와 기동 점검이 함께 본다. */
export function deploymentSlotTableMismatches(): string[] {
  const bad: string[] = [];
  for (const slot of Object.keys(DEPLOYMENT_KEY_SLOTS) as DeploymentKeySlot[]) {
    const purpose = purposeOfSlot(slot);
    if (purpose === null) continue;
    if (KEY_ID_SLUGS[purpose] !== DEPLOYMENT_KEY_SLOTS[slot]) {
      bad.push(`${slot}: ${DEPLOYMENT_KEY_SLOTS[slot]} ≠ ${KEY_ID_SLUGS[purpose]}`);
    }
  }
  return bad;
}
