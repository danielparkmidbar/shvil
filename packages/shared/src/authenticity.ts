/**
 * 위폐 감지기 (M16) — 다니엘 쌤 2026-07-26.
 *
 * > "같은 지갑에서 형성될 수 있는 코인은 형성에 물리적 시간이 필요하다.
 * >  프로그램을 통해 코인을 복제하면 각각의 코인 형성 간의 시간 거리를 부여할 수 없다.
 * >  위폐 감지기 기능처럼 이 코인들이 정상적으로 만들어진 것인지 복제된 것인지 판별한다."
 *
 * ── 왜 이것이 필요한가 ────────────────────────────────────────────────
 * 서명 검증(verifyCoin)은 "이 코인이 **어떤 키로** 서명됐는가"만 답한다. 변조 앱이
 * 자기 기기 키로 조작된 걷기 증명을 서명하면 서명은 **완벽히 유효**하다. 그래서
 * 서명만으로는 위폐를 못 잡는다 — 실제로 이번 세션에 스팟 예치 무제한 발행구가
 * 그렇게 열려 있었다.
 *
 * 다니엘 쌤의 통찰은 방어의 축을 옮긴다: **위조자는 서명을 위조하지 않아도 되지만,
 * 시간은 위조할 수 없다.** 걷기 코인은 거리·걸음·시간·발행액을 한 몸에 품고 있어
 * 서로를 반증한다. 100 km를 20분에 걸을 수 없고, 한 사람이 같은 시각에 두 구간을
 * 걸을 수 없고, 프로그램이 찍어낸 코인들은 사람이 걸은 코인처럼 제각각일 수 없다.
 *
 * ── 이 모듈이 지키는 원칙 ─────────────────────────────────────────────
 * 1. **순수 함수다.** 서버·DB·네트워크가 없다. 지갑도, 사이트도, 제3자도 같은 코드로
 *    같은 답을 얻는다. 쉬빌 서버가 사라져도 판정은 계속된다 — 개발자도 통제할 수 없다.
 * 2. **결정적 위반과 통계적 신호를 절대 섞지 않는다.** FATAL은 물리적으로 불가능한
 *    것만이다. 통계는 SIGNAL이며 **혼자서는 결코 위조 판정을 내리지 않는다.**
 *    정직한 사람을 위폐범으로 지목하는 것이 위조를 놓치는 것보다 나쁘다(제3조).
 * 3. **좌표를 보지 않는다.** 코인에 좌표가 없고, 이 검사도 요구하지 않는다(제10조).
 * 4. **거래를 막지 않는다.** 리포트를 낼 뿐이다(제9조). 무엇을 할지는 사람이 정한다.
 * 5. **코어 판정은 누구에게나 같다.** 코어 검사에는 사용자가 돌릴 손잡이가 없다 —
 *    같은 코인을 넣으면 세상 누구의 기기에서든 같은 coreVerdict가 나온다. 그래야
 *    "이 코인이 진짜인가"에 대한 공통 답이 하나로 유지되어 화폐가 쪼개지지 않는다.
 *    더 엄격하게 보고 싶은 사람은 **규칙 팩**(rulePack.ts)을 얹는다 — 팩은 검사를
 *    더할 수만 있고, 코어를 끄거나 완화할 수는 구조적으로 없다.
 */
import {
  DEFAULT_BIKE_FILTER_PARAMS,
  DEFAULT_ECONOMIC_PARAMS,
  DEFAULT_HUMAN_LIMIT_PROFILE,
  DEFAULT_WALK_FILTER_PARAMS,
  MICRO_PER_DSHV,
  MICRO_PER_METER_BASE,
  type BikeFilterParams,
  type EconomicParams,
  type HumanLimitProfile,
  type WalkFilterParams,
} from './params';
import { verifyCoin, type VerifyCoinOptions } from './coin';
import { hashObject } from './crypto';
import { coinSerial, serialFromCoinId } from './serial';
import {
  applyRulePacks,
  CORE_SOURCE,
  sumByDate,
  validateRulePacks,
  type RulePack,
} from './rulePack';
import type { Coin, WalkSegmentProof } from './types';

// ── 판정 ──────────────────────────────────────────────────────────────

/**
 * FORGED  — 물리적으로 불가능한 것이 코인 안에 있다. 반박 불가.
 * SUSPECT — 결정적 위반은 없지만 사람의 걷기로 보기 어려운 통계적 신호가 여럿이다.
 * AUTHENTIC — 검사한 범위에서 위조 근거가 없다. (**"진짜임을 증명했다"가 아니다.**)
 * INCONCLUSIVE — 검사할 재료가 부족하다 (GRANT 계보만, 표본 1개 등).
 */
export type AuthenticityVerdict = 'FORGED' | 'SUSPECT' | 'AUTHENTIC' | 'INCONCLUSIVE';

export type AuthenticityCheckId =
  // ── 결정적 · 코인 한 장 안에서 ──
  | 'LINEAGE' // 서명·ID·계보 (verifyCoin)
  | 'TIME_WINDOW' // 창이 뒤집혔거나 미래다
  | 'SPEED_LIMIT' // 평균 속도가 사람 다리 힘을 넘는다
  | 'STRIDE' // 보폭이 인간 대역 밖
  | 'CADENCE' // 평균 케이던스가 상한 초과
  | 'MINT_RATE' // 발행액이 이 거리에서 나올 수 있는 최대치 초과
  | 'DAILY_CAP' // 하루 발행이 인간 한계 초과
  | 'BREAKDOWN_DATES' // 일자별 내역이 걷기 창 밖의 날짜
  | 'WINDOW_TOO_LONG' // ★창 길이가 상한 초과 — 과거로 밀어 만든 백데이팅
  | 'BREAKDOWN_TOO_MANY' // ★일자별 내역 항목이 창이 덮는 날 수보다 많다
  | 'PROOF_CAP' // ★증명 한 건의 절대 발행 상한 초과
  // ── 결정적 · 코인들 사이에서 (★다니엘 쌤의 "시간 거리") ──
  | 'WINDOW_OVERLAP' // 한 사람이 같은 시각에 두 구간을 걸었다
  | 'TIME_BUDGET' // 총 거리를 걷는 데 필요한 시간 > 실제 흐른 시간
  | 'SENSOR_DUPLICATE' // 서로 다른 증명이 같은 센서 요약 — 복사
  | 'COIN_DUPLICATE' // 같은 코인이 서로 다른 상태로 두 번
  // ── 통계적 · 혼자서는 위조 판정을 내리지 않는다 ──
  | 'INTERVAL_UNIFORMITY' // 코인 형성 간격이 기계적으로 균일
  | 'VALUE_UNIFORMITY' // 거리·걸음·시간이 매번 똑같다
  | 'TIMESTAMP_GRID' // 시각이 전부 딱 떨어지는 값
  | 'BURST_DENSITY'; // 짧은 시간에 증명이 몰려 있다

