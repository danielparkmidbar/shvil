'use client';

/**
 * 언어 스위처 (헤더) — M4 완료 기준의 진입점.
 * 선택 즉시 localStorage에 저장되고 <html lang dir>이 갱신된다.
 * 히브리어(עברית) 선택 시 전체 레이아웃이 RTL로 뒤집힌다.
 */
import { SUPPORTED_LOCALES, useI18n, type Locale } from '@/i18n';

/** 각 언어를 그 언어 자신의 이름으로 표기한다. */
const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  he: 'עברית',
  ko: '한국어',
  es: 'Español',
};

export default function LocaleSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <select
      className="lang-select"
      aria-label={t.common.langLabel}
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
    >
      {SUPPORTED_LOCALES.map((l) => (
        <option key={l} value={l}>
          {LOCALE_LABELS[l]}
        </option>
      ))}
    </select>
  );
}
