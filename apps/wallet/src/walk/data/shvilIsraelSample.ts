/**
 * 쉬빌 이스라엘 북부 구간 — 파일럿용 샘플 코스 데이터.
 *
 * ⚠️ 예시 폴리라인이다. 실제 파일럿 구간·정밀 좌표·초기 엔젤 포인트 수집 방법은
 * 결정 대기 6번 (다니엘 쌤 확정 사항). 확정되면 shvilist.org 코스 등록부가
 * 원본이 되고 앱은 갱신분을 내려받는다.
 *
 * 형태: 텔 단(Tel Dan) 인근에서 남서쪽으로 이어지는 약 8km 구간.
 * 전반 4km는 개활지(회랑 50m, 평지 ×1.0), 후반 4km는 산악(회랑 100m, ×1.5).
 */
import type { AngelPoint, CourseData } from '../courses';

export const SHVIL_ISRAEL_NORTH_SAMPLE: CourseData = {
  courseId: 'shvil-israel',
  name: '쉬빌 이스라엘 (북부 샘플 구간)',
  version: 1,
  polyline: [
    { lat: 33.2485, lon: 35.6523 },
    { lat: 33.2432, lon: 35.6489 },
    { lat: 33.2378, lon: 35.6455 },
    { lat: 33.2325, lon: 35.6420 },
    { lat: 33.2271, lon: 35.6386 },
    { lat: 33.2218, lon: 35.6352 }, // ~4km 지점: 개활지 → 산악 전환
    { lat: 33.2169, lon: 35.6310 },
    { lat: 33.2121, lon: 35.6266 },
    { lat: 33.2073, lon: 35.6223 },
    { lat: 33.2024, lon: 35.6180 },
    { lat: 33.1976, lon: 35.6137 },
  ],
  segments: [
    { fromIdx: 0, toIdx: 5, terrain: 'OPEN', difficultyTenths: 10 },
    { fromIdx: 5, toIdx: 10, terrain: 'MOUNTAIN', difficultyTenths: 15 },
  ],
};

/** 샘플 엔젤 포인트 — 코스에서 1~2km 벗어난 위치 (우회 판정 테스트 겸용). */
export const SAMPLE_ANGELS: AngelPoint[] = [
  {
    memberId: 'angel-dafna',
    name: '다프나의 집 (샘플)',
    location: { lat: 33.2290, lon: 35.6550 }, // 코스 중반에서 동쪽 ~1.5km
  },
  {
    memberId: 'angel-hagoshrim',
    name: '하고쉬림 정원 (샘플)',
    location: { lat: 33.2180, lon: 35.6250 }, // 후반 구간 서쪽 ~1km
  },
];
