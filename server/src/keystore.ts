/**
 * 발행 개인키 봉인 저장소 (보안 감사 H-2).
 *
 * 발행 개인키(promo/claim/reward/membership-root)를 kv에 평문으로 두지 않고,
 * 환경변수로 주입한 KEK(키 암호화 키)로 봉인해 저장한다. KEK는 DB에 없으므로
 * DB 유출만으로는 발행 키를 복원할 수 없다.
 *
 * KEK 정책:
 *  - 운영(devMode=false): `SHVIL_KEK` 환경변수 필수. 없으면 기동 실패(fail-closed).
 *  - 개발(devMode=true): 환경변수 있으면 사용, 없으면 개발용 고정 KEK 폴백(경고).
 *
 * 자동 마이그레이션: 기존 평문 키가 kv에 있으면 로드 후 봉인해 재저장한다.
 *
 * ★루트 시드(2026-07-27 추가): 무료 호스팅의 디스크는 휘발성이라 재배포 한 번이면 아래
 * `#loadOrCreateKey`가 **조용히 새 키를 만들었다** — 그것이 이번 사고의 원인이다. 이제
 * `SHVIL_ROOT_SEED`가 있으면 키를 시드에서 **결정적으로 유도**하고 kv를 쓰지 않는다
 * (`packages/shared/src/keyDerivation.ts` — 유도식은 규격의 일부). 시드가 없으면 예전
 * 동작(무작위)이 남지만, `keySource`가 `EPHEMERAL_RANDOM`으로 드러나고 `/health`에 실린다.
 *
 * 키 회전(2026-07-26 갱신): 새 키를 만들면 **이름이 그 키에서 유도되어 저절로 새
 * 이름이 된다**(`deriveKeyId` — 규격 9.2 I-1). 새 항목이 아래 공개키 이력에 하나 더
 * 붙고 옛 항목은 그대로 남으므로, 회전해도 옛 코인이 죽지 않는다. 남은 운영 절차는
 * "언제 회전할 것인가"뿐이며, **유출된 키의 폐기**는 여전히 미구현이다(서명된 폐기
 * 목록 — docs/소급무효화_제거_2026-07-26.md).
 */
import {
  MAX_KEY_GENERATION,
  MIN_ROOT_SEED_LENGTH,
  deploymentPublicKeyHistory,
  deriveDeploymentKeyPair,
  generateKeyPair,
  isAcceptableRootSeed,
  isSealed,
  isSelfDerivedKeyId,
  legacyAliasPurpose,
  openSecret,
  sealSecret,
  signerFromKeyPair,
  type DeploymentKeySlot,
  type KeyPair,
  type Signer,
} from '@shvil/shared';
import type { DatabaseSync } from 'node:sqlite';
import { kvGet, kvSet } from './db';

/** 개발용 폴백 KEK — 운영에서는 절대 쓰이지 않는다(devMode에서만 도달). */
const DEV_FALLBACK_KEK = 'shvil-dev-kek-not-for-production-0000000000000000';

/**
 * KEK 해석: 직접 주입(optKek)이 SHVIL_KEK 환경변수보다 우선한다.
 * optKek은 테스트가 devMode=false 서버를 환경변수 오염 없이 세우기 위한 것 —
 * 운영은 SHVIL_KEK 환경변수로 주입한다(코드에 KEK를 넣지 않는다).
 */
export function resolveKek(devMode: boolean, optKek?: string): string {
  const kek = optKek ?? process.env.SHVIL_KEK;
  if (kek && kek.length >= 16) return kek;
  if (!devMode) {
    throw new Error(
      'SHVIL_KEK 환경변수가 필요합니다 (발행 개인키 봉인용, 최소 16자). 운영에서는 필수입니다.',
    );
  }
  return DEV_FALLBACK_KEK;
}

// ── ★루트 시드 (2026-07-27 — 재배포가 발행 권위를 죽이지 않게) ──────────

/**
 * 이 배포의 발행 키가 **어디서 왔는가.**
 *  · `SEED` — `SHVIL_ROOT_SEED`(또는 주입)에서 결정적으로 유도. 재배포해도 같은 키.
 *  · `EPHEMERAL_RANDOM` — 시드가 없어 kv에서 읽거나 무작위 생성. **재배포하면 사라진다.**
 *
 * 이 값은 `/health`로 공개된다. 사고의 원인이 "조용히 무작위 키를 만든 것"이었으므로,
 * 어느 쪽인지가 **밖에서 보여야** 한다 (제3조 정직화).
 */