/** 팩 규칙이 만든 발견의 check 값 — 코어 검사 id와 절대 겹치지 않는다. */
export const PACK_RULE_CHECK = 'PACK_RULE';

export interface AuthenticityFinding {
  check: AuthenticityCheckId | typeof PACK_RULE_CHECK;
  /** FATAL = 물리적 불가능(결정적). SIGNAL = 통계적 의심(정황). */
  severity: 'FATAL' | 'SIGNAL';
  /** 사람이 읽는 한 줄 설명 (한국어). UI는 이것을 그대로 보여도 된다. */
  detail: string;
  /** 관련 증명의 해시 목록 — 어느 코인이 문제인지 짚어 준다. */
  proofHashes?: string[];
  /**
   * 이 발견이 어디서 왔는가. `'CORE'` = 코어 검사(누구에게나 같다).
   * 그 밖의 값은 규칙 팩의 id다 — 그 팩을 얹은 사람에게만 보이는 판단이다.
   */
  source: typeof CORE_SOURCE | (string & {});
  /** 팩 발견일 때 규칙 id. 코어 발견에는 없다. */
  ruleId?: string;
}

/** 적용된 규칙 팩의 요약 — 리포트를 받은 사람이 "무엇이 얹혔는지" 볼 수 있게. */
export interface AppliedRulePack {
  id: string;
  name: string;
  ruleCount: number;
}

export interface AuthenticityReport {
  /**
   * 최종 판정 = extendedVerdict (팩까지 반영). 팩이 없으면 coreVerdict와 같다.
   * 남과 비교할 때는 이 값이 아니라 **coreVerdict**를 비교해야 한다.
   */
  verdict: AuthenticityVerdict;
  /**
   * ★팩 없이 코어 검사만으로 낸 판정. 같은 코인이면 세상 누구의 기기에서든 같다.
   * 화폐성(모두가 같은 답을 계산한다)이 유지되는 지점이 정확히 여기다.
   */
  coreVerdict: AuthenticityVerdict;
  /** 코어 + 내가 얹은 팩까지 반영한 판정. 코어보다 관대해질 수 없다(오직 격상만). */
  extendedVerdict: AuthenticityVerdict;
  /** 검사 대상 코인들의 일련번호 (제출 순서). */
  serials: string[];
  /** 걷기 증명 개수 (분할 형제는 하나로 셈). */
  proofCount: number;
  /** GRANT(보너스·보물 등) 계보 코인 개수 — 걷기 물리 검사 대상이 아니다. */
  grantCount: number;
  /** 검사한 코인 총액 (dSHV). */
  totalDshv: number;
  /** 코어 + 팩 발견 전부. 각 항목의 source로 출처를 구분한다. */
  findings: AuthenticityFinding[];
  /** 코어 검사만의 발견 (source === 'CORE'). */
  coreFindings: AuthenticityFinding[];
  /** 규칙 팩이 더한 발견. 이것을 지워도 coreVerdict는 바뀌지 않는다. */
  packFindings: AuthenticityFinding[];
  /** 실제로 적용된 팩. */
  packs: AppliedRulePack[];
  /** 로드에 실패한 팩의 이유 (fail-closed). 팩이 실패해도 코어 검사는 그대로 돌았다. */
  packErrors: string[];
  /** 통계 검사가 실제로 돌았는가 (표본 부족이면 false). */
  statisticsApplied: boolean;
  /** 검사하지 못한 범위 — 정직화(제3조): 안 본 것을 본 것처럼 말하지 않는다. */
  notes: string[];
  /** 사람이 읽는 결론 한 문단 (팩 결과 포함). */
  summary: string;
  /** 팩을 빼고 코어만 말하는 결론 — 남에게 보여 줄 때 쓰는 문장. */
  coreSummary: string;
}

export interface AuthenticityOptions extends VerifyCoinOptions {
  economicParams?: EconomicParams;
  walkParams?: WalkFilterParams;
  bikeParams?: BikeFilterParams;
  humanLimits?: HumanLimitProfile;
  /** 통계 검사를 켜는 최소 증명 수. 기본 5 — 그 아래는 우연이 너무 흔하다. */
  minSamplesForStatistics?: number;
  /**
   * 커뮤니티 규칙 팩 — **검사를 더하기만 한다.** 코어를 끄거나 완화할 수 없다.
   *
   * 검증되지 않은 JSON을 그대로 넣어도 안전하다: 내부에서 validateRulePack을 다시
   * 돌리고, 실패한 팩은 버린 뒤 이유를 packErrors에 남긴다(코어 검사는 계속 돈다).
   */
  rulePacks?: readonly unknown[];
}

// ── 증명 수집 ─────────────────────────────────────────────────────────

interface ProofEntry {
  hash: string;
  proof: WalkSegmentProof;
}

/** 코인의 뿌리 걷기 증명 (SPLIT은 부모를 따라 올라간다). GRANT면 null. */
function rootWalkProof(coin: Coin): WalkSegmentProof | null {
  let node = coin;
  while (node.provenance.kind === 'SPLIT') node = node.provenance.parent;
  return node.provenance.kind === 'WALK' ? node.provenance.proof : null;
}

// ── 물리 상수 ─────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/**
 * ★백데이팅 방어 상수 (2026-07-26 추가).
 *
 * ── 무엇이 뚫려 있었나 ────────────────────────────────────────────────
 * 재현 결과: 변조 앱이 `startedAt`을 3년 전으로 밀고 `distanceM`을 그에 맞춰 키우면
 * **43,800 SHV**짜리 코인 한 장이 findings 0건으로 AUTHENTIC을 받았다. 10년으로
 * 늘리면 146,000 SHV. 발행량에 상한이 없었다 — 백데이팅 일수에 정비례해 무한히 커진다.
 *
 * 왜 세 방어선이 전부 통과시켰는가:
 *  - MINT_RATE는 **거리만의 함수**였다. 거리를 키우면 상한도 같이 커진다.
 *  - SPEED_LIMIT·CADENCE는 durationMs가 분모/우변이라, 창을 늘릴수록 **더 쉽게** 통과한다.
 *    (실측 평균 0.417 km/h · 9.26 spm — 백데이팅은 방어를 강화하는 게 아니라 무력화한다.)
 *  - BREAKDOWN_DATES의 허용 날짜 범위는 startedAt 자신에서 파생된다 — 자기가 자기를
 *    검사하므로 구조적으로 이 공격을 잡을 수 없다.
 *  - checkAcrossProofs는 증명이 1건이면 early return이고, 분할 형제는 dedup되어
 *    100장으로 쪼개 올려도 proofCount는 1이다.
 *
 * 즉 방어가 전부 "거리 대비 발행액"이라는 **비율**에만 걸려 있고, "실제로 흐른 시간"이라는
 * **절대량**에는 아무 데도 걸려 있지 않았다. 아래 세 상수가 그 절대량을 건다.
 */

