/**
 * 잠정 누적 원장 (온디바이스) — 만보기 모델의 핵심 (지시서 2.2).
 *
 * - 걷는 동안 SHV는 잠정(pending) 상태로 계속 쌓인다. 며칠이고 계속.
 * - 정산은 오직 두 가지: 사용(SPEND) 또는 본인 선언(MANUAL, "여기서 정산").
 *   자동 생성·자동 정산 메서드는 이 클래스에 존재하지 않는다 — 의도적 설계.
 * - 엔젤 우회 거리는 잠정 카운트되며, 그 엔젤에게 지불(SPEND)하는 정산에서만
 *   확정된다. 정산으로 구간이 닫히면 미확정 우회분은 소멸한다.
 * - 위치 비저장: 이 원장에는 좌표가 없다. 날짜별 micro 발행량·거리·걸음 수뿐.
 */
import {
  DEFAULT_ECONOMIC_PARAMS,
  DEFAULT_WALK_FILTER_PARAMS,
  MICRO_PER_DSHV,
  type EconomicParams,
  type WalkFilterParams,
} from './params.js';
import { applyDailyCap, floorMicroToDshv, metersToMicroDshv } from './rates.js';
import { evaluateWalkSample } from './walkFilter.js';
import { hashObject } from './crypto.js';
import type { SettlementKind, WalkSample, WalkSampleVerdict } from './types.js';

export interface LedgerConfig {
  memberId: string;
  economicParams?: EconomicParams;
  filterParams?: WalkFilterParams;
  /** 사용자 현지 시간대 오프셋(분) — 일일 상한의 역일 귀속 기준. */
  tzOffsetMinutes?: number;
}

/** 정산 초안 — 서명 전의 WalkSegmentProof 재료. */
export interface SettlementDraft {
  memberId: string;
  settlement: SettlementKind;
  startedAt: number;
  settledAt: number;
  distanceM: number;
  stepCount: number;
  courseIds: string[];
  amountDshv: number;
  dailyBreakdown: { date: string; amountDshv: number }[];
  sensorSummaryHash: string;
}

export interface PendingSnapshot {
  /** 정규(코스/이탈/일상) 잠정 누적 — 내림 전 추정 dSHV. */
  pendingDshvEstimate: number;
  /** 엔젤별 우회 잠정 누적 (dSHV 추정) — 해당 엔젤 사용 시에만 확정될 금액. */
  detourPendingByAngel: Record<string, number>;
  distanceM: number;
  stepCount: number;
  startedAt: number | null;
}

interface DayAccrual {
  regularMicro: number;
  detourMicroByAngel: Map<string, number>;
}

export class PendingWalkLedger {
  private readonly memberId: string;
  private readonly eco: EconomicParams;
  private readonly filter: WalkFilterParams;
  private readonly tzOffsetMinutes: number;

  private days = new Map<string, DayAccrual>();
  /** 일자별 기확정 발행량 — 정산을 나눠도 하루 상한(40 SHV)을 우회할 수 없다. */
  private mintedByDate = new Map<string, number>();
  private detourMetersByAngel = new Map<string, number>();
  private courseIds = new Set<string>();
  private distanceM = 0;
  private stepCount = 0;
  private startedAt: number | null = null;
  private sampleCount = 0;

  constructor(config: LedgerConfig, mintedHistory?: Record<string, number>) {
    this.memberId = config.memberId;
    this.eco = config.economicParams ?? DEFAULT_ECONOMIC_PARAMS;
    this.filter = config.filterParams ?? DEFAULT_WALK_FILTER_PARAMS;
    this.tzOffsetMinutes = config.tzOffsetMinutes ?? 0;
    if (mintedHistory) {
      for (const [date, dshv] of Object.entries(mintedHistory)) this.mintedByDate.set(date, dshv);
    }
  }

  /** 일자별 기확정 발행량 (영속화용 — 앱이 SQLite에 저장·복원). */
  getMintedHistory(): Record<string, number> {
    return Object.fromEntries(this.mintedByDate);
  }

  /** epoch ms → 사용자 현지 역일 (YYYY-MM-DD). */
  dateOf(timestamp: number): string {
    const d = new Date(timestamp + this.tzOffsetMinutes * 60_000);
    return d.toISOString().slice(0, 10);
  }

