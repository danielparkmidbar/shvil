'use client';

/**
 * 로케일 컨텍스트 (M4): 언어 스위처 + localStorage 저장, 기본 en.
 *
 * - SSR과 첫 클라이언트 렌더는 en으로 일치시키고, 마운트 후 저장값으로 전환한다
 *   (hydration 불일치 방지).
 * - 전환 시 <html lang dir>을 갱신한다 — 히브리어(he)는 dir="rtl"로 전체
 *   레이아웃이 뒤집힌다 (globals.css는 논리 속성만 사용).
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
import { DICTIONARIES } from './dictionaries';
import { dirOf, SUPPORTED_LOCALES, type Locale, type Strings } from './types';

export const LOCALE_STORAGE_KEY = 'shvil.locale';

const DEFAULT_LOCALE: Locale = 'en';

export interface I18nContextValue {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  t: Strings;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  dir: dirOf(DEFAULT_LOCALE),
  t: DICTIONARIES[DEFAULT_LOCALE],
  setLocale: () => {},
});

export function isLocale(value: string | null): value is Locale {
  return value !== null && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  // 저장된 언어 복원 (기본 en).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (isLocale(saved)) setLocaleState(saved);
    } catch {
      // localStorage 접근 불가 환경 — 기본 en 유지.
    }
  }, []);

  // <html lang dir> 갱신 — he 전환 시 문서 전체가 rtl로 뒤집힌다.
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dirOf(locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // 저장 실패해도 화면 전환은 유지.
    }
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, dir: dirOf(locale), t: DICTIONARIES[locale], setLocale }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** 모든 화면 컴포넌트는 이 훅으로만 문자열을 읽는다. */
export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

/**
 * hydration 이전에 <html lang dir>을 저장값으로 맞추는 부트 스크립트 —
 * 히브리어 사용자에게 LTR 화면이 번쩍이지 않게 한다. layout의 <body> 첫
 * 요소로 인라인 삽입한다 (html에는 suppressHydrationWarning).
 */
export const LOCALE_BOOT_SCRIPT =
  `(function(){try{var l=localStorage.getItem('${LOCALE_STORAGE_KEY}');` +
  `if(l==='en'||l==='he'||l==='ko'||l==='es'){document.documentElement.lang=l;` +
  `document.documentElement.dir=l==='he'?'rtl':'ltr';}}catch(e){}})();`;
