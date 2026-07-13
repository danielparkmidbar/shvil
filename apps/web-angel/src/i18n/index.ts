import { ko } from './ko';
import { dirOf, type Locale, type Strings } from './types';

export { dirOf, RTL_LOCALES, SUPPORTED_LOCALES } from './types';
export type { Locale, Strings } from './types';

/**
 * 현재 활성 로케일 — M4에서 라우팅/쿠키 기반 스위치로 대체한다.
 * 그때까지 초기 릴리스는 한국어 고정.
 */
export const activeLocale: Locale = 'ko';

/** 활성 사전. 컴포넌트는 반드시 이 t를 통해서만 문자열을 읽는다. */
export const t: Strings = ko;

/** <html dir> 값 — 히브리어(he) 전환 시 자동으로 rtl이 된다. */
export const activeDir = dirOf(activeLocale);
