/**
 * 코인 일련번호 (M16) — 다니엘 쌤 2026-07-26:
 * **"화폐에 일련 번호가 있듯 코인에도 일련 번호가 있다."**
 *
 * ★설계의 핵심: 일련번호는 **새 필드가 아니다.** coin.id(계보 해시)에서 유도되는
 * 표시 형식일 뿐이다. 코인 구조에 번호를 넣으면 그 번호는 위조자가 고쳐 쓸 수 있고,
 * 기존 코인이 전부 깨진다. 유도값이면 **계보가 바뀌는 순간 번호도 바뀐다** —
 * 번호 자체가 무결성 검사다.
 *
 * 형식: `SHV-XXXXX-XXXXX-XXXXX-C` (Crockford Base32 15자 + 체크 1자)
 *  - Crockford 알파벳은 I·L·O·U를 뺀다 — 손으로 옮겨 적을 때의 혼동(1/I/l, 0/O)을 없앤다.
 *  - 입력 정규화가 I→1, L→1, O→0, 소문자→대문자, 하이픈·공백 제거를 해 준다.
 *  - 75비트: 10억 코인에서 충돌 확률 ~1e-4 수준.
 *
 * 체크 문자는 오타를 즉시 잡기 위한 것이지 위조 방어가 아니다. 진위 판정은
 * authenticity.ts가 코인 전체를 보고 한다.
 */
import { sha256Hex } from './crypto';
import type { Coin } from './types';

/** Crockford Base32 — I, L, O, U 제외 (혼동·비속어 회피). */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 일련번호 본문 길이 (체크 문자 제외). 15자 × 5비트 = 75비트. */
export const SERIAL_BODY_LENGTH = 15;

export const SERIAL_PREFIX = 'SHV';

/** 16진 해시 → Crockford Base32 문자열 (앞에서부터 5비트씩). */
function hexToCrockford(hex: string, chars: number): string {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const ch of hex) {
    acc = (acc << 4) | parseInt(ch, 16);
    bits += 4;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(acc >> bits) & 31];
      if (out.length === chars) return out;
    }
    acc &= (1 << bits) - 1;
  }
  return out.padEnd(chars, '0');
}

/**
 * 체크 문자 — 본문과 다른 도메인의 해시에서 뽑는다.
 * 본문 자체의 재해시가 아니라 도메인 분리 문자열을 쓰는 이유: 본문만 보고 체크 문자를
 * 만들어 붙이는 것을 어렵게 하려는 게 아니라(그건 불가능하다 — 알고리즘은 공개다),
 * 본문 유도와 체크 유도가 우연히 상관되지 않게 하기 위해서다.
 */
function checkChar(body: string): string {
  const h = sha256Hex(`shvil-serial-check|${body}`);
  return ALPHABET[parseInt(h.slice(0, 2), 16) & 31]!;
}

/** coin.id → 사람이 읽는 일련번호. 같은 코인은 항상 같은 번호, 계보가 바뀌면 번호도 바뀐다. */
export function serialFromCoinId(coinId: string): string {
  // coinId를 한 번 더 도메인 해시로 감싼다 — 일련번호에서 coinId를 역산하는 착시를 없애고
  // (역산은 어차피 불가능하지만) coinId 형식이 바뀌어도 번호 유도가 안정적이도록.
  const h = sha256Hex(`shvil-serial|${coinId}`);
  const body = hexToCrockford(h, SERIAL_BODY_LENGTH);
  const groups = [body.slice(0, 5), body.slice(5, 10), body.slice(10, 15)];
  return `${SERIAL_PREFIX}-${groups.join('-')}-${checkChar(body)}`;
}

export function coinSerial(coin: Coin): string {
  return serialFromCoinId(coin.id);
}

/**
 * 사용자 입력 정규화 — 손으로 옮겨 적은 번호를 받아들인다.
 * 혼동 문자(I·L→1, O→0)를 되돌리고, 하이픈·공백·소문자를 흡수한다.
 */
export function normalizeSerial(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .replace(/^SHV/, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (cleaned.length !== SERIAL_BODY_LENGTH + 1) return null;
  for (const ch of cleaned) if (!ALPHABET.includes(ch)) return null;
  const body = cleaned.slice(0, SERIAL_BODY_LENGTH);
  const check = cleaned.slice(SERIAL_BODY_LENGTH);
  if (check !== checkChar(body)) return null; // 오타 — 조용히 통과시키지 않는다
  return `${SERIAL_PREFIX}-${body.slice(0, 5)}-${body.slice(5, 10)}-${body.slice(10, 15)}-${check}`;
}

/** 입력한 번호가 이 코인의 것인가. 정규화 실패(오타)도 false. */
export function serialMatchesCoin(input: string, coin: Coin): boolean {
  const normalized = normalizeSerial(input);
  return normalized !== null && normalized === coinSerial(coin);
}
