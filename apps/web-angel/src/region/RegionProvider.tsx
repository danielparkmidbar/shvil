'use client';

/**
 * 지역(트레일) 컨텍스트 — 헤더의 지역 선택기와 페이지의 "현재 지역" 표시가
 * 같은 선택 상태를 공유하게 한다 (LocaleProvider와 같은 패턴).
 *
 * - 카탈로그는 packages/shared의 WORLD_TRAILS (앱·서버·웹이 같은 지역 정의를 공유).
 * - LIVE 지역만 실제 선택 대상이다. COMING_SOON은 안내용이라 저장/선택되지 않는다.
 * - 기본값은 DEFAULT_REGION_ID(이스라엘) — SSR/첫 렌더를 기본값으로 맞추고
 *   마운트 후 localStorage 저장값으로 전환한다 (hydration 불일치 방지).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_REGION_ID,
  WORLD_TRAILS,
  regionById,
  type TrailRegion,
} from '@shvil/shared/src/regions';

export const REGION_STORAGE_KEY = 'shvil.region';

const DEFAULT_REGION: TrailRegion = regionById(DEFAULT_REGION_ID) ?? WORLD_TRAILS[0];

export interface RegionContextValue {
  regionId: string;
  /** 선택된 지역 (해석 실패 시 기본 지역으로 폴백). */
  region: TrailRegion;
  /** LIVE 지역만 실제로 전환된다. */
  setRegion: (regionId: string) => void;
}

const RegionContext = createContext<RegionContextValue>({
  regionId: DEFAULT_REGION_ID,
  region: DEFAULT_REGION,
  setRegion: () => {},
});

/** ISO alpha-2 국가 코드 → 국기 이모지 (표시 계층 전용, 방향 중립). */
export function countryFlag(countryCode: string): string {
  if (!/^[A-Za-z]{2}$/.test(countryCode)) return '';
  const base = 0x1f1e6; // Regional Indicator Symbol Letter A
  const cc = countryCode.toUpperCase();
  return String.fromCodePoint(
    base + (cc.charCodeAt(0) - 65),
    base + (cc.charCodeAt(1) - 65),
  );
}

export function RegionProvider({ children }: { children: ReactNode }) {
  const [regionId, setRegionId] = useState<string>(DEFAULT_REGION_ID);

  // 저장된 선택 복원 — LIVE 지역만 인정 (COMING_SOON은 저장 대상이 아님).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(REGION_STORAGE_KEY);
      if (saved) {
        const r = regionById(saved);
        if (r && r.status === 'LIVE') setRegionId(r.regionId);
      }
    } catch {
      // localStorage 접근 불가 — 기본값 유지.
    }
  }, []);

  const setRegion = useCallback((next: string) => {
    const r = regionById(next);
    if (!r || r.status !== 'LIVE') return; // COMING_SOON은 선택 불가.
    setRegionId(r.regionId);
    try {
      window.localStorage.setItem(REGION_STORAGE_KEY, r.regionId);
    } catch {
      // 저장 실패해도 화면 전환은 유지.
    }
  }, []);

  const value = useMemo<RegionContextValue>(
    () => ({ regionId, region: regionById(regionId) ?? DEFAULT_REGION, setRegion }),
    [regionId, setRegion],
  );

  return <RegionContext.Provider value={value}>{children}</RegionContext.Provider>;
}

export function useRegion(): RegionContextValue {
  return useContext(RegionContext);
}
