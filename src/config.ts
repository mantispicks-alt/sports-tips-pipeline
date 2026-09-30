// -------------------------------------------------------------------------
// Global site configuration. Brand-identifying values (name, domain, email,
// worker URL) read from PUBLIC_* env vars at build time so the source tree
// stays generic; deploy env sets the real values.
// -------------------------------------------------------------------------
const env = import.meta.env;

export const SITE = {
  name: env.PUBLIC_BRAND_NAME ?? 'SportsTips',
  tagline: env.PUBLIC_BRAND_TAGLINE ?? 'Sharp Predictions. Proven Results.',
  description:
    env.PUBLIC_BRAND_DESCRIPTION ??
    'Independent football predictions produced by a proprietary consensus engine and verified against real results. Every published pick is tracked publicly.',
  domain: env.PUBLIC_BRAND_DOMAIN ?? 'example.com',
  url: env.PUBLIC_BRAND_URL ?? 'https://example.pages.dev',
  locale: env.PUBLIC_BRAND_LOCALE ?? 'en',
  email: env.PUBLIC_BRAND_EMAIL ?? 'info@example.com',
  // Funnel / social
  telegram: env.PUBLIC_BRAND_TELEGRAM ?? 'https://t.me/',
  twitter: env.PUBLIC_BRAND_TWITTER ?? '#',
  instagram: env.PUBLIC_BRAND_INSTAGRAM ?? '#',
  youtube: env.PUBLIC_BRAND_YOUTUBE ?? '#',
  // Compliance
  minAge: 18,
  regulator: 'Licensed operators only',
  // Live-data endpoint: read-only, populated by the Worker's 5-minute cron.
  // Site fetches fresh published picks from here on load — no rebuild needed
  // when the Worker publishes a new pick. Empty response falls back silently
  // to the static tips already on the page.
  workerApiUrl: env.PUBLIC_WORKER_API_URL ?? '',
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
      { label: 'Full analysis and edge probabilities on every pick', included: true },
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
