/**
 * 위폐 감지기 입력 파서 (M16) — 사이트·지갑 공용.
 *
 * 사용자가 붙여넣거나 업로드하는 것을 코인 목록으로 되돌린다. 받는 형식:
 *  1. 코인 JSON 한 개 (지갑 상세 화면의 "내보내기")
 *  2. 코인 JSON 배열
 *  3. { coins: [...] } — 복호화된 지갑 백업(WalletBackup)·지불 메시지 공통 모양
 *  4. "SHV1."·"SHV2." QR 페이로드 — 지불 QR(shvil/payment)에 코인이 실려 있다
 *
 * ★2026-07-27 실사용 시나리오 시험에서 재현된 결함: 여기가 `SHV1.`만 보고 있어서,
 *  압축 전송(`SHV2.`)이 들어온 뒤로 **지갑이 실제로 만드는 지불 QR을 검사기가 읽지
 *  못했다.** 새 지갑의 지불 QR은 거의 전부 SHV2이므로(짧은 쪽을 고른다), 사람이
 *  QR 내용을 붙여넣으면 "JSON을 읽을 수 없습니다"라는 엉뚱한 안내를 받았다.
 *  형식 판별은 `qr.ts`(isQrPayload/decodeQr) 한 곳만 알게 둔다.
 *
 * 암호화 백업 blob은 받지 않는다 — 키가 없으면 열 수 없고, **키를 사이트에 넣게
 * 유도해서는 안 된다.** 지갑이 "검사용 내보내기"로 평문 코인 JSON을 만들게 한다.
 *
 * 구조 검증은 얕게만 한다 (필수 필드 존재) — 깊은 검증은 checkAuthenticity가
 * verifyCoin으로 수행한다. 여기서 걸러내는 것은 "코인이 아예 아닌 것"뿐이다.
 */
import { decodeQr, isQrPayload } from './qr';
import type { Coin } from './types';

export type CheckerInputSource = 'COIN' | 'COIN_ARRAY' | 'COIN_LIST' | 'QR_PAYMENT';

export interface CheckerInput {
  coins: Coin[];
  source: CheckerInputSource;
}

/** 코인처럼 생겼는가 — 필수 필드의 존재와 타입만 본다. */
export function looksLikeCoin(value: unknown): value is Coin {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c['id'] === 'string' &&
    typeof c['amountDshv'] === 'number' &&
    typeof c['memberId'] === 'string' &&
    typeof c['provenance'] === 'object' &&
    c['provenance'] !== null &&
    Array.isArray(c['transferChain'])
  );
}

/**
 * 텍스트 → 코인 목록. 인식할 수 없으면 Error를 던진다 (메시지는 사용자에게 보여도
 * 되는 한국어 — 사이트가 그대로 표시한다).
 */
export function parseCheckerInput(text: string): CheckerInput {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('내용이 비어 있습니다.');

  // QR 페이로드 — 지불 QR에는 코인이 실려 있다. 옛 형식(SHV1)·압축 형식(SHV2) 둘 다.
  // ★접두사 목록을 여기에 다시 적지 않는다. 그렇게 적어 둔 것이 이번 결함의 원인이었다.
  if (isQrPayload(trimmed)) {
    const message = decodeQr(trimmed);
    if (message.type !== 'shvil/payment') {
      throw new Error('이 QR에는 코인이 들어 있지 않습니다 (청구·확인 QR은 코인을 싣지 않습니다). 지불 QR을 스캔해 주세요.');
    }
    const coins = message.coins.filter(looksLikeCoin);
    if (coins.length === 0) throw new Error('지불 QR 안에서 코인을 찾지 못했습니다.');
    return { coins, source: 'QR_PAYMENT' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('JSON을 읽을 수 없습니다. 지갑의 "검사용 내보내기"로 만든 파일이나 지불 QR 내용을 붙여넣어 주세요.');
  }

  if (looksLikeCoin(parsed)) return { coins: [parsed], source: 'COIN' };

  if (Array.isArray(parsed)) {
    const coins = parsed.filter(looksLikeCoin);
    if (coins.length === 0) throw new Error('배열 안에서 코인을 찾지 못했습니다.');
    return { coins, source: 'COIN_ARRAY' };
  }

  if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { coins?: unknown }).coins)) {
    const coins = ((parsed as { coins: unknown[] }).coins).filter(looksLikeCoin);
    if (coins.length === 0) throw new Error('coins 목록 안에서 코인을 찾지 못했습니다.');
    return { coins, source: 'COIN_LIST' };
  }

  throw new Error('코인 형식이 아닙니다. 코인 JSON, 코인 배열, 지갑 내보내기({coins: [...]}), 또는 지불 QR 내용을 받습니다.');
}
