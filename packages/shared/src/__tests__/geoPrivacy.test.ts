import { describe, expect, it } from 'vitest';
import { PRIVACY_GRID_DEG, snapToPrivacyGrid } from '../geoPrivacy';

describe('위치 프라이버시 눈금화 (R-4 — 공개는 ~1km 눈금만)', () => {
  it('소수 둘째 자리로 반올림한다 (0.01° ≈ 1km)', () => {
    expect(snapToPrivacyGrid(33.2291, 35.6553)).toEqual({ lat: 33.23, lon: 35.66 });
    expect(snapToPrivacyGrid(33.2249, 35.6549)).toEqual({ lat: 33.22, lon: 35.65 });
    expect(snapToPrivacyGrid(32.0, 34.8)).toEqual({ lat: 32, lon: 34.8 });
  });

  it('눈금 상수는 0.01°다', () => {
    expect(PRIVACY_GRID_DEG).toBe(0.01);
  });

  it('멱등성: snap(snap(p)) == snap(p)', () => {
    const once = snapToPrivacyGrid(31.776539, 35.234391);
    const twice = snapToPrivacyGrid(once.lat, once.lon);
    expect(twice).toEqual(once);
  });

  it('음수 좌표(남반구·서반구)도 눈금 위로 간다', () => {
    expect(snapToPrivacyGrid(-33.8688, -151.2093)).toEqual({ lat: -33.87, lon: -151.21 });
    const s = snapToPrivacyGrid(-0.004999, -0.005001);
    expect(s.lat * 100).toBe(Math.round(s.lat * 100));
    expect(s.lon * 100).toBe(Math.round(s.lon * 100));
  });

  it('결과는 항상 0.01° 눈금 위에 있다 (부동소수 오차 없음)', () => {
    for (const [lat, lon] of [
      [33.229123, 35.655987],
      [31.5, 34.9],
      [-45.123456, 170.987654],
    ]) {
      const p = snapToPrivacyGrid(lat!, lon!);
      expect(Number.isInteger(Math.round(p.lat * 100))).toBe(true);
      expect(p.lat).toBe(Math.round(lat! * 100) / 100);
      expect(p.lon).toBe(Math.round(lon! * 100) / 100);
    }
  });
});
