import { describe, expect, it } from 'vitest';
import { generateKeyPair, signerFromKeyPair, type Signer } from '../crypto';
import { PendingWalkLedger } from '../ledger';
import { buildWalkSegmentProof } from '../proof';
import { acknowledgeTransfer, createTransfer, mintWalkCoin, splitCoin } from '../coin';
import { coinFingerprint, forkSuspectAddress } from '../fingerprint';
import { addressFromPublicKey } from '../crypto';
import type { Coin } from '../types';
import { T0, walkKm } from './helpers';

const alice = signerFromKeyPair(generateKeyPair());
const bob = signerFromKeyPair(generateKeyPair());
const carol = signerFromKeyPair(generateKeyPair());

function mintFor(memberId: string, signer: Signer, km = 10): Coin {
  const ledger = new PendingWalkLedger({ memberId });
  const end = walkKm(ledger, km);
  return mintWalkCoin(buildWalkSegmentProof(ledger.settleOnSpend(end)!, signer));
}

function transferTo(coin: Coin, from: Signer, to: Signer): Coin {
  return acknowledgeTransfer(createTransfer(coin, from, to.publicKeyHex, T0 + 1000), to);
}

describe('코인 지문 (보안 감사 H-1)', () => {
  it('지문은 계보 요약뿐 — 좌표류 필드가 없다', () => {
    const fp = coinFingerprint(mintFor('m-a', alice));
    expect(JSON.stringify(fp)).not.toMatch(/lat|lon|coord|geo|track|route/i);
    expect(fp.rootKind).toBe('WALK');
    expect(fp.chainLen).toBe(0);
    expect(fp.producerMemberId).toBe('m-a');
    expect(fp.dailyBreakdown).not.toBeNull();
  });

  it('분할 형제는 같은 proofHash를 공유한다 (서버 dedup 키)', () => {
    const coin = mintFor('m-a', alice); // 100 dSHV
    const [x, y] = splitCoin(coin, alice, [60, 40], T0);
    expect(coinFingerprint(x!).proofHash).toBe(coinFingerprint(y!).proofHash);
    expect(coinFingerprint(x!).coinId).not.toBe(coinFingerprint(y!).coinId);
  });

  it('오프라인 분기: 같은 코인을 두 수령자에게 이전하면 분기점 지불자가 식별된다', () => {
    const coin = mintFor('m-a', alice);
    const toBob = transferTo(coin, alice, bob);
    const toCarol = transferTo(coin, alice, carol);

    const suspect = forkSuspectAddress(coinFingerprint(toBob), coinFingerprint(toCarol));
    expect(suspect).toBe(addressFromPublicKey(alice.publicKeyHex));
  });

  it('정상 이전 연쇄는 분기가 아니다 (체인 길이가 다름)', () => {
    const coin = mintFor('m-a', alice);
    const atBob = transferTo(coin, alice, bob);
    const atCarol = transferTo(atBob, bob, carol);
    expect(forkSuspectAddress(coinFingerprint(atBob), coinFingerprint(atCarol))).toBeNull();
  });

  it('동일 지문끼리는 분기가 아니다', () => {
    const coin = mintFor('m-a', alice);
    const atBob = transferTo(coin, alice, bob);
    expect(forkSuspectAddress(coinFingerprint(atBob), coinFingerprint(atBob))).toBeNull();
  });
});
