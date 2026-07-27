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

// ── 폴리라인 투영 (2026-07-27) ────────────────────────────────────────
//
// 왜 필요한가: 창의 거리를 픽스 사이 haversine 합으로 재면 GPS 오차가 **절댓값으로
// 누적**된다. 오차 평균이 0이어도 합은 한쪽으로만 쌓이므로, 도시 다중경로(σ10)에서
// 발행이 +30~36% 부풀고, 협곡(σ15)에서는 부푼 거리가 보폭 검사를 터뜨려 정직한
// 사람의 창이 통째로 기각된다. 같은 노이즈가 먼저 도둑질을 하고 그다음 정직한 사람을
// 죽인다 — 실측된 두 실패 모드다.
//
// 회랑 안이라면 진짜 진행 거리는 "폴리라인 위를 얼마나 나아갔는가"다. 그 값(alongM)은
// 코스 선이라는 **고정된 기준**에 대한 사영이므로 횡방향 오차가 통째로 상쇄된다.
//
// 위치 비저장(제9조)과의 관계: alongM은 좌표가 아니라 공개 코스 위의 스칼라 하나이고,
// 좌표와 같은 수명(창 마감 시 폐기 / 이월점 한 점)만 산다. 방출되는 WalkSample에는
// 들어가지 않는다 — 남는 것은 여전히 거리(m)뿐이다.

/** 폴리라인 + 누적 길이. 코스마다 한 번 만들고 재사용한다. */
export interface PolylineIndex {
  polyline: GeoPoint[];
  /** cumM[i] = polyline[0]부터 polyline[i]까지의 누적 길이 (m). 길이 = polyline.length. */
  cumM: number[];
  /** 전체 길이 (m). */
  totalM: number;
}

export function buildPolylineIndex(polyline: GeoPoint[]): PolylineIndex {
  const cumM = new Array<number>(polyline.length);
  cumM[0] = 0;
  for (let i = 1; i < polyline.length; i++) {
    cumM[i] = cumM[i - 1]! + haversineM(polyline[i - 1]!, polyline[i]!);
  }
  return { polyline, cumM, totalM: polyline.length > 0 ? cumM[polyline.length - 1]! : 0 };
}

export interface PolylineProjection {
  /** 폴리라인까지의 수직 거리 (m). */
  distanceM: number;
  /** 최근접 선분 인덱스. */
  segmentIndex: number;
  /** 폴리라인 시작점에서 사영점까지의 **선 위 거리** (m) — 이것이 진행 좌표다. */
  alongM: number;
}

/** 점을 선분에 사영 — 수직 거리와 선분 내 위치 비율 t(0~1). */
function projectOnSegment(p: GeoPoint, a: GeoPoint, b: GeoPoint): { distanceM: number; t: number } {
  const P = toLocalXY(a, p);
  const B = toLocalXY(a, b);
  const lenSq = B.x * B.x + B.y * B.y;
  if (lenSq === 0) return { distanceM: haversineM(p, a), t: 0 };
  let t = (P.x * B.x + P.y * B.y) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const dx = P.x - t * B.x;
  const dy = P.y - t * B.y;
  return { distanceM: Math.sqrt(dx * dx + dy * dy), t };
}

/** cumM에서 alongM 이하의 마지막 인덱스 (이분 탐색). */
function indexAtAlong(cumM: number[], alongM: number): number {
  let lo = 0;
  let hi = cumM.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cumM[mid]! <= alongM) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * 점을 폴리라인에 사영한다.
 *
 * `hint`를 주면 **직전 위치 주변의 선분만** 본다(국지 투영). 이것이 없으면 자기교차
 * 구간에서 사영점이 멀리 뛰어 거짓 거리가 만들어진다 — 이스라엘 1,055 km 실측으로
 * 지리적으로 100 m 이내인데 코스상 500 m 이상 떨어진 점쌍이 5쌍 있었고, 최악은
 * 0.74 km였다. 사람이 1분에 갈 수 있는 거리로 후보를 묶으면 그 뜀이 구조적으로 사라진다.
 */
export function projectOnPolyline(
  p: GeoPoint,
  index: PolylineIndex,
  hint?: { alongM: number; radiusM: number },
): PolylineProjection {
  const { polyline, cumM } = index;
  if (polyline.length < 2) {
    return { distanceM: Number.POSITIVE_INFINITY, segmentIndex: 0, alongM: 0 };
  }
  let from = 0;
  let to = polyline.length - 2; // 마지막 선분 인덱스
  if (hint) {
    from = indexAtAlong(cumM, hint.alongM - hint.radiusM);
    to = Math.min(to, indexAtAlong(cumM, hint.alongM + hint.radiusM));
    if (to < from) to = from;
  }

  let best = Number.POSITIVE_INFINITY;
  let bestIdx = from;
  let bestT = 0;
  for (let i = from; i <= to; i++) {
    const { distanceM, t } = projectOnSegment(p, polyline[i]!, polyline[i + 1]!);
    if (distanceM < best) {
      best = distanceM;
      bestIdx = i;
      bestT = t;
    }
  }
  const segLen = cumM[bestIdx + 1]! - cumM[bestIdx]!;
  return { distanceM: best, segmentIndex: bestIdx, alongM: cumM[bestIdx]! + bestT * segLen };
}
