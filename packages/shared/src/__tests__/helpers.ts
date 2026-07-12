import type { WalkSample, WalkTier } from '../types';
import { PendingWalkLedger } from '../ledger';

export const T0 = Date.parse('2026-07-01T06:00:00Z');

/** 정상 보행 창: 72초에 100m (5 km/h), 140걸음 (보폭 0.71m, 케이던스 117 spm). */
export function makeSample(overrides: Partial<WalkSample> = {}): WalkSample {
  return {
    durationS: 72,
    distanceM: 100,
    steps: 140,
    tier: 'ON_COURSE',
    timestamp: T0,
    courseId: 'shvil-israel',
    ...overrides,
  };
}

/** km 단위 정상 보행을 원장에 기록 (100m 창 × 10/km). 반환: 마지막 timestamp. */
export function walkKm(
  ledger: PendingWalkLedger,
  km: number,
  overrides: Partial<WalkSample> = {},
  startAt: number = T0,
): number {
  const windows = Math.round(km * 10);
  let t = startAt;
  for (let i = 0; i < windows; i++) {
    const verdict = ledger.recordSample(makeSample({ ...overrides, timestamp: t }));
    if (!verdict.accepted) throw new Error(`helper walkKm: sample rejected (${verdict.reason})`);
    t += 72_000;
  }
  return t;
}
