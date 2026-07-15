import type { Strings } from './types';

/** 한국어 사전. */
export const ko: Strings = {
  common: {
    siteName: '쉬빌리스트',
    tagline: '걷는 사람들의 집 — 여행하며 코인을 만드는 순례자. 스스로 기록하고 스스로 인증한다.',
    nav: {
      angels: '엔젤 찾기',
      courses: '코스 등록부',
      claims: '클레임 게시판',
      certificates: '완주 갤러리',
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
    downloadNote: '앱 배포 준비 중 — 곧 열립니다.',
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
};
