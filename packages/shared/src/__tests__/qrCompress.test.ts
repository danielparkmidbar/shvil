/**
 * QR 전송 압축 코덱 — **무손실성이 곧 돈이다.**
 *
 * 이 코덱이 한 바이트라도 틀리면 광야 한복판에서 지불이 실패하거나, 더 나쁘게는
 * 서명 검증만 깨진 채 "위조"라는 말이 정직한 사람 화면에 뜬다. 그래서 여기서는
 * "잘 줄어든다"를 재지 않는다 — **어떤 입력이든 정확히 되돌아온다**를 두들긴다.
 * 크기 측정은 qrSize.test.ts 가 맡는다.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_DECOMPRESSED_BYTES,
  compressPayload,
  decompressPayload,
  lzCompress,
  lzDecompress,
  packHexRuns,
  unpackHexRuns,
} from '../qrCompress';
import { utf8Decode, utf8Encode } from '../encoding';

function roundTrip(bytes: Uint8Array): Uint8Array {
  return decompressPayload(compressPayload(bytes));
}

function expectExact(bytes: Uint8Array, label: string): void {
  const back = roundTrip(bytes);
  expect(back.length, `${label}: 길이 불일치`).toBe(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    if (back[i] !== bytes[i]) throw new Error(`${label}: ${i}번째 바이트가 ${bytes[i]} → ${back[i]}`);
  }
}

/** 결정적 난수 (xorshift32) — 실패를 재현할 수 있어야 한다. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
}

describe('QR 전송 압축 — 무손실 왕복', () => {
  it('빈 입력·한 바이트·모든 단일 바이트 값이 그대로 돌아온다', () => {
    expectExact(new Uint8Array(0), '빈 입력');
    for (let b = 0; b < 256; b += 1) expectExact(Uint8Array.from([b]), `단일 바이트 ${b}`);
  });

  it('★0x00 바이트가 섞여도 총함수다 (토큰 머리와 충돌하지 않는다)', () => {
    // JSON.stringify 는 0x00 을 내지 않지만, 코덱은 임의 바이트열에 총함수여야 한다.
    expectExact(Uint8Array.from([0, 0, 0]), 'NUL 연속');
    expectExact(utf8Encode('a\u0000b\u0000c'), 'NUL 혼합');
    const mixed = Uint8Array.from([0, 0x61, 0x62, 0, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x61, 0x62, 0]);
    expectExact(mixed, 'NUL + hex 런');
  });

  it('★대문자 hex는 접지 않는다 — 접었다면 소문자로 되돌아와 서명이 깨진다', () => {
    const upper = utf8Encode('"ABCDEF0123456789ABCDEF0123456789ABCDEF01"');
    expectExact(upper, '대문자 hex');
    // 되돌린 결과가 대문자를 그대로 유지하는지 문자열로도 확인한다.
    expect(utf8Decode(roundTrip(upper))).toBe('"ABCDEF0123456789ABCDEF0123456789ABCDEF01"');
    const mixedCase = utf8Encode('"aBcDeF0123456789aBcDeF0123456789"');
    expect(utf8Decode(roundTrip(mixedCase))).toBe('"aBcDeF0123456789aBcDeF0123456789"');
  });

  it('홀수 길이 hex 런·경계 길이(11/12/13자)가 전부 정확하다', () => {
    for (let len = 0; len < 200; len += 1) {
      const s = '0123456789abcdef'.repeat(20).slice(0, len);
      expectExact(utf8Encode(`{"h":"${s}"}`), `hex ${len}자`);
    }
  });

  it('유니코드(한글·히브리어·이모지)가 왕복 무손실이다', () => {
    const s = JSON.stringify({
      ko: '풀 패키지 🌵 잠자리 10 SHV',
      he: 'שביל ישראל',
      emoji: '🇮🇱🇰🇷👣',
      surrogate: '\u{1F600}\u{10FFFF}',
    });
    expect(utf8Decode(roundTrip(utf8Encode(s)))).toBe(s);
  });

  it('결정적이다 — 같은 입력은 언제나 같은 바이트열이 된다', () => {
    const bytes = utf8Encode(JSON.stringify({ a: 'ab12cd34ef56ab12cd34ef56', b: [1, 2, 3] }));
    const first = compressPayload(bytes);
    const second = compressPayload(bytes);
    expect(Array.from(second)).toEqual(Array.from(first));
  });

  it('퍼즈 4,000회 — 임의 바이트열이 전부 정확히 돌아온다 (시드 고정)', () => {
    const rng = makeRng(0x5c1e17);
    for (let iter = 0; iter < 4000; iter += 1) {
      const len = rng() % 400;
      const mode = rng() % 4;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) {
        if (mode === 0) bytes[i] = rng() & 0xff; // 완전 임의
        else if (mode === 1) bytes[i] = '0123456789abcdef'.charCodeAt(rng() % 16); // hex만
        else if (mode === 2) bytes[i] = 0x20 + (rng() % 95); // 인쇄 가능 ASCII
        else bytes[i] = rng() % 3 === 0 ? 0 : '0123456789abcdef{}",:'.charCodeAt(rng() % 21); // NUL 다수
      }
      expectExact(bytes, `퍼즈 iter=${iter} mode=${mode} len=${len}`);
    }
    // 단독 실행은 0.6초지만 다른 파일과 병렬로 돌 때 5초 기본 제한을 넘겼다(실측).
    // 시간 초과로 red가 되면 "테스트 통과"가 신호가 아니게 되므로 여유를 준다.
  }, 30_000);

  it('퍼즈 — 반복이 많은 JSON 유사 입력 (LZ 경로 집중)', () => {
    const rng = makeRng(0xbeef01);
    const keys = ['"signature":', '"devicePublicKey":', '"transferChain":', '"dailyBreakdown":', '"amountDshv":'];
    for (let iter = 0; iter < 600; iter += 1) {
      let s = '{';
      const n = 1 + (rng() % 40);
      for (let i = 0; i < n; i += 1) {
        s += keys[rng() % keys.length]!;
        const hexLen = rng() % 130;
        let hex = '';
        for (let k = 0; k < hexLen; k += 1) hex += '0123456789abcdef'[rng() % 16];
        s += `"${hex}",`;
      }
      s += '}';
      expectExact(utf8Encode(s), `JSON퍼즈 iter=${iter}`);
    }
  });
});

describe('QR 전송 압축 — 손상·악성 입력 (멈추지 않고 던진다)', () => {
  it('컨테이너 바이트가 다르면 조용히 오해석하지 않고 거부한다', () => {
    expect(() => decompressPayload(new Uint8Array(0))).toThrow(/empty compressed payload/);
    expect(() => decompressPayload(Uint8Array.from([0x02, 0x00]))).toThrow(/unsupported compression container/);
  });

  it('잘린 스트림은 절대 "원본"을 만들어 내지 않는다 (무한 루프도 없음)', () => {
    const original = utf8Encode(JSON.stringify({ a: 'ab12cd34ef56'.repeat(20), b: 'ab12cd34ef56'.repeat(5) }));
    const full = compressPayload(original);
    const originalStr = String.fromCharCode(...Array.from(original));
    let threw = 0;
    for (let cut = 1; cut < full.length; cut += 1) {
      let out: Uint8Array | null = null;
      try {
        out = decompressPayload(full.subarray(0, cut));
      } catch {
        threw += 1;
        continue;
      }
      // 예외가 안 났다면 결과는 반드시 원본과 달라야 한다.
      expect(String.fromCharCode(...Array.from(out)), `cut=${cut} 에서 잘린 입력이 원본을 만들었다`).not.toBe(
        originalStr,
      );
    }
    expect(threw).toBeGreaterThan(0);
  });

  it('시작점 앞을 가리키는 매치 오프셋은 거부된다', () => {
    // 제어바이트 0b1 (첫 토큰이 매치) + 오프셋 1 + 길이 4 — 출력이 비어 있는데 뒤를 본다.
    const evil = Uint8Array.from([0x01, 0x01, 0x00, 0x00, 0x00]);
    expect(() => decompressPayload(evil)).toThrow(/offset before start/);
  });

  it('★압축 폭탄은 상한에서 멈춘다 (스캔 한 번에 메모리를 태우지 못한다)', () => {
    // 리터럴 1개 + 오프셋1·길이259 매치를 반복 → 3바이트마다 259바이트가 나온다.
    const stream: number[] = [];
    stream.push(0x01); // 컨테이너
    stream.push(0x00, 0x61, 0x61, 0x61, 0x61, 0x61, 0x61, 0x61, 0x61); // 리터럴 8개 그룹
    // 이후 그룹들은 전부 매치 8개
    for (let g = 0; g < 600; g += 1) {
      stream.push(0xff);
      for (let t = 0; t < 8; t += 1) stream.push(0x00, 0x00, 0xff); // off=1, len=259
    }
    const bomb = Uint8Array.from(stream);
    expect(() => decompressPayload(bomb, 4096)).toThrow(/too large/);
    // 기본 상한(1 MiB)에서도 반드시 멈춘다.
    expect(() => decompressPayload(bomb)).toThrow(/too large/);
    expect(MAX_DECOMPRESSED_BYTES).toBe(1 << 20);
  });

  it('hex 토큰 길이가 남은 바이트를 넘으면 거부된다', () => {
    // 0x00 + varint(200) 인데 뒤에 200바이트가 없다.
    expect(() => unpackHexRuns(Uint8Array.from([0x00, 200 & 0x7f | 0x80, 0x01, 0x41]))).toThrow(/truncated body/);
    expect(() => unpackHexRuns(Uint8Array.from([0x00]))).toThrow(/truncated length/);
  });
});

describe('QR 전송 압축 — 단계별 성질', () => {
  it('hex 패킹만으로도 왕복 무손실이다 (LZ와 독립)', () => {
    const rng = makeRng(0x1234);
    for (let iter = 0; iter < 500; iter += 1) {
      const len = rng() % 300;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) bytes[i] = rng() % 5 === 0 ? 0 : rng() & 0xff;
      const back = unpackHexRuns(packHexRuns(bytes));
      expect(Array.from(back), `hex 단계 iter=${iter}`).toEqual(Array.from(bytes));
    }
  });

  it('LZ만으로도 왕복 무손실이다 (hex 패킹과 독립)', () => {
    const rng = makeRng(0x9999);
    for (let iter = 0; iter < 500; iter += 1) {
      const len = rng() % 600;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) bytes[i] = rng() % 3 === 0 ? 0x61 : rng() & 0xff;
      const back = lzDecompress(lzCompress(bytes));
      expect(Array.from(back), `LZ 단계 iter=${iter}`).toEqual(Array.from(bytes));
    }
  });

  it('hex 패킹은 소문자 hex 런을 실제로 절반으로 접는다 (효과 확인)', () => {
    const sig = 'ab12cd34'.repeat(16); // 128자 서명 모양
    const packed = packHexRuns(utf8Encode(sig));
    expect(packed.length).toBeLessThanOrEqual(sig.length / 2 + 3);
  });
});