/**
 * 걷기 구간 창(settledAt − startedAt)의 상한.
 *
 * 90일인 이유: 잠정 원장은 "며칠이고 계속" 쌓이는 것이 설계다(ledger.ts) — startedAt은
 * 첫 샘플 시각으로 정해져 정산 때까지 유지되므로, 오래 정산하지 않은 정직한 사용자의
 * 창도 길어질 수 있다. 이스라엘 트레일 종주가 45~60일이므로 **60일 종주자가 반드시
 * 통과해야 한다.** 90일은 거기에 한 달의 여유를 더한 값이다. 3년·10년 백데이팅은
 * 확실히 막고, 종주자는 억울하게 걸리지 않는다 — 결정적 판정은 언제나 관대한 쪽으로.
 *
 * 이 값은 **상수이지 옵션이 아니다.** 옵션으로 열면 사람마다 coreVerdict가 달라져
 * "이 코인이 진짜인가"의 공통 답이 사라진다. 더 엄격하게 보고 싶은 사람은 규칙 팩으로
 * `spanDays`에 자기 선을 그으면 된다(rulePacks/strictBuyer.ts의 span-over-14d 참조).
 */
export const MAX_SEGMENT_SPAN_DAYS = 90;
export const MAX_SEGMENT_SPAN_MS = MAX_SEGMENT_SPAN_DAYS * DAY_MS;

/** 일자별 내역의 날짜 판정에 쓰는 시간대 관용 (±1일). BREAKDOWN_DATES와 같은 폭이다. */
export const BREAKDOWN_TZ_TOLERANCE_DAYS = 1;

/**
 * 증명 한 건의 절대 발행 상한 (dSHV) = 창 상한일수 × 하루 상한.
 * 기본값으로 90일 × 400 dSHV = 36,000 dSHV(3,600 SHV). 하루도 빠짐없이 상한까지
 * 걸은 90일 종주자가 정확히 이 값에 닿는다 — 그 위는 시간이 모자란다.
 */
export function maxProofAmountDshv(limits: HumanLimitProfile): number {
  return MAX_SEGMENT_SPAN_DAYS * limits.dailyMaxDshv;
}

/** 창이 덮을 수 있는 역일 수 (시간대 관용 ±1일 포함). BREAKDOWN_DATES의 [lo, hi]와 같은 범위. */
function allowedBreakdownDayCount(startedAt: number, settledAt: number): number {
  const loDay = Math.floor((startedAt - BREAKDOWN_TZ_TOLERANCE_DAYS * DAY_MS) / DAY_MS);
  const hiDay = Math.floor((settledAt + BREAKDOWN_TZ_TOLERANCE_DAYS * DAY_MS) / DAY_MS);
  return hiDay - loDay + 1;
}

/**
 * 발행액 상한 계산: 1 m가 만들 수 있는 최대 microDshv.
 * ON_COURSE × 난이도 상한(×4.0)이 최대치다 — 이탈·일상은 1/1000이라 훨씬 적고,
 * 자전거는 ×0.5라 더 적다. 그러므로 이 상한은 **모든 걷기 코인에 유효**하다.
 */
function maxMicroPerMeter(eco: EconomicParams): number {
  return Math.floor((MICRO_PER_METER_BASE * eco.difficultyMaxTenths) / 10);
}

/**
 * 이 거리에서 나올 수 있는 최대 발행액 (dSHV).
 *
 * +1은 경계 오차 관용이다 — 원장은 창마다 floor를 적용하고 거리는 round로 남기므로
 * 실제 발행은 항상 이 값 이하이지만, 1 dSHV 반올림 폭을 억울하게 잡지 않는다.
 *
 * ★2026-07-26 재검토: 백데이팅 공격이 이 +1을 이용해 "정확히 경계를 스쳐" 통과한 것이
 * 아닌지 확인했다. **아니다.** 공격의 실제 값은 distanceM 10,950,000 m → 상한
 * floor(10,950,000/25) = 438,000, 발행액도 정확히 438,000이었다. 즉 +1이 없었어도
 * `438000 > 438000`은 거짓이라 그대로 통과했다 — 공격은 거리를 발행액에 맞춰 키우는
 * 방식이므로 1 dSHV의 관용과는 무관하다.
 *
 * 반대로 +1을 없애면 정직한 코인이 걸릴 수 있다: 거리 round가 0.5 m 내려가면 상한이
 * 0.02 dSHV 줄고, 그 폭이 정수 경계를 넘는 순간 1 dSHV 오탐이 난다. 잡지도 못하면서
 * 정직한 사람만 지목하는 변경이므로 **유지한다**(제3조). 백데이팅은 아래 세 검사
 * (WINDOW_TOO_LONG · BREAKDOWN_TOO_MANY · PROOF_CAP)가 막는다.
 */
function maxDshvForDistance(distanceM: number, eco: EconomicParams): number {
  return Math.floor((Math.max(0, distanceM) * maxMicroPerMeter(eco)) / MICRO_PER_DSHV) + 1;
}

/**
 * 사람이 낼 수 있는 최대 이동 속도 (m/s).
 * 코인 계보에는 이동 수단이 새겨지지 않으므로(humanLimits.ts 주석 참조)
 * **자전거 상한을 쓴다** — 도보 상한으로 재면 자전거 이용자를 위폐범으로 몰게 된다.
 * 결정적 판정은 언제나 가장 관대한 쪽으로 잡는다.
 */
function maxSpeedMps(bike: BikeFilterParams): number {
  return bike.maxBikeSpeedKmh / 3.6;
}

// ── 단일 증명 물리 검사 (전부 결정적) ─────────────────────────────────

