/**
 * 배포 키 결정적 유도 (규격 9.5) — 다른 구현이 같은 값을 내는지까지 못박는다.
 *
 * 이 파일의 **벡터는 규격이다.** 유도식을 건드려 벡터가 바뀌면 그것은 리팩터링이 아니라
 * 화폐 규격 변경이고, 이미 유통된 코인의 발행 키가 통째로 바뀐다는 뜻이다.
 */
import { hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEPLOYMENT_KEY_SLOTS,
  KEY_DERIVATION_SPEC,
  KEY_ID_SLUGS,
  MAX_KEY_GENERATION,
  MIN_ROOT_SEED_LENGTH,
  deploymentKeyInfo,
  deploymentPublicKeyHistory,
  deploymentSlotTableMismatches,
  deriveDeploymentKeyPair,
  deriveKeyId,
  isAcceptableRootSeed,
  normalizeRootSeed,
  purposeOfSlot,
  signObject,
  signerFromKeyPair,
  verifyObject,
  type DeploymentKeySlot,
} from '../index';

/** 시험용 시드 — hex 64자(32바이트) 경로. */
const SEED_HEX = '7'.repeat(64);
/** 시험용 시드 — 임의 문자열(UTF-8) 경로. */
const SEED_TEXT = 'shvil-테스트-시드-절대-운영에-쓰지-말-것-0123456789';

