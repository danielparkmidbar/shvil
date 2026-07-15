/** 몸 인증 보물 마이닝 판정 (M9) — 순수 함수 단위 테스트. */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEG_TOLERANCE,
  isValidTreasureSpec,
  treasureTranscriptHash,
  verifyLeg,
  type MovementLeg,
  type TreasureSpec,
} from '../treasure';

/** "북쪽으로 30걸음" — 기대 변위 15~27 m. */
const N30: MovementLeg = { dir: 'N', steps: 30 };

describe('verifyLeg — 정상 수행', () => {
  it('지시 방향·걸음·보폭 대역 안이면 통과한다', () => {
    // 30걸음 × 0.7 m 북쪽 = 21 m 북쪽 변위.
    expect(verifyLeg(21, 0, 30, N30)).toEqual({ ok: true });
  });

  it('4방위 전부: 각 방향의 정직한 수행이 통과한다', () => {
    expect(verifyLeg(14, 0, 20, { dir: 'N', steps: 20 }).ok).toBe(true);
    expect(verifyLeg(0, 14, 20, { dir: 'E', steps: 20 }).ok).toBe(true);
    expect(verifyLeg(-14, 0, 20, { dir: 'S', steps: 20 }).ok).toBe(true);
    expect(verifyLeg(0, -14, 20, { dir: 'W', steps: 20 }).ok).toBe(true);
  });

  it('허용각(±35°) 이내의 비스듬한 이동은 통과한다', () => {
    // 북쪽 지시인데 북북동으로 약 27° 기울어짐 — 통과해야 한다.
    expect(verifyLeg(20, 10, 30, N30).ok).toBe(true);
  });

  it('GPS 오차 완충: 변위가 보폭 하한보다 조금 짧아도 통과한다', () => {
    // 하한 = 30×0.5 − 12/2 = 9 m.
    expect(verifyLeg(9.5, 0, 30, N30).ok).toBe(true);
  });
});

describe('verifyLeg — 실패', () => {
  it('방향이 틀리면 HEADING_OFF (동쪽 지시에 북쪽 이동)', () => {
    expect(verifyLeg(21, 0, 30, { dir: 'E', steps: 30 })).toEqual({ ok: false, reason: 'HEADING_OFF' });
  });

  it('반대 방향 이동은 HEADING_OFF', () => {
    expect(verifyLeg(-21, 0, 30, N30)).toEqual({ ok: false, reason: 'HEADING_OFF' });
  });

  it('걸음이 부족하면 STEPS_OUT_OF_BAND (30 지시에 15걸음)', () => {
    expect(verifyLeg(21, 0, 15, N30)).toEqual({ ok: false, reason: 'STEPS_OUT_OF_BAND' });
  });

  it('걸음이 과다하면 STEPS_OUT_OF_BAND (30 지시에 50걸음)', () => {
    expect(verifyLeg(21, 0, 50, N30)).toEqual({ ok: false, reason: 'STEPS_OUT_OF_BAND' });
  });

  it('걸음만 흔들고 제자리면 DISTANCE_OUT_OF_BAND (변위 ~0)', () => {
    expect(verifyLeg(0.5, 0.5, 30, N30)).toEqual({ ok: false, reason: 'DISTANCE_OUT_OF_BAND' });
  });

  it('차량 등 과다 이동은 DISTANCE_OUT_OF_BAND (상한 = 30×0.9+12 = 39 m)', () => {
    expect(verifyLeg(60, 0, 30, N30)).toEqual({ ok: false, reason: 'DISTANCE_OUT_OF_BAND' });
  });

  it('형식이 어긋난 입력은 MALFORMED', () => {
    expect(verifyLeg(21, 0, -1, N30)).toEqual({ ok: false, reason: 'MALFORMED' });
    expect(verifyLeg(Number.NaN, 0, 30, N30)).toEqual({ ok: false, reason: 'MALFORMED' });
    expect(verifyLeg(21, 0, 30, { dir: 'N', steps: 100 })).toEqual({ ok: false, reason: 'MALFORMED' });
    expect(verifyLeg(21, 0, 30, { dir: 'X' as 'N', steps: 30 })).toEqual({ ok: false, reason: 'MALFORMED' });
  });
});