function checkProofPhysics(
  entry: ProofEntry,
  opts: Required<Pick<AuthenticityOptions, 'economicParams' | 'walkParams' | 'bikeParams' | 'humanLimits'>>,
  now: number,
  out: AuthenticityFinding[],
): void {
  const { proof, hash } = entry;
  const at = (detail: string, check: AuthenticityCheckId) =>
    out.push({ check, severity: 'FATAL', detail, proofHashes: [hash], source: CORE_SOURCE });

  const durationMs = proof.settledAt - proof.startedAt;

  // ① 시간 창 자체가 성립하는가.
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    at(`걷기 구간의 끝(${iso(proof.settledAt)})이 시작(${iso(proof.startedAt)})보다 앞서거나 같습니다. 시간이 흐르지 않은 걷기는 존재할 수 없습니다.`, 'TIME_WINDOW');
    return; // 창이 무의미하면 이후 속도·케이던스 계산도 무의미하다
  }
  // 미래의 걷기 — 기기 시계를 앞당겨 일일 상한을 우회하는 수법.
  if (proof.settledAt > now + 24 * 3600_000) {
    at(`정산 시각이 미래(${iso(proof.settledAt)})입니다. 아직 오지 않은 날의 걷기는 존재할 수 없습니다.`, 'TIME_WINDOW');
  }

  // ①-b ★창 길이 상한 — 백데이팅의 정면 차단.
  //     startedAt을 과거로 밀수록 속도·케이던스 검사는 오히려 쉬워지므로, 창 자체에
  //     절대 상한을 걸지 않으면 남는 방어가 없다. 60일 종주는 통과, 3년은 차단.
  if (durationMs > MAX_SEGMENT_SPAN_MS) {
    at(
      `한 걷기 구간이 ${fmtDur(durationMs)}(${iso(proof.startedAt)} ~ ${iso(proof.settledAt)})에 걸쳐 있습니다. ` +
        `잠정 원장은 며칠이고 쌓이지만 상한은 ${MAX_SEGMENT_SPAN_DAYS}일입니다(종주 60일에 한 달의 여유를 더한 값). ` +
        `시작 시각을 과거로 밀어 발행액을 키운 기록입니다.`,
      'WINDOW_TOO_LONG',
    );
  }

  // ①-c ★일자별 내역 개수 상한 — "걷지 않은 날 수만큼 발행 항목이 있을 수 없다."
  //     날짜 하나하나는 BREAKDOWN_DATES가 보지만, **개수**는 아무도 보지 않았다.
  //     같은 날짜를 여러 줄로 반복해 넣는 수법도 여기서 함께 걸린다.
  const allowedDays = allowedBreakdownDayCount(proof.startedAt, proof.settledAt);
  if (proof.dailyBreakdown.length > allowedDays) {
    at(
      `일자별 내역이 ${proof.dailyBreakdown.length.toLocaleString()}줄인데, 이 걷기 구간이 걸칠 수 있는 날은 최대 ${allowedDays.toLocaleString()}일입니다(시간대 관용 ±${BREAKDOWN_TZ_TOLERANCE_DAYS}일 포함). ` +
        `걷지 않은 날 수만큼 발행 항목이 있을 수는 없습니다.`,
      'BREAKDOWN_TOO_MANY',
    );
  }

  // ①-d ★증명 한 건의 절대 발행 상한 — 창 상한 × 하루 상한.
  //     비율(거리 대비 발행액)이 아니라 **절대량**을 거는 유일한 검사다.
  const proofCapDshv = maxProofAmountDshv(opts.humanLimits);
  if (proof.amountDshv > proofCapDshv) {
    at(
      `증명 한 건이 ${(proof.amountDshv / 10).toFixed(1)} SHV를 발행했습니다. ` +
        `하루 상한 ${(opts.humanLimits.dailyMaxDshv / 10).toFixed(0)} SHV를 ${MAX_SEGMENT_SPAN_DAYS}일 내내 채워도 ` +
        `${(proofCapDshv / 10).toFixed(0)} SHV가 한 구간의 최대치입니다.`,
      'PROOF_CAP',
    );
  }

  // ② 평균 속도 — 정수 비교로 부동소수 오차를 피한다.
  //    distanceM/(durationMs/1000) > maxMps  ⟺  distanceM*1000 > maxMps*durationMs
  const maxMps = maxSpeedMps(opts.bikeParams);
  if (proof.distanceM * 1000 > maxMps * durationMs) {
    const speedKmh = (proof.distanceM / (durationMs / 1000)) * 3.6;
    at(`평균 속도 ${speedKmh.toFixed(1)} km/h — 사람 다리 힘의 상한(${opts.bikeParams.maxBikeSpeedKmh} km/h)을 넘습니다. ${fmtM(proof.distanceM)}를 ${fmtDur(durationMs)} 만에 이동한 것으로 기록되어 있습니다.`, 'SPEED_LIMIT');
  }

  // ③ 보폭 — 걸음이 0이면 자전거로 보고 건너뛴다(자전거는 만보기 걸음이 없다).
  if (proof.stepCount > 0 && proof.distanceM > 0) {
    const stride = proof.distanceM / proof.stepCount;
    const w = opts.walkParams;
    const min = w.strideMinM * (1 - w.strideToleranceRatio);
    const max = w.strideMaxM * (1 + w.strideToleranceRatio);
    // 자전거는 걸음 대비 거리가 크므로 상한 위반이 정상일 수 있다 → 하한만 결정적으로 본다.
    // (한 걸음에 0.35 m 미만인데 거리가 인정됐다면 걸음 수가 부풀려진 것이다.)
    if (stride < min) {
      at(`한 걸음이 ${stride.toFixed(2)} m — 사람 보폭 하한(${min.toFixed(2)} m) 미만입니다. 걸음 수 ${proof.stepCount.toLocaleString()}보에 비해 거리 ${fmtM(proof.distanceM)}가 너무 짧습니다(걸음 수가 부풀려졌습니다).`, 'STRIDE');
    } else if (stride > max && proof.stepCount > 0) {
      // 상한 초과는 자전거·GPS 튐일 수 있어 정황으로만 남긴다.
      out.push({
        check: 'STRIDE',
        severity: 'SIGNAL',
        detail: `한 걸음이 ${stride.toFixed(2)} m로 도보 대역(최대 ${max.toFixed(2)} m)을 넘습니다. 자전거였다면 정상입니다.`,
        proofHashes: [hash],
        source: CORE_SOURCE,
      });
    }

    // ④ 케이던스 상한 — 휴식이 섞이면 평균은 **낮아지므로**, 평균이 상한을 넘으면
    //    구간 전체가 기계적 반복이라는 뜻이다(하한은 휴식 때문에 검사할 수 없다).
    if (proof.stepCount * 60_000 > opts.walkParams.cadenceMaxSpm * durationMs) {
      const spm = proof.stepCount / (durationMs / 60_000);
      at(`분당 ${spm.toFixed(0)}걸음 — 사람 걸음의 상한(${opts.walkParams.cadenceMaxSpm}보/분)을 넘습니다. 휴식이 섞이면 평균은 오히려 낮아지므로, 이 평균은 기계적 반복입니다.`, 'CADENCE');
    }
  }

  // ⑤ ★발행액 상한 — 이 거리에서 물리적으로 나올 수 없는 액수인가.
  //    이번 세션에 발견된 스팟 무제한 발행구가 정확히 이 검사에 걸린다.
  const maxDshv = maxDshvForDistance(proof.distanceM, opts.economicParams);
  if (proof.amountDshv > maxDshv) {
    const neededM = Math.ceil((proof.amountDshv * MICRO_PER_DSHV) / maxMicroPerMeter(opts.economicParams));
    at(`${(proof.amountDshv / 10).toFixed(1)} SHV를 발행했는데 기록된 거리는 ${fmtM(proof.distanceM)}뿐입니다. 최고 난이도(×${(opts.economicParams.difficultyMaxTenths / 10).toFixed(1)})를 다 쳐줘도 이 액수에는 ${fmtM(neededM)} 이상이 필요합니다.`, 'MINT_RATE');
  }

  // ⑥ 일자별 인간 한계 — 하루에 넘을 수 없는 발행량.
  //    ★날짜로 **합산**해서 본다: 같은 날짜를 여러 줄로 쪼개 넣어 상한을 우회할 수 없다.
  //    (예전에는 줄 단위로 봐서 400을 열 줄로 쪼개면 하루 4,000이 통과했다.)
  for (const [date, amountDshv] of sumByDate(proof.dailyBreakdown)) {
    if (amountDshv > opts.humanLimits.dailyMaxDshv) {
      at(`${date} 하루에 ${(amountDshv / 10).toFixed(1)} SHV — 하루 상한 ${(opts.humanLimits.dailyMaxDshv / 10).toFixed(0)} SHV를 넘습니다.`, 'DAILY_CAP');
    }
  }

  // ⑦ 일자별 내역이 걷기 창 안의 날짜인가.
  //    시간대 오프셋(-12h ~ +14h)을 흡수하기 위해 창을 하루씩 넓혀 잡는다.
  const lo = dayString(proof.startedAt - 86_400_000);
  const hi = dayString(proof.settledAt + 86_400_000);
  for (const day of proof.dailyBreakdown) {
    if (day.date < lo || day.date > hi) {
      at(`일자별 내역에 ${day.date}가 있는데, 이 걷기는 ${iso(proof.startedAt)}부터 ${iso(proof.settledAt)}까지입니다. 걷지 않은 날에 발행이 귀속되어 있습니다.`, 'BREAKDOWN_DATES');
    }
  }
}

