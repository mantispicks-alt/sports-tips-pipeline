// -------------------------------------------------------------------------
// Generic HTML prediction-site adapter TEMPLATE.
//
// ⚠️ LEGAL / ToS — READ FIRST:
// Only point this at sites whose robots.txt AND terms of service permit
// automated access. Many big prediction sites (blade.bet, oddspedia,
// sportytrader, etc.) actively BLOCK scraping and FORBID it — do NOT scrape
// them. Republishing their tips can breach copyright. Prefer, in order:
//   1. An official API (see apiFootball.ts)
//   2. An RSS/Atom feed (see rss.ts)
//   3. An explicit data partnership / opt-in feed
// Use this HTML path only for sites that clearly allow it.
//
// Disabled by default. Kept as a documented template; a real implementation
// would fetch the page and extract rows with a parser (e.g. linkedom/cheerio),
// then hand each row's text to parseTipText().
// -------------------------------------------------------------------------
import type { RawTip } from '../types';
// import { parseTipText } from '../parse';

const ENABLED = false;
const SITES: { url: string; tipster: string }[] = [];

export async function htmlSource(): Promise<RawTip[]> {
  if (!ENABLED || SITES.length === 0) return [];

  // Real implementation (requires a HTML parser dependency + permission):
  //   for (const site of SITES) {
  //     const html = await (await fetch(site.url)).text();
  //     const rows = extractRows(html);            // site-specific selectors
  //     for (const row of rows) {
  //       const tip = parseTipText(row.text, { tipster: site.tipster, source: `html:${site.tipster}` });
  //       if (tip) out.push(tip);
  //     }
  //   }
  return [];
}
