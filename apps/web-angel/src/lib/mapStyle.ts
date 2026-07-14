/**
 * 지도 스타일 + 라벨 다국어 (M5 — 래스터 → OpenFreeMap 벡터 전환).
 *
 * - 스타일: OpenFreeMap Liberty (키 불필요, OSM 데이터).
 * - 벡터 타일에는 name:{lang} 속성이 실려 있어 언어 전환 시 지도 라벨을
 *   즉시 로케일에 맞출 수 있다 — en/he(RTL)/ko/es 전부 지원.
 * - web-list의 src/lib/mapStyle.ts와 같은 패턴을 쓴다 (파일은 각 앱에 각자 둔다).
 *
 * 이 모듈은 타입 import만 하므로 SSR/프리렌더에서도 안전하다
 * (maplibre-gl 런타임은 화면 컴포넌트가 useEffect 안에서 동적 import 한다).
 */
import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl';
import type { Locale } from '@/i18n';

/** OpenFreeMap Liberty 벡터 스타일 — API 키 불필요. */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/** 필수 표기 — 데이터(OSM) + 타일 호스팅(OpenFreeMap). */
export const MAP_ATTRIBUTION = '© OpenStreetMap contributors, © OpenFreeMap';

/**
 * 로케일 우선 이름 표현식: name:{locale} → name:en → name:latin → name.
 * 히브리어 지명은 name:he, 한국어는 name:ko … 없으면 라틴 표기로 폴백한다.
 */
export function localizedNameExpression(locale: Locale): ExpressionSpecification {
  return [
    'coalesce',
    ['get', `name:${locale}`],
    ['get', 'name:en'],
    ['get', 'name:latin'],
    ['get', 'name'],
  ];
}

/**
 * 스타일의 모든 symbol 레이어 중 "이름"을 그리는 라벨의 text-field를
 * 로케일 표현식으로 교체한다. 도로 번호(ref) 등 이름이 아닌 라벨은 건드리지 않는다.
 * 스타일 로드 후, 그리고 언어 전환 시마다 호출한다 (멱등).
 */
export function applyMapLabelLocale(map: MapLibreMap, locale: Locale): void {
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    if (layer.type !== 'symbol') continue;
    const textField: unknown = map.getLayoutProperty(layer.id, 'text-field');
    if (!textField) continue;
    const raw = typeof textField === 'string' ? textField : JSON.stringify(textField);
    if (!raw.includes('name')) continue;
    map.setLayoutProperty(layer.id, 'text-field', localizedNameExpression(locale));
  }
}

/**
 * 스타일의 첫 symbol 레이어 id — 코스 폴리라인·미리보기 도형을 이 레이어
 * 아래(beforeId)에 끼워 넣어 지명 라벨을 가리지 않게 한다.
 */
export function firstSymbolLayerId(map: MapLibreMap): string | undefined {
  return (map.getStyle()?.layers ?? []).find((l) => l.type === 'symbol')?.id;
}
