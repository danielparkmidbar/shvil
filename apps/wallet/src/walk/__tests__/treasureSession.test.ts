/** 보물 챌린지 세션 (M9) — 휘발성 측정 엔진 단위 테스트. */
import { describe, expect, it } from 'vitest';
import { treasureTranscriptHash, type TreasureSpec } from '@shvil/shared';
import { TreasureSession, detectNearbyTreasure } from '../treasureSession';

/** 위도 33°에서 미터 → 도 변환 (세션 내부 투영과 동일 근사). */
const M_PER_DEG_LAT = 111_320;
const LAT0 = 33.23;
const LON0 = 35.65;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);

function at(northM: number, eastM: number) {
  return { lat: LAT0 + northM / M_PER_DEG_LAT, lon: LON0 + eastM / M_PER_DEG_LON, timestamp: 0 };
}

const SPEC: TreasureSpec = {
  treasureId: 'promo-galilee-1',
  regionId: 'israel-national',
  zone: { center: { lat: LAT0, lon: LON0 }, radiusM: 60 },
  amountDshv: 50,
  totalCount: 10,
  validFrom: 0,
  validUntil: Number.MAX_SAFE_INTEGER,
  legs: [
    { dir: 'N', steps: 10 },
    { dir: 'E', steps: 30 },
    { dir: 'S', steps: 3 },
  ],
};

describe('TreasureSession — 정상 수행', () => {
  it('세 다리를 지시대로 수행하면 SUCCESS + 성공 요약 해시가 나온다', () => {
    const s = new TreasureSession(SPEC);
    // 다리 1: 북쪽 10걸음 (~7 m 북). 기준점 = 첫 픽스.
    s.addFix(at(0, 0));
    s.addFix(at(7, 0));
    s.addSteps(10);
    expect(s.getStatus().legIndex).toBe(1);
    expect(s.state).toBe('ACTIVE');
    // 다리 2: 동쪽 30걸음 (~21 m 동).
    s.addFix(at(7, 21));
    s.addSteps(15);
    s.addSteps(15); // 걸음 증분 분할 공급도 누적된다
    expect(s.getStatus().legIndex).toBe(2);
    // 다리 3: 남쪽 3걸음 — 짧은 다리는 걸음 수 위주 (GPS 갱신 없어도 통과).
    s.addSteps(3);
    expect(s.state).toBe('SUCCESS');

    const hash = s.transcriptHash('SHV-100000');
    expect(hash).toBe(
      treasureTranscriptHash(SPEC.treasureId, 'SHV-100000', [
        { dir: 'N', steps: 10, measuredSteps: 10 },
        { dir: 'E', steps: 30, measuredSteps: 30 },
        { dir: 'S', steps: 3, measuredSteps: 3 },
      ]),
    );
  });

  it('상태 노출에 좌표·변위가 없다 (파생 지표뿐)', () => {
    const s = new TreasureSession(SPEC);
    s.addFix(at(0, 0));
    s.addSteps(4);
    const status = s.getStatus() as unknown as Record<string, unknown>;
    expect(Object.keys(status).sort()).toEqual(
      ['amountDshv', 'currentLeg', 'failedReason', 'legCount', 'legIndex', 'state', 'stepsInLeg', 'treasureId'].sort(),
    );
    expect(JSON.stringify(status)).not.toContain('33.2'); // 위도 흔적 없음
  });
});

describe('TreasureSession — 실패·차단', () => {
  it('첫 다리에서 방향이 틀리면 FAILED (북쪽 지시에 남쪽 이동)', () => {
    const s = new TreasureSession(SPEC);
    s.addFix(at(0, 0));
    s.addFix(at(-7, 0));
    s.addSteps(10);
    expect(s.state).toBe('FAILED');
    expect(s.getStatus().failedReason).toBe('HEADING_OFF');
    // 실패 후 입력은 무시된다.
    s.addSteps(30);
    expect(s.state).toBe('FAILED');
    expect(() => s.transcriptHash('SHV-100000')).toThrow();
  });

  it('걸음만 흔들고 제자리면 두 번째(긴) 다리에서 FAILED', () => {
    const s = new TreasureSession(SPEC);
    s.addFix(at(0, 0));
    s.addFix(at(7, 0));
    s.addSteps(10); // 다리 1 통과
    s.addFix(at(7, 0.5)); // 30걸음 지시인데 사실상 제자리
    s.addSteps(30);
    expect(s.state).toBe('FAILED');
    expect(s.getStatus().failedReason).toBe('DISTANCE_OUT_OF_BAND');
  });

  it('mock location 픽스가 오면 BLOCKED (기존 mockDetected 패턴)', () => {
    const s = new TreasureSession(SPEC);
    s.addFix(at(0, 0));
    s.addFix({ ...at(7, 0), mocked: true });
    expect(s.state).toBe('BLOCKED');
    s.addSteps(10);
    expect(s.state).toBe('BLOCKED');
  });

  it('정확도가 나쁜 픽스(>50 m)는 측정에서 제외된다', () => {
    const s = new TreasureSession(SPEC);
    s.addFix(at(0, 0));
    s.addFix({ ...at(-50, 0), accuracy: 120 }); // 엉뚱한 반대 방향이지만 무시
    s.addFix(at(7, 0));
    s.addSteps(10);
    expect(s.getStatus().legIndex).toBe(1);
  });
});

describe('detectNearbyTreasure — 존 진입 감지', () => {
  const entry = { ...SPEC, remaining: 5 };

  it('존 안에서 거리와 식별 정보만 돌려준다 (좌표 없음)', () => {
    const hit = detectNearbyTreasure({ lat: LAT0, lon: LON0 + 30 / M_PER_DEG_LON }, [entry], new Set(), Date.now());
    expect(hit).toEqual({ treasureId: 'promo-galilee-1', amountDshv: 50, distanceM: 30 });
  });

  it('존 밖·기간 밖·이미 획득·소진 보물은 무시한다', () => {
    const now = Date.now();
    const out = { lat: LAT0, lon: LON0 + 200 / M_PER_DEG_LON };
    const inZone = { lat: LAT0, lon: LON0 };
    expect(detectNearbyTreasure(out, [entry], new Set(), now)).toBeNull();
    expect(detectNearbyTreasure(inZone, [entry], new Set(['promo-galilee-1']), now)).toBeNull();
    expect(detectNearbyTreasure(inZone, [{ ...entry, validUntil: now - 1 }], new Set(), now)).toBeNull();
    expect(detectNearbyTreasure(inZone, [{ ...entry, remaining: 0 }], new Set(), now)).toBeNull();
  });
});
