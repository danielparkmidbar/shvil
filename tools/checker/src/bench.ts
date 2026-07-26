/** 규모 점검 — 지갑 전체를 한 번에 검사하면 얼마나 걸리는가 (시제품 점검 전용). */
import { generateKeyPair, signerFromKeyPair } from '../../../packages/shared/src/crypto';
import { PendingWalkLedger } from '../../../packages/shared/src/ledger';
import { buildWalkSegmentProof } from '../../../packages/shared/src/proof';
import { mintWalkCoin } from '../../../packages/shared/src/coin';
import { checkAuthenticity } from '../../../packages/shared/src/authenticity';
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
    ledger.recordSample(sample({ timestamp: t }));
    t += 72_000;
  }
  return mintWalkCoin(buildWalkSegmentProof(ledger.settleOnSpend(t)!, alice));
}

const coins: Coin[] = [];
// 하루 한 장씩, 서로 겹치지 않는 창으로 만든다.
for (let i = 0; i < 300; i++) coins.push(honest(2 + (i % 5), T0 + i * 86_400_000));

for (const n of [10, 50, 100, 200, 300]) {
  const subset = coins.slice(0, n);
  const t0 = performance.now();
  const r = checkAuthenticity(subset, { now: T0 + 400 * 86_400_000 });
  const ms = performance.now() - t0;
  // eslint-disable-next-line no-console
  console.log(`${String(n).padStart(4)}장 → ${ms.toFixed(0).padStart(6)} ms · ${r.verdict} · findings ${r.findings.length}`);
}
