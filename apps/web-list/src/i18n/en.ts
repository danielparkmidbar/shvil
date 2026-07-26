import type { Strings } from './types';

/** English dictionary — default locale. */
export const en: Strings = {
  common: {
    siteName: 'Shvilist',
    tagline:
      'The home of the shvilists — walkers who mint coins as they journey. You record it yourself, you attest it yourself.',
    nav: {
      angels: 'Find an Angel',
      trailAngels: 'INT Trail Angels',
      companions: 'Find Companions',
      spots: 'Spot Treasures',
      courses: 'Course Registry',
      claims: 'Claims Board',
      certificates: 'Completion Gallery',
      verify: 'Coin Checker',
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
    downloadNote: 'Closed pilot in progress — the Android test build opens after field testing.',
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

  companions: {
    title: 'Find Companions',
    intro:
      'A place to share your journey and meet the people you will walk with — before you set out. ' +
      'Rather than walking alone, a team of three or four supports one another on the trail and finds ' +
      'hosting more easily; people come before coins. Browse the sections, dates and team sizes to find ' +
      'a journey that matches yours.',
    readOnlyNote:
      'This site is for browsing and planning. Posting a companion notice and sending interest happen in the wallet app, which holds your signing key.',
    teamNote: 'Teams of 3–4 recommended — walking together builds trust and makes hosting easier (from Daniel’s experience).',
    filterTitle: 'Region',
    filterAllRegions: 'All regions',
    filterOpen: 'Recruiting',
    filterAll: 'All',
    count: (n) => `${n} recruiting`,
    modeWalk: '🚶 On foot',
    modeBike: '🚲 By bike',
    dateRange: (from, to) => `🗓 ${from} – ${to}`,
    partyValue: (current, target) => `👥 ${current} / ${target}`,
    recommendedBadge: 'Recommended size',
    closedBadge: 'Closed',
    contactCta: 'Send interest in the wallet app',
    contactNote:
      'Opens on a device with the Shvil wallet installed. Interest and contact happen only in the wallet — an end-to-end encrypted message to the poster.',
    postInApp: 'Post a companion notice from the wallet app (More → Find Companions → New post).',
    empty: 'No companion posts are recruiting yet. Post the first one from the wallet app.',
  },

  legacyAngels: {
    title: 'Legacy Trail Angels (INT)',
    intro:
      'The public trail-angel list kept for decades by the Israel National Trail hiker community. ' +
      'These hosts are not Shvil members — this is a reference list; follow the original notes for ' +
      'contact and etiquette. Ordered north (Dan) to south (Eilat).',
    etiquette: 'Etiquette: contact at least 48 hours before arrival, no calls after 21:00, and leave your spot tidy.',
    shoBadge: 'Shabbat observed',
    shoNote: 'SHO = a household observing Shabbat and Jewish holidays — no calls from Friday sunset until Saturday after sunset.',
    source: 'Source',
    updated: (date) => `Original last updated ${date}`,
    count: (n) => `${n} angels · reference list`,
    serviceLabels: {
      SLEEP: 'Sleep',
      SHOWER: 'Shower',
      MEAL: 'Meals',
      LAUNDRY: 'Laundry',
      INTERNET: 'Internet',
      GROCERY: 'Groceries',
      KITCHEN: 'Kitchen',
      PICKUP: 'Pickup/drop-off',
      WATER: 'Water',
      MAIL: 'Mail drop',
    },
  },
  trust: {
    title: 'Verified track record',
    walkTier: (tier) =>
      tier === 'VETERAN' ? 'Veteran walker' : tier === 'EXPERIENCED' ? 'Experienced walker' : 'Started walking',
    claimsApproved: (n) => `${n} community-verified completion${n === 1 ? '' : 's'}`,
    certificatesFull: (n) => `${n} full-trail certificate${n === 1 ? '' : 's'}`,
    certificatesSection: (n) => `${n} section certificate${n === 1 ? '' : 's'}`,
    memberSince: (day) => `Active since ${day}`,
    guestbookCards: (n) => `${n} thank-you card${n === 1 ? '' : 's'}`,
    firstHosting: 'Has hosted',
    verified: 'Reviewer-verified',
    none: 'No public track record yet.',
    ratingIsReference: 'Stars are a reference only — trust is built on verifiable facts.',
  },

  spots: {
    title: 'Spot Treasures',
    intro:
      'Businesses along the trail — cafés, guesthouses, gas stations — hide coins at their door to welcome ' +
      'walkers. A merchant cannot mint: they redistribute only coins they bought or earned, by depositing ' +
      '(burning) them so the server can hand them out first-come, first-served. Only spots that still have ' +
      'coins appear here — decide as you walk whether one is worth the detour.',
    readOnlyNote:
      'This site is for browsing and planning. Claiming happens in the wallet app, which scans the spot QR and signs — coins are handed out only to identity-verified members (no bearer voucher).',
    filterTitle: 'Region',
    filterAllRegions: 'All regions',
    count: (n) => `${n} spot${n === 1 ? '' : 's'}`,
    perClaim: (shv) => `${shv} each`,
    remaining: (remaining, total) => `${remaining} of ${total} left`,
    scale: (shv) => `Pool ${shv}`,
    until: (date) => `Until ${date}`,
    presenceBadge: '🚶 On-site walk check — be there to claim',
    selectHint: 'Select a marker on the map to see the spot.',
    getInApp: 'Claim in the wallet app',
    getNote:
      'Opens on a device with the Shvil wallet installed. Claiming is first-come, one per person — the server counts the slots, so coins can never exceed what the merchant deposited.',
    empty: 'No funded spots right now. Spots with no coins do not appear on the map.',
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
  verify: {
    title: 'Coin Checker',
    intro:
      'Upload a coin to tell whether it was genuinely formed or cloned. Beyond signature checks, we test whether the physical facts a coin carries — distance, steps, time — contradict each other, and whether real time actually passed between coins. A cloning program cannot manufacture the time between coin formations.',
    privacyNote: 'Everything runs inside this browser. Your coins are never sent anywhere.',
    download: {
      title: 'Download the checker',
      body:
        'The checker is a single file. Download it and keep it on your own device. Even if this ' +
        'site disappears, even with no internet, opening that file gives you the same check. We ' +
        'are not checking coins for you — we are handing you the tool that does the checking.',
      cta: 'Download the checker (one HTML file)',
      offlineHint:
        'Save the file, then open it in any browser. It works in airplane mode — which is the ' +
        'proof that this check ends on your own device.',
      communityNote:
        'The rules behind the verdict are open and anyone can read them. The checker is not a ' +
        'service we run; it is a tool the community owns — whoever finds a new forgery trick can ' +
        'add a rule and make their own checker stronger.',
      langNote: 'The downloadable checker is currently in Korean.',
    },
    effort: {
      title: 'How thoroughly you check is your call',
      body:
        'We do not require you to check, and we do not decide for you. If you lose nothing by not ' +
        'checking, do not check. The more you stand to lose, the more thoroughly you should ' +
        'check — that threshold is yours to set.',
      lowStake: 'Small amounts — just accept them. Checking is not an obligation.',
      highStake:
        'Paying real money, or receiving a large amount — do not look at a single coin. Check all ' +
        'of the other side’s coins together. The time distance between coins only shows up ' +
        'when several are examined at once.',
    },
    limits: {
      title: 'What this checker cannot do',
      items: [
        '“No contradictions” is not proof of authenticity. It means nothing was caught by the checks this checker knows.',
        'It does not verify the issuer’s identity or device integrity — it runs without a trusted-key list, so it only checks that the signatures are internally consistent.',
        'The time-distance check between coins only works with two or more coins. A single coin narrows the check sharply.',
        'It cannot tell whether this coin was already spent somewhere else. It only catches the same coin forking inside the batch you submitted.',
        'Statistical indications never add up to a forged verdict, however many stack up. An indication is grounds to ask for an explanation, never grounds to condemn a person.',
      ],
    },
    pastePlaceholder: 'Paste coin JSON, a wallet export, or a payment QR payload (SHV1.…)',
    uploadLabel: 'Upload file',
    checkButton: 'Check',
    clearButton: 'Clear',
    verdicts: { FORGED: 'Forged', SUSPECT: 'Suspicious', AUTHENTIC: 'No contradictions', INCONCLUSIVE: 'Inconclusive' },
    summaryTitle: 'Verdict',
    findingsTitle: 'Findings',
    notesTitle: 'Not checked',
    serialsTitle: 'Serial numbers',
    statsLine: (proofs, grants, totalShv) => `${proofs} walk proofs · ${grants} grant coins · total ${totalShv}`,
    fatalBadge: 'Physically impossible',
    unprovenBadge: 'Eligibility not proven',
    signalBadge: 'Indication',
    detailsLangNote: 'Detailed explanations are currently generated in Korean.',
    errorPrefix: 'Could not read input',
  },
};
