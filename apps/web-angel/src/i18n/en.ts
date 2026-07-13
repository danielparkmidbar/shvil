import type { Strings } from './types';

/** English dictionary — default locale. */
export const en: Strings = {
  common: {
    siteName: 'Shvil Angel',
    tagline: 'Angel homes — the map of those who welcome pilgrims',
    nav: { map: 'Angel Map', market: 'Coin Market', transparency: 'Transparency' },
    footer: {
      shvilistLink: 'Shvil List — journey records & course registry (shvilist.org)',
      shvilistUrl: 'https://shvilist.org',
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
    mapPreviewCta: 'View the Angel Map',
    downloadCta: 'Download the wallet',
    downloadNote: 'App release in preparation — opening soon.',
    flowTitle: 'The way to become an angel',
    flowSteps: [
      'Install the Shvil wallet app. The wallet is also a messenger.',
      'Verify your phone in the app, then register what you can offer (a room, a sofa, a yard tent, meals, a shower) and your location.',
      'The moment you register, your point appears on this site’s angel map, and pilgrims on the trail knock with a message.',
    ],
    flowNote:
      'Receiving the wallet registers you as an angel on the map. You can turn your visibility on and off at any time.',
    faceToFaceFree:
      'A face-to-face payment between pilgrim and angel needs no server approval and carries no fee — payments inside the ecosystem are free, forever.',
  },

  map: {
    title: 'Angel Map',
    intro:
      'The points of angels who welcome pilgrims on the trail. Only locations that angels have voluntarily made public are shown.',
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
    capacity: (n) => `Capacity: ${n} guest${n === 1 ? '' : 's'}`,
    conditionsLabel: 'Hosting conditions',
    messageCta: 'Send a message from the wallet app',
    messageNote: 'Opens on a device with the Shvil wallet installed.',
    selectHint: 'Tap a marker on the map to see the angel’s profile.',
    attribution: '© OpenStreetMap contributors',
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
};
