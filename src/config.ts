// -------------------------------------------------------------------------
// Global site configuration. Rename the brand here and it changes everywhere.
// -------------------------------------------------------------------------
export const SITE = {
  name: 'the site',
  tagline: 'Sharp Predictions. Proven Results.',
  description:
    'Free consensus football & basketball predictions, cross-checked across dozens of tipsters and verified against real results. Bet smarter with the site.',
  domain: 'the-site.com',
  url: 'https://the-site-tips.pages.dev',
  locale: 'en',
  email: 'info@the-site.com',
  // Funnel / social
  telegram: 'https://t.me/',
  twitter: '#',
  instagram: '#',
  youtube: '#',
  // Compliance
  minAge: 18, // 18 for most of Europe; use 21 if you target Greece (EEEP)
  regulator: 'Licensed operators only', // e.g. "MGA / UKGC licensed operators"
} as const;

export const NAV = [
  { label: 'Predictions', href: '/tips' },
  { label: 'Value', href: '/value' },
  { label: 'VIP', href: '/pricing' },
  { label: 'Results', href: '/results' },
  { label: 'Free Bets', href: '/offers' },
  { label: 'Casino', href: '/casino' },
  { label: 'News', href: '/news' },
] as const;

// -------------------------------------------------------------------------
// Membership tiers. Prices live here so you change them in one place.
// The `stripeEnv` name maps to a Stripe Price ID you set as an env var /
// Cloudflare secret in Phase 2 (e.g. STRIPE_PRICE_PREMIUM). Nothing secret
// lives in this file.
// -------------------------------------------------------------------------
export type TierId = 'free' | 'win' | 'premium' | 'vip';

export interface Tier {
  id: TierId;
  name: string;
  tagline: string;
  price: number; // per month, in EUR
  period: string;
  badge?: string;
  highlight?: boolean; // visually featured card
  cta: string;
  stripeEnv?: string; // env var holding the Stripe Price ID (Phase 2)
  features: { label: string; included: boolean }[];
}

// Three tracked systems → three plans, plus a free daily hook. Each plan sells on
// the metric its system is best at: WIN on strike rate, OVERALL on balanced profit,
// VIP on return. See /results for each system's live record.
export const TIERS: Tier[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'See how sharp we are.',
    price: 0,
    period: 'forever',
    cta: 'Start free',
    features: [
      { label: '1 daily Banker pick', included: true },
      { label: 'Full public track record — all 3 systems', included: true },
      { label: 'Best-odds comparison board', included: true },
      { label: 'News, guides & bonus offers', included: true },
      { label: 'Full WIN feed (all favorites)', included: false },
      { label: 'Value picks & the balanced system', included: false },
      { label: 'High-odds VIP value engine', included: false },
    ],
  },
  {
    id: 'win',
    name: 'WIN',
    tagline: 'Highest strike rate. Sleep easy.',
    price: 35,
    period: 'month',
    badge: 'Banker',
    cta: 'Get WIN',
    stripeEnv: 'STRIPE_PRICE_WIN',
    features: [
      { label: 'Everything in Free', included: true },
      { label: 'The full WIN feed — every favorite pick', included: true },
      { label: 'Our highest win rate — the safe, steady system', included: true },
      { label: 'Filters, alerts & daily email', included: true },
      { label: 'Ad-free experience', included: true },
      { label: 'Value picks & the balanced system', included: false },
      { label: 'High-odds VIP value engine', included: false },
    ],
  },
  {
    id: 'premium',
    name: 'OVERALL',
    tagline: 'Win rate and profit, balanced.',
    price: 65,
    period: 'month',
    badge: 'Most popular',
    highlight: true,
    cta: 'Get OVERALL',
    stripeEnv: 'STRIPE_PRICE_PREMIUM',
    features: [
      { label: 'Everything in WIN', included: true },
      { label: 'The balanced system — favorites + value', included: true },
      { label: 'Value picks (odds 2.60–3.49) added in', included: true },
      { label: 'Full Poisson expected-goals model & probabilities', included: true },
      { label: 'Best all-round win rate + ROI', included: true },
      { label: 'High-odds VIP value engine', included: false },
    ],
  },
  {
    id: 'vip',
    name: 'VIP',
    tagline: 'Maximum return. The value engine.',
    price: 140,
    period: 'month',
    badge: 'Max ROI',
    cta: 'Get VIP',
    stripeEnv: 'STRIPE_PRICE_VIP',
    features: [
      { label: 'Everything in OVERALL', included: true },
      { label: 'The high-odds value engine (odds ≥ 3.50)', included: true },
      { label: 'Our highest ROI — the sharp value plays', included: true },
      { label: 'Curated accumulators & value parlays', included: true },
      { label: 'Early access — picks the moment they drop', included: true },
      { label: 'Private VIP Telegram channel + priority support', included: true },
    ],
  },
];

// Where the "manage subscription" / checkout wiring will hook in (Phase 2).
export const BILLING = {
  currency: '€',
  // Set true in Phase 2 once Stripe + auth are live; until then CTAs explain
  // that checkout is coming and route to the Telegram/contact funnel.
  live: false,
  trialDays: 0,
} as const;
