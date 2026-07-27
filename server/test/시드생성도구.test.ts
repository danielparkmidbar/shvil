/**
 * 시드 생성기(`tools/시드생성.mjs`)가 규격과 어긋나지 않는지.
 *
 * ── 왜 이 테스트가 필요한가 ──────────────────────────────────────────
 * 그 도구는 다니엘 쌤이 `node` 하나로 돌릴 수 있어야 해서 라이브러리(`@shvil/shared`)를
 * 쓰지 않고 유도식을 **직접** 계산한다. 즉 규격에서 조용히 어긋날 수 있는 두 번째 구현이다.
 * 어긋나면 종이에 적은 이름·지문이 서버가 내는 값과 달라지고, 다니엘 쌤의 확인 절차가
 * 그 자리에서 거짓말이 된다 — 그러면 **오타 난 시드를 잡아 줄 유일한 장치가 사라진다.**
 *
 * ★이 파일이 못박는 것: 도구의 값 = 라이브러리의 값 = 서버 `/health`의 값.
 */
import { describe, expect, it } from 'vitest';
import {
  deriveDeploymentKeyPair,
  deriveKeyId,
  publicKeyFingerprint,
  type DeploymentKeySlot,
} from '@shvil/shared';
import { buildApp } from '../src/app';
// @ts-expect-error — 운영자가 그대로 돌리는 .mjs를 **그 파일 그대로** 부른다(사본 금지).
import { derivePublicKey, keyIdOf, fingerprint, summarize } from '../../tools/시드생성.mjs';

const SEED = 'a'.repeat(64);
const SEED2 = '9f'.repeat(32);

describe('시드 생성기 — 종이에 적는 값이 서버가 내는 값과 같은가', () => {
  it('①-A 도구가 유도한 공개키가 라이브러리와 슬롯마다 일치한다', () => {
    const rows = summarize(SEED, 0) as { slot: string; slug: string; publicKey: string }[];
    expect(rows).toHaveLength(7);
    for (const r of rows) {
      const lib = deriveDeploymentKeyPair(SEED, r.slot as DeploymentKeySlot, 0);
      expect(r.publicKey).toBe(lib.publicKeyHex);
    }
  });

  it('①-B 도구가 만든 열쇠 이름이 라이브러리 유도값과 일치한다 (SPOT_RESERVE는 이름 없음)', () => {
    const rows = summarize(SEED, 0) as { slot: string; publicKey: string; keyId: string | null }[];
    for (const r of rows) {
      if (r.slot === 'SPOT_RESERVE') {
        expect(r.keyId).toBeNull();
        continue;
      }
      expect(r.keyId).toBe(deriveKeyId(r.slot, r.publicKey));
    }
  });

  it('①-C 지문 형식이 폰·서버와 글자 하나까지 같다', () => {
    const pk = deriveDeploymentKeyPair(SEED, 'DISTRIBUTION', 0).publicKeyHex;
    expect(fingerprint(pk)).toBe(publicKeyFingerprint(pk));
  });

  it('①-D 세대를 올리면 도구도 라이브러리와 똑같이 다른 값을 낸다', () => {
    for (const g of [0, 1, 7]) {
      expect(derivePublicKey(SEED, 'distribution', g)).toBe(
        deriveDeploymentKeyPair(SEED, 'DISTRIBUTION', g).publicKeyHex,
      );
    }
    expect(derivePublicKey(SEED, 'distribution', 0)).not.toBe(derivePublicKey(SEED, 'distribution', 1));
  });

  it('①-E 대소문자·앞뒤 공백은 같은 시드로 본다 (붙여넣기 사고 방지)', () => {
    expect(derivePublicKey(`  ${SEED.toUpperCase()}  `, 'distribution', 0)).toBe(
      derivePublicKey(SEED, 'distribution', 0),
    );
  });

  it('①-F ★한 글자만 달라도 완전히 다른 열쇠가 된다 (그래서 종이 대조가 필요하다)', () => {
    const 오타 = `${SEED.slice(0, 63)}b`;
    expect(derivePublicKey(오타, 'distribution', 0)).not.toBe(derivePublicKey(SEED, 'distribution', 0));
  });

  it('①-G ★★종이의 값 = 서버 /health의 값 (실제 서버를 세워 대조한다)', async () => {
    const app = buildApp({ rootSeed: SEED2, keyGeneration: 0 });
    const res = await app.inject({ method: 'GET', url: '/health' });
    const health = res.json() as { distKeyId: string; distKeyFingerprint: string; keySource: string };
    const 종이 = (summarize(SEED2, 0) as { slot: string; keyId: string; fingerprint: string }[]).find(
      (r) => r.slot === 'DISTRIBUTION',
    )!;
    expect(health.keySource).toBe('SEED');
    expect(health.distKeyId).toBe(종이.keyId);
    expect(health.distKeyFingerprint).toBe(종이.fingerprint);
    // 오타 난 시드로 뜬 서버는 같은 대조에서 **걸린다** — 이것이 이 절차의 전부다.
    const 오타서버 = buildApp({ rootSeed: `${SEED2.slice(0, 63)}0`, keyGeneration: 0 });
    const 오타 = (await 오타서버.inject({ method: 'GET', url: '/health' })).json() as {
      distKeyId: string;
      warnings: string[];
    };
    expect(오타.distKeyId).not.toBe(종이.keyId);
    expect(오타.warnings).toEqual([]); // ★경고는 안 뜬다 — 대조만이 잡는다
    await app.close();
    await 오타서버.close();
  });

  it('①-H 이름 유도식이 규격 9.2 I-1 그대로다 (슬러그 + SHA256 앞 32 hex)', () => {
    const pk = deriveDeploymentKeyPair(SEED, 'MEMBERSHIP_ROOT', 0).publicKeyHex;
    const id = keyIdOf('membership-root', pk) as string;
    expect(id).toBe(deriveKeyId('MEMBERSHIP_ROOT', pk));
    expect(id.split('-').pop()).toHaveLength(32);
  });
});
