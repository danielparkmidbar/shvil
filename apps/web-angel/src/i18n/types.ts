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
    nav: { become: string; map: string; market: string; transparency: string };
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
    /** 주 CTA — "엔젤 되기" (M5: 사이트는 문, 등록은 지갑). */
    becomeCta: string;
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
    /**
     * 잠자리 복수 선택 (2026-07-15) — 유형별 수용 인원 태그: "방 2" 등.
     * beds가 없는 옛 레코드는 filters.bedRoom 등 인원 없는 라벨로 폴백한다.
     */
    bedRoomCount: (n: number) => string;
    bedSofaCount: (n: number) => string;
    bedTentCount: (n: number) => string;
    selectHint: string;
    /** 순례자용 탐색·신청은 shvilist.org로 갔다는 한 줄 안내 (링크는 화면이 붙인다). */
    pilgrimNotice: string;
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

  /**
   * 검증 가능한 신뢰 지표 (C — 별점 대신 사실, 검증가능신뢰_설계.md).
   * 서버는 뱃지 코드·숫자·일자만 보내므로 그것을 사람 문구로 옮기는 4개 언어 사전이
   * 유일한 출처다. 위조가 어려운 사실(완주·검증 걷기 실적·활동 기간)을 뱃지로 보여
   * "검증된 실적 있는 엔젤"을 위조 없이 고르게 한다(다니엘 쌤 의도). 별점은 참고 지표.
   */
  trust: {
    title: string;
    walkTier: (tier: 'STARTER' | 'EXPERIENCED' | 'VETERAN') => string;
    claimsApproved: (n: number) => string;
    certificatesFull: (n: number) => string;
    certificatesSection: (n: number) => string;
    memberSince: (day: string) => string;
    guestbookCards: (n: number) => string;
    firstHosting: string;
    verified: string;
    none: string;
  };

  /**
   * "엔젤 되기" (M5 신규 — 서비스 재조정 설계 §4-1).
   * 사이트는 문이다: 미리보기까지만, 어떤 것도 서버로 제출하지 않는다.
   * 등록 서명은 지갑만 할 수 있다.
   */
  become: {
    title: string;
    intro: string;
    /** ① 주소/마을 입력 (Photon 지오코딩). */
    stepAddressTitle: string;
    addressPlaceholder: string;
    addressHint: string;
    searching: string;
    noResults: string;
    searchFailed: string;
    /** ② 핀 미세 조정 + 프라이버시 눈금 미리보기 (R-4 확정). */
    stepPinTitle: string;
    pinDragHint: string;
    /** "공개 지도에는 약 1km 눈금의 대략 위치만 …" — R-4 안내 원문. */
    pinPrivacyNote: string;
    /** 반투명 원 = 공개될 대략 위치라는 범례. */
    publicPreviewLegend: string;
    /** ③ 제공 서비스 미리보기. */
    stepServicesTitle: string;
    servicesNote: string;
    bedLabel: string;
    /** 총 수용 인원 라벨 — 값은 유형별 인원의 합계로 자동 계산되어 표시된다. */
    capacityLabel: string;
    /** "잠자리 유형별 인원의 합계로 자동 계산됩니다" 안내 (잠자리 복수 선택). */
    capacityAutoNote: string;
    /** ④ 지갑 다운로드 안내 (플레이스홀더 — 앱 배포 전). */
    stepWalletTitle: string;
    walletCta: string;
    walletComingSoon: string;
    /** "여기까지의 입력은 이 브라우저에만 있으며 서버로 전송되지 않았습니다" — 사실이어야 한다. */
    notSentNote: string;
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
