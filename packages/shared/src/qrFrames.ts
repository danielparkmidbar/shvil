/**
 * 분할 프레임 QR — **크기 상한을 없앤다.**
 *
 * ── 왜 이것이 필요한가 (헌법 제7조) ──────────────────────────────────
 * 코인은 손을 바꿀 때마다 이전 링크가 하나씩 자란다. 그것이 순환의 증거이자
 * 순환의 비용이다. `SHV2.` 압축이 상한을 크게 밀어냈지만 **없애지는 못했다** —
 * 실측(qrSize.test.ts)상 불곡산 코인은 손바뀜 5회, 소액 코인 묶음은 5장에서
 * 한 장을 넘는다. 즉 압축만으로는 **화폐가 순환할수록 죽는다.** 상한이 남아
 * 있는 한 "엔젤이 받은 코인으로 다시 잠자리 값을 낸다"가 언젠가 반드시 막힌다.
 *
 * ── 이 파일이 하는 일 ────────────────────────────────────────────────
 * `encodeQr`가 만든 **완성된 텍스트를 그대로 잘라 여러 장으로 나눈다.** 서명도,
 * 코인 구조도, 압축 컨테이너도 건드리지 않는다 — 봉투를 여러 장으로 나눌 뿐이다.
 * 받는 쪽은 조각을 모아 원래 문자열을 복원하고, 평소처럼 `decodeQr`에 넘긴다.
 * 그래서 이미 발행된 코인은 한 개도 영향받지 않는다.
 *
 * ── 프레임 형식 ──────────────────────────────────────────────────────
 *   SHV2M:<id8>:<i>/<n>:<조각>
 * · `id8` — 전체 텍스트의 sha256 앞 4바이트(hex 8자). 서로 다른 지불의 프레임이
 *   섞이는 것을 막는다. 두 사람이 나란히 서서 각자 QR을 돌려도 안 섞인다.
 * · `i` 는 1부터, `n` 은 총 장수. 순서와 무관하게 모을 수 있다.
 * · 조각은 원문의 부분 문자열이다(추가 인코딩 없음).
 *
 * ── 왜 라이브러리를 쓰지 않았나 ──────────────────────────────────────
 * BC-UR(@ngraveio/bc-ur)은 v2가 beta이고 Buffer·cbor 폴리필을 끌고 온다. 상호운용
 * 표준이 필요한 상황이 아니다 — 보내는 쪽도 받는 쪽도 우리 앱이다. 조각내고 모으는
 * 일에 새 의존성과 공급망을 들이는 것은 비싸다.
 *
 * ── 아직 검증되지 않은 것 (제3조) ────────────────────────────────────
 * 프레임 **주기(ms)와 실기기 스캔 성공률은 시뮬레이션으로 알 수 없다.** 여기 있는
 * 것은 조각내기·모으기의 정확성뿐이고, 그것은 시험으로 못박았다. 카메라가 실제로
 * 몇 장을 몇 초에 잡는지는 폰으로 재야 한다.
 */
import { sha256Hex } from './crypto';
import { QR_BYTE_MODE_MAX_CHARS } from './qr';

/** 프레임 접두사. `SHV1.`/`SHV2.`(한 장짜리)와 겹치지 않는다 — 'SHV2M:' 은 마침표가 아니라 콜론이다. */
const FRAME_PREFIX = 'SHV2M:';

/**
 * 프레임 하나에 담는 **조각의 문자 수**.
 *
 * 700자 조각 + 머리 20자 = 720자 → QR version 18 부근(89×89 모듈). 280dp 화면에서
 * 모듈당 3.1dp로, 한 장에 밀어 넣을 때의 version 40(모듈당 1.6dp)보다 두 배 성기다.
 * 폰 화면을 폰 카메라로 읽는 상황에서 성김이 곧 스캔 성공률이다.
 */
export const QR_FRAME_CHUNK_CHARS = 700;

/** 한 지불이 가질 수 있는 최대 프레임 수 — 악성 QR이 수신 버퍼를 부풀리는 것을 막는다. */
export const QR_FRAME_MAX_FRAMES = 64;

export interface QrFrame {
  /** 전체 텍스트의 신원 (hex 8자). */
  id: string;
  /** 1부터 시작하는 장 번호. */
  index: number;
  /** 총 장수. */
  total: number;
  /** 원문 조각. */
  chunk: string;
}

/** 전체 텍스트의 신원 — 프레임이 섞이는 것을 막는 데만 쓴다(보안 용도 아님). */
export function qrFrameId(text: string): string {
  return sha256Hex(text).slice(0, 8);
}

/**
 * 완성된 QR 텍스트를 프레임들로 나눈다.
 *
 * 한 장이면 나누지 않고 `[text]`를 그대로 돌려준다 — 평범한 지불에 프레임 머리를
 * 붙여 괜히 크게 만들 이유가 없다(제8조).
 */
export function encodeQrFrames(text: string, chunkChars: number = QR_FRAME_CHUNK_CHARS): string[] {
  if (!Number.isInteger(chunkChars) || chunkChars <= 0) throw new Error('qrFrames: chunkChars must be a positive integer');
  if (text.length === 0) throw new Error('qrFrames: empty text');
  const total = Math.ceil(text.length / chunkChars);
  // 한 장이면 머리를 붙이지 않는다 — 평범한 지불의 QR을 괜히 키울 이유가 없다(제8조).
  if (total <= 1) return [text];
  if (total > QR_FRAME_MAX_FRAMES) {
    throw new Error(`qrFrames: ${total}장은 상한(${QR_FRAME_MAX_FRAMES}장)을 넘습니다`);
  }
  const id = qrFrameId(text);
  const frames: string[] = [];
  for (let i = 0; i < total; i += 1) {
    frames.push(`${FRAME_PREFIX}${id}:${i + 1}/${total}:${text.slice(i * chunkChars, (i + 1) * chunkChars)}`);
  }
  return frames;
}

