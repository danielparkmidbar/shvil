'use client';

/**
 * 엔젤 지도 (지시서 5장 2절): 전체 엔젤 마커 + 서비스 아이콘 필터 +
 * 클릭 시 프로필 카드 + "지갑 앱에서 메시지 보내기" 딥링크(shvil://chat/…).
 * 코스 폴리라인(GET /courses)도 함께 그린다.
 *
 * 여기 표시되는 좌표는 엔젤이 자발 공개한 포인트와 공개 트레일 폴리라인뿐이다 —
 * 사용자 이동 궤적이 아니다 (위치 비저장 원칙은 사용자 좌표에 관한 것).
 *
 * maplibre-gl은 브라우저 전용이므로 useEffect 안에서 동적 import 한다
 * (프리렌더/SSR에서 window 참조로 빌드가 깨지지 않게).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MapLibreMap, Marker as MapLibreMarker } from 'maplibre-gl';
import {
  chatDeepLink,
  fetchAngels,
  fetchCourses,
  type AngelEntry,
  type AngelServices,
  type CourseData,
} from '@/lib/api';
import { useI18n, type Strings } from '@/i18n';

const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

type FilterKey = 'bedRoom' | 'bedSofa' | 'bedTent' | 'internet' | 'shower' | 'meal';

const FILTER_KEYS: readonly FilterKey[] = [
  'bedRoom',
  'bedSofa',
  'bedTent',
  'internet',
  'shower',
  'meal',
];

const SERVICE_ICONS: Record<FilterKey, string> = {
  bedRoom: '🛏️',
  bedSofa: '🛋️',
  bedTent: '⛺',
  internet: '📶',
  shower: '🚿',
  meal: '🍲',
};

function serviceTags(
  services: AngelServices | null,
  f: Strings['map']['filters'],
): { key: FilterKey; label: string }[] {
  if (!services) return [];
  const tags: { key: FilterKey; label: string }[] = [];
  if (services.bed === 'ROOM') tags.push({ key: 'bedRoom', label: f.bedRoom });
  if (services.bed === 'SOFA') tags.push({ key: 'bedSofa', label: f.bedSofa });
  if (services.bed === 'TENT') tags.push({ key: 'bedTent', label: f.bedTent });
  if (services.internet) tags.push({ key: 'internet', label: f.internet });
  if (services.shower) tags.push({ key: 'shower', label: f.shower });
  if (services.meal) tags.push({ key: 'meal', label: f.meal });
  return tags;
}

/** 체크된 필터를 모두 만족해야 표시 (잠자리 유형은 체크된 것들 중 하나면 통과). */
function passesFilters(angel: AngelEntry, filters: Record<FilterKey, boolean>): boolean {
  const s = angel.services;
  const bedChecked: ('ROOM' | 'SOFA' | 'TENT')[] = [];
  if (filters.bedRoom) bedChecked.push('ROOM');
  if (filters.bedSofa) bedChecked.push('SOFA');
  if (filters.bedTent) bedChecked.push('TENT');
  if (bedChecked.length > 0 && (!s?.bed || !bedChecked.includes(s.bed))) return false;
  if (filters.internet && !s?.internet) return false;
  if (filters.shower && !s?.shower) return false;
  if (filters.meal && !s?.meal) return false;
  return true;
}

