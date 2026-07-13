/**
 * 다국어 구조 (지시서 5장 + M4: en 기본 · he RTL · ko · es — 4개 사전 완비).
 *
 * 모든 화면 문자열은 이 Strings 계약을 통해서만 사용한다.
 * 히브리어 RTL은 dirOf()로 처음부터 설계에 포함한다 — LocaleProvider가
 * <html lang dir>을 이 함수 값으로 갱신한다.
 */

export type Locale = 'en' | 'he' | 'ko' | 'es';

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'he', 'ko', 'es'];

/** RTL 로케일 — 히브리어. */
export const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(['he']);

export function dirOf(locale: Locale): 'ltr' | 'rtl' {
  return RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';
}

/** 화면 문자열 계약 — 모든 로케일 사전이 이 형태를 구현한다. */
export interface Strings {
  common: {
    siteName: string;
    tagline: string;
    nav: { map: string; market: string; transparency: string };
    footer: {
      shvilistLink: string;
      shvilistUrl: string;
      faceToFaceFree: string;
    };
    serverUnreachable: string;
    loading: string;
    langLabel: string;
  };
  landing: {
    heroTitle: string;
    vision: string;
    mapPreviewCta: string;
    downloadCta: string;
    downloadNote: string;
    flowTitle: string;
    flowSteps: readonly string[];
    flowNote: string;
    faceToFaceFree: string;
  };
  map: {
    title: string;
    intro: string;
    filterTitle: string;
    filters: {
      bedRoom: string;
      bedSofa: string;
      bedTent: string;
      internet: string;
      shower: string;
      meal: string;
    };
    angelCount: (n: number) => string;
    capacity: (n: number) => string;
    conditionsLabel: string;
    messageCta: string;
    messageNote: string;
    selectHint: string;
    attribution: string;
  };
  market: {
    title: string;
    intro: string;
    noPriceBanner: string;
    noPriceDetail: string;
    colSeller: string;
    colAmount: string;
    colListedAt: string;
    colPrice: string;
    priceCell: string;
    empty: string;
    feeNote: string;
    faceToFaceFree: string;
    appFlowNote: string;
  };
  transparency: {
    title: string;
    intro: string;
    estimateNote: string;
    promoTitle: string;
    promoRegistration: (issued: number, quota: number) => string;
    promoFirstHosting: (issued: number) => string;
    promoRule: string;
    marketTitle: string;
    marketOpen: (n: number) => string;
    marketSettled: (n: number, shv: string) => string;
    marketFees: (usdc: string, pct: string) => string;
    mintStatsTitle: string;
    mintStatsPlaceholder: string;
    regionalTitle: string;
    regionalPlaceholder: string;
    reserveTitle: string;
    reservePlaceholder: string;
  };
}
