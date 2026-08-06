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
  { label: 'Verified Tips', href: '/verified-tips' },
  { label: 'Free Bets', href: '/offers' },
  { label: 'Bookmakers', href: '/bookmakers' },
  { label: 'Results', href: '/results' },
  { label: 'News', href: '/news' },
] as const;
