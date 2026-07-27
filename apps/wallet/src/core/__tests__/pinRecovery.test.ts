/**
 * ★배포 키 변경 복구 경로 — 벽돌이 되지 않되, 자동으로 풀리지도 않는다.
 *
 * 두 실패 방식을 함께 막아야 한다:
 *  · 영구 벽돌 — 서버를 정당하게 재배포하면 이미 설치된 폰이 재설치 전까지 갱신 불가.
 *  · MITM 통로 — 아무 키로나 서명해 보내면 지갑이 그 키를 새 진실로 받아들이는 것.
 * 해법은 "거부는 유지하되 사람에게 보여 준다"이며, 이 파일이 그 경계를 못박는다.
 */
import { describe, expect, it } from 'vitest';
import { deriveKeyId, generateKeyPair, signDistribution, signerFromKeyPair } from '@shvil/shared';
import { DistributionPinMismatchError, guardDistribution } from '../distributionGuard';
import {
  buildPinChangeNotice,
  keyFingerprint,
  mergePendingPinChange,
  parsePendingPinChange,
} from '../pinRecovery';

const oldDist = signerFromKeyPair(generateKeyPair());
const newDist = signerFromKeyPair(generateKeyPair());
const rogue = signerFromKeyPair(generateKeyPair());
const T0 = Date.parse('2026-07-27T00:00:00Z');
const T1 = Date.parse('2026-08-02T00:00:00Z');

/** 이름을 주지 않으면 **정직한 서버**처럼 자기 공개키에서 유도한 이름을 싣는다. */
function courses(signer: typeof oldDist, keyId = deriveKeyId('DISTRIBUTION', signer.publicKeyHex)) {
  return signDistribution({ courses: [] }, signer, keyId, T0);
}

describe('가드 — 거부는 그대로, 재료만 들려 보낸다', () => {
  it('핀 불일치는 여전히 던진다 (갱신 거부가 기본값이다)', () => {
    expect(() => guardDistribution(courses(newDist), oldDist.publicKeyHex)).toThrow(/KEY_PIN_MISMATCH/);
  });

  it('★서명이 성립하는 새 키는 사람에게 물을 후보로 실려 나온다', () => {
    try {
      guardDistribution(courses(newDist), oldDist.publicKeyHex);
      expect.unreachable('던져야 한다');
    } catch (e) {
      expect(e).toBeInstanceOf(DistributionPinMismatchError);
      const err = e as DistributionPinMismatchError;
      expect(err.candidate).not.toBeNull();
      expect(err.candidate!.newPublicKey).toBe(newDist.publicKeyHex);
      expect(err.candidate!.newKeyId).toBe(deriveKeyId('DISTRIBUTION', newDist.publicKeyHex));
      expect(err.candidate!.nameVerified).toBe(true);
    }
  });

  it('★★서버가 주장하는 이름은 후보에 실리지 않는다 — 지갑이 직접 유도한다 (적대검증 ①-b)', () => {
    // 중간자는 진짜 서버의 응답을 볼 수 있으므로 그 이름을 그대로 베낀다.
    const 진짜이름 = deriveKeyId('DISTRIBUTION', oldDist.publicKeyHex);
    try {
      guardDistribution(courses(rogue, 진짜이름), oldDist.publicKeyHex);
      expect.unreachable('던져야 한다');
    } catch (e) {
      const c = (e as DistributionPinMismatchError).candidate!;
      // 예전에는 여기에 `진짜이름`이 실려 화면의 대조를 통과시켰다.
      expect(c.newKeyId).not.toBe(진짜이름);
      expect(c.newKeyId).toBe(deriveKeyId('DISTRIBUTION', rogue.publicKeyHex));
      // 그리고 "이름이 열쇠와 맞지 않는다"는 사실이 함께 실린다 → 수락 단추가 내려간다.
      expect(c.nameVerified).toBe(false);
    }
  });

  it('★본문이 변조된 응답은 후보가 되지 않는다 (물을 값어치가 없다)', () => {
    const res = courses(rogue);
    const tampered = { ...res, courses: [{ courseId: 'evil' }] } as unknown as typeof res;
    try {
      guardDistribution(tampered, oldDist.publicKeyHex);
      expect.unreachable('던져야 한다');
    } catch (e) {
      expect((e as DistributionPinMismatchError).candidate).toBeNull();
    }
  });

  it('가드는 스스로 핀을 바꾸지 않는다 — pinToStore는 핀이 있으면 언제나 null', () => {
    expect(guardDistribution(courses(oldDist), oldDist.publicKeyHex).pinToStore).toBeNull();
    // 핀이 없을 때만(최초 수신) 저장할 값을 돌려준다 = TOFU.
    expect(guardDistribution(courses(oldDist), null).pinToStore).toBe(oldDist.publicKeyHex);
  });
});