export default function AngelMap() {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<MapLibreMarker[]>([]);
  // Marker 생성자는 동적 import 이후에만 알 수 있으므로 모듈 참조를 보관한다.
  const maplibreRef = useRef<typeof import('maplibre-gl') | null>(null);
  const didFitRef = useRef(false);

  const [mapReady, setMapReady] = useState(false);
  const [angels, setAngels] = useState<AngelEntry[] | null>(null);
  const [courses, setCourses] = useState<CourseData[]>([]);
  const [serverDown, setServerDown] = useState(false);
  const [selected, setSelected] = useState<AngelEntry | null>(null);
  const [filters, setFilters] = useState<Record<FilterKey, boolean>>({
    bedRoom: false,
    bedSofa: false,
    bedTent: false,
    internet: false,
    shower: false,
    meal: false,
  });

  // ── 지도 초기화 (브라우저에서만) ────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | undefined;
    (async () => {
      const maplibre = await import('maplibre-gl');
      if (cancelled || !containerRef.current) return;
      maplibreRef.current = maplibre;
      map = new maplibre.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            osm: {
              type: 'raster',
              tiles: [OSM_TILE_URL],
              tileSize: 256,
              attribution: t.map.attribution, // "© OpenStreetMap contributors" — 필수 표기
            },
          },
          layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
        },
        center: [35.64, 33.22], // 쉬빌 이스라엘 북부 샘플 구간 부근
        zoom: 10,
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

  // ── 데이터 로드 (공개 API만 — 서명 인증 API는 웹에서 쓰지 않는다) ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [angelList, courseList] = await Promise.all([fetchAngels(), fetchCourses()]);
        if (cancelled) return;
        setAngels(angelList);
        setCourses(courseList);
        setServerDown(false);
      } catch {
        if (!cancelled) {
          setAngels([]);
          setServerDown(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredAngels = useMemo(
    () => (angels ?? []).filter((a) => passesFilters(a, filters)),
    [angels, filters],
  );

  // ── 코스 폴리라인 ───────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const course of courses) {
      const sourceId = `course-${course.courseId}`;
      if (map.getSource(sourceId)) continue;
      map.addSource(sourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: { name: course.name },
          geometry: {
            type: 'LineString',
            coordinates: course.polyline.map((p) => [p.lon, p.lat]),
          },
        },
      });
      map.addLayer({
        id: `${sourceId}-line`,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#2e6b3f',
          'line-width': 3,
          'line-opacity': 0.75,
        },
      });
    }
  }, [courses, mapReady]);

  // ── 엔젤 마커 (필터 반영) ───────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const maplibre = maplibreRef.current;
    if (!map || !maplibre || !mapReady) return;

    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    for (const angel of filteredAngels) {
      const marker = new maplibre.Marker({ color: '#2e6b3f' })
        .setLngLat([angel.location.lon, angel.location.lat])
        .addTo(map);
      marker.getElement().style.cursor = 'pointer';
      marker.getElement().addEventListener('click', (e) => {
        e.stopPropagation();
        setSelected(angel);
      });
      markersRef.current.push(marker);
    }
  }, [filteredAngels, mapReady]);

  // ── 최초 1회 화면 맞춤 (엔젤 + 코스 전체) ───────────────────
  useEffect(() => {
    const map = mapRef.current;
    const maplibre = maplibreRef.current;
    if (!map || !maplibre || !mapReady || didFitRef.current) return;
    const points: [number, number][] = [
      ...(angels ?? []).map((a): [number, number] => [a.location.lon, a.location.lat]),
      ...courses.flatMap((c) => c.polyline.map((p): [number, number] => [p.lon, p.lat])),
    ];
    if (points.length === 0) return;
    const bounds = points.reduce(
      (b, p) => b.extend(p),
      new maplibre.LngLatBounds(points[0], points[0]),
    );
    map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 0 });
    didFitRef.current = true;
  }, [angels, courses, mapReady]);

  const s = t.map;
  return (
    <>
      {serverDown && <div className="notice-warn">{t.common.serverUnreachable}</div>}

      <div className="filter-row" role="group" aria-label={s.filterTitle}>
        <strong>{s.filterTitle}:</strong>
        {FILTER_KEYS.map((key) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={filters[key]}
              onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.checked }))}
            />
            {SERVICE_ICONS[key]} {s.filters[key]}
          </label>
        ))}
        <span className="muted">{angels === null ? t.common.loading : s.angelCount(filteredAngels.length)}</span>
      </div>

      <div className="map-layout">
        <div ref={containerRef} className="map-canvas" />
        <aside>
          {selected ? (
            <div className="card angel-card">
              <h3>{selected.name}</h3>
              <div className="service-tags">
                {serviceTags(selected.services, s.filters).map(({ key, label }) => (
                  <span key={key} className="service-tag">
                    {SERVICE_ICONS[key]} {label}
                  </span>
                ))}
              </div>
              <p>{s.capacity(selected.capacity)}</p>
              {selected.conditions && (
                <p className="muted">
                  {s.conditionsLabel}: {selected.conditions}
                </p>
              )}
              {/* 딥링크 href만 제공 — 앱 연동은 후속 (지갑 = 메신저, 지시서 0-4) */}
              <a className="btn" href={chatDeepLink(selected.memberId)}>
                {s.messageCta}
              </a>
              <p className="muted">{s.messageNote}</p>
            </div>
          ) : (
            <div className="card">
              <p className="muted">{s.selectHint}</p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
