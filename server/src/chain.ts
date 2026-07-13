/**
 * 스테이블코인 체인 어댑터 (마켓 에스크로 전용 — 지시서 1장, 5장).
 *
 * SHV 자체는 온체인이 아니다. 체인은 마켓에서 현금 가치와 교환할 때만 등장한다.
 * 협약 스테이블코인·체인 확정은 결정 대기 1번 (권고: USDC on Base) — 확정 전까지
 * Mock 어댑터로 에스크로 로직을 개발·검증하고, 확정 후 동일 인터페이스로
 * 실체인(테스트넷) 어댑터를 끼운다.
 *
 * 금액 단위: microUSDC (10^-6 — USDC 네이티브 소수 자릿수).
 */

export interface ChainAdapter {
  /** 에스크로별 입금 참조(주소/메모) 생성. */
  createDepositReference(escrowId: number): string;
  /** 참조로 입금된 금액이 요구액 이상인지 확인. */
  checkDeposit(depositRef: string, amountUsdcMicro: number): Promise<boolean>;
  /** 판매자 지갑으로 방출. 반환: 트랜잭션 ID. */
  release(toAddress: string | null, amountUsdcMicro: number): Promise<string>;
  /** 구매자에게 환불. 반환: 트랜잭션 ID. */
  refund(depositRef: string, amountUsdcMicro: number): Promise<string>;
}

/** 개발·테스트용 모의 체인 — 입금을 메모리에 기록한다. */
export class MockChainAdapter implements ChainAdapter {
  #deposits = new Map<string, number>();
  #txSeq = 0;

  createDepositReference(escrowId: number): string {
    return `mock-escrow-${escrowId}`;
  }

  /** 테스트 훅: 구매자 입금 시뮬레이션. */
  simulateDeposit(depositRef: string, amountUsdcMicro: number): void {
    this.#deposits.set(depositRef, (this.#deposits.get(depositRef) ?? 0) + amountUsdcMicro);
  }

  async checkDeposit(depositRef: string, amountUsdcMicro: number): Promise<boolean> {
    return (this.#deposits.get(depositRef) ?? 0) >= amountUsdcMicro;
  }

  async release(toAddress: string | null, amountUsdcMicro: number): Promise<string> {
    void toAddress;
    void amountUsdcMicro;
    return `mock-tx-release-${++this.#txSeq}`;
  }

  async refund(depositRef: string, amountUsdcMicro: number): Promise<string> {
    this.#deposits.set(depositRef, Math.max(0, (this.#deposits.get(depositRef) ?? 0) - amountUsdcMicro));
    return `mock-tx-refund-${++this.#txSeq}`;
  }
}