export type KeySource = 'SEED' | 'EPHEMERAL_RANDOM';

export interface RootSeedResolution {
  /** 유도에 쓸 시드. 없으면 null(= EPHEMERAL_RANDOM). */
  seed: string | null;
  source: KeySource;
  /** 시드가 어디서 왔는지 — 진단용. 시드 값 자체는 절대 밖으로 내보내지 않는다. */
  origin: 'ENV' | 'OPTION' | null;
}

/**
 * 루트 시드 해석. 직접 주입(optSeed)이 `SHVIL_ROOT_SEED` 환경변수보다 우선한다
 * (테스트가 환경변수 오염 없이 결정적 서버를 세우기 위한 것 — `resolveKek`과 같은 패턴).
 *
 * ★**여기서는 던지지 않는다.** 시드가 없으면 `EPHEMERAL_RANDOM`을 돌려주고, 기동을 막는
 * 판단은 `server/src/main.ts`(실제 부팅 경로)가 한다. 이유:
 *  · `buildApp`은 테스트가 수백 번 세우는 라이브러리다. 여기서 fail-closed로 만들면
 *    모든 테스트가 시드를 들고 다녀야 하고, 그러면 사람들이 아무 시드나 상수로 박게 된다.
 *  · 반면 운영 기동은 한 곳(main.ts)뿐이므로, 관문을 거기 두면 **운영에서 조용히 무작위
 *    키가 생기는 일**을 확실히 막으면서 테스트는 자유롭다.
 *
 * @throws 시드가 있는데 하한 미만이면 — 이건 실수이고, 조용히 약한 시드를 쓰면 안 된다.
 */
export function resolveRootSeed(optSeed?: string): RootSeedResolution {
  const raw = optSeed ?? process.env.SHVIL_ROOT_SEED;
  const origin: 'ENV' | 'OPTION' | null = optSeed ? 'OPTION' : raw ? 'ENV' : null;
  if (raw === undefined || raw.trim() === '') {
    return { seed: null, source: 'EPHEMERAL_RANDOM', origin: null };
  }
  if (!isAcceptableRootSeed(raw)) {
    throw new Error(
      `SHVIL_ROOT_SEED가 너무 짧습니다 (최소 ${MIN_ROOT_SEED_LENGTH}자). ` +
        '난수로 만든 값을 넣으세요 — `node tools/시드생성.mjs`',
    );
  }
  return { seed: raw.trim(), source: 'SEED', origin };
}

/**
 * 키 세대 해석 (`SHVIL_KEY_GENERATION`, 기본 0).
 *
 * 세대를 올리면 **모든 발행 키가 새로 유도된다**(= 회전). 옛 세대 공개키는 기동 때마다
 * 0..N을 전부 다시 유도해 이력에 실으므로 옛 코인은 죽지 않는다.
 *
 * @throws 정수가 아니거나 범위를 벗어나면 — 오타로 키가 통째로 바뀌는 사고를 막는다.
 */
export function resolveKeyGeneration(optGeneration?: number): number {
  if (optGeneration !== undefined) {
    if (!Number.isInteger(optGeneration) || optGeneration < 0 || optGeneration > MAX_KEY_GENERATION) {
      throw new Error(`키 세대가 범위를 벗어났습니다: ${optGeneration}`);
    }
    return optGeneration;
  }
  const raw = process.env.SHVIL_KEY_GENERATION;
  if (raw === undefined || raw.trim() === '') return 0;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 0 || n > MAX_KEY_GENERATION) {
    throw new Error(
      `SHVIL_KEY_GENERATION은 0 이상 ${MAX_KEY_GENERATION} 이하의 정수여야 합니다: ${raw}`,
    );
  }
  return n;
}

// ── 공개키 이력 (★2026-07-26 — 키 회전이 옛 코인을 죽이지 않게) ──────────