// ── 증명들 **사이** 검사 — ★다니엘 쌤의 "형성 간 시간 거리" ──────────

function checkAcrossProofs(
  entries: ProofEntry[],
  opts: Required<Pick<AuthenticityOptions, 'bikeParams'>>,
  out: AuthenticityFinding[],
): void {
  if (entries.length < 2) return;

  // 회원별로 나눈다 — 시간 거리는 "한 몸"에 대한 제약이다.
  const byMember = new Map<string, ProofEntry[]>();
  for (const e of entries) {
    const list = byMember.get(e.proof.memberId) ?? [];
    list.push(e);
    byMember.set(e.proof.memberId, list);
  }

  for (const [memberId, list] of byMember) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.proof.startedAt - b.proof.startedAt);

    // ① 창 겹침 — 한 사람이 같은 시각에 두 구간을 걸을 수는 없다.
    //    지갑의 잠정 원장은 정산 때마다 비워지므로 정상 코인의 창은 절대 겹치지 않는다.
    //    겹친다는 것은 원장이 둘이었다는 뜻이다 = 복제.
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (cur.proof.startedAt < prev.proof.settledAt) {
        const overlapMs = Math.min(prev.proof.settledAt, cur.proof.settledAt) - cur.proof.startedAt;
        const sameDevice = prev.proof.devicePublicKey === cur.proof.devicePublicKey;
        out.push({
          check: 'WINDOW_OVERLAP',
          severity: 'FATAL',
          detail:
            `회원 ${memberId}의 두 걷기가 ${fmtDur(overlapMs)} 겹칩니다 ` +
            `(${iso(cur.proof.startedAt)} 시작 · 앞 구간은 ${iso(prev.proof.settledAt)}에 끝남). ` +
            (sameDevice
              ? `같은 기기에서 나왔는데도 겹칩니다 — 한 원장에서는 불가능합니다.`
              : `서로 다른 기기입니다 — 같은 회원 번호로 두 대를 동시에 돌린 기록입니다.`),
          proofHashes: [prev.hash, cur.hash],
          source: CORE_SOURCE,
        });
      }
    }

    // ② ★시간 예산 — 다니엘 쌤 통찰의 핵심.
    //    이 코인들이 주장하는 거리를 전부 이동하려면 최소 얼마의 시간이 필요한가.
    //    그 합이 실제로 흐른 시간(첫 시작 ~ 마지막 정산)보다 크면, 복제 말고는 설명이 없다.
    //    복제 프로그램은 코인을 찍어낼 수는 있어도 **코인들 사이에 시간을 만들어 넣을 수 없다.**
    const spanMs = sorted[sorted.length - 1]!.proof.settledAt - sorted[0]!.proof.startedAt;
    const totalDistanceM = sorted.reduce((s, e) => s + Math.max(0, e.proof.distanceM), 0);
    const neededMs = (totalDistanceM / maxSpeedMps(opts.bikeParams)) * 1000;
    if (neededMs > spanMs) {
      out.push({
        check: 'TIME_BUDGET',
        severity: 'FATAL',
        detail:
          `회원 ${memberId}의 코인 ${sorted.length}장이 합계 ${fmtM(totalDistanceM)} 이동을 주장합니다. ` +
          `사람이 낼 수 있는 최고 속도(${opts.bikeParams.maxBikeSpeedKmh} km/h)로도 최소 ${fmtDur(neededMs)}가 걸리는데, ` +
          `실제로 흐른 시간은 ${fmtDur(spanMs)}뿐입니다. 코인은 복제할 수 있어도 코인 사이의 시간은 만들어 넣을 수 없습니다.`,
        proofHashes: sorted.map((e) => e.hash),
        source: CORE_SOURCE,
      });
    }
  }

  // ③ 센서 요약 중복 — 서로 다른 증명이 같은 센서 요약 해시를 가질 수 없다.
  //    요약에는 시작 시각(ms)이 들어가므로 우연 일치 확률은 0이다. 같으면 복사다.
  const bySensor = new Map<string, ProofEntry[]>();
  for (const e of entries) {
    if (!e.proof.sensorSummaryHash) continue;
    const list = bySensor.get(e.proof.sensorSummaryHash) ?? [];
    list.push(e);
    bySensor.set(e.proof.sensorSummaryHash, list);
  }
  for (const [, list] of bySensor) {
    if (list.length < 2) continue;
    const members = new Set(list.map((e) => e.proof.memberId));
    if (members.size === 1) {
      // 같은 회원의 서로 다른 증명이 같은 센서 요약 — 한 원장은 정산마다 비워지므로
      // 요약(시작 시각 ms 포함)이 반복될 수 없다. 복사다.
      out.push({
        check: 'SENSOR_DUPLICATE',
        severity: 'FATAL',
        detail: `같은 회원의 서로 다른 걷기 증명 ${list.length}개가 똑같은 센서 요약을 가지고 있습니다. 센서 요약에는 시작 시각(밀리초)이 들어가므로 한 원장에서 반복될 수 없습니다 — 하나를 복사해 만든 것입니다.`,
        proofHashes: list.map((e) => e.hash),
        source: CORE_SOURCE,
      });
    } else {
      // 서로 다른 회원 — 함께 걸은 두 사람이 우연히 같은 요약을 가질 극미한 여지가
      // 있으므로 결정적으로 단정하지 않는다 (관대한 쪽으로).
      out.push({
        check: 'SENSOR_DUPLICATE',
        severity: 'SIGNAL',
        detail: `서로 다른 회원 ${members.size}명의 걷기 증명이 똑같은 센서 요약을 가지고 있습니다. 남의 걷기 기록을 복사해 자기 이름으로 서명한 정황일 수 있습니다.`,
        proofHashes: list.map((e) => e.hash),
        source: CORE_SOURCE,
      });
    }
  }
}

