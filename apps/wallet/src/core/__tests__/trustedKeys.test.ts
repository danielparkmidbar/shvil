/**
 * 신뢰 키 캐시 누적 (2026-07-26) — 키를 한 번 회전하면 옛 코인이 전부 죽던 버그.
 *
 * 서버 `/keys`는 **현행 키만** 내려보낸다(이력 목록이 없다). 지갑이 그 응답으로 캐시를
 * 통째 덮어쓰고 있었으므로, `membership-root-2026` → `membership-root-2027` 회전 순간
 * 보유 중인 모든 옛 WALK 코인이 `UNKNOWN_MEMBERSHIP_ROOT`가 되었다.
 * 키 회전은 유출 사건이 아니다 — 옛 키가 서명한 옛 증서는 여전히 정직하다.
 */
import { describe, expect, it } from 'vitest';
import { mergeTrustedKeyInfos, type KeyInfoLike } from '../trustedKeys';

const root2026: KeyInfoLike = { keyId: 'membership-root-2026', publicKey: 'aa'.repeat(32), purpose: 'MEMBERSHIP_ROOT' };
const root2027: KeyInfoLike = { keyId: 'membership-root-2027', publicKey: 'bb'.repeat(32), purpose: 'MEMBERSHIP_ROOT' };
const promo2026: KeyInfoLike = { keyId: 'promo-angel-2026', publicKey: 'cc'.repeat(32), purpose: 'ANGEL_BONUS' };

describe('신뢰 키 캐시 누적 — 옛 코인을 죽이지 않는 회전', () => {
  it('★루트를 회전해도 옛 루트가 캐시에 남는다 (예전에는 사라졌다)', () => {
    const merged = mergeTrustedKeyInfos([root2026, promo2026], [root2027, promo2026]);
    expect(merged.map((k) => k.keyId)).toEqual([
      'membership-root-2026',
      'promo-angel-2026',
      'membership-root-2027',
    ]);
  });

  it('새 keyId는 더해진다 — 회전은 새 ID로 오므로 더하기만으로 동작한다', () => {
    expect(mergeTrustedKeyInfos([], [root2026]).map((k) => k.keyId)).toEqual(['membership-root-2026']);
  });

  it('★아는 keyId의 공개키는 절대 바뀌지 않는다 (바꿔치기 차단)', () => {
    const substituted: KeyInfoLike = { ...root2026, publicKey: 'ff'.repeat(32) };
    const merged = mergeTrustedKeyInfos([root2026], [substituted]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.publicKey).toBe(root2026.publicKey); // 첫 응답이 기준
  });

  it('서버가 목록에서 뺀 키도 캐시에서 지우지 않는다 — 유통 중인 옛 코인이 죽는다', () => {
    const merged = mergeTrustedKeyInfos([root2026, promo2026], [root2027]);
    expect(merged.map((k) => k.keyId)).toContain('membership-root-2026');
    expect(merged.map((k) => k.keyId)).toContain('promo-angel-2026');
  });

  it('회전을 여러 번 해도 이력이 계속 쌓인다 (2026 → 2027 → 2028)', () => {
    const root2028: KeyInfoLike = { ...root2027, keyId: 'membership-root-2028', publicKey: 'dd'.repeat(32) };
    let cache = mergeTrustedKeyInfos([], [root2026]);
    cache = mergeTrustedKeyInfos(cache, [root2027]);
    cache = mergeTrustedKeyInfos(cache, [root2028]);
    expect(cache).toHaveLength(3);
  });

  it('오염된 캐시(중복·형식 불량)는 조용히 정리한다 — 앱이 죽지 않는다', () => {
    const dirty = [root2026, root2026, { keyId: 'x' } as unknown as KeyInfoLike, null as unknown as KeyInfoLike];
    expect(mergeTrustedKeyInfos(dirty, [root2027]).map((k) => k.keyId)).toEqual([
      'membership-root-2026',
      'membership-root-2027',
    ]);
  });
});
