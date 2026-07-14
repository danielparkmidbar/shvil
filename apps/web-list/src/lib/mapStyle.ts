/**
 * OpenFreeMap 벡터 타일 스타일 + 지도 라벨 다국어 (M5 — 서비스 재조정).
 *
 * 기존 web-angel 지도는 래스터 타일(tile.openstreetmap.org)이라 라벨이 타일
 * 이미지에 구워져 나온다 — 어떤 언어를 골라도 현지어(히브리어·아랍어)만 보이는
 * 버그의 원인. 벡터 타일은 라벨이 데이터이므로 로케일에 맞춰 그릴 수 있다:
 *   name:<locale> → name:en → name:latin → name 폴백.
 * (타일에 name:ko·name:es는 드물어서 실질 동작은 en → latin 폴백이다.)
 *
 * 스타일 원천: https://tiles.openfreemap.org/styles/liberty — 키 불필요.
 * 이 모듈은 web-angel 지도도 곧 같이 쓴다 — 로직 변경 시 양쪽을 함께 볼 것.
 */
import type { StyleSpecification } from 'maplibre-gl';

export const OPENFREEMAP_LIBERTY_STYLE_URL =
  'https://tiles.openfreemap.org/styles/liberty';

/** 필수 저작자 표기 — 데이터(OSM 기여자) + 타일 호스팅(OpenFreeMap). */
export const MAP_ATTRIBUTION = '© OpenStreetMap contributors, © OpenFreeMap';

const STYLE_FETCH_TIMEOUT_MS = 8_000;

/**
 * symbol 레이어 text-field에 넣는 로케일 우선 coalesce 표현식.
 * MapLibre 표현식은 JSON 배열 — 타입은 setLayoutProperty/layout에 그대로 전달된다.
 */
export function labelExpression(locale: string): unknown {
  return [
    'coalesce',
    ['get', `name:${locale}`],
    ['get', 'name:en'],
    ['get', 'name:latin'],
    ['get', 'name'],
  ];
}

/**
 * 이름 라벨인가 — liberty 스타일의 symbol 레이어에는 도로 번호(ref) 라벨도 있다.
 * 그런 것까지 name coalesce로 바꾸면 도로 번호가 사라지므로, text-field가
 * name 계열 속성을 참조하는 레이어만 교체 대상으로 삼는다.
 */
function isNameLabel(textField: unknown): boolean {
  if (textField == null) return false;
  const s = typeof textField === 'string' ? textField : JSON.stringify(textField);
  return s.includes('name');
}

export interface LocalizedMapStyle {
  style: StyleSpecification;
  /** 로케일 전환 시 setLayoutProperty('text-field')로 갱신할 레이어 ID들. */
  labelLayerIds: string[];
}

/**
 * 스타일 JSON의 이름 라벨을 로케일 coalesce로 교체하고 attribution을 부착한다.
 * 원본은 변경하지 않는다 (structuredClone).
 */
export function localizeStyle(
  raw: StyleSpecification,
  locale: string,
): LocalizedMapStyle {
  const style = structuredClone(raw);
  const labelLayerIds: string[] = [];
  for (const layer of style.layers ?? []) {
    if (layer.type !== 'symbol') continue;
    const layout = (layer as { layout?: Record<string, unknown> }).layout;
    if (!layout || !isNameLabel(layout['text-field'])) continue;
    layout['text-field'] = labelExpression(locale);
    labelLayerIds.push(layer.id);
  }
  // 소스에 attribution이 비어 있으므로 직접 부착한다 (중복 문자열은
  // MapLibre AttributionControl이 하나로 합친다).
  for (const source of Object.values(style.sources ?? {})) {
    (source as { attribution?: string }).attribution = MAP_ATTRIBUTION;
  }
  return { style, labelLayerIds };
}

/** OpenFreeMap 스타일을 받아 현재 로케일로 라벨을 교체해 반환한다. */
export async function fetchLocalizedStyle(
  locale: string,
  styleUrl: string = OPENFREEMAP_LIBERTY_STYLE_URL,
): Promise<LocalizedMapStyle> {
  const res = await fetch(styleUrl, {
    signal: AbortSignal.timeout(STYLE_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GET ${styleUrl} -> ${res.status}`);
  const raw = (await res.json()) as StyleSpecification;
  return localizeStyle(raw, locale);
}

/**
 * 스타일 서버 장애 시 폴백 — 래스터 OSM. 라벨 다국어는 안 되지만 지도는 뜬다.
 * labelLayerIds가 비어 있으므로 로케일 전환 루프는 자연히 no-op이 된다.
 */
export function fallbackRasterStyle(): LocalizedMapStyle {
  return {
    style: {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors',
        },
      },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    },
    labelLayerIds: [],
  };
}