describe('후보 누적 — 사람이 판단할 수 있는 형태로', () => {
  const candidate = {
    newPublicKey: newDist.publicKeyHex,
    newKeyId: deriveKeyId('DISTRIBUTION', newDist.publicKeyHex),
    nameVerified: true,
    signedAt: T0,
  };

  it('같은 키를 또 보면 횟수만 오른다 (계속되는 상태인지 알 수 있게)', () => {
    const first = mergePendingPinChange(null, candidate, T0);
    expect(first.seenCount).toBe(1);
    const second = mergePendingPinChange(first, candidate, T1);
    expect(second.seenCount).toBe(2);
    expect(second.firstSeenAt).toBe(T0);
    expect(second.lastSeenAt).toBe(T1);
  });

  it('★볼 때마다 키가 다르면 횟수가 1로 되돌아간다 (정상 갱신이 아니라는 신호)', () => {
    const first = mergePendingPinChange(null, candidate, T0);
    const other = mergePendingPinChange(
      first,
      {
        newPublicKey: rogue.publicKeyHex,
        newKeyId: deriveKeyId('DISTRIBUTION', rogue.publicKeyHex),
        nameVerified: true,
        signedAt: T1,
      },
      T1,
    );
    expect(other.seenCount).toBe(1);
    expect(other.newPublicKey).toBe(rogue.publicKeyHex);
  });

  it('깨진 저장값은 무시한다 (앱이 죽지 않는다)', () => {
    expect(parsePendingPinChange(null)).toBeNull();
    expect(parsePendingPinChange('{')).toBeNull();
    expect(parsePendingPinChange('{"newPublicKey":"짧다"}')).toBeNull();
    const ok = parsePendingPinChange(JSON.stringify(mergePendingPinChange(null, candidate, T0)));
    expect(ok!.newPublicKey).toBe(newDist.publicKeyHex);
  });
});

describe('화면에 보여줄 것 — 정직하게', () => {
  it('지문은 사람이 대조할 수 있는 짧은 형태다 (판정에는 쓰이지 않는다)', () => {
    const fp = keyFingerprint('0123456789abcdef' + 'f'.repeat(48));
    expect(fp).toBe('0123 4567 89AB CDEF');
    expect(keyFingerprint(null)).toBe('(없음)');
    expect(keyFingerprint('짧음')).toBe('(없음)');
  });

  const 정직한후보 = {
    newPublicKey: newDist.publicKeyHex,
    newKeyId: deriveKeyId('DISTRIBUTION', newDist.publicKeyHex),
    nameVerified: true,
    signedAt: T1,
  };

  it('★알림에 옛 지문·새 지문·핀한 날·본 횟수가 모두 들어간다', () => {
    const pending = mergePendingPinChange(null, 정직한후보, T1);
    const notice = buildPinChangeNotice({
      pinnedPublicKey: oldDist.publicKeyHex,
      pinnedAt: T0,
      pending,
    });
    expect(notice.pinnedFingerprint).toBe(keyFingerprint(oldDist.publicKeyHex));
    expect(notice.newFingerprint).toBe(keyFingerprint(newDist.publicKeyHex));
    expect(notice.pinnedAtText).toBe('2026년 7월 27일');
    expect(notice.seenCount).toBe(1);
    expect(notice.newKeyId).toBe(deriveKeyId('DISTRIBUTION', newDist.publicKeyHex));
    expect(notice.acceptable).toBe(true);
  });

  it('★문구가 "공격일 수도, 정상 갱신일 수도"를 숨기지 않는다', () => {
    const notice = buildPinChangeNotice({
      pinnedPublicKey: oldDist.publicKeyHex,
      pinnedAt: null,
      pending: mergePendingPinChange(null, 정직한후보, T1),
    });
    const all = notice.lines.join(' ');
    expect(all).toMatch(/가짜 서버/);
    expect(all).toMatch(/구별할 수 없습니다/);
    // ★0층이 산다는 사실도 반드시 화면에 있어야 한다 — 사용자가 겁먹고 앱을 지우면
    //   그것이 곧 코인 소실이다(백업이 401로 막히는 상황에서는 더욱).
    expect(all).toMatch(/걷기·정산·지불·수령은 그대로 됩니다/);
    // 핀 시각을 모르는 옛 지갑에서도 화면이 성립한다.
    expect(notice.pinnedAtText).toBeNull();
  });

  it('★★"횟수가 늘면 진짜일 가능성이 크다"는 조언을 하지 않는다 (적대검증 ①-d)', () => {
    const notice = buildPinChangeNotice({
      pinnedPublicKey: oldDist.publicKeyHex,
      pinnedAt: T0,
      pending: { ...정직한후보, firstSeenAt: T0, lastSeenAt: T1, seenCount: 12 },
    });
    const all = notice.lines.join(' ');
    // 지속 MITM은 "횟수가 늘고 지문이 같은" 모양 그대로다 — 그 조언은 공격자 편이었다.
    expect(all).not.toMatch(/가능성이 큽니다/);
    expect(all).toMatch(/몇 번 봤는지는 진짜인지와 아무 상관이 없습니다/);
    // 대역 밖 확인을 요구한다 — 같은 인터넷으로 받은 값은 근거가 아니다.
    expect(all).toMatch(/전화하거나 직접 만나서/);
  });

  it('★★이름이 열쇠와 맞지 않으면 수락 자체를 제안하지 않는다 (적대검증 ①-b)', () => {
    const notice = buildPinChangeNotice({
      pinnedPublicKey: oldDist.publicKeyHex,
      pinnedAt: T0,
      pending: mergePendingPinChange(null, { ...정직한후보, nameVerified: false }, T1),
    });
    expect(notice.acceptable).toBe(false);
    expect(notice.lines.join(' ')).toMatch(/자기 열쇠와 맞지 않는 이름/);
  });

  it('옛 버전이 적어 둔 후보(검산 정보 없음)는 수락 대상이 아니다', () => {
    const 옛항목 = JSON.stringify({
      newPublicKey: newDist.publicKeyHex,
      newKeyId: 'distribution-옛',
      signedAt: T1,
      firstSeenAt: T1,
      lastSeenAt: T1,
      seenCount: 3,
    });
    expect(parsePendingPinChange(옛항목)!.nameVerified).toBe(false);
  });
});