  /** 걷기 창 샘플 기록: 필터 통과분만 요율에 따라 잠정 누적된다. */
  recordSample(sample: WalkSample): WalkSampleVerdict {
    const verdict = evaluateWalkSample(sample, this.filter);
    if (!verdict.accepted || verdict.creditedDistanceM <= 0) return verdict;

    if (this.startedAt === null) this.startedAt = sample.timestamp;
    this.distanceM += verdict.creditedDistanceM;
    this.stepCount += sample.steps;
    this.sampleCount += 1;
    if (sample.courseId) this.courseIds.add(sample.courseId);

    const date = this.dateOf(sample.timestamp);
    const day = this.days.get(date) ?? { regularMicro: 0, detourMicroByAngel: new Map() };

    if (sample.tier === 'ANGEL_DETOUR') {
      const angelId = sample.detourAngelMemberId;
      if (!angelId) {
        // 목적지 엔젤 없는 우회는 코스 이탈로 강등 처리.
        day.regularMicro += metersToMicroDshv(verdict.creditedDistanceM, 'OFF_COURSE', undefined, this.eco);
      } else {
        // 우회 인정 한도(편도) 초과분은 잠정 카운트하지 않는다.
        const used = this.detourMetersByAngel.get(angelId) ?? 0;
        const credit = Math.max(0, Math.min(verdict.creditedDistanceM, this.eco.angelDetourMaxMeters - used));
        this.detourMetersByAngel.set(angelId, used + verdict.creditedDistanceM);
        if (credit > 0) {
          const micro = metersToMicroDshv(credit, 'ANGEL_DETOUR', undefined, this.eco);
          day.detourMicroByAngel.set(angelId, (day.detourMicroByAngel.get(angelId) ?? 0) + micro);
        }
      }
    } else {
      day.regularMicro += metersToMicroDshv(
        verdict.creditedDistanceM,
        sample.tier,
        sample.difficultyTenths,
        this.eco,
      );
    }

    this.days.set(date, day);
    return verdict;
  }

  /** 표시용 잠정 누적 조회 — 정산이 아니다. 코인을 만들지 않는다. */
  getPending(): PendingSnapshot {
    let regularMicro = 0;
    const detour: Record<string, number> = {};
    for (const day of this.days.values()) {
      regularMicro += day.regularMicro;
      for (const [angelId, micro] of day.detourMicroByAngel) {
        detour[angelId] = (detour[angelId] ?? 0) + floorMicroToDshv(micro);
      }
    }
    return {
      pendingDshvEstimate: floorMicroToDshv(regularMicro),
      detourPendingByAngel: detour,
      distanceM: this.distanceM,
      stepCount: this.stepCount,
      startedAt: this.startedAt,
    };
  }

  /**
   * 사용(지불)에 의한 정산. paidAngelMemberId가 주어지면 그 엔젤로의 우회
   * 잠정분이 함께 확정된다. 다른 엔젤의 우회분은 소멸.
   */
  settleOnSpend(now: number, paidAngelMemberId?: string): SettlementDraft | null {
    return this.#settle('SPEND', now, paidAngelMemberId);
  }

  /** 본인 선언("여기서 정산")에 의한 수동 정산. 우회 잠정분은 확정되지 않고 소멸. */
  settleManual(now: number): SettlementDraft | null {
    return this.#settle('MANUAL', now);
  }

  #settle(kind: SettlementKind, now: number, paidAngelMemberId?: string): SettlementDraft | null {
    const dailyBreakdown: { date: string; amountDshv: number }[] = [];
    let total = 0;

    // 0.1 SHV(1 dSHV) 미만의 잔여 micro는 다음 날로 이월해 누적한다 (미세 요율의
    // 다일 누적 보전). 반면 일일 상한(40 SHV) 초과분은 절사되며 이월하지 않는다.
    // 최종 정산 후 남는 잔여 micro는 내림으로 소멸한다.
    let carryMicro = 0;
    const dates = [...this.days.keys()].sort();
    for (const date of dates) {
      const day = this.days.get(date)!;
      let micro = day.regularMicro + carryMicro;
      if (kind === 'SPEND' && paidAngelMemberId) {
        micro += day.detourMicroByAngel.get(paidAngelMemberId) ?? 0;
      }
      // 0.1 SHV 단위 내림 → 일일 40 SHV 상한 (요율·계수 적용 후 총액 기준).
      const floored = floorMicroToDshv(micro);
      const already = this.mintedByDate.get(date) ?? 0;
      const dshv = applyDailyCap(floored, already, this.eco);
      carryMicro = micro - floored * MICRO_PER_DSHV; // 소수점 잔여만 이월 (상한 절사분 제외)
      if (dshv > 0) {
        dailyBreakdown.push({ date, amountDshv: dshv });
        this.mintedByDate.set(date, already + dshv);
        total += dshv;
      }
    }

    // 시작만 있고 생성이 없으면 아무것도 만들어지지 않는다 (지시서 0-6).
    if (total <= 0 || this.startedAt === null) {
      this.#reset();
      return null;
    }

    const draft: SettlementDraft = {
      memberId: this.memberId,
      settlement: kind,
      startedAt: this.startedAt,
      settledAt: now,
      distanceM: Math.round(this.distanceM),
      stepCount: this.stepCount,
      courseIds: [...this.courseIds].sort(),
      amountDshv: total,
      dailyBreakdown,
      // 센서 요약 해시: 파생 지표 요약의 해시 (좌표 없음). M1에서 파형 통계로 확장.
      sensorSummaryHash: hashObject({
        distanceM: Math.round(this.distanceM),
        stepCount: this.stepCount,
        sampleCount: this.sampleCount,
        startedAt: this.startedAt,
      }),
    };

    this.#reset();
    return draft;
  }

  #reset(): void {
    this.days.clear();
    this.detourMetersByAngel.clear();
    this.courseIds.clear();
    this.distanceM = 0;
    this.stepCount = 0;
    this.startedAt = null;
    this.sampleCount = 0;
  }
}
