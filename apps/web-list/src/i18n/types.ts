/**
 * 다국어 구조 (지시서 6장 + M4: en 기본 · he RTL · ko · es).
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
    nav: {
      courses: string;
      claims: string;
      certificates: string;
      leaderboard: string;
    };
    footer: {
      angelLink: string;
      angelUrl: string;
      motto: string;
    };
    serverUnreachable: string;
    loading: string;
    langLabel: string;
  };

  home: {
    heroTitle: string;
    vision: string;
    downloadCta: string;
    downloadNote: string;
    proofTitle: string;
    proofBody: string;
    proofComingSoon: string;
    sectionsTitle: string;
    sections: {
      courses: { title: string; desc: string };
      claims: { title: string; desc: string };
      certificates: { title: string; desc: string };
      leaderboard: { title: string; desc: string };
    };
  };

  courses: {
    title: string;
    intro: string;
    officialTitle: string;
    officialEmpty: string;
    colName: string;
    colSegments: string;
    colDifficulty: string;
    segmentsValue: (n: number) => string;
    /** v 예: "1.0" 또는 "1.0–4.0" → "×1.0–4.0" 표기. */
    difficultyValue: (v: string) => string;
    candidateTitle: string;
    candidateEmpty: string;
    /** 승격 진행 표기 — "현재 N명 / 100명". */
    progressLabel: (n: number, threshold: number) => string;
    candidateNoMint: string;
    submitInApp: string;
    statusOfficial: string;
    statusCandidate: string;
  };

  claims: {
    title: string;
    intro: string;
    readOnlyNote: string;
    filterAll: string;
    filterOpen: string;
    filterApproved: string;
    colCourse: string;
    colDistance: string;
    colDate: string;
    colPhotos: string;
    colVotes: string;
    colStatus: string;
    photosValue: (n: number) => string;
    votesValue: (n: number, threshold: number) => string;
    statusLabel: (status: string) => string;
    empty: string;
    rulesTitle: string;
    rule24h: string;
    ruleMonthly: string;
    ruleVoters: string;
    issuanceTitle: string;
    issuanceApproved: (n: number, shv: string) => string;
    issuanceOpen: (n: number) => string;
  };

  certificates: {
    title: string;
    intro: string;
    rewardNote: string;
    filterLabel: string;
    filterAll: string;
    kindFull: string;
    kindSection: string;
    photosValue: (n: number) => string;
    empty: string;
    submitInApp: string;
    issuanceTitle: string;
    issuanceStats: (n: number, shv: string) => string;
  };

  leaderboard: {
    title: string;
    intro: string;
    noLocationNote: string;
    regionLabel: string;
    regionAll: string;
    colRank: string;
    colName: string;
    colRegion: string;
    colDistance: string;
    colMinted: string;
    verifiedBadge: string;
    distanceValue: (km: string) => string;
    empty: string;
    baselineTitle: string;
    baselineDaily: (shv: string) => string;
    baselineWeekly: (shv: string) => string;
    baselineRegionRow: (region: string, shv: string, members: number) => string;
    baselineCatch: string;
    flaggedTitle: string;
    flaggedCount: (n: number) => string;
    flaggedNote: string;
  };

  /** 지역(트레일) 선택기 + 세계 확장 비전 (packages/shared WORLD_TRAILS). */
  region: {
    /** 선택기 라벨/섹션 제목. */
    label: string;
    /** 드롭다운 버튼 aria-label. */
    selectAria: string;
    /** "현재 지역: {트레일명}". */
    current: (name: string) => string;
    /** LIVE 배지. */
    liveBadge: string;
    /** COMING_SOON 배지 ("준비 중"). */
    comingSoonBadge: string;
    /** COMING_SOON 지역 선택 시 안내 ("곧 열립니다"). */
    comingSoonNotice: (name: string) => string;
    /** "이스라엘에서 먼저 시작 · {n}개국으로 확장" 비전 문구. */
    expandVision: (count: number) => string;
    /** 확장 예정 트레일 섹션 제목. */
    expandTitle: string;
    /** 확장 예정 트레일 목록 도입 문구. */
    expandIntro: string;
    /** ISO 국가 코드 → 로케일별 국가명 (없으면 코드 표기로 폴백). */
    countries: Record<string, string>;
  };
}
