import type { Strings } from './types';

/** 한국어 사전. */
export const ko: Strings = {
  common: {
    siteName: '쉬빌 엔젤',
    tagline: '엔젤의 집 — 순례자를 맞이하는 지도',
    nav: { map: '엔젤 지도', market: '코인 마켓', transparency: '투명성' },
    footer: {
      shvilistLink: '쉬빌 리스트 — 여정 기록·코스 등록부 (shvilist.org)',
      shvilistUrl: 'https://shvilist.org',
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
    mapPreviewCta: '엔젤 지도 보기',
    downloadCta: '지갑 다운로드',
    downloadNote: '앱 배포 준비 중 — 곧 열립니다.',
    flowTitle: '엔젤이 되는 길',
    flowSteps: [
      '쉬빌 지갑 앱을 설치합니다. 지갑은 동시에 메신저입니다.',
      '앱에서 전화 인증을 하고, 내어줄 수 있는 것(방·소파·마당 텐트, 식사, 샤워)과 위치를 등록합니다.',
      '등록하는 순간 이 사이트의 엔젤 지도에 내 포인트가 나타나고, 길 위의 순례자가 메시지로 문을 두드립니다.',
    ],
    flowNote:
      '지갑을 받으면 지도에 엔젤로 등록됩니다. 공개 여부는 언제든 본인이 켜고 끌 수 있습니다.',
    faceToFaceFree:
      '순례자와 엔젤 사이의 대면 지불은 서버 승인도, 수수료도 없습니다 — 생태계 내부 대면 지불은 영구 무료입니다.',
  },

  map: {
    title: '엔젤 지도',
    intro:
      '길 위의 순례자를 맞이하는 엔젤들의 포인트입니다. 위치는 엔젤 본인이 자발적으로 공개한 것만 표시됩니다.',
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
    capacity: (n) => `수용 인원 ${n}명`,
    conditionsLabel: '수용 조건',
    messageCta: '지갑 앱에서 메시지 보내기',
    messageNote: '쉬빌 지갑 앱이 설치된 기기에서 열립니다.',
    selectHint: '지도의 마커를 누르면 엔젤 프로필이 표시됩니다.',
    attribution: '© OpenStreetMap contributors',
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
    mintStatsTitle: '생성 코인 vs 구매 코인 구분 통계',
    mintStatsPlaceholder:
      '집계 준비 중 — 걸어서 생성한 코인과 마켓에서 구매한 코인은 계보로 영구 구분되며, 동기화 통계가 모이는 대로 이곳에 공시됩니다.',
    regionalTitle: '지역별 생성량 추이',
    regionalPlaceholder:
      '집계 준비 중 — 지역별 생성량(위치 아닌 코스 단위)이 이곳에 공시됩니다. 개인의 이동 경로는 어디에도 기록되지 않습니다.',
    reserveTitle: '리저브 공시',
    reservePlaceholder:
      '준비 중 — 리저브 운용 원칙과 현황은 리저브 기획 보고서(docs/쉬빌_리저브_기획보고서.md)를 기준으로 이곳에 공시됩니다.',
  },
};
