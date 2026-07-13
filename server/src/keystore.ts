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
 * 키 회전: keyId에 연도 버전이 있어 새 keyId로 회전 가능(운영 절차 — TODO).
 */
import { generateKeyPair, isSealed, openSecret, sealSecret, signerFromKeyPair, type KeyPair, type Signer } from '@shvil/shared';
import type { DatabaseSync } from 'node:sqlite';
import { kvGet, kvSet } from './db';

/** 개발용 폴백 KEK — 운영에서는 절대 쓰이지 않는다(devMode에서만 도달). */
const DEV_FALLBACK_KEK = 'shvil-dev-kek-not-for-production-0000000000000000';

export function resolveKek(devMode: boolean): string {
  const env = process.env.SHVIL_KEK;
  if (env && env.length >= 16) return env;
  if (!devMode) {
    throw new Error(
      'SHVIL_KEK 환경변수가 필요합니다 (발행 개인키 봉인용, 최소 16자). 운영에서는 필수입니다.',
    );
  }
  return DEV_FALLBACK_KEK;
}

/**
 * 봉인 키 저장소. loadOrCreateSigner로 발행 서명자를 얻는다 — 없으면 생성·봉인 저장,
 * 있으면 해제. 레거시 평문은 자동 재봉인.
 */
export class SealedKeystore {
  #db: DatabaseSync;
  #kek: string;

  constructor(db: DatabaseSync, devMode: boolean) {
    this.#db = db;
    this.#kek = resolveKek(devMode);
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
