import type { Strings } from './types';

/** English dictionary — default locale. */
export const en: Strings = {
  common: {
    siteName: 'Shvilist',
    tagline:
      'The home of the shvilists — walkers who mint coins as they journey. You record it yourself, you attest it yourself.',
    nav: {
      angels: 'Find an Angel',
      courses: 'Course Registry',
      claims: 'Claims Board',
      certificates: 'Completion Gallery',
      leaderboard: 'Top 100',
      transparency: 'Transparency',
    },
    footer: {
      angelLink: 'Shvil Angel — angel map & coin market (shvilangel.org)',
      angelUrl: 'https://www.shvilangel.org',
      motto: 'You record it yourself, you attest it yourself.',
    },
    serverUnreachable:
      'Cannot reach the directory server. Please try again in a moment.',
    loading: 'Loading…',
    langLabel: 'Language',
  },

  home: {
    heroTitle: 'You record it yourself, you attest it yourself',
    vision:
      'Shvil Coin is a currency born from footsteps on pilgrimage trails. No server issues it — ' +
      'while you walk a registered course, it forms inside your own phone. Shvilist is the home of ' +
      'those walkers who create coins as they journey: register courses, certify completions, and let ' +
      'the community redeem steps that went unrecorded. There is no server watching — what ' +
      'watches is always the community. (Detailed trail guides are a separate service, Shvil List.)',
    downloadCta: 'Download the wallet',
    downloadNote: 'App release in preparation — opening soon.',
    proofTitle: 'Journey proofs — attestation without location',
    proofBody:
      'Walk-proof summaries that you set to public in the app are published here. Only distance, ' +
      'step count, and date are shown — location and route are never recorded, neither on the ' +
      'phone nor on the server, so they cannot be shown.',
    proofComingSoon: 'Public browsing of journey proofs is in preparation — it opens in a coming update.',
    sectionsTitle: 'What you can do here',
    sections: {
      courses: {
        title: 'Course Registry',
        desc: 'Official and candidate courses, with promotion progress toward 100 completions.',
      },
      claims: {
        title: 'Claims Board',
        desc: 'The community procedure for redeeming steps the app failed to record.',
      },
      certificates: {
        title: 'Completion Gallery',
        desc: 'Completion and section certificates, with encouragement-coin issuance figures.',
      },
      leaderboard: {
        title: 'Top 100 Leaderboard',
        desc: 'The hall of fame of verified trekkers — the system’s living baseline.',
      },
    },
  },

  angels: {
    title: 'Find an Angel',
    intro:
      'Along the trail there are homes that open their doors to those who walk. Goodwill is the ' +
      'foundation — the coin is only a means of giving thanks and keeping the circle of good deeds ' +
      'turning. Find the angels near your route and plan where you will rest.',
    filterTitle: 'Service filters',
    filters: {
      bedRoom: 'Room',
      bedSofa: 'Sofa',
      bedTent: 'Yard tent',
      internet: 'Internet',
      shower: 'Shower',
      meal: 'Meal',
    },
    angelCount: (n) => `${n} angel${n === 1 ? '' : 's'}`,
    bedRoomCount: (n) => `Room ×${n}`,
    bedSofaCount: (n) => `Sofa ×${n}`,
    bedTentCount: (n) => `Yard tent ×${n}`,
    capacity: (n) => `Capacity: ${n} guest${n === 1 ? '' : 's'}`,
    conditionsLabel: 'Hosting conditions',
    availableBadge: 'Open to guests now',
    unavailableBadge: 'Not hosting right now',
    approxLocation:
      'This is an approximate location — the exact location is shared by wallet message after the angel approves your request.',
    requestCta: 'Request a stay in the wallet app',
    requestNote:
      'Opens on a device with the Shvil wallet installed. Stay requests are sent only from the wallet — this site is for browsing and planning.',
    selectHint: 'Select a marker on the map to see the angel’s profile.',
    guestbookTitle: 'Guestbook',
    guestbookCount: (n) => `Guestbook · ${n} card${n === 1 ? '' : 's'}`,
    guestbookEmpty: 'No thank-you cards left here yet.',
    ratingTitle: 'Rating',
    ratingSummary: (avg, count, ratioPercent) =>
      `★ ${avg} (${count} rating${count === 1 ? '' : 's'}, ${ratioPercent}% public)`,
    ratingNone: 'No ratings received yet',
    ratingDisclaimer: 'For reference only — not a verified score (posted by the profile owner).',
  },

  courses: {
    title: 'Course Registry',
    intro:
      'Only steps on courses registered as pilgrimage trails become coins at the base rate ' +
      '(1 km = 1 SHV). This is the official registry of those courses.',
    officialTitle: 'Official courses',
    officialEmpty: 'No official courses are registered yet.',
    colName: 'Course name',
    colSegments: 'Segments',
    colDifficulty: 'Difficulty factor',
    segmentsValue: (n) => `${n} segment${n === 1 ? '' : 's'}`,
    difficultyValue: (v) => `×${v}`,
    candidateTitle: 'Candidate courses (awaiting promotion)',
    candidateEmpty: 'No candidate courses have been proposed yet.',
    progressLabel: (n, threshold) => `currently ${n} of ${threshold} walkers`,
    candidateNoMint:
      'Candidate courses do not generate coins. Generation begins only after 100 or more completion records promote the course to official status.',
    submitInApp: 'Proposing a new course and submitting completion records happens in the wallet app.',
    statusOfficial: 'Official',
    statusCandidate: 'Candidate',
  },

  claims: {
    title: 'Claims Board',
    intro:
      'The redemption procedure for steps that were truly walked but produced no coins — the app ' +
      'was left off, or an error occurred. When the community reviews and recognizes a claim, the ' +
      'site’s claim issuing key signs a grant for the corresponding SHV.',
    readOnlyNote:
      'This page is read-only. Submitting claims and casting recognition votes happen in the wallet app, and only identity-verified users may take part.',
    filterAll: 'All',
    filterOpen: 'Under review',
    filterApproved: 'Approved',
    colCourse: 'Course',
    colDistance: 'Distance',
    colDate: 'Walked on',
    colPhotos: 'Photos',
    colVotes: 'Recognition votes',
    colStatus: 'Status',
    photosValue: (n) => `${n}`,
    votesValue: (n, threshold) => `${n} / ${threshold}`,
    statusLabel: (status) =>
      status === 'OPEN' ? 'Under review' : status === 'APPROVED' ? 'Approved' : status,
    empty: 'No claims to show.',
    rulesTitle: 'Claim rules',
    rule24h: 'Only claims filed within 24 hours of the walk are valid.',
    ruleMonthly: 'Claims are limited to 2 per person per month.',
    ruleVoters: 'Recognition votes are open to identity-verified users only, one vote per person.',
    issuanceTitle: 'Claim issuance disclosure',
    issuanceApproved: (n, shv) => `Approved claims: ${n} (total issued ${shv})`,
    issuanceOpen: (n) => `Claims under review: ${n}`,
  },

  certificates: {
    title: 'Completion Gallery',
    intro:
      'People who share information build the community. Post completion photos and trekking data, ' +
      'and the site issues encouragement coins. These records also inform candidate-course promotion ' +
      'reviews and claim recognition votes.',
    rewardNote:
      'Encouragement coins: course completion 10 SHV · section completion 3 SHV. No duplicate reward for the same course (one per person per course). A promotion limited in period and total volume.',
    filterLabel: 'Course',
    filterAll: 'All courses',
    kindFull: 'Completion (10 SHV)',
    kindSection: 'Section (3 SHV)',
    photosValue: (n) => `${n} photo${n === 1 ? '' : 's'}`,
    empty: 'No certificates have been posted yet.',
    submitInApp: 'Submitting completion certificates happens in the wallet app.',
    issuanceTitle: 'Encouragement coin issuance disclosure',
    issuanceStats: (n, shv) => `Encouragement coins issued: ${n} (total ${shv})`,
  },

  leaderboard: {
    title: 'Verified Trekkers — Top 100',
    intro:
      'The regional hall of fame of trekkers who hold a verification badge. With their explicit consent, only cumulative distance and total minted coins are published.',
    noLocationNote:
      'There is no location data — only distance and totals are public, and routes are never recorded anywhere.',
    regionLabel: 'Region',
    regionAll: 'All regions',
    colRank: 'Rank',
    colName: 'Name',
    colRegion: 'Region',
    colDistance: 'Distance',
    colMinted: 'Total minted',
    verifiedBadge: 'Verified',
    distanceValue: (km) => `${km} km`,
    empty: 'No trekkers are enrolled yet.',
    baselineTitle: 'Human-limit baseline',
    baselineDaily: (shv) => `Daily minting cap: ${shv}`,
    baselineWeekly: (shv) => `Weekly plausibility ceiling: ${shv}`,
    baselineRegionRow: (region, shv, members) =>
      `${region} — ${members} verified trekker${members === 1 ? '' : 's'}, top total minted ${shv}`,
    baselineCatch: 'Any minter who overtakes this baseline is caught automatically.',
    flaggedTitle: 'Pending explanations',
    flaggedCount: (n) => `Awaiting explanation: ${n}`,
    flaggedNote:
      'Anonymous tally. Cleared once the explanation is accepted; genuine coins already in circulation and other people’s trades are unaffected.',
  },

  transparency: {
    title: 'Transparency',
    intro:
      'Shvil has no central ledger. Instead, so the community can watch over itself, the site publishes everything it has issued and settled, along with sync statistics.',
    estimateNote:
      'Minting statistics are estimates based on device sync data — coins are created on each person’s phone, and the server neither approves nor enforces reporting.',
    promoTitle: 'Promotional issuance (angel bonus)',
    promoRegistration: (issued, quota) =>
      `Registration bonus (20 SHV): ${issued} issued of a quota of ${quota}`,
    promoFirstHosting: (issued) => `First-hosting bonus (30 SHV): ${issued} issued`,
    promoRule:
      'Angel bonuses are issued with a signing key limited in period and quantity, and minting happens on the angel’s phone.',
    marketTitle: 'Market settlements & fees to date',
    marketOpen: (n) => `Open listings: ${n}`,
    marketSettled: (n, shv) => `Settled listings: ${n} (total ${shv})`,
    marketFees: (usdc, pct) => `Accumulated fees: ${usdc} (${pct} at settlement)`,
    marketNote:
      'Face-to-face payments inside the ecosystem are free, forever — the fee applies only to market settlements.',
    mintStatsTitle: 'Walked coins vs. purchased coins',
    mintStatsPlaceholder:
      'In preparation — coins minted by walking and coins bought on the market are permanently distinguished by lineage, and the figures will be disclosed here as sync data accumulates.',
    regionalTitle: 'Regional minting trends',
    regionalPlaceholder:
      'In preparation — minting volume by region (by course, not by location) will be disclosed here. No one’s route is ever recorded anywhere.',
    reserveTitle: 'Reserve disclosure',
    reservePlaceholder:
      'In preparation — the reserve’s operating principles and status will be disclosed here.',
  },

  region: {
    label: 'Region',
    selectAria: 'Select trail region',
    current: (name) => `Current region: ${name}`,
    liveBadge: 'Live',
    comingSoonBadge: 'Coming soon',
    comingSoonNotice: (name) => `${name} opens soon — the trail is on the way.`,
    expandVision: (count) =>
      `We begin on the Israel National Trail. From there we expand to trails across ${count} countries.`,
    expandTitle: 'Trails opening next',
    expandIntro: 'Regions preparing to open for minting and angel hosting:',
    countries: {
      IL: 'Israel',
      ES: 'Spain',
      PE: 'Peru',
      NP: 'Nepal',
      CL: 'Chile',
      FR: 'France',
      NZ: 'New Zealand',
      US: 'United States',
      TZ: 'Tanzania',
    },
  },
};
