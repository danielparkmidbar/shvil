/**
 * QR 전송 압축 — **서명 대상 바이트는 한 바이트도 건드리지 않는다.**
 *
 * ── 왜 필요한가 (2026-07-27 실측) ────────────────────────────────────────
 * 지불(payment) QR 한 다리만 용량을 넘긴다. 회원 증서를 받은 정상 지갑은
 * **이전 0회에도** 2,872자(QR version 40)라 사실상 스캔이 안 되고, 손이 한 번만
 * 바뀌어도 3,769자로 QR 자체가 만들어지지 않는다. 헌법 제7조(순환)가 요구하는 것이
 * 바로 코인이 계속 손을 바꾸는 것인데, 그때마다 계보가 자라 대면 지불이 죽는다.
 *
 * ── 왜 "전송 인코딩만" 인가 ─────────────────────────────────────────────
 * 정준 직렬화(canonical.ts stableStringify)가 바뀌면 이미 발행된 코인의 서명이
 * 전부 깨진다 — 새 규칙이 옛 화폐를 가짜로 만드는 것이고, 헌법 제3조 위반이다.
 * 그래서 여기서 하는 일은 오직 하나다: `JSON.stringify(message)` 의 **UTF-8
 * 바이트열을 무손실로 줄였다가 그대로 되돌린다.** 코인 구조·필드명·서명 대상은
 * 그대로다. 옛 지갑이 만든 코인은 새 지갑에서 그대로 검증되고, 옛 형식(SHV1.)
 * QR도 계속 읽힌다(qr.ts decodeQr).
 *
 * ── 왜 외부 압축 라이브러리를 쓰지 않았나 ───────────────────────────────
 * fflate/pako(deflate)가 감소율은 더 좋다(실측 52~78%). 그러나 (가) 이 코덱이
 * 실패하면 광야 한복판에서 돈이 안 건네진다 — 우리가 전부 읽고 퍼즈로 두들길 수
 * 있는 200줄이 낫다. (나) 새 의존성은 오프라인 설치·RN 번들·공급망을 함께 들여온다.
 * (다) 이 파일은 순수 JS·타입배열만 쓴다 — Hermes/Node/브라우저 어디서나 같다.
 * 실측상 deflate 대비 6~18% 큰 대신, 아래 두 단계로 대표 시나리오를 전부 살린다.
 *
 * 1단계 hex 런 패킹 — payment JSON의 26~54%가 소문자 hex다(서명 128자·공개키
 *   64자·해시 64자·코인 ID 64자·주소 40자). 이 문자열은 문자당 4비트뿐이라
 *   절반으로 접힌다. **필드 이름을 알 필요가 없다** — 바이트열 위에서 소문자 hex
 *   런만 보고 접으므로, memberId가 우연히 hex여도 그대로 되돌아온다(무손실).
 * 2단계 LZSS — 반복되는 키 이름·이전 링크 구조·dailyBreakdown 60일치를 참조로 접는다.
 */

/** 압축 해제 결과 상한 (바이트) — 악성 QR의 압축 폭탄 방어. 실물 payment는 수 KB다. */
export const MAX_DECOMPRESSED_BYTES = 1 << 20; // 1 MiB

/** 컨테이너 버전 — 형식이 바뀌면 올린다. 옛 값을 만나면 던진다(조용히 오해석 금지). */
const CONTAINER_V1 = 0x01;

// ── 1단계: hex 런 패킹 ────────────────────────────────────────────────
//
// 토큰 머리는 0x00 이다. `JSON.stringify`의 UTF-8 바이트열에는 0x00이 나올 수
// 없다(제어문자는 \u0000 로 escape된다). 그래도 이 함수는 임의 바이트열에
// 총함수여야 하므로 0x00 은 `0x00 0x00`(길이 0)으로 탈출시킨다.
//
// 토큰 = 0x00, varint(L), 그리고 L바이트. L=0 이면 리터럴 0x00 하나.
// L>=1 이면 2L개의 소문자 hex 문자로 되돌아간다.

/**
 * 패킹 최소 런 길이 (hex 문자 수).
 *
 * 오버헤드는 2바이트(머리 + varint)다. n자를 접으면 n → 2 + n/2 이므로 n=12면
 * 4바이트를 번다. 더 짧게 잡으면 타임스탬프 조각 같은 잡음까지 토큰이 되어
 * 2단계 LZSS의 반복 구조를 오히려 부순다(실측으로 12가 최적 부근).
 */
const MIN_HEX_RUN = 12;

function isHexByte(b: number): boolean {
  return (b >= 0x30 && b <= 0x39) || (b >= 0x61 && b <= 0x66); // '0'-'9' | 'a'-'f'
}