// ── 통계 검사 — 혼자서는 결코 위조 판정을 내리지 않는다 ───────────────

function coefficientOfVariation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return null;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

function checkStatistics(entries: ProofEntry[], minSamples: number, out: AuthenticityFinding[]): boolean {
  const byMember = new Map<string, ProofEntry[]>();
  for (const e of entries) {
    const list = byMember.get(e.proof.memberId) ?? [];
    list.push(e);
    byMember.set(e.proof.memberId, list);
  }

  let applied = false;
  for (const [memberId, list] of byMember) {
    if (list.length < minSamples) continue;
    applied = true;
    const sorted = [...list].sort((a, b) => a.proof.startedAt - b.proof.startedAt);
    const hashes = sorted.map((e) => e.hash);

    // ① 형성 간격의 균일성 — 사람은 매번 다른 때에 정산한다.
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(sorted[i]!.proof.startedAt - sorted[i - 1]!.proof.startedAt);
    }
    const gapCv = coefficientOfVariation(gaps);
    if (gapCv !== null && gapCv < 0.02) {
      out.push({
        check: 'INTERVAL_UNIFORMITY',
        severity: 'SIGNAL',
        detail: `회원 ${memberId}의 코인 ${sorted.length}장이 거의 일정한 간격(편차 ${(gapCv * 100).toFixed(2)}%)으로 만들어졌습니다. 사람의 걷기는 이렇게 규칙적이지 않습니다.`,
        proofHashes: hashes,
        source: CORE_SOURCE,
      });
    }

    // ② 값의 균일성 — 사람은 매번 같은 거리를 같은 걸음 수로 걷지 않는다.
    const distCv = coefficientOfVariation(sorted.map((e) => e.proof.distanceM));
    const stepCv = coefficientOfVariation(sorted.map((e) => e.proof.stepCount));
    if (distCv !== null && stepCv !== null && distCv < 0.01 && stepCv < 0.01) {
      out.push({
        check: 'VALUE_UNIFORMITY',
        severity: 'SIGNAL',
        detail: `코인 ${sorted.length}장의 거리와 걸음 수가 거의 완전히 같습니다(편차 ${(distCv * 100).toFixed(2)}% / ${(stepCv * 100).toFixed(2)}%). 같은 값을 찍어낸 흔적입니다.`,
        proofHashes: hashes,
        source: CORE_SOURCE,
      });
    }

    // ③ 시각의 격자 정렬 — 실제 센서 시각은 밀리초가 제각각이다.
    if (sorted.every((e) => e.proof.startedAt % 1000 === 0 && e.proof.settledAt % 1000 === 0)) {
      out.push({
        check: 'TIMESTAMP_GRID',
        severity: 'SIGNAL',
        detail: `코인 ${sorted.length}장의 시작·종료 시각이 모두 밀리초 000으로 딱 떨어집니다. 센서에서 온 시각이라면 우연히 그럴 확률은 사실상 0입니다.`,
        proofHashes: hashes,
        source: CORE_SOURCE,
      });
    }

    // ④ 몰림 — 24시간 안에 정산이 지나치게 많다.
    //    사람도 여러 번 정산할 수 있으므로 정황일 뿐이다.
    const dayMs = 86_400_000;
    for (let i = 0; i < sorted.length; i++) {
      const windowEnd = sorted[i]!.proof.startedAt + dayMs;
      let count = 0;
      for (let j = i; j < sorted.length && sorted[j]!.proof.startedAt <= windowEnd; j++) count++;
      if (count > 20) {
        out.push({
          check: 'BURST_DENSITY',
          severity: 'SIGNAL',
          detail: `24시간 안에 걷기 정산이 ${count}건 있습니다. 물리적으로 불가능하지는 않지만 사람의 사용 방식과 크게 다릅니다.`,
          proofHashes: hashes,
          source: CORE_SOURCE,
        });
        break;
      }
    }
  }
  return applied;
}

// ── 진입점 ────────────────────────────────────────────────────────────

/**
 * 위폐 감지 — 코인 한 장 또는 여러 장을 받아 리포트를 만든다.
 *
 * 여러 장을 함께 넣을수록 강해진다. 코인 한 장의 물리 정합은 위조자가 맞출 수 있지만,
 * **여러 장 사이의 시간 거리**는 맞추려면 실제로 그만큼 걸어야 하기 때문이다.
 * 그래서 사이트는 "지갑 전체 내보내기"를 받는다.
 */
