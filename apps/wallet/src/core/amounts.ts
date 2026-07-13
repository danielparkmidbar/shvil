/**
 * 금액 문자열 파싱·표기 (순수 TS — vitest 대상).
 *
 * SHV는 dSHV(0.1 SHV) 정수, USDC는 micro(1e-6 USDC) 정수로만 다룬다 —
 * 부동소수점 연산 없이 문자열 → 정수 변환으로 정확성을 보장한다.
 * (SHV는 걸음의 코인, USDC는 현금 가치 — 화면상 명확히 구분, 지시서 4장)
 */

/** "12.5" → 125 dSHV. 소수 1자리(0.1 SHV 단위)까지. 잘못된 입력·0이면 null. */
export function parseShvToDshv(text: string): number | null {
  const m = /^(\d+)(?:\.(\d))?$/.exec(text.trim());
  if (!m) return null;
  const dshv = parseInt(m[1]!, 10) * 10 + (m[2] ? parseInt(m[2]!, 10) : 0);
  return dshv > 0 ? dshv : null;
}

/** "9.5" → 9_500_000 micro USDC. 소수 6자리까지. 잘못된 입력·0이면 null. */
export function parseUsdcToMicro(text: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text.trim());
  if (!m) return null;
  const micro = parseInt(m[1]!, 10) * 1_000_000 + parseInt((m[2] ?? '').padEnd(6, '0') || '0', 10);
  return micro > 0 ? micro : null;
}

/** 9_500_000 → "9.5 USDC" (뒤 0 제거). */
export function fmtUsdcMicro(micro: number): string {
  const sign = micro < 0 ? '-' : '';
  const abs = Math.abs(micro);
  const whole = Math.floor(abs / 1_000_000);
  const frac = String(abs % 1_000_000)
    .padStart(6, '0')
    .replace(/0+$/, '');
  return `${sign}${whole}${frac ? `.${frac}` : ''} USDC`;
}
