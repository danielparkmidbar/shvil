import type { Strings } from './types';

/** 한국어 사전. */
export const ko: Strings = {
  common: {
    siteName: '쉬빌 엔젤',
    tagline: '엔젤의 집 — 순례자를 맞이하는 지도',
    nav: {
      become: '엔젤 되기',
      map: '이웃 엔젤',
      trailAngels: 'INT 트레일 엔젤',
      market: '코인 마켓',
      transparency: '투명성',
    },
    footer: {
      shvilistLink: '쉬빌리스트 — 걷는 사람들의 집 (shvilist.org)',
      shvilistUrl: 'https://www.shvilist.org',
      faceToFaceFree: '생태계 내부 대면 지불은 영구 무료입니다.',
    },
    serverUnreachable:
      '디렉토리 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    loading: '불러오는 중…',
    langLabel: '언어',
  },

  landing: {
    heroTitle: '내 집을 내어주면, 나도 다른 곳에서 쉴 수 있습니다',
    vision:
      '쉬빌 코인은 순례길 위의 걸음에서 태어나는 화폐입니다. 서버가 찍어내지 않습니다 — ' +
      '등록된 코스를 걷는 동안 순례자의 폰 안에서 스스로 생성되고, 길가의 엔젤이 내어주는 ' +
      '잠자리·식사·샤워와 교환됩니다. 내 집을 내어주면 나도 다른 곳에서 다른 사람의 집을 ' +
      '이용할 수 있습니다. 돈을 받고 집을 빌려주는 모델의 반대편에서, 걸음과 환대가 서로를 ' +
      '갚는 호혜의 순환을 만듭니다.',
    becomeCta: '엔젤 되기',
    mapPreviewCta: '이웃 엔젤 보기',
    downloadCta: '지갑 다운로드',
    downloadNote: '앱 배포 준비 중 — 곧 열립니다.',
    flowTitle: '엔젤이 되는 길',
    flowSteps: [
      '"엔젤 되기"에서 트레일을 고르고 마을·주소를 입력해 지도 위 내 핀을 확인합니다.',
      '내어줄 수 있는 것(방·소파·마당 텐트, 식사, 샤워)을 미리 그려 봅니다.',
      '쉬빌 지갑 앱을 설치합니다. 지갑은 동시에 메신저이며, 등록 서명은 지갑만 할 수 있습니다.',
      '지갑에서 등록을 마치면 이웃 엔젤 지도에 내 포인트가 나타나고, 길 위의 순례자가 메시지로 문을 두드립니다.',
    ],
    flowNote:
      '이 사이트는 문입니다. 가입 이후의 모든 것 — 신청·승인·감사 — 은 지갑을 통해 흐르고, 공개 여부는 언제든 본인이 켜고 끌 수 있습니다.',
    faceToFaceFree:
      '순례자와 엔젤 사이의 대면 지불은 서버 승인도, 수수료도 없습니다 — 생태계 내부 대면 지불은 영구 무료입니다.',
  },

  map: {
    title: '이웃 엔젤',
    intro:
      '길을 따라 함께 집을 여는 이웃들입니다. 닉네임과 제공 서비스만 표시됩니다 — 위치는 약 1km 눈금의 대략 위치입니다.',
    filterTitle: '서비스 필터',
    filters: {
      bedRoom: '방',
      bedSofa: '소파',
      bedTent: '마당 텐트',
      internet: '인터넷',
      shower: '샤워',
      meal: '식사',
    },
    angelCount: (n) => `엔젤 ${n}곳`,
    bedRoomCount: (n) => `방 ${n}`,
    bedSofaCount: (n) => `소파 ${n}`,
    bedTentCount: (n) => `마당 텐트 ${n}`,
    selectHint: '지도의 마커를 누르면 엔젤의 닉네임과 서비스가 표시됩니다.',
    pilgrimNotice: '길을 걸으며 엔젤을 찾고 계신가요? 순례자용 탐색과 신청은 여기에 있습니다:',
    guestbookTitle: '방명록',
    guestbookCount: (n) => `방명록 ${n}장`,
    guestbookEmpty: '아직 남겨진 감사 카드가 없습니다.',
    ratingTitle: '별점',
    ratingSummary: (avg, count, ratioPercent) => `★ ${avg} (${count}개, 공개율 ${ratioPercent}%)`,
    ratingNone: '아직 받은 별점이 없습니다',
    ratingDisclaimer: '참고 지표 — 검증된 값이 아닙니다 (프로필 주인이 게시).',
  },

  legacyAngels: {
    title: '기존 트레일 엔젤 명단 (INT)',
    intro:
      '이스라엘 국립 트레일(INT) 하이커 커뮤니티가 수십 년 이어온 공개 엔젤 명단입니다. ' +
      '이분들은 쉬빌 회원이 아닌 참고 명단입니다 — 연락·이용 방식은 원문 안내를 따르세요. ' +
      '북쪽 단(Dan)에서 남쪽 에일라트(Eilat)까지 지리 순서입니다.',
    etiquette: '이용 예절: 도착 최소 48시간 전에 연락하고, 21:00 이후에는 전화하지 마세요. 떠날 때는 머문 자리를 정돈합니다.',
    shoBadge: '안식일 준수',
    shoNote: 'SHO = 안식일·유대 명절 준수 가정 — 금요일 일몰부터 토요일 일몰 후까지 전화 금지.',
    source: '출처',
    updated: (date) => `원본 최종 갱신 ${date}`,
    count: (n) => `엔젤 ${n}명 · 참고 명단`,
    serviceLabels: {
      SLEEP: '숙박',
      SHOWER: '샤워',
      MEAL: '식사',
      LAUNDRY: '세탁',
      INTERNET: '인터넷',
      GROCERY: '식료품',
      KITCHEN: '취사',
      PICKUP: '픽업/드롭',
      WATER: '식수',
      MAIL: '우편물',
    },
  },
  trust: {
    title: '검증된 실적',
    walkTier: (tier) =>
      tier === 'VETERAN' ? '베테랑 트레커' : tier === 'EXPERIENCED' ? '경험 많은 트레커' : '걷기 시작',
    claimsApproved: (n) => `커뮤니티 인정 완주 ${n}`,
    certificatesFull: (n) => `완주 인증 ${n}`,
    certificatesSection: (n) => `구간 인증 ${n}`,
    memberSince: (day) => `${day}부터 활동`,
    guestbookCards: (n) => `감사 카드 ${n}`,
    firstHosting: '접대 경험 있음',
    verified: '검토단 검증',
    none: '아직 공개된 실적이 없습니다.',
  },

  become: {
    title: '엔젤 되기',
    intro:
      '집을 여는 일은 여기서 시작됩니다. 이 페이지는 문일 뿐입니다 — 위치와 서비스를 미리 그려 보고, 실제 등록은 지갑에서 완성합니다. 여기 입력한 것은 어떤 서버로도 전송되지 않습니다.',
    stepAddressTitle: '집이 어디인가요? (마을 또는 주소)',
    addressPlaceholder: '마을·도시 또는 주소',
    addressHint: '3자 이상 입력하고 잠시 멈추면 후보가 나타납니다.',
    searching: '찾는 중…',
    noResults: '장소를 찾지 못했습니다. 가까운 마을·도시 이름으로 다시 시도해 보세요.',
    searchFailed:
      '주소 검색을 지금 사용할 수 없습니다. 지도를 눌러 핀을 놓고 끌어서 조정할 수 있습니다.',
    stepPinTitle: '핀 미세 조정',
    pinDragHint: '지도를 누르면 핀이 놓이고, 핀을 끌어 미세 조정할 수 있습니다.',
    pinPrivacyNote:
      '공개 지도에는 약 1km 눈금의 대략 위치만 표시됩니다. 정확한 위치는 투숙을 승인한 손님에게만 지갑 메시지로 전달됩니다.',
    publicPreviewLegend: '반투명 원이 공개될 대략 위치입니다.',
    stepServicesTitle: '무엇을 내어줄 수 있나요?',
    servicesNote: '미리보기입니다 — 실제 제공 내용은 지갑에서 등록하고 언제든 바꿀 수 있습니다.',
    bedLabel: '잠자리',
    capacityLabel: '수용 인원(명)',
    capacityAutoNote: '위 잠자리 유형별 인원의 합계로 자동 계산됩니다.',
    stepWalletTitle: '지갑에서 등록을 완성하세요',
    walletCta: '지갑 다운로드',
    walletComingSoon: '앱 배포 준비 중 — 곧 열립니다.',
    notSentNote:
      '여기까지의 입력은 이 브라우저에만 있으며 쉬빌 서버로 전송되지 않았습니다 — 주소 검색어만 후보를 찾기 위해 지오코딩 서비스(Photon)에 전달됩니다. 등록 서명은 지갑만 할 수 있습니다.',
  },

  market: {
    title: '코인 마켓',
    intro:
      '여행하지 않는 엔젤은 접대로 받은 코인을 이곳에 내놓습니다. 결제는 협약 달러 스테이블코인으로 이루어집니다.',
    noPriceBanner: '이 마켓에는 가격 열이 없습니다.',
    noPriceDetail:
      '가격은 구매자가 제시합니다 — 무정가 리스팅. 엔젤은 수량만 올리고, 구매자가 제시한 가격을 승인할지 결정합니다.',
    colSeller: '판매자 (엔젤)',
    colAmount: '수량',
    colListedAt: '등록일',
    colPrice: '가격',
    priceCell: '구매자 제시',
    empty: '지금은 열린 리스팅이 없습니다.',
    feeNote:
      '마켓 수수료는 체결 시 2.5%입니다 (운영 재원, 투명성 페이지에 공시).',
    faceToFaceFree:
      '길 위에서 순례자가 엔젤에게 직접 지불하는 것은 언제나, 영원히 무료입니다.',
    appFlowNote:
      '가격 제시와 승인, 에스크로 진행은 쉬빌 지갑 앱에서 이루어집니다. 이 페이지는 열린 리스팅을 보여줄 뿐입니다.',
  },

  transparency: {
    title: '투명성',
    intro:
      '쉬빌에는 중앙 원장이 없습니다. 그 대신 커뮤니티가 스스로 지켜볼 수 있도록, 사이트가 발행·체결한 것과 동기화 통계를 모두 공개합니다.',
    estimateNote:
      '민팅 통계는 기기 동기화 데이터 기반 추정치입니다 — 코인은 각자의 폰에서 생성되며, 서버는 승인하지도 집계를 강제하지도 않습니다.',
    promoTitle: '프로모션 발행 현황 (엔젤 보너스)',
    promoRegistration: (issued, quota) =>
      `등록 보너스 (20 SHV): ${issued}건 발행 / 쿼터 ${quota}건`,
    promoFirstHosting: (issued) => `첫 접대 보너스 (30 SHV): ${issued}건 발행`,
    promoRule:
      '엔젤 보너스는 기간·수량 한정 서명 키로 발급되며, 민팅은 엔젤의 폰에서 이루어집니다.',
    marketTitle: '마켓 체결·수수료 누계',
    marketOpen: (n) => `열린 리스팅: ${n}건`,
    marketSettled: (n, shv) => `체결된 리스팅: ${n}건 (누계 ${shv})`,
    marketFees: (usdc, pct) => `수수료 누계: ${usdc} (체결 시 ${pct})`,
    marketNote: '생태계 내부 대면 지불은 영구 무료입니다 — 수수료는 마켓 체결에만 부과됩니다.',
    mintStatsTitle: '생성 코인 vs 구매 코인 구분 통계',
    mintStatsPlaceholder:
      '집계 준비 중 — 걸어서 생성한 코인과 마켓에서 구매한 코인은 계보로 영구 구분되며, 동기화 통계가 모이는 대로 이곳에 공시됩니다.',
    regionalTitle: '지역별 생성량 추이',
    regionalPlaceholder:
      '집계 준비 중 — 지역별 생성량(위치 아닌 코스 단위)이 이곳에 공시됩니다. 개인의 이동 경로는 어디에도 기록되지 않습니다.',
    reserveTitle: '리저브 공시',
    // 공시 기준 문서는 docs/쉬빌_리저브_기획보고서.md — 내부 경로는 화면에 쓰지 않는다
    // (방문자는 접근할 수 없고, 다른 3개 사전과도 어긋난다).
    reservePlaceholder: '준비 중 — 리저브 운용 원칙과 현황은 이곳에 공시됩니다.',
  },

  region: {
    label: '지역',
    selectAria: '트레일 지역 선택',
    current: (name) => `현재 지역: ${name}`,
    liveBadge: '운영 중',
    comingSoonBadge: '준비 중',
    comingSoonNotice: (name) => `${name} — 곧 열립니다.`,
    expandVision: (count) =>
      `이스라엘 국립 트레일에서 먼저 시작합니다. ${count}개국의 트레일로 확장해 나갑니다.`,
    expandTitle: '곧 열릴 트레일',
    expandIntro: '코인 생성과 엔젤 활동을 위해 열릴 준비 중인 지역들:',
    countries: {
      IL: '이스라엘',
      ES: '스페인',
      PE: '페루',
      NP: '네팔',
      CL: '칠레',
      FR: '프랑스',
      NZ: '뉴질랜드',
      US: '미국',
      TZ: '탄자니아',
    },
  },
};