/**
 * 이 서버가 지금까지 쓴 **모든** 발행·루트 공개키의 이력.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────
 * `/keys`가 **현행 키만** 내려보내고 있었다. 그래서 루트를 `membership-root-2026` →
 * `membership-root-2027`로 한 번 회전하면:
 *  · 지갑 — 캐시에서 옛 키가 사라져 보유 중인 옛 코인이 전부 `UNKNOWN_MEMBERSHIP_ROOT`.
 *    (지갑 쪽은 `trustedKeys.ts`의 누적 병합으로 막았지만, 그것은 **이미 옛 키를 갖고
 *    있던 지갑만** 구한다. 회전 이후 새로 설치한 지갑은 옛 키를 배울 길이 없었다.)
 *  · 서버 자신 — `trustedRootKeys`에 루트가 하나뿐이라 신뢰 뱃지·스팟 예치에서
 *    옛 코인이 INVALID가 된다.
 *
 * 즉 증서 만료라는 킬 스위치를 없애도 **루트 회전이라는 킬 스위치가 그대로 남아
 * 있었다.** 제9조(무승인)의 실질은 "서버가 이미 만들어진 코인을 죽일 수 없다"이므로,
 * 이 이력이 없으면 만료를 고친 의미가 절반이다.
 *
 * ── 왜 이것이 위조 여지를 만들지 않는가 ──────────────────────────────
 * 키 회전은 유출 사건이 아니다. 옛 루트의 **개인키가 공격자에게 넘어간 것이 아니므로**,
 * 옛 공개키를 계속 신뢰해도 공격자가 새로 만들 수 있는 것은 없다. 비대칭이 공짜로
 * 성립하는 유일한 경로다.
 *
 * ── 이것이 못 하는 것 (정직화 · 제3조) ───────────────────────────────
 * 키가 **실제로 유출**됐을 때는 이력에서 빼는 것으로 해결되지 않는다. 그건 서명된
 * **폐기 목록**의 문제이며 아직 구현되어 있지 않다(docs/소급무효화_제거_2026-07-26.md).
 */
export interface ArchivedPublicKey {
  keyId: string;
  publicKey: string;
  purpose: string;
  /** 이 서버가 이 키를 처음 쓴 시각 — 공시·감사용. 판정에는 쓰이지 않는다. */
  firstSeenAt: number;
}

const KEY_ARCHIVE_KV = 'publicKeyArchive';

