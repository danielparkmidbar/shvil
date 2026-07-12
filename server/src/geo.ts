/** 거리 계산 (엔젤 디렉토리 검색용 — 공개 엔젤 포인트 좌표만 다룬다). */
import type { GeoPoint } from '@shvil/shared';

const EARTH_RADIUS_KM = 6_371;
const DEG = Math.PI / 180;

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}
