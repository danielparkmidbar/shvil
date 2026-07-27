/**
 * 분할 프레임 QR — 조각내기·모으기.
 *
 * 여기서 확인하는 것은 **크기 상한이 사라졌는가**와 **잘못 모으는 일이 없는가** 둘이다.
 * 카메라는 순서대로 주지 않고, 같은 장을 여러 번 주고, 옆 사람의 QR도 준다.
 */
import { describe, expect, it } from 'vitest';
import {
  QR_FRAME_CHUNK_CHARS,
  QR_FRAME_MAX_FRAMES,
  QrFrameCollector,
  encodeQrFrames,
  isQrFrame,
  parseQrFrame,
  qrFrameId,
} from '../qrFrames';

/** 카메라가 무작위 순서로 준 것처럼 섞는다 (결정적 셔플 — 시험이 흔들리면 안 된다). */
function shuffle<T>(items: T[], seed = 12345): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function collectAll(frames: string[]): string {
  const c = new QrFrameCollector();
  let done: string | null = null;
  for (const f of frames) {
    const r = c.add(f);
    if (r.status === 'DONE') done = r.text;
  }
  if (done === null) throw new Error('모으지 못했다');
  return done;
}

const LONG = 'SHV2.' + 'AbCdEf-_0123456789'.repeat(500); // 9,005자 — 한 장에 절대 안 들어간다

describe('분할 프레임 QR', () => {
  it('한 장에 들어가는 텍스트는 나누지 않는다 (평범한 지불에 머리를 붙이지 않는다)', () => {
    const short = 'SHV2.' + 'x'.repeat(100);
    const frames = encodeQrFrames(short);
    expect(frames).toEqual([short]);
    expect(isQrFrame(frames[0]!)).toBe(false);
  });

  it('긴 텍스트를 나누고 순서 상관없이 되돌린다', () => {
    const frames = encodeQrFrames(LONG);
    expect(frames.length).toBe(Math.ceil(LONG.length / QR_FRAME_CHUNK_CHARS));
    for (const f of frames) expect(isQrFrame(f)).toBe(true);
    expect(collectAll(shuffle(frames))).toBe(LONG);
  });

  it('★프레임 한 장의 크기가 한 장짜리 QR 상한보다 훨씬 작다 (성글게 그려진다)', () => {
    for (const f of encodeQrFrames(LONG)) {
      expect(f.length).toBeLessThanOrEqual(QR_FRAME_CHUNK_CHARS + 32);
    }
  });

  it('같은 장을 여러 번 읽어도 무해하다 (카메라는 계속 같은 것을 준다)', () => {
    const frames = encodeQrFrames(LONG);
    const doubled = [...frames, ...frames].sort();
    expect(collectAll(doubled)).toBe(LONG);
  });

  it('다 모으기 전에는 DONE이 아니고, 남은 장 번호를 알려 준다', () => {
    const frames = encodeQrFrames(LONG);
    const c = new QrFrameCollector();
    const r1 = c.add(frames[0]!);
    expect(r1.status).toBe('COLLECTING');
    if (r1.status !== 'COLLECTING') throw new Error();
    expect(r1.received).toBe(1);
    expect(r1.total).toBe(frames.length);
    expect(r1.missing).toContain(2);
    expect(r1.missing).not.toContain(1);
  });

  it('★다른 지불의 프레임이 섞여 들어오면 처음부터 다시 모은다 (두 사람이 나란히 서 있어도 안 섞인다)', () => {
    const a = encodeQrFrames(LONG);
    const b = encodeQrFrames('SHV2.' + 'ZZZZ'.repeat(900));
    expect(qrFrameId(LONG)).not.toBe(qrFrameId('SHV2.' + 'ZZZZ'.repeat(900)));
    const c = new QrFrameCollector();
    c.add(a[0]!);
    c.add(a[1]!);
    const r = c.add(b[0]!);
    expect(r.status).toBe('RESTARTED');
    // b를 마저 모으면 b가 나온다 — a의 조각이 섞여 들어가지 않는다.
    let out: string | null = null;
    for (const f of b) {
      const x = c.add(f);
      if (x.status === 'DONE') out = x.text;
    }
    expect(out).toBe('SHV2.' + 'ZZZZ'.repeat(900));
  });

  it('★한 글자라도 어긋나면 DONE 대신 CORRUPT를 낸다 (신원 대조)', () => {
    const frames = encodeQrFrames(LONG);
    const broken = [...frames];
    // 마지막 장의 조각 한 글자를 바꾼다 (머리는 그대로라 파싱은 통과한다).
    const last = broken[broken.length - 1]!;
    const head = last.slice(0, last.indexOf(':', last.indexOf(':', 6) + 1) + 1);
    broken[broken.length - 1] = head + last.slice(head.length).replace(/.$/, 'Q');
    const c = new QrFrameCollector();
    let sawCorrupt = false;
    for (const f of broken) {
      const r = c.add(f);
      expect(r.status).not.toBe('DONE');
      if (r.status === 'CORRUPT') sawCorrupt = true;
    }
    expect(sawCorrupt).toBe(true);
    expect(c.received).toBe(0); // 반쯤 맞은 상태로 남지 않는다
  });

  it('프레임이 아닌 것은 조용히 무시한다 (카메라는 아무 QR이나 읽는다)', () => {
    const c = new QrFrameCollector();
    for (const junk of ['', 'https://example.com', 'SHV2.abc', 'SHV2M:', 'SHV2M:zzzz:1/2:x', 'SHV2M:00112233:0/2:x', 'SHV2M:00112233:3/2:x']) {
      expect(c.add(junk).status).toBe('IGNORED');
    }
    expect(parseQrFrame('SHV2M:00112233:1/2:')).toBeNull(); // 빈 조각
    expect(parseQrFrame('SHV2M:00112233:1/999:x')).toBeNull(); // 장수 상한 초과
  });

  it('프레임 수 상한을 넘기면 만들지 않고 던진다 (수신 버퍼 폭탄 방어)', () => {
    const tooLong = 'x'.repeat(QR_FRAME_CHUNK_CHARS * (QR_FRAME_MAX_FRAMES + 1));
    expect(() => encodeQrFrames(tooLong)).toThrow(/상한/);
  });

  it('★상한이 실제로 사라졌다 — 손바뀜이 아무리 늘어도 나눌 수 있다', () => {
    // 이전 20회 코인 수준(약 8,000자)과 묶음 12장 수준(약 5,300자)을 모사한다.
    for (const size of [5_300, 8_000, 20_000]) {
      const text = 'SHV2.' + 'Q7x-_9aB'.repeat(Math.ceil(size / 8)).slice(0, size);
      const frames = encodeQrFrames(text);
      expect(collectAll(shuffle(frames, size))).toBe(text);
    }
  });
});
