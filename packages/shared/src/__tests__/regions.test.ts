import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REGION_ID,
  TARGET_COUNTRY_COUNT,
  WORLD_TRAILS,
  liveRegions,
  regionByCourseId,
  regionById,
} from '../regions';
import { SHVIL_ISRAEL } from '../worldCourses';

describe('세계 트레일 지역 카탈로그 (150개국 확장)', () => {
  it('이스라엘 국립 트레일이 먼저 런칭(LIVE)한다', () => {
    const israel = regionById('israel-national');
    expect(israel?.status).toBe('LIVE');
    expect(israel?.courseIds).toContain('shvil-israel');
    expect(DEFAULT_REGION_ID).toBe('israel-national');
  });

  it('세계 대표 트레일이 확장 예정(COMING_SOON)으로 카탈로그에 있다', () => {
    for (const id of ['camino-de-santiago', 'inca-trail', 'annapurna-circuit', 'kilimanjaro']) {
      expect(regionById(id)?.status).toBe('COMING_SOON');
    }
    expect(WORLD_TRAILS.length).toBeGreaterThanOrEqual(10);
  });

  it('LIVE 지역만 코인 생성·엔젤 활동이 가능하다 (현재 이스라엘 하나)', () => {
    const live = liveRegions();
    expect(live).toHaveLength(1);
    expect(live[0]!.regionId).toBe('israel-national');
  });

  it('코스 ID로 소속 지역을 찾는다 (엔젤·코인 지역 귀속)', () => {
    expect(regionByCourseId('shvil-israel')?.regionId).toBe('israel-national');
    expect(regionByCourseId('unknown-course')).toBeUndefined();
  });

  it('확장 목표는 150개국이다', () => {
    expect(TARGET_COUNTRY_COUNT).toBe(150);
  });

  /**
   * LIVE 지역의 courseIds가 실제 코스 정의를 가리켜야 한다. 가리키는 코스가 없으면
   * 지역은 열려 있는데 걸을 코스가 없어 코인 생성·엔젤 등록이 헛돈다.
   */
  it('LIVE 지역의 courseIds가 실물 코스 정의와 연결돼 있다', () => {
    const israel = regionById('israel-national')!;
    expect(israel.courseIds).toContain(SHVIL_ISRAEL.courseId);
    // 실물이 연결됐는지 — 손으로 찍은 11점 샘플이 아니라 OSM 실측 폴리라인이다.
    expect(SHVIL_ISRAEL.polyline.length).toBeGreaterThan(5_000);
  });

  it('COMING_SOON 지역에는 연결된 코스가 없다 (열리지 않았음을 코스로도 표시)', () => {
    for (const r of WORLD_TRAILS.filter((t) => t.status === 'COMING_SOON')) {
      expect(r.courseIds).toEqual([]);
    }
  });
});
