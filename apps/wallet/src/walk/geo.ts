/**
 * 지오메트리 유틸 — 회랑 판정 전용.
 *
 * 여기의 좌표 연산은 전부 휘발성 메모리에서만 수행된다. 이 모듈의 어떤 함수도
 * 좌표를 저장·전송하지 않으며, 반환값은 거리(m)·인덱스 같은 파생 지표뿐이다.
 */

import type { GeoPoint } from '@shvil/shared';

export type { GeoPoint };

const EARTH_RADIUS_M = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;
/** 위도 1도의 미터 근사. */
const METERS_PER_DEG_LAT = 111_320;

/** 두 좌표 간 거리 (haversine, m). */
export function haversineM(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLon = (b.lon - a.lon) * DEG_TO_RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(a.lat * DEG_TO_RAD) * Math.cos(b.lat * DEG_TO_RAD) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 국지 등장방형 투영 (회랑 폭 수백 m 스케일에서 충분한 정확도). */
function toLocalXY(origin: GeoPoint, p: GeoPoint): { x: number; y: number } {
  return {
    x: (p.lon - origin.lon) * METERS_PER_DEG_LAT * Math.cos(origin.lat * DEG_TO_RAD),
    y: (p.lat - origin.lat) * METERS_PER_DEG_LAT,
  };
}

/** 점 p에서 선분 a-b까지의 최단 거리 (m). */
export function distToSegmentM(p: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  const P = toLocalXY(a, p);
  const B = toLocalXY(a, b);
  const lenSq = B.x * B.x + B.y * B.y;
  if (lenSq === 0) return haversineM(p, a);
  let t = (P.x * B.x + P.y * B.y) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const dx = P.x - t * B.x;
  const dy = P.y - t * B.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export interface NearestOnPolyline {
  /** 폴리라인까지의 최단 거리 (m). */
  distanceM: number;
  /** 최근접 선분 인덱스 (polyline[i] ~ polyline[i+1]). */
  segmentIndex: number;
}

/** 점에서 폴리라인까지의 최단 거리와 최근접 선분. */
export function nearestOnPolyline(p: GeoPoint, polyline: GeoPoint[]): NearestOnPolyline {
  let best = Number.POSITIVE_INFINITY;
  let bestIdx = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const d = distToSegmentM(p, polyline[i]!, polyline[i + 1]!);
    if (d < best) {
      best = d;
      bestIdx = i;
    }
  }
  return { distanceM: best, segmentIndex: bestIdx };
}
