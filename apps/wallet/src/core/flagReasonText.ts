/**
 * 소명 대기 사유 문구 조립 (지갑 — 현재 한국어 전용 UI).
 *
 * 서버는 사유를 코드 + 파라미터로만 배포한다 (@shvil/shared FlagReason).
 * 문장은 각 클라이언트가 자기 언어로 만든다 — 지갑이 다국어화되면 이 함수만
 * 사전으로 바꾸면 된다. 서버 응답에는 번역할 수 없는 문장이 남지 않는다.
 *
 * 이 모듈은 순수 TS다 — expo 모듈 import 금지 (vitest 테스트 대상).
 */
import type { FlaggedMemberEntry } from './api';

/** 10 dSHV = 1 SHV. */
function shv(dshv: number): string {
  return `${(dshv / 10).toFixed(1)} SHV`;
}

export function flagReasonText(entry: FlaggedMemberEntry): string {
  switch (entry.reasonCode) {
    case 'DOUBLE_SPEND_SUSPECT':
      return `이중 사용 의심: 코인 ${entry.params.coinId.slice(0, 12)}… 분기 (체인 ${entry.params.chainLen})`;
    case 'OVERPRODUCTION_DAILY':
      return `초과 생성 의심: ${entry.params.date} 합산 ${shv(entry.params.totalDshv)} > 일 상한 ${shv(entry.params.limitDshv)}`;
    case 'OVERPRODUCTION_WEEKLY':
      return `초과 생성 의심: ~${entry.params.date} 7일 합산 ${shv(entry.params.totalDshv)} > 주 상한 ${shv(entry.params.limitDshv)}`;
    case 'MANUAL':
      return '검토단 수동 등재';
    default:
      // 지갑보다 새로운 사유 코드 — 구버전 지갑도 목록 자체는 계속 준수한다.
      return '검토 절차 진행 중';
  }
}
