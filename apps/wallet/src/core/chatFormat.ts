/**
 * 메신저 정형 문구 — 순수 함수 (expo 무의존, vitest 테스트 대상).
 */

/** 수신 봉투의 발신자 서명이 무효할 때 본문 앞에 붙는 경고 표식. */
export const SENDER_UNVERIFIED_PREFIX = '[발신자 확인 불가] ';

/** 도착 예정 시각 공유 — 현재 시각 + N시간의 정형 문구 (지시서 4장 메시지 화면). */
export function buildEtaMessage(hoursFromNow: number, now: number): string {
  const eta = new Date(now + hoursFromNow * 3_600_000);
  const hh = String(eta.getHours()).padStart(2, '0');
  const mm = String(eta.getMinutes()).padStart(2, '0');
  return `도착 예정 시각을 알려드립니다: ${hh}:${mm} (약 ${hoursFromNow}시간 후)`;
}
