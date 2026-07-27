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

  /**
   * ★체크 문자는 32값(Crockford Base32 한 글자)이다. 따라서 **한 글자 오타를
   *  약 1/32 = 3.1 % 확률로 놓친다** — 이것은 구현 결함이 아니라 형식의 성질이다
   *  (serial.ts 주석: "체크 문자는 오타를 즉시 잡기 위한 것이지 위조 방어가 아니다").
   *
   *  이 성질 때문에 예전 판(무작위 코인 하나 + 첫 글자 뒤집기)은 3.1 % 확률로
   *  간헐 실패했다(실측). 그래서 두 가지로 나눈다:
   *   (1) **결정적 검사** — 체크 문자가 실제로 달라지는 오타를 골라 반드시 거부되는지.
   *   (2) **성질 검사** — 검출률을 실제로 재서 대역에 있는지 (숨기지 않고 못박는다).
   */
  it('오타(체크 문자 불일치)는 조용히 통과시키지 않는다', () => {
    const serial = coinSerial(mintCoinFor('m-alice', alice));
    const body = serial.replace(/-/g, '').slice(3, 3 + SERIAL_BODY_LENGTH);
    const check = serial.slice(-1);
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    // 체크 문자가 실제로 바뀌는 한 글자 오타를 하나 고른다 (반드시 존재한다).
    let typo: string | null = null;
    for (const ch of alphabet) {
      if (ch === body[0]) continue;
      const candidate = `SHV-${ch}${body.slice(1, 5)}-${body.slice(5, 10)}-${body.slice(10, 15)}-${check}`;
      if (normalizeSerial(candidate) === null) {
        typo = candidate;
        break;
      }
    }
    expect(typo).not.toBeNull();
    expect(normalizeSerial(typo!)).toBeNull();
  });

  it('★한 글자 오타 검출률을 실측해 못박는다 (체크 문자 32값 → 약 96.9 %)', () => {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let tried = 0;
    let caught = 0;
    for (let i = 0; i < 60; i++) {
      const serial = serialFromCoinId(`typo-probe-${i}`);
      const body = serial.replace(/-/g, '').slice(3, 3 + SERIAL_BODY_LENGTH);
      const check = serial.slice(-1);
      for (const pos of [0, 7, 14]) {
        const ch = alphabet[(alphabet.indexOf(body[pos]!) + 7) % 32]!;
        const b = body.slice(0, pos) + ch + body.slice(pos + 1);
        tried++;
        if (normalizeSerial(`SHV-${b.slice(0, 5)}-${b.slice(5, 10)}-${b.slice(10, 15)}-${check}`) === null) caught++;
      }
    }
    const rate = caught / tried;
    // 이론 31/32 = 96.875 %. 표본 180개라 오차 대역을 넉넉히 잡는다.
    expect(rate).toBeGreaterThan(0.9);
    expect(rate).toBeLessThanOrEqual(1);
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
