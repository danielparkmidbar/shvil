'use client';

/**
 * "엔젤 되기" 단계형 화면 (M5 — 서비스 재조정 설계 §4-1, R-4 확정).
 *
 * ① 주소/마을 입력 (Photon 지오코딩 — 키 불필요, 500ms+ 디바운스로 공용 API 존중)
 * ② 지도 핀 미세 조정 (드래그) + 프라이버시 눈금 미리보기(~1km 반올림 위치에
 *    반투명 원) — "공개되는 위치"를 눈으로 확인시킨다
 * ③ 제공 서비스 미리보기 (잠자리·식사·샤워·인터넷·수용 인원)
 * ④ 지갑 다운로드 안내 (플레이스홀더)
 *
 * 이 페이지는 어떤 것도 서버에 제출하지 않는다 — 입력은 이 브라우저의 메모리에만
 * 있다. 등록 서명은 지갑만 할 수 있다 (웹에는 개인키가 없다).
 * 레이아웃은 데스크톱 우선("여행 전엔 노트북"): 넓은 화면에서 폼 + 지도 나란히.
 */
import { useEffect, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import type { Feature, Polygon } from 'geojson';
import { snapToPrivacyGrid } from '@shvil/shared/src/geoPrivacy';
import { useI18n } from '@/i18n';
import CurrentRegionBanner from '@/components/CurrentRegionBanner';
import {
  applyMapLabelLocale,
  firstSymbolLayerId,
  MAP_ATTRIBUTION,
  MAP_STYLE_URL,
} from '@/lib/mapStyle';

// ── Photon 지오코딩 (공용 무료 API — 반드시 디바운스) ──────────────
const PHOTON_URL = 'https://photon.komoot.io/api/';
const GEOCODE_DEBOUNCE_MS = 600; // 지시: 500ms 이상
const MIN_QUERY_LEN = 3;

// ── 프라이버시 눈금 미리보기 ────────────────────────────────────────
const PREVIEW_SOURCE = 'privacy-preview';
const PREVIEW_RADIUS_M = 500; // 눈금 0.01° ≈ 1km → 반경 ~500m 원

interface GeocodeCandidate {
  label: string;
  lat: number;
  lon: number;
}

/** Photon 응답 feature — 필요한 필드만, 방어적으로. */
interface PhotonFeature {
  geometry?: { coordinates?: unknown };
  properties?: { name?: unknown; city?: unknown; state?: unknown; country?: unknown };
}

function parsePhoton(features: PhotonFeature[]): GeocodeCandidate[] {
  const out: GeocodeCandidate[] = [];
  for (const f of features) {
    const coords = f.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const [lon, lat] = coords;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    const p = f.properties ?? {};
    const parts = [p.name, p.city, p.state, p.country]
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    // 중복 토막 제거 (예: name === city)
    const label = [...new Set(parts)].join(', ');
    if (!label) continue;
    out.push({ label, lat, lon });
  }
  return out;
}

/**
 * 눈금 중심의 반경 ~500m 원 폴리곤 — "공개되는 위치" 시각화.
 * 미리보기용 근사면 충분하다 (위도에 따른 경도 보정만).
 */
function privacyCirclePolygon(lat: number, lon: number): Feature<Polygon> {
  const steps = 64;
  const dLat = PREVIEW_RADIUS_M / 111_320;
  const dLon = PREVIEW_RADIUS_M / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

type Bed = 'ROOM' | 'SOFA' | 'TENT';

export default function BecomeAngel() {
  const { t, locale } = useI18n();
  const s = t.become;

  // ── 지도 ──
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const maplibreRef = useRef<typeof import('maplibre-gl') | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // ── ① 주소 검색 ──
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<GeocodeCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  // 후보 선택으로 입력값을 바꿀 때 재검색이 다시 뜨지 않게 하는 1회용 플래그.
  const skipNextSearchRef = useRef(false);

  // ── ② 핀 좌표 (이 브라우저에만 존재 — 서버 전송 없음) ──
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);

  // ── ③ 서비스 미리보기 ──
  const [bed, setBed] = useState<Bed>('ROOM');
  const [meal, setMeal] = useState(false);
  const [shower, setShower] = useState(false);
  const [internet, setInternet] = useState(false);
  const [capacity, setCapacity] = useState(2);

  // ── 지도 초기화 (브라우저에서만 — SSR 안전) ──────────────────────
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | undefined;
    (async () => {
      const maplibre = await import('maplibre-gl');
      if (cancelled || !containerRef.current) return;
      maplibreRef.current = maplibre;
      map = new maplibre.Map({
        container: containerRef.current,
        style: MAP_STYLE_URL, // OpenFreeMap Liberty 벡터 — 라벨 다국어 지원
        attributionControl: { compact: false, customAttribution: MAP_ATTRIBUTION },
        center: [35.2, 32.4], // 이스라엘 트레일 일대 (기본 LIVE 지역)
        zoom: 7,
      });
      map.addControl(new maplibre.NavigationControl(), 'top-right');
      // 지도를 눌러도 핀을 놓을 수 있다 — 검색이 안 될 때의 대비책이기도 하다.
      map.on('click', (e) => {
        setCoords({ lat: e.lngLat.lat, lon: e.lngLat.lng });
      });
      map.on('load', () => {
        if (!cancelled) setMapReady(true);
      });
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      markerRef.current = null;
      setMapReady(false);
    };
  }, []);

  // ── 지도 라벨 다국어 — 로드 후 + 언어 전환 시 ────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    applyMapLabelLocale(map, locale);
  }, [locale, mapReady]);

  // ── ① Photon 지오코딩 (디바운스 + 요청 취소) ─────────────────────
  useEffect(() => {
    const q = query.trim();
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }
    if (q.length < MIN_QUERY_LEN) {
      setCandidates(null);
      setSearching(false);
      setSearchFailed(false);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchFailed(false);
      try {
        const res = await fetch(`${PHOTON_URL}?q=${encodeURIComponent(q)}&limit=5`, {
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`photon ${res.status}`);
        const data = (await res.json()) as { features?: PhotonFeature[] };
        setCandidates(parsePhoton(data.features ?? []));
        setSearching(false);
      } catch {
        if (!ctrl.signal.aborted) {
          setCandidates(null);
          setSearchFailed(true);
          setSearching(false);
        }
      }
    }, GEOCODE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  function pickCandidate(c: GeocodeCandidate) {
    skipNextSearchRef.current = true;
    setQuery(c.label);
    setCandidates(null);
    setCoords({ lat: c.lat, lon: c.lon });
    mapRef.current?.flyTo({ center: [c.lon, c.lat], zoom: 14, duration: 900 });
  }

  // ── ② 핀 + 프라이버시 눈금 미리보기 갱신 ─────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const maplibre = maplibreRef.current;
    if (!map || !maplibre || !mapReady || !coords) return;

    if (!markerRef.current) {
      const marker = new maplibre.Marker({ color: '#2e6b3f', draggable: true })
        .setLngLat([coords.lon, coords.lat])
        .addTo(map);
      marker.on('dragend', () => {
        const p = marker.getLngLat();
        setCoords({ lat: p.lat, lon: p.lng });
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLngLat([coords.lon, coords.lat]);
    }

    // 공개될 대략 위치 = 0.01° 눈금 반올림 (packages/shared snapToPrivacyGrid —
    // 지갑·서버와 동일 코드) 중심의 반투명 원.
    const snapped = snapToPrivacyGrid(coords.lat, coords.lon);
    const data = privacyCirclePolygon(snapped.lat, snapped.lon);
    const src = map.getSource(PREVIEW_SOURCE) as GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
    } else {
      map.addSource(PREVIEW_SOURCE, { type: 'geojson', data });
      const beforeId = firstSymbolLayerId(map);
      map.addLayer(
        {
          id: `${PREVIEW_SOURCE}-fill`,
          type: 'fill',
          source: PREVIEW_SOURCE,
          paint: { 'fill-color': '#2e6b3f', 'fill-opacity': 0.18 },
        },
        beforeId,
      );
      map.addLayer(
        {
          id: `${PREVIEW_SOURCE}-line`,
          type: 'line',
          source: PREVIEW_SOURCE,
          paint: { 'line-color': '#2e6b3f', 'line-width': 1.5, 'line-opacity': 0.5 },
        },
        beforeId,
      );
    }
  }, [coords, mapReady]);

  const f = t.map.filters;
  return (
    <div className="page-wide">
      <h1>{s.title}</h1>
      <p className="muted become-intro">{s.intro}</p>
      <CurrentRegionBanner />

      {/* 데스크톱 우선: 왼쪽 폼(단계) + 오른쪽 지도 나란히 */}
      <div className="become-layout">
        <div className="become-steps">
          {/* ① 주소/마을 입력 */}
          <section className="card become-step">
            <h2>{s.stepAddressTitle}</h2>
            <input
              className="address-input"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={s.addressPlaceholder}
              autoComplete="off"
            />
            <p className="muted">{searching ? s.searching : s.addressHint}</p>
            {searchFailed && <div className="notice-warn">{s.searchFailed}</div>}
            {candidates !== null && !searching && (
              candidates.length > 0 ? (
                <ul className="candidate-list">
                  {candidates.map((c) => (
                    <li key={`${c.label}-${c.lat}-${c.lon}`}>
                      <button type="button" onClick={() => pickCandidate(c)}>
                        📍 {c.label}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">{s.noResults}</p>
              )
            )}
          </section>

          {/* ② 핀 미세 조정 + 프라이버시 안내 (R-4) */}
          <section className="card become-step">
            <h2>{s.stepPinTitle}</h2>
            <p className="muted">{s.pinDragHint}</p>
            <div className="notice">{s.pinPrivacyNote}</div>
            <p className="muted">
              <span className="legend-swatch" aria-hidden="true" /> {s.publicPreviewLegend}
            </p>
          </section>

          {/* ③ 제공 서비스 미리보기 */}
          <section className="card become-step">
            <h2>{s.stepServicesTitle}</h2>
            <p className="muted">{s.servicesNote}</p>
            <div className="service-form">
              <div className="service-form-row" role="radiogroup" aria-label={s.bedLabel}>
                <strong>{s.bedLabel}:</strong>
                {(
                  [
                    ['ROOM', `🛏️ ${f.bedRoom}`],
                    ['SOFA', `🛋️ ${f.bedSofa}`],
                    ['TENT', `⛺ ${f.bedTent}`],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="bed"
                      checked={bed === value}
                      onChange={() => setBed(value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <div className="service-form-row">
                <label>
                  <input type="checkbox" checked={meal} onChange={(e) => setMeal(e.target.checked)} />
                  🍲 {f.meal}
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={shower}
                    onChange={(e) => setShower(e.target.checked)}
                  />
                  🚿 {f.shower}
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={internet}
                    onChange={(e) => setInternet(e.target.checked)}
                  />
                  📶 {f.internet}
                </label>
              </div>
              <div className="service-form-row">
                <label>
                  {s.capacityLabel}
                  <input
                    className="capacity-input"
                    type="number"
                    min={1}
                    max={20}
                    value={capacity}
                    onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 1))}
                  />
                </label>
              </div>
            </div>
          </section>

          {/* ④ 지갑 다운로드 — 등록 완결은 지갑에서 (플레이스홀더) */}
          <section className="card become-step">
            <h2>{s.stepWalletTitle}</h2>
            <div className="hero-actions">
              <a className="btn" aria-disabled="true" title={s.walletComingSoon}>
                {s.walletCta}
              </a>
              <span className="muted">{s.walletComingSoon}</span>
            </div>
            {/* 사실이어야 한다: 이 화면의 어떤 입력도 fetch로 서버에 가지 않는다
                (유일한 외부 호출은 Photon 지오코딩 검색어뿐). */}
            <div className="notice">{s.notSentNote}</div>
          </section>
        </div>

        <div className="become-map-col">
          <div ref={containerRef} className="map-canvas become-map" />
        </div>
      </div>
    </div>
  );
}
