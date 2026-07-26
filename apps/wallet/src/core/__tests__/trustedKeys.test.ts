/**
 * 신뢰 키 캐시 누적 + 유도식 검산 (2026-07-26).
 *
 * (가) 캐시 누적 — 키를 한 번 회전하면 옛 코인이 전부 죽던 버그. 지갑이 서버 응답으로
 *      캐시를 통째 덮어써서, 회전 순간 보유 중인 옛 WALK 코인이 전부
 *      `UNKNOWN_MEMBERSHIP_ROOT`가 되었다. 키 회전은 유출 사건이 아니다.
 * (나) ★이름 정규화 — 옛 이름이 하드코딩이라 모든 배포가 같은 이름을 썼고, 제2
 *      발행자가 나오면 슬롯 충돌로 한쪽 코인이 전량 무효가 되었다. 들어오는 목록의
 *      이름을 공개키에서 다시 유도해 적는다(규격 9.2 I-1·I-3).
 */
import { describe, expect, it } from 'vitest';
import { deriveKeyId } from '@shvil/shared';
import { foldTrustedKeys, mergeTrustedKeyInfos, type KeyInfoLike } from '../trustedKeys';

const PK_ROOT_A = 'aa'.repeat(32);
const PK_ROOT_A2 = 'bb'.repeat(32); // A가 회전한 새 루트
const PK_PROMO_A = 'cc'.repeat(32);
const PK_ROOT_B = 'dd'.repeat(32); // 제2 발행자

const key = (purpose: string, publicKey: string): KeyInfoLike => ({
  keyId: deriveKeyId(purpose, publicKey),
  publicKey,
  purpose,
});

const rootA = key('MEMBERSHIP_ROOT', PK_ROOT_A);
const rootA2 = key('MEMBERSHIP_ROOT', PK_ROOT_A2);
const promoA = key('ANGEL_BONUS', PK_PROMO_A);
const rootB = key('MEMBERSHIP_ROOT', PK_ROOT_B);

describe('신뢰 키 캐시 누적 — 옛 코인을 죽이지 않는 회전', () => {
  it('★루트를 회전해도 옛 루트가 캐시에 남는다 (예전에는 사라졌다)', () => {
    const merged = mergeTrustedKeyInfos([rootA, promoA], [rootA2, promoA]);
    expect(merged.map((k) => k.keyId)).toEqual([rootA.keyId, promoA.keyId, rootA2.keyId]);
  });

  it('새 keyId는 더해진다 — 회전은 새 키 재료 = 새 유도 이름으로 온다', () => {
    expect(mergeTrustedKeyInfos([], [rootA]).map((k) => k.keyId)).toEqual([rootA.keyId]);
  });

  it('★아는 keyId의 공개키는 절대 바뀌지 않는다 (바꿔치기 차단)', () => {
    const substituted: KeyInfoLike = { ...rootA, publicKey: 'ff'.repeat(32) };
    const merged = mergeTrustedKeyInfos([rootA], [substituted]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.publicKey).toBe(rootA.publicKey); // 첫 응답이 기준
  });

  it('서버가 목록에서 뺀 키도 캐시에서 지우지 않는다 — 유통 중인 옛 코인이 죽는다', () => {
    const merged = mergeTrustedKeyInfos([rootA, promoA], [rootA2]);
    expect(merged.map((k) => k.keyId)).toContain(rootA.keyId);
    expect(merged.map((k) => k.keyId)).toContain(promoA.keyId);
  });

  it('회전을 여러 번 해도 이력이 계속 쌓인다', () => {
    const rootA3 = key('MEMBERSHIP_ROOT', 'ee'.repeat(32));
    let cache = mergeTrustedKeyInfos([], [rootA]);
    cache = mergeTrustedKeyInfos(cache, [rootA2]);
    cache = mergeTrustedKeyInfos(cache, [rootA3]);
    expect(cache).toHaveLength(3);
  });

  it('오염된 캐시(중복·형식 불량)는 조용히 정리한다 — 앱이 죽지 않는다', () => {
    const dirty = [rootA, rootA, { keyId: 'x' } as unknown as KeyInfoLike, null as unknown as KeyInfoLike];
    expect(mergeTrustedKeyInfos(dirty, [rootA2]).map((k) => k.keyId)).toEqual([rootA.keyId, rootA2.keyId]);
  });
});

describe('★관문 — 참칭한 항목은 캐시에 닿지 못한다 (규격 I-3)', () => {
  const impostor: KeyInfoLike = { keyId: rootA.keyId, publicKey: PK_ROOT_B, purpose: 'MEMBERSHIP_ROOT' };

  it('남의 유도 이름에 자기 공개키를 붙인 항목은 버려진다', () => {
    expect(mergeTrustedKeyInfos([], [impostor])).toEqual([]);
  });

  it('★선점 시나리오: 공격자가 먼저 도달해도 A의 슬롯을 가져가지 못한다', () => {
    // 예전 병: 먼저 만난 쪽이 슬롯을 영구히 차지했다(재병합 10회에도 뒤집히지 않았다).
    // 이제는 이름이 공개키에 묶여 있어 공격자가 A의 이름을 주장할 수 없고,
    // A는 나중에 와도 자기 자리에 들어간다.
    let cache = mergeTrustedKeyInfos([], [impostor]);
    expect(cache).toEqual([]);
    cache = mergeTrustedKeyInfos(cache, [rootA]);
    expect(foldTrustedKeys(cache, true)[rootA.keyId]).toBe(PK_ROOT_A);
  });

  it('아무 문자열 이름은 들어오지 못한다 (fail-closed)', () => {
    const bogus: KeyInfoLike = { keyId: 'trust-me-2026', publicKey: PK_ROOT_B, purpose: 'MEMBERSHIP_ROOT' };
    expect(mergeTrustedKeyInfos([], [bogus])).toEqual([]);
  });

  it('검산에 걸려도 기존 캐시는 그대로다 — 앱은 계속 동작한다', () => {
    const bogus: KeyInfoLike = { keyId: 'trust-me-2026', publicKey: PK_ROOT_B, purpose: 'MEMBERSHIP_ROOT' };
    expect(mergeTrustedKeyInfos([rootA], [bogus]).map((k) => k.keyId)).toEqual([rootA.keyId]);
  });
});

