import type { Strings } from './types';

/** 한국어 사전. */
export const ko: Strings = {
  common: {
    siteName: '쉬빌리스트',
    tagline: '걷는 사람들의 집 — 여행하며 코인을 만드는 순례자. 스스로 기록하고 스스로 인증한다.',
    nav: {
      angels: '엔젤 찾기',
      trailAngels: 'INT 트레일 엔젤',
      companions: '동행 찾기',
      spots: '스팟 보물',
      courses: '코스 등록부',
      claims: '클레임 게시판',
      certificates: '완주 갤러리',
      verify: '위폐 감지기',
      leaderboard: '탑 100',
      transparency: '투명성',
    },
    footer: {
      angelLink: '쉬빌 엔젤 — 엔젤 지도·코인 마켓 (shvilangel.org)',
      angelUrl: 'https://www.shvilangel.org',
      motto: '스스로 기록하고 스스로 인증한다.',
    },
    serverUnreachable:
      '디렉토리 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    loading: '불러오는 중…',
    langLabel: '언어',
  },

  home: {
    heroTitle: '스스로 기록하고 스스로 인증한다',
    vision:
      '쉬빌 코인은 순례길 위의 걸음에서 태어나는 화폐입니다. 서버가 발행하지 않습니다 — ' +
      '등록된 코스를 걷는 동안 걷는 사람의 폰 안에서 스스로 생성됩니다. 이곳 쉬빌리스트는 ' +
      '여행하며 코인을 만드는 걷는 사람들의 집입니다. 코스를 등록하고, 완주를 인증하고, 누락된 걸음을 ' +
      '커뮤니티가 함께 구제합니다. 감시하는 서버는 없습니다 — 지켜보는 것은 언제나 커뮤니티입니다. ' +
      '(상세 트레일 정보 안내는 별도 서비스 Shvil List가 다룹니다.)',
    downloadCta: '지갑 다운로드',
    downloadNote: '닫힌 시험 진행 중 — 실기기 검증 후 Android 시험판(APK)을 엽니다.',
    proofTitle: '여정 인증 — 위치 없는 증명',
    proofBody:
      '앱에서 본인이 공개로 설정한 걷기 증명 요약이 이곳에 게시됩니다. 공개되는 것은 ' +
      '거리·걸음 수·날짜뿐입니다 — 위치와 이동 경로는 폰에도 서버에도 기록되지 않으므로 ' +
      '보여줄 수도 없습니다.',
    proofComingSoon: '공개 열람 기능은 준비 중입니다 — 다음 업데이트에서 열립니다.',
    sectionsTitle: '이 사이트에서 할 수 있는 일',
    sections: {
      courses: {
        title: '코스 등록부',
        desc: '공식 코스와 후보 코스, 100명 승격 현황을 봅니다.',
      },
      claims: {
        title: '클레임 게시판',
        desc: '앱을 못 켠 걸음의 커뮤니티 구제 절차를 봅니다.',
      },
      certificates: {
        title: '완주 갤러리',
        desc: '완주·구간 인증과 격려 코인 발행 현황을 봅니다.',
      },
      leaderboard: {
        title: '탑 100 리더보드',
        desc: '검증 트레커의 명예의 전당 — 시스템의 살아 있는 기준선.',
      },
    },
  },

  angels: {
    title: '엔젤 찾기',
    intro:
      '길 위에는 걷는 사람에게 문을 여는 집들이 있습니다. 바탕은 선의입니다 — 코인은 ' +
      '감사를 전하고 선행의 순환을 잇는 수단일 뿐입니다. 여정 가까이의 엔젤을 찾아 ' +
      '쉬어 갈 곳을 미리 계획하세요.',
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
    capacity: (n) => `수용 인원 ${n}명`,
    conditionsLabel: '수용 조건',
    availableBadge: '지금 손님 받는 중',
    unavailableBadge: '지금은 어려움',
    approxLocation:
      '대략적 위치입니다 — 정확한 위치는 엔젤이 신청을 승인한 뒤 지갑 메시지로 전달됩니다.',
    requestCta: '지갑 앱에서 투숙 신청',
    requestNote:
      '쉬빌 지갑 앱이 설치된 기기에서 열립니다. 투숙 신청은 지갑에서만 보낼 수 있습니다 — 이 사이트는 열람과 계획까지입니다.',
    selectHint: '지도의 마커를 누르면 엔젤 프로필이 표시됩니다.',
    guestbookTitle: '방명록',
    guestbookCount: (n) => `방명록 ${n}장`,
    guestbookEmpty: '아직 남겨진 감사 카드가 없습니다.',
    ratingTitle: '별점',
    ratingSummary: (avg, count, ratioPercent) => `★ ${avg} (${count}개, 공개율 ${ratioPercent}%)`,
    ratingNone: '아직 받은 별점이 없습니다',
    ratingDisclaimer: '참고 지표 — 검증된 값이 아닙니다 (프로필 주인이 게시).',
  },

  companions: {
    title: '동행 찾기',
    intro:
      '여정을 나누고 함께 걸을 사람을 미리 만나는 공간입니다. 혼자보다 3~4팀이 ' +
      '길에서 서로 의지가 되고, 투숙도 한결 수월해집니다 — 코인보다 사람이 먼저입니다. ' +
      '구간·대략 날짜·팀 규모를 보고 마음이 맞는 여정을 찾아보세요.',
    readOnlyNote:
      '이 사이트는 열람과 계획까지입니다. 동행 글 작성과 "관심 보내기"는 서명 주체인 지갑 앱에서 합니다.',
    teamNote: '3~4인 팀 권장 — 함께 걷는 사람이 있으면 신뢰도가 높아지고 투숙도 수월합니다 (다니엘 쌤 경험).',
    filterTitle: '지역',
    filterAllRegions: '전체 지역',
    filterOpen: '모집 중',
    filterAll: '전체',
    count: (n) => `모집 중 ${n}개`,
    modeWalk: '🚶 도보',
    modeBike: '🚲 자전거',
    dateRange: (from, to) => `🗓 ${from} ~ ${to}`,
    partyValue: (current, target) => `👥 ${current} / ${target}명`,
    recommendedBadge: '권장 팀 규모',
    closedBadge: '모집 마감',
    contactCta: '지갑 앱에서 관심 보내기',
    contactNote:
      '쉬빌 지갑 앱이 설치된 기기에서 열립니다. 관심 보내기·연락은 지갑에서만 — 게시자와 종단간 암호화 메시지로 이어집니다.',
    postInApp: '동행 글은 지갑 앱에서 올립니다 (더보기 → 동행 찾기 → 동행 글 올리기).',
    empty: '아직 모집 중인 동행 글이 없습니다. 지갑 앱에서 첫 글을 올려 보세요.',
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
    ratingIsReference: '별점은 참고 지표입니다 — 신뢰는 검증 가능한 사실로 쌓입니다.',
  },

  spots: {
    title: '스팟 보물',
    intro:
      '트레일 근처 사업장(카페·게스트하우스·주유소)이 문 앞에 코인을 숨겨 걷는 사람을 맞이합니다. ' +
      '사업자는 발행하지 못합니다 — 자기가 구매하거나 걸어서 만든 코인을 예치(소각)한 만큼만 서버가 ' +
      '선착순으로 나눠줍니다. 코인이 남은 스팟만 여기 뜨니, 걸으며 들를지 미리 정하세요.',
    readOnlyNote:
      '이 사이트는 열람과 계획까지입니다. 받기는 지갑 앱에서 스팟 QR을 스캔·서명해 이루어지며, 코인은 본인 확인을 마친 회원에게만 지급됩니다 (무기명 바우처 아님).',
    filterTitle: '지역',
    filterAllRegions: '전체 지역',
    count: (n) => `스팟 ${n}곳`,
    perClaim: (shv) => `1인당 ${shv}`,
    remaining: (remaining, total) => `남은 ${remaining} / ${total}명`,
    scale: (shv) => `규모 ${shv}`,
    until: (date) => `${date}까지`,
    presenceBadge: '🚶 현장 걷기 인증 — 그 자리에 가야 받습니다',
    selectHint: '지도의 마커를 누르면 스팟이 표시됩니다.',
    getInApp: '지갑 앱에서 받기',
    getNote:
      '쉬빌 지갑 앱이 설치된 기기에서 열립니다. 선착순 1인 1회이며, 슬롯은 서버가 셈하므로 지급이 예치를 넘을 수 없습니다.',
    empty: '지금 코인이 있는 스팟이 없습니다. 코인이 없는 스팟은 지도에 뜨지 않습니다.',
  },

  courses: {
    title: '코스 등록부',
    intro:
      '순례길로 등재된 코스 위의 걸음만 기준 요율(1km = 1 SHV)로 코인이 됩니다. ' +
      '이곳은 그 코스의 공식 등록부입니다.',
    officialTitle: '공식 코스',
    officialEmpty: '아직 등재된 공식 코스가 없습니다.',
    colName: '코스 이름',
    colSegments: '구간',
    colDifficulty: '난이도 계수',
    segmentsValue: (n) => `${n}개 구간`,
    difficultyValue: (v) => `×${v}`,
    candidateTitle: '후보 코스 (승격 대기)',
    candidateEmpty: '지금은 제안된 후보 코스가 없습니다.',
    progressLabel: (n, threshold) => `현재 ${n}명 / ${threshold}명`,
    candidateNoMint:
      '후보 코스에서는 코인이 생성되지 않습니다. 100명 이상의 완주 기록이 쌓여 공식 코스로 승격된 뒤부터 생성됩니다.',
    submitInApp: '새 코스 제안과 완주 기록 제출은 지갑 앱에서 이루어집니다.',
    statusOfficial: '공식',
    statusCandidate: '후보',
  },

  claims: {
    title: '클레임 게시판',
    intro:
      '실제로 걸었는데 앱을 깜빡 켜지 않았거나 오류로 코인이 생성되지 않은 걸음의 구제 절차입니다. ' +
      '커뮤니티가 검토하고 인정하면, 사이트의 클레임 발행 키가 해당 SHV의 승인서를 발행합니다.',
    readOnlyNote:
      '이 페이지는 열람 전용입니다. 클레임 제출과 인정 투표는 지갑 앱에서 이루어지며, 본인 확인을 마친 사용자만 참여할 수 있습니다.',
    filterAll: '전체',
    filterOpen: '검토 중',
    filterApproved: '승인됨',
    colCourse: '코스',
    colDistance: '거리',
    colDate: '걸은 날짜',
    colPhotos: '사진',
    colVotes: '인정 투표',
    colStatus: '상태',
    photosValue: (n) => `${n}장`,
    votesValue: (n, threshold) => `${n} / ${threshold}`,
    statusLabel: (status) =>
      status === 'OPEN' ? '검토 중' : status === 'APPROVED' ? '승인됨' : status,
    empty: '표시할 클레임이 없습니다.',
    rulesTitle: '클레임 규칙',
    rule24h: '걷기 발생 후 24시간 이내에 접수된 클레임만 유효합니다.',
    ruleMonthly: '1인당 클레임은 월 2회로 제한됩니다.',
    ruleVoters: '인정 투표는 본인 확인을 마친 사용자만, 1인 1표로 참여합니다.',
    issuanceTitle: '클레임 발행 총량 공시',
    issuanceApproved: (n, shv) => `승인된 클레임: ${n}건 (발행 누계 ${shv})`,
    issuanceOpen: (n) => `검토 중인 클레임: ${n}건`,
  },

  certificates: {
    title: '완주 갤러리',
    intro:
      '정보를 나누는 사람이 커뮤니티를 만듭니다. 완주 인증 사진과 트레킹 데이터를 올리면 ' +
      '사이트가 격려 코인을 발행합니다. 이렇게 모인 기록은 후보 코스 승격 심사와 클레임 인정 투표의 참고 자료가 됩니다.',
    rewardNote:
      '격려 코인: 코스 완주 인증 10 SHV · 구간 인증 3 SHV. 같은 코스 중복 보상은 없습니다(1인 1코스 1회). 기간·총량 한정 프로모션입니다.',
    filterLabel: '코스',
    filterAll: '전체 코스',
    kindFull: '완주 (10 SHV)',
    kindSection: '구간 (3 SHV)',
    photosValue: (n) => `사진 ${n}장`,
    empty: '아직 등록된 인증이 없습니다.',
    submitInApp: '완주 인증 제출은 지갑 앱에서 이루어집니다.',
    issuanceTitle: '격려 코인 발행 현황 공시',
    issuanceStats: (n, shv) => `발행된 격려 코인: ${n}건 (누계 ${shv})`,
  },

  leaderboard: {
    title: '검증 트레커 탑 100',
    intro:
      '검증 배지를 받은 트레커들의 지역별 명예의 전당입니다. 본인 동의하에 누적 거리와 생성 코인 총량만 공개됩니다.',
    noLocationNote:
      '위치 정보는 없습니다 — 공개되는 것은 거리와 총량뿐이며, 이동 경로는 어디에도 기록되지 않습니다.',
    regionLabel: '지역',
    regionAll: '전체 지역',
    colRank: '순위',
    colName: '이름',
    colRegion: '지역',
    colDistance: '누적 거리',
    colMinted: '생성 총량',
    verifiedBadge: '검증됨',
    distanceValue: (km) => `${km} km`,
    empty: '아직 등재된 트레커가 없습니다.',
    baselineTitle: '인간 한계 기준선',
    baselineDaily: (shv) => `1일 생성 상한: ${shv}`,
    baselineWeekly: (shv) => `주간 개연성 상한: ${shv}`,
    baselineRegionRow: (region, shv, members) =>
      `${region} — 검증 트레커 ${members}명, 최고 생성 총량 ${shv}`,
    baselineCatch: '이 기준선을 추월하는 생성자는 자동 포착됩니다.',
    flaggedTitle: '소명 대기 현황',
    flaggedCount: (n) => `소명 대기 중: ${n}건`,
    flaggedNote:
      '익명 집계입니다. 소명을 통과하면 해제되며, 이미 유통 중인 정상 코인과 타인의 거래는 영향받지 않습니다.',
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
  verify: {
    title: '위폐 감지기',
    intro:
      '코인을 업로드하면 정상적으로 만들어진 것인지 복제된 것인지 판별합니다. 서명 검증에 더해, 코인이 스스로 품고 있는 물리적 사실 — 거리·걸음·시간 — 이 서로 모순되지 않는지, 그리고 코인들 사이에 실제로 시간이 흘렀는지를 검사합니다. 프로그램으로 코인을 복제하면 코인 형성 간의 시간 거리를 만들어 넣을 수 없습니다.',
    privacyNote: '검사는 전부 이 브라우저 안에서 이루어집니다. 코인은 어디로도 전송되지 않습니다.',
    download: {
      title: '감지기 내려받기',
      body:
        '이 감지기는 파일 하나입니다. 내려받아 당신의 기기에 보관하세요. 이 사이트가 사라져도, ' +
        '인터넷이 끊겨도, 그 파일만 열면 똑같이 검사할 수 있습니다. 우리가 대신 검사해 주는 것이 ' +
        '아니라, 검사하는 도구를 당신에게 드리는 것입니다.',
      cta: '감지기 내려받기 (HTML 파일 하나)',
      offlineHint:
        '받은 파일을 저장한 뒤 브라우저로 열면 됩니다. 비행기 모드에서도 그대로 동작합니다 — ' +
        '그것이 이 검사가 당신의 기기에서 끝난다는 증거입니다.',
      communityNote:
        '판정 규칙은 공개되어 있고 누구나 읽을 수 있습니다. 감지기는 우리가 운영하는 서비스가 아니라 ' +
        '커뮤니티가 가진 도구입니다 — 새로운 위조 수법을 찾은 사람은 규칙을 더해 자기 감지기를 ' +
        '더 강하게 만들 수 있습니다.',
      langNote: '',
    },
    effort: {
      title: '얼마나 철저히 검사할지는 당신이 정합니다',
      body:
        '검사를 강요하지 않고, 판정을 대신하지도 않습니다. 확인하지 않아 잃을 것이 없다면 ' +
        '확인하지 않아도 됩니다. 손해가 클수록 더 철저히 검사하십시오 — 그 기준은 당신의 것입니다.',
      lowStake: '적은 금액을 주고받을 때 — 그냥 받아도 됩니다. 검사는 의무가 아닙니다.',
      highStake:
        '실제 돈을 내고 사거나 큰 금액을 받을 때 — 한 장만 보지 말고 상대의 코인을 한꺼번에 ' +
        '검사하십시오. 코인들 사이의 시간 거리는 여러 장을 함께 볼 때만 드러납니다.',
    },
    limits: {
      title: '이 감지기가 하지 못하는 것',
      items: [
        '‘모순 없음’은 진짜라는 증명이 아닙니다. 이 감지기가 아는 검사에 걸리지 않았다는 뜻일 뿐입니다.',
        '발행자의 신원과 기기 무결성은 확인하지 않습니다 — 신뢰 키 목록 없이 검사하므로 서명 자체의 정합만 봅니다.',
        '코인들 사이의 시간 거리 검사는 코인이 2장 이상일 때만 작동합니다. 한 장만 올리면 검사 범위가 크게 줄어듭니다.',
        '이 코인이 이미 다른 곳에서 쓰였는지는 알 수 없습니다. 제출한 묶음 안에서 같은 코인이 두 갈래로 갈라진 경우만 잡아냅니다.',
        '통계적 정황은 몇 개가 겹쳐도 위조 판정이 되지 않습니다. 정황은 소명을 요청할 근거일 뿐, 사람을 단정하는 근거가 아닙니다.',
      ],
    },
    pastePlaceholder: '코인 JSON, 지갑 내보내기, 또는 지불 QR 내용(SHV1.…)을 붙여넣으세요',
    uploadLabel: '파일 업로드',
    checkButton: '검사하기',
    clearButton: '지우기',
    verdicts: { FORGED: '위조', SUSPECT: '의심', AUTHENTIC: '모순 없음', INCONCLUSIVE: '판정 불가' },
    summaryTitle: '판정',
    findingsTitle: '발견 사항',
    notesTitle: '검사하지 못한 범위',
    serialsTitle: '일련번호',
    statsLine: (proofs, grants, totalShv) => `걷기 증명 ${proofs}건 · 보너스 계보 ${grants}장 · 합계 ${totalShv}`,
    fatalBadge: '물리적 불가능',
    signalBadge: '정황',
    detailsLangNote: '',
    errorPrefix: '읽기 실패',
  },
};