export function checkAuthenticity(coins: Coin[], options: AuthenticityOptions = {}): AuthenticityReport {
  const now = options.now ?? Date.now();
  const opts = {
    economicParams: options.economicParams ?? DEFAULT_ECONOMIC_PARAMS,
    walkParams: options.walkParams ?? DEFAULT_WALK_FILTER_PARAMS,
    bikeParams: options.bikeParams ?? DEFAULT_BIKE_FILTER_PARAMS,
    humanLimits: options.humanLimits ?? DEFAULT_HUMAN_LIMIT_PROFILE,
  };
  const minSamples = options.minSamplesForStatistics ?? 5;
  /**
   * ★코어 발견만 담는 배열이다. 규칙 팩은 이 배열에 손댈 수 없다 —
   * 팩 해석기(applyRulePacks)는 이 배열을 인자로 받지도 않는다.
   */
  const coreFindings: AuthenticityFinding[] = [];
  const findings = coreFindings; // 아래 코어 검사들이 쓰는 이름 (의미는 위와 같다)

  // 같은 코인을 여러 번 넣은 경우: 내용이 같으면 한 장으로, 다르면 이중 사용 정황.
  const byCoinId = new Map<string, Set<string>>();
  for (const coin of coins) {
    const states = byCoinId.get(coin.id) ?? new Set<string>();
    states.add(hashObject({ chain: coin.transferChain }));
    byCoinId.set(coin.id, states);
  }
  for (const [coinId, states] of byCoinId) {
    if (states.size > 1) {
      findings.push({
        check: 'COIN_DUPLICATE',
        severity: 'FATAL',
        detail: `일련번호 ${serialOf(coinId)} 코인이 서로 다른 이전 기록 ${states.size}개로 제출되었습니다. 같은 코인이 두 갈래로 갈라졌다는 뜻이며, 이는 이중 지불입니다.`,
        source: CORE_SOURCE,
      });
    }
  }

  // ① 계보 검증 — 서명·ID. 여기서 걸리면 나머지 검사는 의미가 없다.
  const verifyOptions: VerifyCoinOptions = {
    ...(options.trustedIssuerKeys !== undefined ? { trustedIssuerKeys: options.trustedIssuerKeys } : {}),
    ...(options.trustedRootKeys !== undefined ? { trustedRootKeys: options.trustedRootKeys } : {}),
    ...(options.requireIntegrityToken !== undefined ? { requireIntegrityToken: options.requireIntegrityToken } : {}),
    ...(options.allowPendingLastLink !== undefined ? { allowPendingLastLink: options.allowPendingLastLink } : {}),
    now,
  };
  const seenCoinIds = new Set<string>();
  let grantCount = 0;
  let totalDshv = 0;
  const serials: string[] = [];
  const entries = new Map<string, ProofEntry>();

  for (const coin of coins) {
    serials.push(coinSerial(coin));
    if (seenCoinIds.has(coin.id)) continue;
    seenCoinIds.add(coin.id);
    totalDshv += coin.amountDshv;

    const verdict = verifyCoin(coin, verifyOptions);
    // 신뢰 키 목록이 **주어지지 않은** 환경(예: 오프라인 검사)에서는 발행자 신원을
    // 판정할 수 없다 — 그것을 위조 판정으로 바꾸면 정직한 보너스·보물 코인이 전부
    // 위폐가 된다. "확인 못 함"은 notes로 정직하게 남기고, FATAL로 삼지 않는다.
    const reasons =
      options.trustedIssuerKeys === undefined
        ? verdict.reasons.filter((r) => r !== 'UNTRUSTED_ISSUER')
        : verdict.reasons;
    if (reasons.length > 0) {
      findings.push({
        check: 'LINEAGE',
        severity: 'FATAL',
        detail: `일련번호 ${coinSerial(coin)}: 계보 검증 실패 (${reasons.join(', ')}). 서명 또는 계보가 손상되었습니다.`,
        source: CORE_SOURCE,
      });
    }

    const proof = rootWalkProof(coin);
    if (!proof) {
      grantCount++;
      continue;
    }
    // 분할 형제는 같은 뿌리 증명을 공유한다 — 반드시 dedup해야 한다.
    // (안 하면 자기 자신과 창이 겹친다고 오판해 정직한 사람을 위폐범으로 만든다.)
    const hash = hashObject(proof);
    if (!entries.has(hash)) entries.set(hash, { hash, proof });
  }

  // ② 증명 한 장의 물리 정합.
  const list = [...entries.values()];
  for (const entry of list) checkProofPhysics(entry, opts, now, findings);

  // ③ 증명들 사이의 시간 거리 (★핵심).
  checkAcrossProofs(list, { bikeParams: opts.bikeParams }, findings);

  // ④ 통계 — 정황일 뿐.
  const statisticsApplied = checkStatistics(list, minSamples, findings);

  // 검사하지 못한 범위를 정직하게 남긴다 (제3조).
  const notes: string[] = [];
  if (grantCount > 0 && options.trustedIssuerKeys === undefined) {
    notes.push(`보너스·보물 계보 ${grantCount}장의 발행자 신원은 확인하지 않았습니다 (신뢰 발행 키 목록 없음). 서명 자체의 정합만 검사했습니다.`);
  }
  if (list.length > 0 && options.trustedRootKeys === undefined) {
    notes.push(`회원 증서(기기 무결성)는 확인하지 않았습니다 (신뢰 루트 키 없음). 걷기의 물리 정합만으로 판정했습니다.`);
  }
  if (list.length === 1) {
    notes.push(`코인 사이의 시간 거리 검사는 코인이 2장 이상일 때 작동합니다. 지갑 전체를 함께 검사하면 훨씬 정확해집니다.`);
  }

  // ⑤ ★코어 판정을 **먼저, 팩과 무관하게** 확정한다.
  //    이 순서가 곧 보장이다 — 팩이 무엇을 하든 이 값은 이미 정해졌다.
  const coreVerdict = decideVerdict(coreFindings, list.length, grantCount);
  const coreSummary = buildSummary(coreFindings, list.length, grantCount, statisticsApplied);

  // ⑥ 규칙 팩 — 검사를 **더하기만** 한다. 로드에 실패한 팩은 버리고 이유만 남긴다.
  const { packs, errors: packErrors } = validateRulePacks(options.rulePacks ?? []);
  const packFindings: AuthenticityFinding[] = applyRulePacks(packs, list, { now }).map((f) => ({
    check: PACK_RULE_CHECK,
    severity: f.severity,
    // 팩이 만든 문장임을 문장 자체에 새긴다 — 코어 판정을 사칭할 수 없게.
    detail: `[규칙 팩 "${f.packName}" · ${f.ruleId}] ${f.detail}`,
    proofHashes: f.proofHashes,
    source: f.packId,
    ruleId: f.ruleId,
  }));
  if (packErrors.length > 0) {
    notes.push(
      `규칙 팩 ${packErrors.length}개를 읽지 못해 적용하지 않았습니다 (모르는 규칙은 통과시키지 않습니다). 코어 검사는 그대로 수행했습니다.`,
    );
  }

  // ⑦ 확장 판정 — 코어 + 팩. escalateOnly가 "팩은 관대해질 수 없다"를 한 번 더 못 박는다.
  const allFindings = [...coreFindings, ...packFindings];
  const extendedVerdict = escalateOnly(coreVerdict, decideVerdict(allFindings, list.length, grantCount));

  return {
    verdict: extendedVerdict,
    coreVerdict,
    extendedVerdict,
    serials,
    proofCount: list.length,
    grantCount,
    totalDshv,
    findings: allFindings,
    coreFindings,
    packFindings,
    packs: packs.map((p) => ({ id: p.id, name: p.name, ruleCount: p.rules.length })),
    packErrors,
    statisticsApplied,
    notes,
    summary: withPackSummary(coreSummary, coreVerdict, extendedVerdict, packFindings, packs),
    coreSummary,
  };
}

