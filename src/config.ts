// -------------------------------------------------------------------------
// Global site configuration. Rename the brand here and it changes everywhere.
// -------------------------------------------------------------------------
export const SITE = {
  name: 'the site',
  tagline: 'Smart Predictions. Bigger Bonuses.',
  description:
    'Free expert betting predictions, in-depth match analysis and the best licensed bookmaker bonuses across Europe. Bet smarter with the site.',
  domain: 'the-site.pages.dev',
  url: 'https://the-site.pages.dev',
  locale: 'en',
  email: 'info@the-site.example',
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
  { label: 'Verified Tips', href: '/verified-tips' },
  { label: 'Free Bets', href: '/offers' },
  { label: 'Bookmakers', href: '/bookmakers' },
  { label: 'Results', href: '/results' },
  { label: 'News', href: '/news' },
] as const;
