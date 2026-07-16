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
      angels: string;
      courses: string;
      claims: string;
      certificates: string;
      leaderboard: string;
      transparency: string;
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

  /**
   * 엔젤 찾기 (서비스 재조정 §2-2 — 지도는 걷는 사람의 것).
   * intro는 "선의가 기반, 코인은 수단"의 정신을 담는다 (재조정 설계 0장).
   */
  angels: {
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
    /**
     * 잠자리 복수 선택 (2026-07-15) — 유형별 수용 인원 태그: "방 2" 등.
     * beds가 없는 옛 레코드는 filters.bedRoom 등 인원 없는 라벨로 폴백한다.
     */
    bedRoomCount: (n: number) => string;
    bedSofaCount: (n: number) => string;
    bedTentCount: (n: number) => string;
    /** 총 수용 인원 — beds가 있으면 유형별 인원의 합계와 같다. */
    capacity: (n: number) => string;
    conditionsLabel: string;
    /** M6 (R-3): 가능 여부 배지 — 서버 공개는 이 수준뿐 (구체 날짜는 E2E로만). */
    availableBadge: string;
    unavailableBadge: string;
    /** R-4: "대략적 위치입니다 — 정확한 위치는 승인 후 지갑 메시지로" 안내. */
    approxLocation: string;
    /** 딥링크 버튼 — "지갑 앱에서 투숙 신청" (웹 신청 불허, R-7). */
    requestCta: string;
    requestNote: string;
    selectHint: string;
    /** M7-A: 게스트북 미리보기 (빈집 방명록의 디지털판, §4-5). */
    guestbookTitle: string;
    /** "방명록 N" — 공개된 감사 카드 수. */
    guestbookCount: (n: number) => string;
    guestbookEmpty: string;
    /**
     * M7-B (안 B): 상호 별점 요약 — 게스트북(M7-A)의 형제 기능.
     * 공개율(公開率)의 분모는 피평가자가 자기 신고한 총 수령 수(receivedCount)다.
     */
    ratingTitle: string;
    /** "★ 4.6 (12개, 공개율 80%)" — ★ 글리프와 서식은 사전이 갖는다. */
    ratingSummary: (avg: string, count: number, ratioPercent: number) => string;
    ratingNone: string;
    /**
     * 정직화 라벨 (M7-B 조건 1) — 공개 별점은 프로필 주인이 게시하는 값이라 서버가
     * 진위를 보증하지 못한다("참고 지표 — 검증된 값이 아닙니다"). 자기 날조가 가능함을
     * 겸손히 밝힌다 (별점_프라이버시_결정.md R-1d).
     */
    ratingDisclaimer: string;
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

  /**
   * 투명성 공시 (재조정 §2-2 — 공통 공시를 양쪽 사이트에 배치).
   * 서버 응답의 자연어 필드는 렌더하지 않는다 — 문구는 전부 이 사전이 갖는다.
   */
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
    /** 수수료의 범위 — 대면 지불은 무료임을 밝히는 문구. 서버가 아니라 사전이 갖는다. */
    marketNote: string;
    mintStatsTitle: string;
    mintStatsPlaceholder: string;
    regionalTitle: string;
    regionalPlaceholder: string;
    reserveTitle: string;
    reservePlaceholder: string;
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
