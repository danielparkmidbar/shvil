'use client';

/**
 * 스팟 보물 지도 (M12 — 사업자 참여 계층, 몸인증_보물마이닝_설계 4장) — 열람 전용.
 *
 * 공개 GET /spot만 소비한다 (비서명). 서버는 잔여>0인 스팟만 내려주므로, 지도에 뜨는
 * 것은 전부 지금 받을 수 있는 스팟이다 (코인 없으면 미표시 — 다니엘 쌤 결정 2번). 위치는
 * 사업장이라 공개다(엔젤 집처럼 눈금화하지 않는다) — 걷는 사람이 지도를 보고 "걸으며
 * 갈지"를 정하게 한다. 받기는 지갑 앱 딥링크(shvil://spot/{id})다 — 웹은 서명 주체가
 * 아니므로 코인을 받을 수 없다(R-7). QR은 spotId만 담는다(비밀키 없음 — M10 폐기).
 *
 * 지도 수명주기는 엔젤 찾기(AngelFinder)와 동일 패턴: maplibre 동적 import, 로케일
 * 라벨 갱신, 지역 전환 시 재로드. maplibre-gl은 브라우저 전용이라 useEffect에서 import.
 *
 * XSS 안전: 사용자 원문(displayName)은 JSX 텍스트 자식으로만 넣어 React 기본
 * 이스케이프에 의존한다 — dangerouslySetInnerHTML은 이 경로에 없다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import { fetchSpots, fmtDate, fmtShv, spotDeepLink, type SpotEntry } from '@/lib/api';
import {
  fallbackRasterStyle,
  fetchLocalizedStyle,
  labelExpression,
  type LocalizedMapStyle,
} from '@/lib/mapStyle';
import { useI18n } from '@/i18n';
import { useRegion } from '@/region/RegionProvider';

/** 이스라엘 북부 샘플 구간 부근 — 데이터 도착 전 첫 화면 (AngelFinder와 동일). */
const INITIAL_CENTER: [number, number] = [35.64, 33.22];
const INITIAL_ZOOM = 10;
/** 스팟 마커 색 — 엔젤 초록과 구분되는 금빛(보물). */
const SPOT_COLOR = '#B8860B';

export default function SpotBoard() {
  const { t, locale } = useI18n();
  const { region } = useRegion();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<MapLibreMarker[]>([]);
  const maplibreRef = useRef<typeof import('maplibre-gl') | null>(null);
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const labelLayerIdsRef = useRef<string[]>([]);
  const didFitRef = useRef(false);

  const [mapReady, setMapReady] = useState(false);
  const [spots, setSpots] = useState<SpotEntry[] | null>(null);
  const [serverDown, setServerDown] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  // ── 지도 초기화 (브라우저에서만, 1회) ────────────────────────
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | undefined;
    (async () => {
      const maplibre = await import('maplibre-gl');
      let localized: LocalizedMapStyle;
      try {
        localized = await fetchLocalizedStyle(localeRef.current);
      } catch {
        localized = fallbackRasterStyle();
      }
      if (cancelled || !containerRef.current) return;
      maplibreRef.current = maplibre;
      labelLayerIdsRef.current = localized.labelLayerIds;
      map = new maplibre.Map({
        container: containerRef.current,
        style: localized.style,
        center: INITIAL_CENTER,
        zoom: INITIAL_ZOOM,
      });
      map.addControl(new maplibre.NavigationControl(), 'top-right');
      map.on('load', () => {
        if (!cancelled) setMapReady(true);
      });
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      markersRef.current = [];
      setMapReady(false);
    };
  }, []);

  // ── 언어 전환 → 지도 라벨 갱신 (스타일 재로드 없이 레이어만) ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const expr = labelExpression(locale);
    for (const id of labelLayerIdsRef.current) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'text-field', expr);
    }
  }, [locale, mapReady]);

  // ── 데이터 로드 (공개 API만) — 지역(트레일) 전환 시 다시 불러온다 ──
  useEffect(() => {
    let cancelled = false;
    setSpots(null);
    setSelected(null);
    didFitRef.current = false;
    (async () => {
      try {
        const rows = await fetchSpots(region.regionId);
        if (cancelled) return;
        setSpots(rows);
        setServerDown(false);
      } catch {
        if (!cancelled) {
          setSpots([]);
          setServerDown(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [region.regionId]);

  // ── 스팟 마커 ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const maplibre = maplibreRef.current;
    if (!map || !maplibre || !mapReady) return;

    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    for (const spot of spots ?? []) {
      const marker = new maplibre.Marker({ color: SPOT_COLOR })
        .setLngLat([spot.location.lon, spot.location.lat])
        .addTo(map);
      marker.getElement().style.cursor = 'pointer';
      marker.getElement().addEventListener('click', (e) => {
        e.stopPropagation();
        setSelected(spot.spotId);
      });
      markersRef.current.push(marker);
    }
  }, [spots, mapReady]);

  // ── 화면 맞춤 (스팟 전체) — 지역 전환 시마다 1회 ──────────────
  useEffect(() => {
    const map = mapRef.current;
    const maplibre = maplibreRef.current;
    if (!map || !maplibre || !mapReady || didFitRef.current) return;
    const points: [number, number][] = (spots ?? []).map((s) => [s.location.lon, s.location.lat]);
    if (points.length === 0) return;
    const bounds = points.reduce((b, p) => b.extend(p), new maplibre.LngLatBounds(points[0], points[0]));
    map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 0 });
    didFitRef.current = true;
  }, [spots, mapReady]);

  const sortedSpots = useMemo(
    () => [...(spots ?? [])].sort((a, b) => b.remainingSlots - a.remainingSlots),
    [spots],
  );

  const s = t.spots;
  return (
    <>
      {serverDown && <div className="notice-warn">{t.common.serverUnreachable}</div>}
      <div className="notice">{s.readOnlyNote}</div>

      <div className="filter-row">
        <span className="muted">{spots === null ? t.common.loading : s.count(sortedSpots.length)}</span>
      </div>

      <div className="finder-layout">
        <div ref={containerRef} className="map-canvas finder-canvas" />
        <aside>
          {spots === null ? (
            <div className="card">
              <p className="muted">{t.common.loading}</p>
            </div>
          ) : sortedSpots.length === 0 ? (
            <div className="card">
              <p className="muted">{s.empty}</p>
            </div>
          ) : (
            sortedSpots.map((spot) => (
              <div
                key={spot.spotId}
                className="card spot-card"
                style={selected === spot.spotId ? { outline: `2px solid ${SPOT_COLOR}` } : undefined}
              >
                {/* displayName = 사업장 표시명(사용자 원문) — 엔젤 이름과 같은 범주 */}
                <h3>🎁 {spot.displayName}</h3>
                <p className="service-tags">
                  <span className="service-tag">{s.perClaim(fmtShv(spot.perClaimDshv))}</span>{' '}
                  <span className="service-tag">{s.remaining(spot.remainingSlots, spot.totalSlots)}</span>{' '}
                  <span className="service-tag">{s.scale(fmtShv(spot.depositTotalDshv))}</span>
                </p>
                <p className="muted">{s.until(fmtDate(spot.validUntil, locale))}</p>
                {/* R-스팟-현장결속: 가야 받는 스팟 표식 — "걸으며 갈지" 판단 정보 */}
                {spot.requirePresence && <p className="spot-presence">{s.presenceBadge}</p>}
                <a className="btn" href={spotDeepLink(spot.spotId)}>
                  {s.getInApp}
                </a>
                <p className="muted">{s.getNote}</p>
              </div>
            ))
          )}
        </aside>
      </div>
    </>
  );
}
