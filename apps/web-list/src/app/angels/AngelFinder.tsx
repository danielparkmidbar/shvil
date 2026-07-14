'use client';

/**
 * 엔젤 찾기 (M5 — 서비스 재조정 §2-2: 순례자용 엔젤 탐색은 걷는 사람의 사이트 것).
 *
 * web-angel의 AngelMap을 참고 원본으로 삼아 리스트(걷는 사람) 관점으로 확장:
 * - 지역(트레일) 선택은 RegionProvider 상태를 따른다 (GET /angels?region=).
 * - 서비스 필터 → 마커 클릭 → 프로필 카드 → 지갑 앱 딥링크로 투숙 신청.
 *   웹에서는 신청을 보낼 수 없다 (R-7: 신청은 서명 주체인 지갑만).
 *
 * 위치 원칙 (확정 R-4): 서버가 내려주는 좌표는 ~1km 눈금으로 눈금화된 대략
 * 위치뿐이다. 정확한 집 위치·주소는 승인된 두 사람 사이의 E2E 지갑 메시지로만
 * 오간다 — 서버도 이 웹도 정확한 위치를 모른다. 프로필 카드에 이를 명시한다.
 *
 * 지도는 OpenFreeMap 벡터 타일 (lib/mapStyle): 라벨을 로케일에 맞춰 그리고,
 * 언어 전환 시 setLayoutProperty 루프로 라벨을 갱신한다 — 래스터 타일의
 * "라벨이 항상 현지어" 버그를 해결한 부분.
 *
 * 레이아웃은 데스크톱 우선 ("여행 전엔 노트북" — 재조정 설계 0-1절): 넓은 지도
 * 캔버스 + 옆의 넉넉한 프로필 카드. 반응형은 유지하되 기준은 큰 화면이다.
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
import {
  fallbackRasterStyle,
  fetchLocalizedStyle,
  labelExpression,
  type LocalizedMapStyle,
} from '@/lib/mapStyle';
import { useI18n, type Strings } from '@/i18n';
import { useRegion } from '@/region/RegionProvider';

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

/** 이스라엘 북부 샘플 구간 부근 — 데이터 도착 전 첫 화면. */
const INITIAL_CENTER: [number, number] = [35.64, 33.22];
const INITIAL_ZOOM = 10;

function serviceTags(
  services: AngelServices | null,
  f: Strings['angels']['filters'],
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

export default function AngelFinder() {
  const { t, locale } = useI18n();
  const { region } = useRegion();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<MapLibreMarker[]>([]);
  // Marker 생성자는 동적 import 이후에만 알 수 있으므로 모듈 참조를 보관한다.
  const maplibreRef = useRef<typeof import('maplibre-gl') | null>(null);
  // 지도 생성 시점의 로케일 (init 이후의 전환은 아래 라벨 갱신 효과가 처리).
  const localeRef = useRef(locale);
  localeRef.current = locale;
  /** 로케일 전환 시 text-field를 갱신할 symbol 레이어 ID들 (lib/mapStyle). */
  const labelLayerIdsRef = useRef<string[]>([]);
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

  // ── 지도 초기화 (브라우저에서만, 1회) ────────────────────────
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | undefined;
    (async () => {
      const maplibre = await import('maplibre-gl');
      // OpenFreeMap 벡터 스타일을 현재 로케일로 라벨 교체해서 적용.
      // 스타일 서버 장애 시 래스터 폴백 (지도는 뜨되 라벨 다국어만 포기).
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

  // ── 데이터 로드 (공개 API만 — 서명 인증 API는 웹에서 쓰지 않는다) ──
  //    지역(트레일) 전환 시 그 지역의 엔젤로 다시 불러온다.
  useEffect(() => {
    let cancelled = false;
    setAngels(null);
    setSelected(null);
    didFitRef.current = false;
    (async () => {
      try {
        const [angelList, courseList] = await Promise.all([
          fetchAngels(region.regionId),
          fetchCourses(),
        ]);
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
  }, [region.regionId]);

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

  // ── 화면 맞춤 (엔젤 + 코스 전체) — 지역 전환 시마다 1회 ──────
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

  const s = t.angels;
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
        <span className="muted">
          {angels === null ? t.common.loading : s.angelCount(filteredAngels.length)}
        </span>
      </div>

      <div className="finder-layout">
        <div ref={containerRef} className="map-canvas finder-canvas" />
        <aside>
          {selected ? (
            <div className="card angel-card">
              {/* name = 엔젤이 공개를 선택한 닉네임 (실명 아님 — 최소 공개 원칙) */}
              <h3>{selected.name}</h3>
              {/* M6 (R-3): 가능 여부 배지 — 서버 공개는 이 수준뿐. 구체 날짜는 지갑 E2E로만 */}
              {selected.available !== undefined && (
                <p>
                  <span className={selected.available ? 'badge badge-strong' : 'badge badge-warn'}>
                    {selected.available ? s.availableBadge : s.unavailableBadge}
                  </span>
                </p>
              )}
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
              {/* R-4: 대략 위치 안내 — 정확 위치는 승인 후 E2E 지갑 메시지로 */}
              <p className="notice approx-note">{s.approxLocation}</p>
              {/* 딥링크 href만 제공 — 신청 자체는 지갑(서명 주체)에서 (R-7) */}
              <a className="btn" href={chatDeepLink(selected.memberId)}>
                {s.requestCta}
              </a>
              <p className="muted">{s.requestNote}</p>
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