export function archivedPublicKeys(db: DatabaseSync): ArchivedPublicKey[] {
  const raw = kvGet(db, KEY_ARCHIVE_KV);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ArchivedPublicKey[];
    return Array.isArray(parsed) ? parsed.filter((k) => k && typeof k.keyId === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * 공개키를 이력에 **추가**한다 (append-only).
 *
 * 규칙은 지갑의 `mergeTrustedKeyInfos`와 같다 — 아는 keyId의 공개키는 절대 바꾸지
 * 않는다. 같은 ID에 다른 키가 오는 것은 회전이 아니라 바꿔치기다. 실수로 keyId를
 * 재사용해 옛 증서를 무효로 만드는 사고도 이 규칙이 막는다.
 *
 * ★2026-07-26 — **유도식 관문**(규격 9.2 I-1/I-3). 이력에 들어온 키는 `/keys`로
 * 세상에 배포되고 남의 지갑의 신뢰 목록이 된다. 그러니 발행 측은 **자기 공개키에서
 * 유도한 이름으로만** 적어야 한다. 검산 없이 넣으면, 이 서버가 남의 이름을 참칭한 키를
 * 대신 배포해 주는 통로가 된다.
 *
 * ★옛 이름(`membership-root-2026` 등)은 **새로 적지 않는다.** 이미 이력에 있는 것은
 * 그대로 두고 계속 게시하지만(옛 앱 버전이 그것을 봐야 한다), 이력이 비어 있는 배포가
 * 옛 이름을 새로 주장할 방법은 없다. 그리고 이제는 그럴 필요도 없다 —
 * 검증 측이 옛 이름을 **공개키로 해소**하므로(`isTrustedKeyBinding`), 옛 이름이
 * 목록에 없어도 옛 증서·옛 GRANT가 전부 검증된다. 업그레이드 순서에 따라 옛 코인이
 * 죽던 문제(적대검증 F1)가 여기서 사라진다.
 *
 * @throws 이름이 유도값이 아니면 — 조용히 건너뛰지 않는다. 발급 측의 실수는 기동
 *         시점에 크게 터져야 한다(조용히 빠지면 그 키로 서명한 코인이 나중에 통째로
 *         거부된다). 규격에 없는 새 용도를 넣을 때도 여기서 터진다 — 용도 문자열은
 *         유도식의 입력이므로 `KEY_ID_SLUGS`에 먼저 등록해야 한다.
 */
export function recordPublicKey(
  db: DatabaseSync,
  entry: Omit<ArchivedPublicKey, 'firstSeenAt'>,
  now: number = Date.now(),
): void {
  const archive = archivedPublicKeys(db);
  // 이미 있는 이름은 그대로 둔다 — 앞선 버전이 적어 둔 옛 이름이 여기서 걸러져
  // 사라지면 그 이름을 게시하던 옛 앱 버전에서 옛 증서가 죽는다.
  if (archive.some((k) => k.keyId === entry.keyId)) return;
  if (!isSelfDerivedKeyId(entry)) {
    throw new Error(
      `키 이름이 공개키에서 유도되지 않았습니다: ${entry.keyId} (규격 9.2 I-1/I-3 — deriveKeyId 사용)`,
    );
  }
  archive.push({ ...entry, firstSeenAt: now });
  kvSet(db, KEY_ARCHIVE_KV, JSON.stringify(archive));
}

/**
 * 이력 중 **규격형이 아닌** 항목 (기동 점검용 — 판정에는 쓰이지 않는다).
 *
 * 이력 kv는 평문 JSON이라, DB 쓰기 권한을 얻은 자가 항목을 직접 끼워 넣으면 관문
 * (`recordPublicKey`)을 거치지 않고 `/keys`에 실린다(적대검증 재현). 개인키는 KEK로
 * 봉인되어 있어 꺼낼 수 없지만 **발행 권위(신뢰 목록)는 갈아끼울 수 있다** — 봉인이
 * 지키는 것과 이력이 지키는 것의 강도가 다르다는 뜻이다.
 *
 * 읽는 쪽에서 **지우지는 않는다**(지우면 옛 이름이 사라져 옛 코인이 죽는다). 대신
 * 기동 시 드러내기만 한다. 근본 해결은 이력 항목마다 배포 키 서명을 붙이는 것이며
 * 아직 미구현이다(docs/발행자_되는_법.md 남은 장벽).
 */
export function nonConformingArchiveEntries(db: DatabaseSync): ArchivedPublicKey[] {
  return archivedPublicKeys(db).filter(
    (k) => !isSelfDerivedKeyId(k) && legacyAliasPurpose(k.keyId) !== k.purpose,
  );
}

/**
 * 이력 전체에서 이 용도의 키를 모은다 (keyId → publicKey) — verifyCoin에 그대로 넘긴다.
 *
 * ★여기서는 다시 검산하지 않는다. 관문은 `recordPublicKey`(쓰는 쪽)에 있다. 읽는 쪽에서
 * 걸러 내면, 이 버전 이전에 적힌 옛 이름들이 그 순간 사라져 **이미 유통 중인 코인이
 * 죽는다.** 검사는 들어올 때 하고, 이미 신뢰하기로 한 것은 지키는 것 — 지갑
 * (`trustedKeys.ts`)과 같은 비대칭이다.
 */
export function trustedKeysForPurposes(db: DatabaseSync, purposes: readonly string[]): Record<string, string> {
  const wanted = new Set(purposes);
  const keys: Record<string, string> = {};
  for (const k of archivedPublicKeys(db)) {
    if (wanted.has(k.purpose)) keys[k.keyId] = k.publicKey;
  }
  return keys;
}

export interface SealedKeystoreOptions {
  /** KEK 직접 주입 (테스트용). 지정 시 SHVIL_KEK보다 우선. */
  kek?: string;
  /** 루트 시드 직접 주입 (테스트용). 지정 시 SHVIL_ROOT_SEED보다 우선. */
  rootSeed?: string;
  /** 키 세대 직접 주입 (테스트용). 지정 시 SHVIL_KEY_GENERATION보다 우선. */
  generation?: number;
}

/**
 * 봉인 키 저장소.
 *
 * ── 두 경로 ──────────────────────────────────────────────────────────
 * **시드 경로 (`keySource === 'SEED'`)** — 키를 `SHVIL_ROOT_SEED`에서 유도한다. kv는 읽지도
 * 쓰지도 않는다. 재배포로 DB가 비어도 같은 키가 나온다. 이 경로가 이번 작업의 목적이다.
 *
 * **휘발 경로 (`keySource === 'EPHEMERAL_RANDOM'`)** — 시드가 없을 때. kv에 있으면 열고
 * 없으면 만들어 봉인 저장한다(= 이 파일의 원래 동작 그대로). 재배포하면 사라진다.
 *
 * ── ★kv의 옛 키를 지우지 않는 이유 ───────────────────────────────────
 * 시드를 도입해도 kv에 남아 있는 **옛 무작위 키**는 그대로 둔다(`retiredPublicKey`로 읽기만
 * 한다). 그 공개키를 이력에 실어야 그 키로 서명된 옛 증서·옛 GRANT가 계속 검증되기
 * 때문이다. 개인키는 더 이상 서명에 쓰이지 않는다 — 은퇴이지 폐기가 아니다.
 */
export class SealedKeystore {
  #db: DatabaseSync;
  #kek: string;
  #seed: string | null;
  readonly keySource: KeySource;
  readonly seedOrigin: 'ENV' | 'OPTION' | null;
  readonly generation: number;

  constructor(db: DatabaseSync, devMode: boolean, opts?: string | SealedKeystoreOptions) {
    const o: SealedKeystoreOptions = typeof opts === 'string' ? { kek: opts } : (opts ?? {});
    this.#db = db;
    this.#kek = resolveKek(devMode, o.kek);
    const seed = resolveRootSeed(o.rootSeed);
    this.#seed = seed.seed;
    this.keySource = seed.source;
    this.seedOrigin = seed.origin;
    this.generation = resolveKeyGeneration(o.generation);
  }

  /**
   * 이 배포가 **서명에 쓰는** 키.
   *
   * @param slot  유도 슬롯 (시드 경로에서 쓰인다)
   * @param kvKey 옛 저장 자리 (휘발 경로에서 쓰인다 — 'promoKey' 등)
   */
  signerForSlot(slot: DeploymentKeySlot, kvKey: string): Signer {
    if (this.#seed !== null) {
      return signerFromKeyPair(deriveDeploymentKeyPair(this.#seed, slot, this.generation));
    }
    return this.loadOrCreateSigner(kvKey);
  }

  /**
   * 세대 0..현재의 공개키 (오름차순). 시드가 없으면 빈 배열.
   * 기동 시 이것을 이력에 다시 적어 **이력을 휘발성 DB에서 독립시킨다.**
   */
  publicKeyGenerations(slot: DeploymentKeySlot): { generation: number; publicKeyHex: string }[] {
    if (this.#seed === null) return [];
    return deploymentPublicKeyHistory(this.#seed, slot, this.generation);
  }

  /**
   * kv에 남아 있는 옛 키의 **공개키만** (시드 도입 전에 만들어진 것). 없으면 null.
   * 읽기 전용 — 없는 키를 만들지 않는다(그러면 휘발 경로가 되살아난다).
   */
  retiredPublicKey(kvKey: string): string | null {
    if (this.#seed === null) return null; // 휘발 경로에서는 그 키가 곧 현행 키다.
    const saved = kvGet(this.#db, kvKey);
    if (!saved) return null;
    try {
      const pair = (isSealed(saved) ? JSON.parse(openSecret(saved, this.#kek)) : JSON.parse(saved)) as KeyPair;
      return typeof pair.publicKeyHex === 'string' && /^[0-9a-f]{64}$/.test(pair.publicKeyHex)
        ? pair.publicKeyHex
        : null;
    } catch {
      // KEK가 바뀌었거나 손상된 항목 — 여기서 터지면 서버가 아예 못 뜬다. 옛 키를
      // 못 살리는 것은 손실이지만, 그 때문에 현행 발행이 멈추는 것이 더 큰 손실이다.
      return null;
    }
  }

  /** 휘발 경로의 원래 동작 — kv에 있으면 열고, 없으면 만들어 봉인 저장. */
  loadOrCreateSigner(kvKey: string): Signer {
    return signerFromKeyPair(this.#loadOrCreateKey(kvKey));
  }

  #loadOrCreateKey(kvKey: string): KeyPair {
    const saved = kvGet(this.#db, kvKey);
    if (saved) {
      if (isSealed(saved)) return JSON.parse(openSecret(saved, this.#kek)) as KeyPair;
      // 레거시 평문 → 재봉인 후 재저장 (자동 마이그레이션).
      const pair = JSON.parse(saved) as KeyPair;
      kvSet(this.#db, kvKey, sealSecret(JSON.stringify(pair), this.#kek));
      return pair;
    }
    const pair = generateKeyPair();
    kvSet(this.#db, kvKey, sealSecret(JSON.stringify(pair), this.#kek));
    return pair;
  }
}
