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
export type TierId = 'free' | 'premium' | 'vip';

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

export const TIERS: Tier[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'See how sharp we are.',
    price: 0,
    period: 'forever',
    cta: 'Start free',
    features: [
      { label: '1 free pick every day', included: true },
      { label: 'Full public track record', included: true },
      { label: 'Best-odds comparison board', included: true },
      { label: 'News, guides & bonus offers', included: true },
      { label: 'All daily picks', included: false },
      { label: 'Full expected-goals model & stats', included: false },
      { label: 'VIP high-confidence picks', included: false },
      { label: 'Accumulators & private VIP channel', included: false },
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    tagline: 'Every pick, every day.',
    price: 29,
    period: 'month',
    badge: 'Most popular',
    highlight: true,
    cta: 'Go Premium',
    stripeEnv: 'STRIPE_PRICE_PREMIUM',
    features: [
      { label: 'Everything in Free', included: true },
      { label: 'All daily picks — football & basketball', included: true },
      { label: 'Full Poisson expected-goals model & probabilities', included: true },
      { label: 'Filters, alerts & daily email', included: true },
      { label: 'Ad-free experience', included: true },
      { label: 'VIP high-confidence picks', included: false },
      { label: 'Accumulators & private VIP channel', included: false },
    ],
  },
  {
    id: 'vip',
    name: 'VIP',
    tagline: 'The sharpest strikes we have.',
    price: 79,
    period: 'month',
    badge: 'Max edge',
    cta: 'Go VIP',
    stripeEnv: 'STRIPE_PRICE_VIP',
    features: [
      { label: 'Everything in Premium', included: true },
      { label: 'VIP-only high-confidence "strike" picks', included: true },
      { label: 'Curated accumulators & value parlays', included: true },
      { label: 'Early access — picks the moment they drop', included: true },
      { label: 'Private VIP Telegram channel', included: true },
      { label: 'Priority support', included: true },
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
