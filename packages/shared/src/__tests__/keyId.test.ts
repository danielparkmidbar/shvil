/**
 * 발행자 식별자 유도·정규화·이름 해소 (규격 9.2 I-1·I-2·I-3).
 *
 * ★이 파일의 벡터는 **화폐 규격 그 자체**다. 다른 언어로 발행기를 만드는 제3의
 * 발행자가 같은 값을 내지 못하면 그 발행자의 코인은 우리 지갑에서 검증되지 않는다.
 * 그래서 "해시 입력이 바이트인가 hex 문자열인가"와 절단 길이를 값으로 고정한다.
 */
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../crypto';
import {
  ISSUER_KEY_PURPOSES,
  KEY_ID_HASH_HEX_LEN,
  KEY_ID_SLUGS,
  LEGACY_KEY_ID_ALIASES,
  ROOT_KEY_PURPOSE,
  acceptKeyBindings,
  deriveKeyId,
  isIssuerPurpose,
  isSelfDerivedKeyId,
  isTrustedKeyBinding,
  tryDeriveKeyId,
} from '../keyId';

const PK_A = 'aa'.repeat(32);
const PK_B = 'bb'.repeat(32);

describe('유도식 벡터 (규격 I-1 — 다른 언어로 구현해도 같은 값이 나와야 한다)', () => {
  it('고정 벡터: 공개키 aa×32 · 용도별 keyId', () => {
    expect(deriveKeyId('MEMBERSHIP_ROOT', PK_A)).toBe('membership-root-e0e77a507412b120f6ede61f62295b1a');
    expect(deriveKeyId('ANGEL_BONUS', PK_A)).toBe('promo-angel-e0e77a507412b120f6ede61f62295b1a');
    expect(deriveKeyId('COMMUNITY_CLAIM', PK_A)).toBe('community-claim-e0e77a507412b120f6ede61f62295b1a');
    expect(deriveKeyId('COMMUNITY_REWARD', PK_A)).toBe('community-reward-e0e77a507412b120f6ede61f62295b1a');
    expect(deriveKeyId('TREASURE', PK_A)).toBe('promo-treasure-e0e77a507412b120f6ede61f62295b1a');
    expect(deriveKeyId('DISTRIBUTION', PK_A)).toBe('distribution-e0e77a507412b120f6ede61f62295b1a');
  });

  it('고정 벡터: 공개키 bb×32 — 키가 다르면 이름이 다르다(충돌 소멸의 근거)', () => {
    expect(deriveKeyId('MEMBERSHIP_ROOT', PK_B)).toBe('membership-root-4ca14526b2751b640d549ce7caf8ac39');
    expect(deriveKeyId('MEMBERSHIP_ROOT', PK_A)).not.toBe(deriveKeyId('MEMBERSHIP_ROOT', PK_B));
  });

  it('★해시 입력은 디코드한 32바이트다 — hex 문자열을 해시하면 다른 값이 나온다', () => {
    const bytesWay = sha256Hex(Uint8Array.from(Buffer.from(PK_A, 'hex'))).slice(0, KEY_ID_HASH_HEX_LEN);
    const stringWay = sha256Hex(PK_A).slice(0, KEY_ID_HASH_HEX_LEN);
    expect(bytesWay).not.toBe(stringWay); // 두 방식은 절대 같아지지 않는다
    expect(stringWay).toBe('ffe054fe7ae0cb6dc65c3af9b61d5209'); // 틀린 구현이 내는 값(대조용)
    expect(deriveKeyId('MEMBERSHIP_ROOT', PK_A)).toBe(`membership-root-${bytesWay}`);
  });

  it('★절단은 32 hex = 128비트다 (다표적 그라인딩에 여유를 남긴다)', () => {
    expect(KEY_ID_HASH_HEX_LEN).toBe(32);
    for (const [purpose, slug] of Object.entries(KEY_ID_SLUGS)) {
      const keyId = deriveKeyId(purpose, PK_A);
      expect(keyId.startsWith(`${slug}-`)).toBe(true);
      expect(keyId.slice(slug.length + 1)).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it('표기 규약 위반은 던진다 — 대문자 hex · 길이 불일치 · 모르는 용도', () => {
    expect(() => deriveKeyId('MEMBERSHIP_ROOT', PK_A.toUpperCase())).toThrow();
    expect(() => deriveKeyId('MEMBERSHIP_ROOT', 'aa')).toThrow();
    expect(() => deriveKeyId('WHATEVER', PK_A)).toThrow();
    expect(tryDeriveKeyId('WHATEVER', PK_A)).toBeNull();
    expect(tryDeriveKeyId('MEMBERSHIP_ROOT', 'aa')).toBeNull();
  });

  it('★코인을 발행할 수 있는 용도는 넷뿐이다 — 배포 서명 키는 발행 권위가 아니다', () => {
    expect([...ISSUER_KEY_PURPOSES]).toEqual(['ANGEL_BONUS', 'COMMUNITY_CLAIM', 'COMMUNITY_REWARD', 'TREASURE']);
    expect(isIssuerPurpose('DISTRIBUTION')).toBe(false);
    expect(isIssuerPurpose(ROOT_KEY_PURPOSE)).toBe(false);
    expect(isIssuerPurpose('ANGEL_BONUS')).toBe(true);
  });
});

describe('★I-3 관문 — 참칭한 이름은 못 들어오고, 옛 이름은 자기 이름으로 고쳐 적힌다', () => {
  const derivedA = { keyId: deriveKeyId('MEMBERSHIP_ROOT', PK_A), publicKey: PK_A, purpose: 'MEMBERSHIP_ROOT' };

  it('자기 공개키에서 유도된 이름은 그대로 통과한다', () => {
    expect(isSelfDerivedKeyId(derivedA)).toBe(true);
    expect(acceptKeyBindings([derivedA])).toEqual([derivedA]);
  });

  it('★사칭 차단: 남의 이름에 자기 공개키를 붙인 항목은 버린다', () => {
    const impostor = { keyId: deriveKeyId('MEMBERSHIP_ROOT', PK_A), publicKey: PK_B, purpose: 'MEMBERSHIP_ROOT' };
    expect(isSelfDerivedKeyId(impostor)).toBe(false);
    expect(acceptKeyBindings([impostor])).toEqual([]);
    // A의 이름은 그대로 남는다 — 먼저 오든 나중에 오든 A는 자기 자리에 들어간다.
    expect(acceptKeyBindings([impostor, derivedA])).toEqual([derivedA]);
  });

  it('용도를 바꿔 붙인 항목도 버린다 (이름은 용도까지 묶는다)', () => {
    const swapped = { ...derivedA, purpose: 'ANGEL_BONUS' };
    expect(acceptKeyBindings([swapped])).toEqual([]);
  });

  it('★옛 이름만 실린 목록도 살아 들어온다 — 유도 이름으로 고쳐 적는다', () => {
    // 업그레이드하지 않은 서버가 내려보내는 모양. 예전에는 통째로 버려서, 캐시가 빈
    // 지갑이 신뢰 루트를 하나도 얻지 못하고 코인을 한 개도 받지 못했다(적대검증 F2).
    const aliasOnly = { keyId: 'membership-root-2026', publicKey: PK_A, purpose: 'MEMBERSHIP_ROOT' };
    expect(acceptKeyBindings([aliasOnly])).toEqual([derivedA]);
  });

  it('옛 이름이라도 용도가 목록과 다르면 버린다', () => {
    expect(acceptKeyBindings([{ keyId: 'membership-root-2026', publicKey: PK_A, purpose: 'ANGEL_BONUS' }])).toEqual([]);
  });

  it('규격 밖 항목은 버린다 — 낯선 이름·모르는 용도·표기 위반', () => {
    expect(acceptKeyBindings([{ keyId: 'trust-me', publicKey: PK_A, purpose: 'MEMBERSHIP_ROOT' }])).toEqual([]);
    expect(acceptKeyBindings([{ keyId: 'x', publicKey: PK_A, purpose: 'SPOT_RESERVE' }])).toEqual([]);
    expect(acceptKeyBindings([{ keyId: derivedA.keyId, publicKey: 'zz', purpose: 'MEMBERSHIP_ROOT' }])).toEqual([]);
  });

  it('같은 공개키가 여러 이름으로 와도 슬롯은 하나다 (중복 제거)', () => {
    const aliasA = { keyId: 'membership-root-2026', publicKey: PK_A, purpose: 'MEMBERSHIP_ROOT' };
    expect(acceptKeyBindings([derivedA, aliasA])).toEqual([derivedA]);
    expect(acceptKeyBindings([aliasA, derivedA]).map((k) => k.keyId)).toEqual([derivedA.keyId]);
  });
});

describe('I-2 옛 이름 — 유통 중인 코인은 한 개도 무효가 되지 않는다', () => {
  const derivedA = deriveKeyId('MEMBERSHIP_ROOT', PK_A);
  const trustedA = { [derivedA]: PK_A };

  it('옛 이름을 단 증서는 그 증서가 들고 있는 공개키로 해소된다', () => {
    expect(isTrustedKeyBinding(trustedA, 'membership-root-2026', PK_A)).toBe(true);
    expect(isTrustedKeyBinding(trustedA, derivedA, PK_A)).toBe(true);
  });

  it('★옛 이름 슬롯을 남이 차지하고 있어도 원조의 옛 코인이 살아 있다 (선점 무력화)', () => {
    // 공격자가 목록에 'membership-root-2026' → 자기 공개키를 심어 둔 지갑.
    const poisoned = { ...trustedA, 'membership-root-2026': PK_B, [deriveKeyId('MEMBERSHIP_ROOT', PK_B)]: PK_B };
    expect(isTrustedKeyBinding(poisoned, 'membership-root-2026', PK_A)).toBe(true); // 원조 옛 증서
    expect(isTrustedKeyBinding(poisoned, 'membership-root-2026', PK_B)).toBe(true); // 공격자 것도 산다
    // 두 발행자의 옛 이름 코인이 한 지갑에서 동시에 유효할 수 있다 = 슬롯 다툼이 없다.
  });

  it('신뢰하지 않는 공개키는 옛 이름을 달아도 통과하지 못한다', () => {
    expect(isTrustedKeyBinding(trustedA, 'membership-root-2026', PK_B)).toBe(false);
    expect(isTrustedKeyBinding({}, 'membership-root-2026', PK_A)).toBe(false);
  });

  it('목록에 없는 이름은 옛 이름이 아니다 (예외의 크기는 여섯 개로 고정)', () => {
    expect(Object.keys(LEGACY_KEY_ID_ALIASES)).toHaveLength(6);
    expect(isTrustedKeyBinding(trustedA, 'membership-root-2027', PK_A)).toBe(false);
  });

  it('옛 이름은 용도까지 고정한다 — 루트 이름으로 발행 키 목록을 뚫을 수 없다', () => {
    const trustedIssuer = { [deriveKeyId('ANGEL_BONUS', PK_A)]: PK_A };
    expect(isTrustedKeyBinding(trustedIssuer, 'membership-root-2026', PK_A)).toBe(false);
    expect(isTrustedKeyBinding(trustedIssuer, 'promo-angel-2026', PK_A)).toBe(true);
  });

  it('빈 공개키·프로토타입 이름으로 통과하지 못한다', () => {
    expect(isTrustedKeyBinding(trustedA, derivedA, '')).toBe(false);
    expect(isTrustedKeyBinding(trustedA, '__proto__', PK_A)).toBe(false);
    expect(isTrustedKeyBinding(trustedA, 'constructor', PK_A)).toBe(false);
  });
});