function nibbleOf(b: number): number {
  return b <= 0x39 ? b - 0x30 : b - 0x61 + 10;
}

function hexByteOf(nibble: number): number {
  return nibble < 10 ? 0x30 + nibble : 0x61 + nibble - 10;
}

function pushVarint(out: number[], value: number): void {
  let v = value;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

export function packHexRuns(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  const n = input.length;
  let i = 0;
  while (i < n) {
    const b = input[i]!;
    if (b === 0x00) {
      out.push(0x00, 0x00); // 탈출: 길이 0 = 리터럴 0x00
      i += 1;
      continue;
    }
    if (!isHexByte(b)) {
      out.push(b);
      i += 1;
      continue;
    }
    let j = i;
    while (j < n && isHexByte(input[j]!)) j += 1;
    const runLen = j - i;
    if (runLen < MIN_HEX_RUN) {
      for (let k = i; k < j; k += 1) out.push(input[k]!);
      i = j;
      continue;
    }
    const packed = runLen >> 1; // 홀수면 마지막 한 자는 다음 회차에서 리터럴이 된다
    out.push(0x00);
    pushVarint(out, packed);
    for (let k = 0; k < packed; k += 1) {
      out.push((nibbleOf(input[i + 2 * k]!) << 4) | nibbleOf(input[i + 2 * k + 1]!));
    }
    i += packed * 2;
  }
  return Uint8Array.from(out);
}

export function unpackHexRuns(input: Uint8Array, maxOut = MAX_DECOMPRESSED_BYTES): Uint8Array {
  const out: number[] = [];
  const n = input.length;
  let i = 0;
  while (i < n) {
    const b = input[i]!;
    if (b !== 0x00) {
      out.push(b);
      i += 1;
      if (out.length > maxOut) throw new Error('qr: decompressed payload too large');
      continue;
    }
    i += 1;
    // varint
    let value = 0;
    let scale = 1;
    for (;;) {
      if (i >= n) throw new Error('qr: corrupt hex token (truncated length)');
      const c = input[i]!;
      i += 1;
      value += (c & 0x7f) * scale;
      if ((c & 0x80) === 0) break;
      scale *= 128;
      if (value > maxOut || scale > maxOut) throw new Error('qr: corrupt hex token (length overflow)');
    }
    if (value === 0) {
      out.push(0x00);
      continue;
    }
    if (i + value > n) throw new Error('qr: corrupt hex token (truncated body)');
    if (out.length + value * 2 > maxOut) throw new Error('qr: decompressed payload too large');
    for (let k = 0; k < value; k += 1) {
      const byte = input[i + k]!;
      out.push(hexByteOf(byte >> 4), hexByteOf(byte & 0x0f));
    }
    i += value;
  }
  return Uint8Array.from(out);
}

// ── 2단계: LZSS ───────────────────────────────────────────────────────
//
// 그룹 = 제어 바이트 1개 + 토큰 최대 8개. 제어 비트(LSB부터) 0 = 리터럴 1바이트,
// 1 = 매치 3바이트(오프셋 하위·상위, 길이-4). 오프셋 1~65536, 길이 4~259.
// 엔트로피 코딩(허프만)은 넣지 않았다 — hex를 1단계에서 이미 접었으므로
// 남은 이득이 작고, 코드는 두 배가 된다.

const MIN_MATCH = 4;
const MAX_MATCH = 259; // 255 + MIN_MATCH
const WINDOW = 65536;
const HASH_BITS = 15;
const MAX_CHAIN = 96;

export function lzCompress(input: Uint8Array): Uint8Array {
  const n = input.length;
  const out: number[] = [];
  if (n === 0) return Uint8Array.from(out);

  const hashSize = 1 << HASH_BITS;
  const head = new Int32Array(hashSize).fill(-1);
  const prev = new Int32Array(n).fill(-1);

  const hashAt = (p: number): number => {
    const raw = (input[p]! << 24) ^ (input[p + 1]! << 16) ^ (input[p + 2]! << 8) ^ input[p + 3]!;
    return (Math.imul(raw, 2654435761) >>> (32 - HASH_BITS)) & (hashSize - 1);
  };

  /**
   * 위치 [insertedUpTo, p) 를 해시 사슬에 넣는다 — **p 자신은 넣지 않는다.**
   * (현재 위치를 미리 넣으면 자기 자신이 오프셋 0의 매치로 잡혀 스트림이 깨진다.)
   */
  let insertedUpTo = 0;
  const insertBefore = (p: number): void => {
    while (insertedUpTo < p) {
      if (insertedUpTo + MIN_MATCH <= n) {
        const h = hashAt(insertedUpTo);
        prev[insertedUpTo] = head[h]!;
        head[h] = insertedUpTo;
      }
      insertedUpTo += 1;
    }
  };

  let bestOff = 0;
  const findMatch = (pos: number): number => {
    bestOff = 0;
    if (pos + MIN_MATCH > n) return 0;
    const limit = Math.min(n - pos, MAX_MATCH);
    let best = 0;
    let cand = head[hashAt(pos)]!;
    let depth = 0;
    while (cand >= 0 && depth < MAX_CHAIN) {
      const off = pos - cand;
      if (off > WINDOW) break;
      if (input[cand + best] === input[pos + best]) {
        let l = 0;
        while (l < limit && input[cand + l] === input[pos + l]) l += 1;
        if (l > best) {
          best = l;
          bestOff = off;
          if (l >= limit) break;
        }
      }
      cand = prev[cand]!;
      depth += 1;
    }
    return best >= MIN_MATCH ? best : 0;
  };

  let ctrlIdx = -1;
  let inGroup = 8;
  const ensureGroup = (): void => {
    if (inGroup === 8) {
      ctrlIdx = out.length;
      out.push(0);
      inGroup = 0;
    }
  };
  const emitLiteral = (byte: number): void => {
    ensureGroup();
    out.push(byte);
    inGroup += 1;
  };
  const emitMatch = (off: number, len: number): void => {
    ensureGroup();
    out[ctrlIdx] = out[ctrlIdx]! | (1 << inGroup);
    const o = off - 1;
    out.push(o & 0xff, (o >> 8) & 0xff, len - MIN_MATCH);
    inGroup += 1;
  };

  let pos = 0;
  while (pos < n) {
    insertBefore(pos);
    const len = findMatch(pos);
    if (len === 0) {
      emitLiteral(input[pos]!);
      pos += 1;
      continue;
    }
    const off = bestOff;
    // 게으른 매칭: 한 칸 뒤가 더 길면 리터럴 하나 흘리고 미룬다 (실측 3~5% 이득)
    if (pos + 1 < n) {
      insertBefore(pos + 1);
      const next = findMatch(pos + 1);
      if (next > len) {
        emitLiteral(input[pos]!);
        pos += 1;
        continue;
      }
    }
    emitMatch(off, len);
    insertBefore(pos + len);
    pos += len;
  }
  return Uint8Array.from(out);
}

export function lzDecompress(input: Uint8Array, maxOut = MAX_DECOMPRESSED_BYTES): Uint8Array {
  const out: number[] = [];
  const n = input.length;
  let i = 0;
  while (i < n) {
    const ctrl = input[i]!;
    i += 1;
    for (let bit = 0; bit < 8 && i < n; bit += 1) {
      if (((ctrl >> bit) & 1) === 1) {
        if (i + 3 > n) throw new Error('qr: corrupt lz stream (truncated match)');
        const off = (input[i]! | (input[i + 1]! << 8)) + 1;
        const len = input[i + 2]! + MIN_MATCH;
        i += 3;
        if (off > out.length) throw new Error('qr: corrupt lz stream (offset before start)');
        if (out.length + len > maxOut) throw new Error('qr: decompressed payload too large');
        const start = out.length - off;
        for (let k = 0; k < len; k += 1) out.push(out[start + k]!);
      } else {
        out.push(input[i]!);
        i += 1;
        if (out.length > maxOut) throw new Error('qr: decompressed payload too large');
      }
    }
  }
  return Uint8Array.from(out);
}

// ── 컨테이너 ──────────────────────────────────────────────────────────

/** UTF-8 바이트열 → 압축 바이트열. 무손실·결정적(같은 입력은 언제나 같은 출력). */
export function compressPayload(bytes: Uint8Array): Uint8Array {
  const packed = lzCompress(packHexRuns(bytes));
  const out = new Uint8Array(packed.length + 1);
  out[0] = CONTAINER_V1;
  out.set(packed, 1);
  return out;
}

/** 압축 바이트열 → 원본 UTF-8 바이트열. 손상된 입력은 던진다(절대 멈추지 않는다). */
export function decompressPayload(bytes: Uint8Array, maxOut = MAX_DECOMPRESSED_BYTES): Uint8Array {
  if (bytes.length === 0) throw new Error('qr: empty compressed payload');
  if (bytes[0] !== CONTAINER_V1) throw new Error(`qr: unsupported compression container ${bytes[0]}`);
  return unpackHexRuns(lzDecompress(bytes.subarray(1), maxOut), maxOut);
}