describe('verifyLeg — 관용 대역 경계', () => {
  it('걸음 허용 = ±max(3, 40%): 30걸음 지시는 18~42가 경계다', () => {
    expect(verifyLeg(15, 0, 18, N30).ok).toBe(true); // 하한 (변위도 18걸음 대역 안)
    expect(verifyLeg(21, 0, 17, N30)).toEqual({ ok: false, reason: 'STEPS_OUT_OF_BAND' });
    expect(verifyLeg(27, 0, 42, N30).ok).toBe(true); // 상한
    expect(verifyLeg(21, 0, 43, N30)).toEqual({ ok: false, reason: 'STEPS_OUT_OF_BAND' });
  });

  it('작은 지시의 걸음 허용은 최소 ±3걸음이다 (5걸음 지시: 2~8)', () => {
    const leg: MovementLeg = { dir: 'N', steps: 5 };
    expect(verifyLeg(0, 0, 2, leg).ok).toBe(true);
    expect(verifyLeg(0, 0, 8, leg).ok).toBe(true);
    expect(verifyLeg(0, 0, 1, leg)).toEqual({ ok: false, reason: 'STEPS_OUT_OF_BAND' });
    expect(verifyLeg(0, 0, 9, leg)).toEqual({ ok: false, reason: 'STEPS_OUT_OF_BAND' });
  });

  it('짧은 다리(<8걸음)는 걸음 수 위주 — 변위·방향이 노이즈여도 통과한다', () => {
    // 3걸음 지시: 기대 변위 ~2 m는 도심 GPS 정확도(5~15 m)에 묻힌다.
    const leg: MovementLeg = { dir: 'S', steps: 3 };
    expect(verifyLeg(4, -3, 3, leg).ok).toBe(true); // GPS가 엉뚱한 곳을 가리켜도
    expect(verifyLeg(0, 0, 3, leg).ok).toBe(true); // 변위가 아예 없어도
    expect(verifyLeg(0, 0, 10, leg)).toEqual({ ok: false, reason: 'STEPS_OUT_OF_BAND' }); // 걸음은 검사
  });

  it('8걸음부터는 변위·방향 검사가 적용된다', () => {
    const leg: MovementLeg = { dir: 'N', steps: 8 };
    expect(verifyLeg(-6, 0, 8, leg)).toEqual({ ok: false, reason: 'HEADING_OFF' });
    expect(verifyLeg(6, 0, 8, leg).ok).toBe(true);
  });

  it('변위가 방향 판정 바닥(5 m) 미만이면서 거리 대역 안이면 방향을 묻지 않는다', () => {
    // 10걸음 지시: 하한 = 10×0.5 − 6 = 0 m → 변위 3 m는 거리 대역 안, 방향 생략.
    const leg: MovementLeg = { dir: 'N', steps: 10 };
    expect(verifyLeg(-2, 2, 10, leg).ok).toBe(true);
  });

  it('방향 허용각 경계: 35° 이내 통과, 초과 실패', () => {
    const d = 20;
    const at = (deg: number) => ({
      n: d * Math.cos((deg * Math.PI) / 180),
      e: d * Math.sin((deg * Math.PI) / 180),
    });
    const inBand = at(34);
    const outBand = at(36);
    expect(verifyLeg(inBand.n, inBand.e, 30, N30).ok).toBe(true);
    expect(verifyLeg(outBand.n, outBand.e, 30, N30)).toEqual({ ok: false, reason: 'HEADING_OFF' });
  });
});

describe('treasureTranscriptHash — 성공 요약 해시 (이동 원자료 아님)', () => {
  const legs = [
    { dir: 'N' as const, steps: 10, measuredSteps: 11 },
    { dir: 'E' as const, steps: 30, measuredSteps: 28 },
  ];

  it('같은 입력이면 결정적으로 같다', () => {
    expect(treasureTranscriptHash('t-1', 'SHV-100000', legs)).toBe(treasureTranscriptHash('t-1', 'SHV-100000', legs));
  });

  it('회원·보물·수행 내용이 다르면 해시가 달라진다 (재사용 불가)', () => {
    const base = treasureTranscriptHash('t-1', 'SHV-100000', legs);
    expect(treasureTranscriptHash('t-1', 'SHV-200000', legs)).not.toBe(base);
    expect(treasureTranscriptHash('t-2', 'SHV-100000', legs)).not.toBe(base);
    expect(
      treasureTranscriptHash('t-1', 'SHV-100000', [legs[0]!, { ...legs[1]!, measuredSteps: 29 }]),
    ).not.toBe(base);
  });

  it('64자리 hex다', () => {
    expect(treasureTranscriptHash('t-1', 'SHV-100000', legs)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('isValidTreasureSpec', () => {
  const valid: TreasureSpec = {
    treasureId: 'promo-galilee-1',
    regionId: 'israel-national',
    zone: { center: { lat: 33.23, lon: 35.65 }, radiusM: 60 },
    amountDshv: 50,
    totalCount: 100,
    validFrom: 1,
    validUntil: 2,
    legs: [
      { dir: 'N', steps: 10 },
      { dir: 'E', steps: 30 },
      { dir: 'S', steps: 3 },
    ],
  };

  it('정상 명세를 통과시킨다 (무보상 스탬프 amountDshv=0 포함)', () => {
    expect(isValidTreasureSpec(valid)).toBe(true);
    expect(isValidTreasureSpec({ ...valid, amountDshv: 0 })).toBe(true);
  });

  it('형식 위반을 거부한다', () => {
    expect(isValidTreasureSpec({ ...valid, treasureId: 'X Y' })).toBe(false);
    expect(isValidTreasureSpec({ ...valid, amountDshv: -1 })).toBe(false);
    expect(isValidTreasureSpec({ ...valid, totalCount: 0 })).toBe(false);
    expect(isValidTreasureSpec({ ...valid, validUntil: 0 })).toBe(false);
    expect(isValidTreasureSpec({ ...valid, legs: [] })).toBe(false);
    expect(isValidTreasureSpec({ ...valid, legs: [{ dir: 'N', steps: 51 }] })).toBe(false);
    expect(isValidTreasureSpec({ ...valid, zone: { center: { lat: 1, lon: 2 }, radiusM: 0 } })).toBe(false);
  });

  it('기본 관용치가 문서 값과 일치한다 (판정 근거 고정)', () => {
    expect(DEFAULT_LEG_TOLERANCE.strideMinM).toBe(0.5);
    expect(DEFAULT_LEG_TOLERANCE.strideMaxM).toBe(0.9);
    expect(DEFAULT_LEG_TOLERANCE.headingToleranceDeg).toBe(35);
    expect(DEFAULT_LEG_TOLERANCE.stepRatioTolerance).toBe(0.4);
    expect(DEFAULT_LEG_TOLERANCE.stepMinToleranceSteps).toBe(3);
    expect(DEFAULT_LEG_TOLERANCE.stepOnlyBelowSteps).toBe(8);
  });
});