/**
 * 화면에 띄울 QR 목록 — **한 장에 들어가면 한 장, 넘으면 나눈다.** 화면과 시험이
 * 같은 판단을 쓰도록 여기 한 군데에 둔다.
 *
 * ★"한 장에 들어간다"는 **규격** 이야기이지 "잘 읽힌다"는 뜻이 아니다. 2,900자대는
 *  QR version 40(177×177 모듈)이라 폰 화면을 폰 카메라로 읽을 때 실패할 수 있다.
 *  그래서 화면은 사람이 직접 나눌 수 있는 버튼을 함께 둔다(`forceSplit`).
 *  이 한계는 시뮬레이션으로 알 수 없다 — 실기기에서 재야 한다(제3조).
 */
export function qrFramesFor(text: string, opts: { forceSplit?: boolean } = {}): string[] {
  if (!opts.forceSplit && text.length <= QR_BYTE_MODE_MAX_CHARS) return [text];
  return encodeQrFrames(text);
}

/** 프레임처럼 생겼는가 — 스캐너가 한 장짜리와 조각을 가르는 단일 기준. */
export function isQrFrame(text: string): boolean {
  return text.startsWith(FRAME_PREFIX);
}

/** 프레임 하나를 뜯는다. 형식이 어긋나면 null (던지지 않는다 — 카메라는 아무거나 읽는다). */
export function parseQrFrame(text: string): QrFrame | null {
  if (!isQrFrame(text)) return null;
  const rest = text.slice(FRAME_PREFIX.length);
  const c1 = rest.indexOf(':');
  if (c1 <= 0) return null;
  const c2 = rest.indexOf(':', c1 + 1);
  if (c2 <= c1) return null;
  const id = rest.slice(0, c1);
  if (!/^[0-9a-f]{8}$/.test(id)) return null;
  const counter = rest.slice(c1 + 1, c2);
  const slash = counter.indexOf('/');
  if (slash <= 0) return null;
  const index = Number(counter.slice(0, slash));
  const total = Number(counter.slice(slash + 1));
  if (!Number.isInteger(index) || !Number.isInteger(total)) return null;
  if (total < 1 || total > QR_FRAME_MAX_FRAMES) return null;
  if (index < 1 || index > total) return null;
  const chunk = rest.slice(c2 + 1);
  if (chunk.length === 0) return null;
  return { id, index, total, chunk };
}

export type QrFrameProgress =
  | { status: 'IGNORED' }
  | { status: 'COLLECTING'; received: number; total: number; missing: number[] }
  | { status: 'RESTARTED'; received: number; total: number; missing: number[] }
  | { status: 'DONE'; text: string }
  | { status: 'CORRUPT'; message: string };

/**
 * 조각 수집기 — 순서 무관, 중복 무해, 다른 지불의 프레임이 오면 새로 시작한다.
 *
 * ★`DONE`을 내기 전에 **모은 문자열의 신원(sha256 앞 8자)을 다시 계산해 대조한다.**
 * 카메라가 잘못 읽은 한 글자 때문에 엉뚱한 지불이 통과하는 일이 없어야 한다.
 * 대조에 실패하면 `CORRUPT`를 내고 버퍼를 비운다(반쯤 맞은 상태로 남지 않는다).
 */
export class QrFrameCollector {
  #id: string | null = null;
  #total = 0;
  #chunks = new Map<number, string>();

  get id(): string | null {
    return this.#id;
  }
  get total(): number {
    return this.#total;
  }
  get received(): number {
    return this.#chunks.size;
  }

  reset(): void {
    this.#id = null;
    this.#total = 0;
    this.#chunks.clear();
  }

  #missing(): number[] {
    const out: number[] = [];
    for (let i = 1; i <= this.#total; i += 1) if (!this.#chunks.has(i)) out.push(i);
    return out;
  }

  add(text: string): QrFrameProgress {
    const frame = parseQrFrame(text);
    if (!frame) return { status: 'IGNORED' };

    let restarted = false;
    if (this.#id !== frame.id) {
      // 다른 지불의 프레임이다 — 섞지 않고 처음부터 다시 모은다.
      restarted = this.#id !== null;
      this.#id = frame.id;
      this.#total = frame.total;
      this.#chunks.clear();
    } else if (this.#total !== frame.total) {
      // 같은 신원인데 장수가 다르다 = 읽기 오류. 조용히 섞지 않는다.
      return { status: 'CORRUPT', message: '같은 지불의 장수가 서로 다릅니다 — 다시 스캔하세요' };
    }
    this.#chunks.set(frame.index, frame.chunk);

    if (this.#chunks.size < this.#total) {
      return {
        status: restarted ? 'RESTARTED' : 'COLLECTING',
        received: this.#chunks.size,
        total: this.#total,
        missing: this.#missing(),
      };
    }

    let text2 = '';
    for (let i = 1; i <= this.#total; i += 1) text2 += this.#chunks.get(i)!;
    if (qrFrameId(text2) !== this.#id) {
      this.reset();
      return { status: 'CORRUPT', message: '조각을 다 모았지만 내용이 맞지 않습니다 — 처음부터 다시 스캔하세요' };
    }
    this.reset();
    return { status: 'DONE', text: text2 };
  }
}