describe('결정성 — 같은 시드는 같은 키를 낸다', () => {
  it('같은 시드·같은 슬롯·같은 세대 → 완전히 같은 키쌍 (재배포해도 같다)', () => {
    for (const slot of Object.keys(DEPLOYMENT_KEY_SLOTS) as DeploymentKeySlot[]) {
      const a = deriveDeploymentKeyPair(SEED_HEX, slot, 0);
      const b = deriveDeploymentKeyPair(SEED_HEX, slot, 0);
      expect(b).toEqual(a);
      expect(a.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
      expect(a.secretKeyHex).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('★같은 시드에서 나온 keyId도 같다 — 75adfd5(공개키에서 유도)와 충돌하지 않는다', () => {
    const a = deriveDeploymentKeyPair(SEED_HEX, 'MEMBERSHIP_ROOT', 0);
    const b = deriveDeploymentKeyPair(SEED_HEX, 'MEMBERSHIP_ROOT', 0);
    expect(deriveKeyId('MEMBERSHIP_ROOT', b.publicKeyHex)).toBe(
      deriveKeyId('MEMBERSHIP_ROOT', a.publicKeyHex),
    );
  });

  it('슬롯이 다르면 키가 다르다 (한 시드에서 7개가 서로 독립)', () => {
    const pubs = (Object.keys(DEPLOYMENT_KEY_SLOTS) as DeploymentKeySlot[]).map(
      (s) => deriveDeploymentKeyPair(SEED_HEX, s, 0).publicKeyHex,
    );
    expect(new Set(pubs).size).toBe(pubs.length);
  });

  it('시드가 다르면 키가 다르다', () => {
    expect(deriveDeploymentKeyPair(SEED_HEX, 'DISTRIBUTION', 0).publicKeyHex).not.toBe(
      deriveDeploymentKeyPair(SEED_TEXT, 'DISTRIBUTION', 0).publicKeyHex,
    );
  });

  it('유도한 키로 실제 서명·검증이 된다 (ed25519 개인키로 성립)', () => {
    const signer = signerFromKeyPair(deriveDeploymentKeyPair(SEED_TEXT, 'ANGEL_BONUS', 3));
    const payload = { hello: '쉬빌', n: 42 };
    expect(verifyObject(payload, signObject(payload, signer), signer.publicKeyHex)).toBe(true);
  });
});

describe('세대 — 회전은 가능하되 옛 공개키가 사라지지 않는다', () => {
  it('세대가 다르면 키가 다르다 (유출 시 세대를 올려 회전)', () => {
    const g0 = deriveDeploymentKeyPair(SEED_HEX, 'MEMBERSHIP_ROOT', 0).publicKeyHex;
    const g1 = deriveDeploymentKeyPair(SEED_HEX, 'MEMBERSHIP_ROOT', 1).publicKeyHex;
    const g2 = deriveDeploymentKeyPair(SEED_HEX, 'MEMBERSHIP_ROOT', 2).publicKeyHex;
    expect(new Set([g0, g1, g2]).size).toBe(3);
  });

  it('★세대 N에서도 0..N 공개키를 전부 재구성할 수 있다 (이력이 DB에서 독립한다)', () => {
    const history = deploymentPublicKeyHistory(SEED_HEX, 'MEMBERSHIP_ROOT', 3);
    expect(history).toHaveLength(4);
    expect(history.map((h) => h.generation)).toEqual([0, 1, 2, 3]);
    // 재구성값이 직접 유도값과 하나도 어긋나지 않는다.
    for (const h of history) {
      expect(h.publicKeyHex).toBe(
        deriveDeploymentKeyPair(SEED_HEX, 'MEMBERSHIP_ROOT', h.generation).publicKeyHex,
      );
    }
  });

  it('세대는 0 이상의 정수여야 한다 (음수·소수·상한 초과는 던진다)', () => {
    expect(() => deriveDeploymentKeyPair(SEED_HEX, 'DISTRIBUTION', -1)).toThrow(/세대/);
    expect(() => deriveDeploymentKeyPair(SEED_HEX, 'DISTRIBUTION', 1.5)).toThrow(/세대/);
    expect(() => deriveDeploymentKeyPair(SEED_HEX, 'DISTRIBUTION', MAX_KEY_GENERATION + 1)).toThrow(/세대/);
  });
});

describe('규격 고정 — 다른 구현이 같은 값을 내야 한다', () => {
  it('★유도 벡터 (이 값이 바뀌면 화폐 규격이 바뀐 것이다)', () => {
    // seed = "7"×64 (hex 경로), 세대 0.
    expect(deriveDeploymentKeyPair(SEED_HEX, 'MEMBERSHIP_ROOT', 0)).toEqual({
      secretKeyHex: 'c1356f8a1a4c5cb05fcb2cba2919d74aecc8940148b6c2ad69c497b41e2d95b3',
      publicKeyHex: '95a684686bdc64b7314c4bb749b1bc3aca2dbb7951a2b00aa26e3320a9d5b442',
    });
  });

  it('★독립 구현(node:crypto의 HKDF)과 값이 일치한다 — 규격이 이식 가능하다', () => {
    // @noble/hashes가 아니라 **Node 표준 라이브러리**로 같은 식을 다시 계산한다.
    // 둘이 맞는다는 것은 이 유도식이 RFC 5869 그대로이며, 다른 언어의 구현도
    // 같은 키를 낼 수 있다는 뜻이다 (제3의 발행자가 이 규격을 구현할 수 있어야 한다).
    for (const [slot, generation] of [
      ['MEMBERSHIP_ROOT', 0],
      ['ANGEL_BONUS', 1],
      ['SPOT_RESERVE', 7],
    ] as [DeploymentKeySlot, number][]) {
      const viaNode = Buffer.from(
        hkdfSync(
          'sha256',
          Buffer.from(normalizeRootSeed(SEED_HEX)),
          Buffer.from(KEY_DERIVATION_SPEC, 'utf8'),
          Buffer.from(deploymentKeyInfo(slot, generation), 'utf8'),
          32,
        ),
      ).toString('hex');
      expect(deriveDeploymentKeyPair(SEED_HEX, slot, generation).secretKeyHex).toBe(viaNode);
    }
  });

  it('info 문자열 규약 — "규격|슬러그|세대", 세대는 0 채움 없는 10진수', () => {
    expect(KEY_DERIVATION_SPEC).toBe('shvil-deployment-key/v1');
    expect(deploymentKeyInfo('DISTRIBUTION', 0)).toBe('shvil-deployment-key/v1|distribution|0');
    expect(deploymentKeyInfo('DISTRIBUTION', 10)).toBe('shvil-deployment-key/v1|distribution|10');
  });

  it('시드 정규화 규약 — hex 64자는 32바이트로, 그 외는 UTF-8 (sealing.ts와 같은 규약)', () => {
    expect(normalizeRootSeed(SEED_HEX)).toHaveLength(32);
    // 대소문자 hex는 같은 바이트로 정규화된다 — 대시보드 복붙 사고 방지.
    expect(deriveDeploymentKeyPair(SEED_HEX.toUpperCase(), 'TREASURE', 0)).toEqual(
      deriveDeploymentKeyPair(SEED_HEX, 'TREASURE', 0),
    );
    expect(normalizeRootSeed('가'.repeat(32))).toHaveLength(96); // UTF-8 3바이트 × 32
  });

  it('★슬롯 표가 규격 9.2 표(KEY_ID_SLUGS)와 글자 하나까지 같다', () => {
    expect(deploymentSlotTableMismatches()).toEqual([]);
    for (const [purpose, slug] of Object.entries(KEY_ID_SLUGS)) {
      expect(DEPLOYMENT_KEY_SLOTS[purpose as DeploymentKeySlot]).toBe(slug);
    }
    // SPOT_RESERVE만 규격 용도가 없다 (서명하지 않는 예치 주소 — /keys에 안 실린다).
    expect(purposeOfSlot('SPOT_RESERVE')).toBeNull();
    expect(purposeOfSlot('DISTRIBUTION')).toBe('DISTRIBUTION');
  });
});

describe('시드 하한 — 조용히 약한 키를 만들지 않는다', () => {
  it(`${MIN_ROOT_SEED_LENGTH}자 미만이면 던진다`, () => {
    expect(isAcceptableRootSeed('짧다')).toBe(false);
    expect(isAcceptableRootSeed('a'.repeat(MIN_ROOT_SEED_LENGTH - 1))).toBe(false);
    expect(isAcceptableRootSeed('a'.repeat(MIN_ROOT_SEED_LENGTH))).toBe(true);
    expect(isAcceptableRootSeed(undefined)).toBe(false);
    expect(() => deriveDeploymentKeyPair('short', 'DISTRIBUTION', 0)).toThrow(/시드/);
  });

  it('앞뒤 공백은 무시한다 (대시보드 복붙 사고 방지)', () => {
    expect(deriveDeploymentKeyPair(` ${SEED_HEX} `, 'DISTRIBUTION', 0)).toEqual(
      deriveDeploymentKeyPair(SEED_HEX, 'DISTRIBUTION', 0),
    );
  });
});
