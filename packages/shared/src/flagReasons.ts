/**
 * 소명 대기 사유 — 코드 + 파라미터 (지시서 3장 5절).
 *
 * 서버는 화면에 보여줄 문장을 만들지 않는다. 포착 사유는 안정적인 코드와
 * 숫자·ID 파라미터로만 배포되고, 문장 조립은 각 클라이언트가 자기 사전에서 한다
 * (지갑: 한국어 / shvilangel·shvilist: en·he·ko·es).
 * 서버가 자연어를 보내는 순간 어떤 클라이언트도 그것을 번역할 수 없다.
 */

export type FlagReasonCode =
  | 'DOUBLE_SPEND_SUSPECT'
  | 'OVERPRODUCTION_DAILY'
  | 'OVERPRODUCTION_WEEKLY'
  | 'MANUAL';

export const FLAG_REASON_CODES: readonly FlagReasonCode[] = [
  'DOUBLE_SPEND_SUSPECT',
  'OVERPRODUCTION_DAILY',
  'OVERPRODUCTION_WEEKLY',
  'MANUAL',
];

/** 사유 코드별 파라미터 — 전부 숫자·ID·ISO 날짜. 자연어 없음. */
export type FlagReason =
  | {
      reasonCode: 'DOUBLE_SPEND_SUSPECT';
      /** 분기가 관측된 코인 ID와 계보 길이. */
      params: { coinId: string; chainLen: number };
    }
  | {
      reasonCode: 'OVERPRODUCTION_DAILY';
      /** 초과가 확인된 날짜(YYYY-MM-DD) · 그 날 합산 · 일 상한 (dSHV). */
      params: { date: string; totalDshv: number; limitDshv: number };
    }
  | {
      reasonCode: 'OVERPRODUCTION_WEEKLY';
      /** 7일 창의 마지막 날(YYYY-MM-DD) · 창 합산 · 주 상한 (dSHV). */
      params: { date: string; totalDshv: number; limitDshv: number };
    }
  | {
      /** 검토단 수동 등재 (개발 모드 · 운영 절차). */
      reasonCode: 'MANUAL';
      params: Record<string, never>;
    };

/** GET /limits/flagged 항목 — 지갑·웹이 공유하는 계약. */
export type FlaggedMemberEntry = FlagReason & {
  memberId: string;
  flaggedAt: number;
};

export function isFlagReasonCode(value: unknown): value is FlagReasonCode {
  return typeof value === 'string' && (FLAG_REASON_CODES as readonly string[]).includes(value);
}

/** 초과 생성 계열(일·주) 여부 — 투명성 익명 카운트 집계용. */
export function isOverproductionCode(code: FlagReasonCode): boolean {
  return code === 'OVERPRODUCTION_DAILY' || code === 'OVERPRODUCTION_WEEKLY';
}
