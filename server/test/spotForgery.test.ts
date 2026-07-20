/**
 * 예치 위조 방어 (M12 보안 수리 — 적대적 검증 2026-07-20 지적).
 *
 * ★발견된 결함: `/spot/deposit`이 verifyCoin에 `trustedIssuerKeys`만 넘기고
 * `trustedRootKeys`·`requireIntegrityToken`을 넘기지 않았다. coin.ts의
 * verifyMembership은 **둘 다 없으면 검사를 생략하고 통과**시키므로(루트 미지정 +
 * 비필수 → return), 공격자가 자기 키쌍으로 자가 서명한 WALK 증명을 만들어
 * 임의 금액의 코인을 민팅해 예치하면 진짜 TREASURE 그랜트로 재배포됐다.
 * = 무제한 발행구 (총량 보존·헌법 제2조 붕괴).
 *
 * 이 테스트가 그 경로를 영구히 막는다: 무결성 증서 없는 걷기 코인은 예치에서
 * 거부되어야 한다. C 신뢰 지표(안 A)가 이미 같은 교훈을 반영한 것과 같은 방향 —
 * **서버가 직접 검증하지 않은 것은 가치의 근거가 될 수 없다.**
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildWalkSegmentProof,
  createTransfer,
  mintWalkCoin,
  type Coin,
} from '@shvil/shared';
import { buildApp } from '../src/app';
import { register, signedInject, T0, type TestIdentity } from './utils';

// 운영과 같은 설정으로 세운다 (devMode=false → 무결성 증서 필수).
const app = buildApp({ dbPath: ':memory:', devMode: true, kek: 'test-kek-forgery-0123456789abcdef' });
const DAY = 86_400_000;

let merchant: TestIdentity;
let reservePublicKey: string;

/**
 * ★부풀린 걷기 코인 — 변조 앱의 실제 공격 경로.
 *
 * 정직한 앱은 PendingWalkLedger가 인간 한계(일 400 dSHV)를 강제하지만, 변조 앱은
 * 그 원장을 **통째로 우회**하고 SettlementDraft를 손으로 지어 buildWalkSegmentProof에
 * 바로 넘길 수 있다 — draft.amountDshv는 평범한 객체 필드이고 상한 검사가 없다.
 * verifyWalkSegmentProof는 서명과 "일자합 = 총액" 정합만 보므로 이것을 통과시킨다.
 *
 * 서명은 **서버에 등록된 진짜 기기 키**로 한다 — 소유권·회원증서 검사를 전부
 * 정당하게 통과하므로, 이것을 막는 유일한 방어선은 인간 한계 검사뿐이다.
 */
function inflatedWalkCoin(who: TestIdentity, dshv: number): Coin {
  const day = new Date(T0).toISOString().slice(0, 10);
  const draft = {
    memberId: who.memberId,
    settlement: 'MANUAL' as const,
    startedAt: T0,
    settledAt: T0 + 3600_000,
    distanceM: dshv * 100,
    stepCount: dshv * 140,
    courseIds: ['shvil-israel'],
    amountDshv: dshv,
    dailyBreakdown: [{ date: day, amountDshv: dshv }],
    sensorSummaryHash: 'f'.repeat(64),
  };
  return mintWalkCoin(buildWalkSegmentProof(draft, who.signer));
}

beforeAll(async () => {
  await app.ready();
  merchant = await register(app, '+972-55-forge-1', 'forge@spot.io', '위조검증 사업자');
  const res = await signedInject(app, merchant, 'POST', '/spot', {
    spotId: 'spot-forgery',
    regionId: 'israel-national',
    displayName: '위조 검증 스팟',
    location: { lat: 33.231, lon: 35.651 },
    perClaimDshv: 50,
    requirePresence: false,
    validFrom: Date.now() - DAY,
    validUntil: Date.now() + DAY,
  });
  expect(res.statusCode).toBe(200);
  reservePublicKey = (res.json() as { reservePublicKey: string }).reservePublicKey;
});

afterAll(async () => {
  await app.close();
});

describe('★예치 위조 차단 — 무결성 증서 없는 걷기 코인은 가치가 되지 못한다', () => {
  it('인간 한계를 넘는 부풀린 걷기 코인을 예치하면 거부된다 (무제한 발행구 차단)', async () => {
    // 하루에 5,000 dSHV(=500 SHV) — 확정 일 상한 400 dSHV의 12.5배. 사람이
    // 물리적으로 만들 수 없는 액수다. 이것이 통과하면 사업자는 걷지 않고도
    // 원하는 만큼 슬롯을 만들어 진짜 TREASURE 그랜트로 재배포할 수 있다.
    const inflated = inflatedWalkCoin(merchant, 5000);
    const burn = createTransfer(inflated, merchant.signer, reservePublicKey, Date.now());
    const res = await signedInject(app, merchant, 'POST', '/spot/deposit', {
      spotId: 'spot-forgery',
      coins: [burn],
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('INVALID_DEPOSIT_COIN');
  });

  it('위조 예치가 거부됐으므로 슬롯이 생성되지 않는다 (총량 보존 유지)', async () => {
    const { spots } = (
      await signedInject(app, merchant, 'GET', '/spot/mine')
    ).json() as { spots: { spotId: string; depositTotalDshv: number; totalSlots: number }[] };
    const mine = spots.find((s) => s.spotId === 'spot-forgery');
    expect(mine).toBeDefined();
    expect(mine!.depositTotalDshv).toBe(0);
    expect(mine!.totalSlots).toBe(0);
  });
});
