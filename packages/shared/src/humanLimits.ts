/**
 * 인간 한계 프로파일 검증 — 무한 복제의 구조적 차단 (지시서 3장 3항).
 *
 * 수신 지갑이 코인을 받을 때, 계보의 회원 번호·날짜·발행량을 이미 알고 있는
 * 같은 회원의 코인들과 로컬 대조하여 "이 회원이 이 기간에 이만큼 걸었다는 것이
 * 인간적으로 가능한가"를 검사한다. 같은 날 40 SHV 초과, 주 300 SHV 같은
 * 물리적 불가능치는 즉시 거부. 탑 100 기준선 연동은 M2+에서 프로파일 갱신으로.
 */
import { DEFAULT_HUMAN_LIMIT_PROFILE, type HumanLimitProfile } from './params';
import { hashObject } from './crypto';
import type { Coin } from './types';

export interface DailyMintRecord {
  /** 걷기 증명의 해시 — 분할 형제 코인들이 같은 증명을 이중 계상하지 않도록 dedup 키. */
  proofHash: string;
  memberId: string;
  date: string;
  amountDshv: number;
}

/** 코인의 뿌리 걷기 증명에서 일자별 발행 기여를 추출 (GRANT 계보는 걷기 한계와 무관). */
export function walkMintContributions(coin: Coin): DailyMintRecord[] {
  const p = coin.provenance;
  switch (p.kind) {
    case 'WALK': {
      const proofHash = hashObject(p.proof);
      return p.proof.dailyBreakdown.map((d) => ({
        proofHash,
        memberId: p.proof.memberId,
        date: d.date,
        amountDshv: d.amountDshv,
      }));
    }
    case 'SPLIT':
      return walkMintContributions(p.parent);
    case 'GRANT':
      return [];
  }
}

export interface HumanLimitViolation {
  kind: 'DAILY' | 'WEEKLY';
  /** DAILY: 해당 일자. WEEKLY: 7일 창의 마지막 일자. */
  date: string;
  totalDshv: number;
  limitDshv: number;
}

export interface HumanLimitVerdict {
  ok: boolean;
  violations: HumanLimitViolation[];
}

function dateToEpochDay(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/**
 * 수신 검사: 후보 코인의 생성 회원에 대해, 로컬에 알려진 같은 회원의 코인들과
 * 합산했을 때 일일·주간 인간 한계를 넘는지 판정한다.
 */
export function checkHumanLimits(
  candidate: Coin,
  knownCoins: Coin[],
  profile: HumanLimitProfile = DEFAULT_HUMAN_LIMIT_PROFILE,
): HumanLimitVerdict {
  const memberId = candidate.memberId;
  const byProof = new Map<string, DailyMintRecord[]>();
  for (const coin of [candidate, ...knownCoins]) {
    const contributions = walkMintContributions(coin);
    const first = contributions[0];
    if (first && first.memberId === memberId && !byProof.has(first.proofHash)) {
      byProof.set(first.proofHash, contributions);
    }
  }

  const perDay = new Map<number, number>();
  for (const records of byProof.values()) {
    for (const r of records) {
      const day = dateToEpochDay(r.date);
      perDay.set(day, (perDay.get(day) ?? 0) + r.amountDshv);
    }
  }

  const violations: HumanLimitViolation[] = [];
  const days = [...perDay.keys()].sort((a, b) => a - b);

  for (const day of days) {
    const total = perDay.get(day)!;
    if (total > profile.dailyMaxDshv) {
      violations.push({
        kind: 'DAILY',
        date: new Date(day * 86_400_000).toISOString().slice(0, 10),
        totalDshv: total,
        limitDshv: profile.dailyMaxDshv,
      });
    }
  }

  for (const end of days) {
    let windowTotal = 0;
    for (let d = end - 6; d <= end; d++) windowTotal += perDay.get(d) ?? 0;
    if (windowTotal > profile.weeklyMaxDshv) {
      violations.push({
        kind: 'WEEKLY',
        date: new Date(end * 86_400_000).toISOString().slice(0, 10),
        totalDshv: windowTotal,
        limitDshv: profile.weeklyMaxDshv,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}
