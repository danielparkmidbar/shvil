import type { Strings } from './types';

/** English dictionary — default locale. */
export const en: Strings = {
  common: {
    siteName: 'Shvil Angel',
    tagline: 'Angel homes — the map of those who welcome pilgrims',
    nav: {
      become: 'Become an Angel',
      map: 'Neighbor Angels',
      market: 'Coin Market',
      transparency: 'Transparency',
    },
    footer: {
      shvilistLink: 'Shvilist — the home of the walkers who mint coins (shvilist.org)',
      shvilistUrl: 'https://www.shvilist.org',
      faceToFaceFree: 'Face-to-face payments inside the ecosystem are free, forever.',
    },
    serverUnreachable:
      'Cannot reach the directory server. Please try again in a moment.',
    loading: 'Loading…',
    langLabel: 'Language',
  },

  landing: {
    heroTitle: 'Open your home, and you too can rest somewhere else',
    vision:
      'Shvil Coin is a currency born from footsteps on pilgrimage trails. No server prints it — ' +
      'while a pilgrim walks a registered course, it forms inside their own phone, and it is ' +
      'exchanged for the bed, the meal, and the shower an angel offers by the wayside. Open ' +
      'your home, and you can stay in someone else’s home elsewhere. On the opposite side of ' +
      'renting out homes for money, walking and hospitality repay one another in a cycle of reciprocity.',
    becomeCta: 'Become an angel',
    mapPreviewCta: 'See the neighbor angels',
    downloadCta: 'Download the wallet',
    downloadNote: 'App release in preparation — opening soon.',
    flowTitle: 'The way to become an angel',
    flowSteps: [
      'In “Become an Angel”, choose your trail, type your village or address, and see your pin on the map.',
      'Sketch what you could offer — a room, a sofa, a yard tent, meals, a shower.',
      'Install the Shvil wallet app. The wallet is also a messenger, and only the wallet can sign your registration.',
      'Finish registering in the wallet — your point appears on the neighbor angels map, and pilgrims on the trail knock with a message.',
    ],
    flowNote:
      'This site is the doorway. Everything after joining — requests, approvals, thanks — flows through the wallet, and you can turn your visibility on and off at any time.',
    faceToFaceFree:
      'A face-to-face payment between pilgrim and angel needs no server approval and carries no fee — payments inside the ecosystem are free, forever.',
  },

  map: {
    title: 'Neighbor Angels',
    intro:
      'The neighbors who open their homes along the trail with you. Only a nickname and the offered services are shown — locations are approximate, on a ~1 km grid.',
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
    selectHint: 'Tap a marker on the map to see the angel’s nickname and services.',
    pilgrimNotice: 'Walking the trail and looking for an angel? Pilgrim search and requests live at',
    guestbookTitle: 'Guestbook',
    guestbookCount: (n) => `Guestbook · ${n} card${n === 1 ? '' : 's'}`,
    guestbookEmpty: 'No thank-you cards left here yet.',
    ratingTitle: 'Rating',
    ratingSummary: (avg, count, ratioPercent) =>
      `★ ${avg} (${count} rating${count === 1 ? '' : 's'}, ${ratioPercent}% public)`,
    ratingNone: 'No ratings received yet',
    ratingDisclaimer: 'For reference only — not a verified score (posted by the profile owner).',
  },

  become: {
    title: 'Become an Angel',
    intro:
      'Opening your home starts here. This page is only the doorway — try out your location and services, then complete the real registration in the wallet. Nothing you type here is sent to any server.',
    stepAddressTitle: 'Where is your home? (village or address)',
    addressPlaceholder: 'Village, town, or address',
    addressHint: 'Type at least 3 characters — candidates appear when you pause.',
    searching: 'Searching…',
    noResults: 'No places found. Try the name of a nearby village or town.',
    searchFailed:
      'Address search is unavailable right now. You can still tap the map to drop the pin and drag it.',
    stepPinTitle: 'Fine-tune the pin',
    pinDragHint: 'Tap the map to drop the pin, then drag it to fine-tune.',
    pinPrivacyNote:
      'The public map shows only an approximate location on a ~1 km grid. Your exact location is delivered only by wallet message, and only to guests whose stay you have approved.',
    publicPreviewLegend: 'The translucent circle is the approximate position that would be shown publicly.',
    stepServicesTitle: 'What can you offer?',
    servicesNote: 'A preview only — the actual offer is registered, and changed anytime, in the wallet.',
    bedLabel: 'Sleeping place',
    capacityLabel: 'Capacity (guests)',
    capacityAutoNote: 'Calculated automatically as the sum of the sleeping places above.',
    stepWalletTitle: 'Complete your registration in the wallet',
    walletCta: 'Download the wallet',
    walletComingSoon: 'App release in preparation — opening soon.',
    notSentNote:
      'Everything you entered here stays in this browser and was not submitted to any Shvil server — only the address search text is sent to the Photon geocoding service, solely to find candidates. Registration is signed by the wallet alone.',
  },

  market: {
    title: 'Coin Market',
    intro:
      'Angels who do not travel list here the coins they received for hospitality. Settlement is in the covenanted dollar stablecoin.',
    noPriceBanner: 'This market has no price column.',
    noPriceDetail:
      'The buyer proposes the price — priceless listings. The angel posts only an amount and decides whether to accept the buyer’s offer.',
    colSeller: 'Seller (angel)',
    colAmount: 'Amount',
    colListedAt: 'Listed on',
    colPrice: 'Price',
    priceCell: 'Buyer proposes',
    empty: 'There are no open listings right now.',
    feeNote:
      'The market fee is 2.5% at settlement (operating funds, disclosed on the Transparency page).',
    faceToFaceFree:
      'A pilgrim paying an angel directly on the trail is always, forever free.',
    appFlowNote:
      'Price offers, approval, and escrow happen in the Shvil wallet app. This page only shows the open listings.',
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