/**
 * 판정 격상 전용 결합 — **절대 내려가지 않는다.**
 *
 * decideVerdict가 이미 코어 발견을 포함해 계산하므로 수학적으로는 중복이다. 그래도
 * 두는 이유: 앞으로 누가 decideVerdict를 고치더라도 "팩이 코어를 완화한다"는 사고가
 * 여기서 한 번 더 막히기 때문이다. 이 한 줄이 화폐의 마지막 잠금장치다.
 */
function escalateOnly(core: AuthenticityVerdict, extended: AuthenticityVerdict): AuthenticityVerdict {
  const rank: Record<AuthenticityVerdict, number> = { INCONCLUSIVE: 0, AUTHENTIC: 1, SUSPECT: 2, FORGED: 3 };
  return rank[extended] > rank[core] ? extended : core;
}

/** 팩 결과를 코어 문장 뒤에 덧붙인다 — 둘을 섞지 않는다. */
function withPackSummary(
  coreSummary: string,
  coreVerdict: AuthenticityVerdict,
  extendedVerdict: AuthenticityVerdict,
  packFindings: AuthenticityFinding[],
  packs: RulePack[],
): string {
  if (packs.length === 0) return coreSummary;
  const names = packs.map((p) => `"${p.name}"`).join(', ');
  if (packFindings.length === 0) {
    return `${coreSummary}\n\n규칙 팩 ${names}도 함께 돌렸고, 걸린 규칙은 없습니다.`;
  }
  const fatal = packFindings.filter((f) => f.severity === 'FATAL').length;
  const signal = packFindings.length - fatal;
  return (
    `${coreSummary}\n\n여기에 더해 규칙 팩 ${names}이 ${packFindings.length}건을 지목했습니다` +
    `(받지 않겠다 ${fatal}건 · 물어볼 만하다 ${signal}건). ` +
    `팩 판정(${extendedVerdict})은 **이 팩을 얹은 사람의 기준**이며, 위조 여부에 대한 공통 답은 코어 판정(${coreVerdict})입니다. ` +
    `팩은 검사를 더할 수만 있고 코어를 완화할 수 없습니다.`
  );
}

/** 코인 한 장 검사 — 편의 함수. 시간 거리 검사는 표본이 하나라 작동하지 않는다. */
export function checkCoinAuthenticity(coin: Coin, options: AuthenticityOptions = {}): AuthenticityReport {
  return checkAuthenticity([coin], options);
}

/**
 * 판정 규칙 — 여기가 이 모듈에서 가장 조심해야 하는 곳이다.
 * **통계 신호는 몇 개가 쌓여도 FORGED가 되지 않는다.** 결정적 위반만이 위조를 말한다.
 */
function decideVerdict(
  findings: AuthenticityFinding[],
  proofCount: number,
  grantCount: number,
): AuthenticityVerdict {
  if (findings.some((f) => f.severity === 'FATAL')) return 'FORGED';
  const signals = findings.filter((f) => f.severity === 'SIGNAL');
  // 신호가 둘 이상 겹칠 때만 의심으로 올린다 — 하나는 우연일 수 있다.
  if (signals.length >= 2) return 'SUSPECT';
  if (proofCount === 0 && grantCount === 0) return 'INCONCLUSIVE';
  return 'AUTHENTIC';
}

function buildSummary(
  findings: AuthenticityFinding[],
  proofCount: number,
  grantCount: number,
  statisticsApplied: boolean,
): string {
  const fatal = findings.filter((f) => f.severity === 'FATAL');
  const signals = findings.filter((f) => f.severity === 'SIGNAL');

  if (fatal.length > 0) {
    return `위조입니다. 물리적으로 불가능한 근거 ${fatal.length}건이 코인 안에 있습니다. 이것은 통계적 추정이 아니라 코인 자체가 스스로 드러낸 모순입니다.`;
  }
  if (proofCount === 0 && grantCount === 0) {
    return `검사할 코인이 없습니다.`;
  }
  if (proofCount === 0) {
    return `걷기 코인이 없습니다(전부 보너스·보물 계보 ${grantCount}장). 서명과 계보는 정상이지만, 걷기의 물리 검사는 적용할 대상이 없습니다.`;
  }
  if (signals.length >= 2) {
    return `위조라고 단정할 근거는 없지만, 사람의 걷기로 보기 어려운 정황이 ${signals.length}건 있습니다. 정황은 증거가 아닙니다 — 소명을 요청할 수는 있어도 이것만으로 거절하지는 마십시오.`;
  }

  const scope =
    proofCount === 1
      ? `코인 한 장만으로는 코인 사이의 시간 거리를 볼 수 없습니다. 지갑 전체를 함께 올리면 훨씬 정확해집니다.`
      : statisticsApplied
        ? `걷기 증명 ${proofCount}건의 물리 정합과 그 사이의 시간 거리를 모두 검사했습니다.`
        : `걷기 증명 ${proofCount}건을 검사했습니다. 통계 검사는 표본이 부족해 적용하지 않았습니다.`;
  return `위조의 근거를 찾지 못했습니다. ${scope} (검사 범위에서 모순이 없다는 뜻이지, 진짜임을 증명한 것은 아닙니다.)`;
}

// ── 표시 도우미 ───────────────────────────────────────────────────────

function serialOf(coinId: string): string {
  return serialFromCoinId(coinId);
}

function iso(ms: number): string {
  if (!Number.isFinite(ms)) return '(알 수 없음)';
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

function dayString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function fmtM(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}초`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min}분`;
  const h = ms / 3600_000;
  if (h < 48) return `${h.toFixed(1)}시간`;
  return `${(h / 24).toFixed(1)}일`;
}