describe('★옛 이름 — 유통 중인 코인은 한 개도 무효가 되지 않는다 (규격 I-2)', () => {
  const aliasA: KeyInfoLike = { keyId: 'membership-root-2026', publicKey: PK_ROOT_A, purpose: 'MEMBERSHIP_ROOT' };
  const aliasB: KeyInfoLike = { keyId: 'membership-root-2026', publicKey: PK_ROOT_B, purpose: 'MEMBERSHIP_ROOT' };

  it('업그레이드 경로: 옛 이름만 들어 있던 캐시를 고쳐 쓰지 않는다', () => {
    // 앱 업데이트 직후의 캐시 = 유도 이름을 배운 적이 없는 상태. 여기서 캐시를 청소하면
    // 그 순간 보유 중인 옛 코인이 전부 죽는다. 관문은 "새로 들어오는 것"에만 세운다.
    const merged = mergeTrustedKeyInfos([aliasA], [rootA]);
    expect(merged.map((k) => k.keyId)).toEqual(['membership-root-2026', rootA.keyId]);
    // 옛 증서(옛 이름)와 새 증서(유도 이름)가 한 지갑에서 둘 다 검증된다.
    const roots = foldTrustedKeys(merged, true);
    expect(roots['membership-root-2026']).toBe(PK_ROOT_A);
    expect(roots[rootA.keyId]).toBe(PK_ROOT_A);
  });

  it('★옛 이름만 실린 목록도 살아 들어온다 — 유도 이름으로 고쳐 적힌다', () => {
    // 업그레이드하지 않은 서버가 내려보내는 모양. 예전에는 통째로 버려서, 캐시가 빈
    // 지갑이 신뢰 루트를 하나도 얻지 못해 코인을 한 개도 받지 못했다(적대검증 F2).
    // 옛 이름을 그대로 캐시에 넣지 않는 이유: 그 칸은 모든 배포가 같이 쓰던 칸이라,
    // 넣는 순간 다시 선착순 다툼이 된다. 옛 코인은 검증 시점에 공개키로 해소된다.
    expect(mergeTrustedKeyInfos([], [aliasA]).map((k) => k.keyId)).toEqual([rootA.keyId]);
    expect(mergeTrustedKeyInfos([], [aliasB]).map((k) => k.keyId)).toEqual([rootB.keyId]);
  });

  it('같은 키가 두 이름으로 와도 캐시에는 한 칸만 쓴다', () => {
    expect(mergeTrustedKeyInfos([], [rootA, aliasA]).map((k) => k.keyId)).toEqual([rootA.keyId]);
  });

  it('★이미 옛 이름을 아는 지갑에 제2 발행자가 그 이름을 주장해도 바뀌지 않는다', () => {
    const merged = mergeTrustedKeyInfos([aliasA], [rootB, aliasB]);
    const roots = foldTrustedKeys(merged, true);
    expect(roots['membership-root-2026']).toBe(PK_ROOT_A); // 원조 유지
    expect(roots[rootB.keyId]).toBe(PK_ROOT_B); // B는 자기 자리에만 들어간다
  });
});

describe('검증 함수에 넘길 모양으로 접기 (verifyCoin 자료구조는 바뀌지 않았다)', () => {
  it('MEMBERSHIP_ROOT와 발행 키를 갈라 담는다', () => {
    const infos = [rootA, promoA, rootB];
    expect(foldTrustedKeys(infos, true)).toEqual({ [rootA.keyId]: PK_ROOT_A, [rootB.keyId]: PK_ROOT_B });
    expect(foldTrustedKeys(infos, false)).toEqual({ [promoA.keyId]: PK_PROMO_A });
  });

  it('★배포 서명 키(DISTRIBUTION)는 코인 발행 권위가 아니다 — 어느 목록에도 없다', () => {
    // 예전에는 "MEMBERSHIP_ROOT가 아니면 전부 발행 키"였다. 그래서 응답에 _sig를 붙이는
    // 배포 키로 서명한 GRANT 코인이 지갑에서는 유효하고 서버에서는 무효였다(실측 재현).
    const dist = key('DISTRIBUTION', 'ff'.repeat(32));
    const infos = [rootA, promoA, dist];
    expect(foldTrustedKeys(infos, false)).toEqual({ [promoA.keyId]: PK_PROMO_A });
    expect(foldTrustedKeys(infos, true)).toEqual({ [rootA.keyId]: PK_ROOT_A });
  });

  it('규격에 없는 용도는 어느 목록에도 들어가지 않는다 (fail-closed)', () => {
    const unknown: KeyInfoLike = { keyId: 'spot-reserve-1', publicKey: 'ee'.repeat(32), purpose: 'SPOT_RESERVE' };
    expect(foldTrustedKeys([unknown], false)).toEqual({});
    expect(foldTrustedKeys([unknown], true)).toEqual({});
  });
});
