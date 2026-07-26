/**
 * 검사용 표본 생성기 (시제품 점검 전용 — 감지기 번들에는 들어가지 않는다).
 * 정직한 걷기 코인 3장과, 서명은 유효하지만 물리가 거짓인 위조 코인 1장을 만든다.
 */
import { generateKeyPair, signerFromKeyPair } from '../../../packages/shared/src/crypto';
import { PendingWalkLedger, type SettlementDraft } from '../../../packages/shared/src/ledger';
import { buildWalkSegmentProof } from '../../../packages/shared/src/proof';
import { mintWalkCoin } from '../../../packages/shared/src/coin';
import { hashObject } from '../../../packages/shared/src/crypto';
import type { Coin, WalkSample } from '../../../packages/shared/src/types';

const T0 = Date.parse('2026-07-01T06:00:00Z');
const alice = signerFromKeyPair(generateKeyPair());

function sample(o: Partial<WalkSample> = {}): WalkSample {
  return { durationS: 72, distanceM: 100, steps: 140, tier: 'ON_COURSE', timestamp: T0, courseId: 'shvil-israel', ...o };
}

function honest(km: number, startAt: number): Coin {
  const ledger = new PendingWalkLedger({ memberId: 'm-alice' });
  let t = startAt;
  for (let i = 0; i < Math.round(km * 10); i++) {
    const v = ledger.recordSample(sample({ timestamp: t }));
    if (!v.accepted) throw new Error('표본 거절: ' + v.reason);
    t += 72_000;
  }
  const draft = ledger.settleOnSpend(t)!;
  return mintWalkCoin(buildWalkSegmentProof(draft, alice));
}

/** 원장을 우회해 초안을 직접 서명 — 변조 앱과 같은 방식. 서명은 유효하다. */
function forged(fields: Partial<SettlementDraft>): Coin {
  const amountDshv = fields.amountDshv ?? 400;
  const draft: SettlementDraft = {
    memberId: 'm-forger',
    settlement: 'MANUAL',
    startedAt: T0,
    settledAt: T0 + 20 * 60_000,
    distanceM: 100_000,
    stepCount: 140_000,
    courseIds: ['shvil-israel'],
    amountDshv,
    dailyBreakdown: [{ date: '2026-07-01', amountDshv }],
    sensorSummaryHash: hashObject({ seed: 1 }),
    ...fields,
  };
  return mintWalkCoin(buildWalkSegmentProof(draft, alice));
}

const honestCoins = [honest(5, T0), honest(4, T0 + 6 * 3600_000), honest(6, T0 + 14 * 3600_000)];
const out = {
  정직: { coins: honestCoins },
  위조: { coins: [forged({})] },
};
// eslint-disable-next-line no-console
console.log(JSON.stringify(out));
