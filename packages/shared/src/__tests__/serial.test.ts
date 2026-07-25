/**
 * 코인 일련번호 (M16) — 다니엘 쌤: "화폐에 일련 번호가 있듯 코인에도 일련 번호가 있다."
 *
 * ★핵심 불변식: 일련번호는 계보에서 유도된다. 계보를 조금이라도 고치면 번호가 바뀐다 —
 * 번호 자체가 무결성 검사다.
 */
import { describe, expect, it } from 'vitest';
import { generateKeyPair, signerFromKeyPair, type Signer } from '../crypto';
import { PendingWalkLedger } from '../ledger';
import { buildWalkSegmentProof } from '../proof';
import { mintWalkCoin, splitCoin } from '../coin';
import { coinSerial, normalizeSerial, serialFromCoinId, serialMatchesCoin, SERIAL_BODY_LENGTH } from '../serial';
import type { Coin } from '../types';
import { walkKm } from './helpers';

const alice = signerFromKeyPair(generateKeyPair());

function mintCoinFor(memberId: string, signer: Signer, km = 17.3): Coin {
  const ledger = new PendingWalkLedger({ memberId });
  const end = walkKm(ledger, km);
  const draft = ledger.settleOnSpend(end)!;
  return mintWalkCoin(buildWalkSegmentProof(draft, signer));
}

describe('일련번호 형식', () => {
  it('SHV-XXXXX-XXXXX-XXXXX-C 형식이다', () => {
    const coin = mintCoinFor('m-alice', alice);
    expect(coinSerial(coin)).toMatch(/^SHV-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]$/);
  });

  it('혼동 문자 I·L·O·U가 절대 나오지 않는다 (손으로 옮겨 적기)', () => {
    for (let i = 0; i < 200; i++) {
      const serial = serialFromCoinId(`coin-${i}`);
      expect(serial.slice(4)).not.toMatch(/[ILOU]/);
    }
  });

  it('같은 코인은 언제나 같은 번호다 (결정적)', () => {
    const coin = mintCoinFor('m-alice', alice);
    expect(coinSerial(coin)).toBe(coinSerial(coin));
    expect(coinSerial(coin)).toBe(serialFromCoinId(coin.id));
  });

  it('★계보가 다르면 번호가 다르다 — 번호 자체가 무결성 검사다', () => {
    const a = mintCoinFor('m-alice', alice, 10);
    const b = mintCoinFor('m-alice', alice, 10.1);
    expect(coinSerial(a)).not.toBe(coinSerial(b));
    // ID를 한 글자만 바꿔도 번호 전체가 달라진다.
    expect(serialFromCoinId(a.id)).not.toBe(serialFromCoinId(a.id.slice(0, -1) + (a.id.endsWith('0') ? '1' : '0')));
  });

  it('분할 자식들은 각자 다른 번호를 가진다', () => {
    const coin = mintCoinFor('m-alice', alice, 20);
    const children = splitCoin(coin, alice, [100, coin.amountDshv - 100], Date.now());
    const serials = new Set(children.map(coinSerial));
    expect(serials.size).toBe(children.length);
    expect(serials.has(coinSerial(coin))).toBe(false);
  });
});

describe('normalizeSerial — 손으로 옮겨 적은 입력', () => {
  it('소문자·공백·하이픈 생략을 흡수한다', () => {
    const coin = mintCoinFor('m-alice', alice);
    const serial = coinSerial(coin);
    expect(normalizeSerial(serial.toLowerCase())).toBe(serial);
    expect(normalizeSerial(serial.replace(/-/g, ' '))).toBe(serial);
    expect(normalizeSerial(serial.replace(/-/g, ''))).toBe(serial);
  });

  it('혼동 문자 오기(1↔I·l, 0↔O)를 되돌린다', () => {
    const coin = mintCoinFor('m-alice', alice);
    const serial = coinSerial(coin);
    const confused = serial.replace(/1/g, 'I').replace(/0/g, 'O');
    expect(normalizeSerial(confused)).toBe(serial);
  });

  it('오타(체크 문자 불일치)는 조용히 통과시키지 않는다', () => {
    const coin = mintCoinFor('m-alice', alice);
    const serial = coinSerial(coin);
    // 본문 한 글자를 다른 유효 문자로 바꾼다.
    const body = serial.replace(/-/g, '').slice(3, 3 + SERIAL_BODY_LENGTH);
    const flip = body[0] === 'A' ? 'B' : 'A';
    const typo = `SHV-${flip}${body.slice(1, 5)}-${body.slice(5, 10)}-${body.slice(10, 15)}-${serial.slice(-1)}`;
    expect(normalizeSerial(typo)).toBeNull();
  });

  it('길이가 다르면 null', () => {
    expect(normalizeSerial('SHV-ABC')).toBeNull();
    expect(normalizeSerial('')).toBeNull();
  });

  it('serialMatchesCoin: 정확한 번호만 참', () => {
    const a = mintCoinFor('m-alice', alice, 10);
    const b = mintCoinFor('m-alice', alice, 11);
    expect(serialMatchesCoin(coinSerial(a), a)).toBe(true);
    expect(serialMatchesCoin(coinSerial(a).toLowerCase(), a)).toBe(true);
    expect(serialMatchesCoin(coinSerial(b), a)).toBe(false);
    expect(serialMatchesCoin('garbage', a)).toBe(false);
  });
});
