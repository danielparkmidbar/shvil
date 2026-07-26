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
 * 키 회전(2026-07-26 갱신): 새 키를 만들면 **이름이 그 키에서 유도되어 저절로 새
 * 이름이 된다**(`deriveKeyId` — 규격 9.2 I-1). 새 항목이 아래 공개키 이력에 하나 더
 * 붙고 옛 항목은 그대로 남으므로, 회전해도 옛 코인이 죽지 않는다. 남은 운영 절차는
 * "언제 회전할 것인가"뿐이며, **유출된 키의 폐기**는 여전히 미구현이다(서명된 폐기
 * 목록 — docs/소급무효화_제거_2026-07-26.md).
 */
import {
  generateKeyPair,
  isSealed,
  isSelfDerivedKeyId,
  legacyAliasPurpose,
  openSecret,
  sealSecret,
  signerFromKeyPair,
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

/**
 * 봉인 키 저장소. loadOrCreateSigner로 발행 서명자를 얻는다 — 없으면 생성·봉인 저장,
 * 있으면 해제. 레거시 평문은 자동 재봉인.
 */
export class SealedKeystore {
  #db: DatabaseSync;
  #kek: string;

  constructor(db: DatabaseSync, devMode: boolean, optKek?: string) {
    this.#db = db;
    this.#kek = resolveKek(devMode, optKek);
  }

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
