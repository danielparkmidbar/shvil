/** UTF-8 · base64url 인코딩 유틸 — Node/RN(Hermes)/브라우저 공용 (외부 API 의존 없음). */

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return Uint8Array.from(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  let s = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i]!;
    let cp: number;
    if (b < 0x80) { cp = b; i += 1; }
    else if (b < 0xe0) { cp = ((b & 0x1f) << 6) | (bytes[i + 1]! & 0x3f); i += 2; }
    else if (b < 0xf0) { cp = ((b & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f); i += 3; }
    else { cp = ((b & 0x07) << 18) | ((bytes[i + 1]! & 0x3f) << 12) | ((bytes[i + 2]! & 0x3f) << 6) | (bytes[i + 3]! & 0x3f); i += 4; }
    s += String.fromCodePoint(cp);
  }
  return s;
}

export function base64urlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64URL[b0 >> 2]!;
    out += B64URL[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)]!;
    if (b1 !== undefined) out += B64URL[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)]!;
    if (b2 !== undefined) out += B64URL[b2 & 0x3f]!;
  }
  return out;
}

export function base64urlDecode(s: string): Uint8Array {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of s) {
    const val = B64URL.indexOf(ch);
    if (val < 0) throw new Error('base64url: invalid character');
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}
