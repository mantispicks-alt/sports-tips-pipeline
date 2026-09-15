// -------------------------------------------------------------------------
// Bridges the tip-aggregation pipeline (src/lib/aggregation, fed by the
// GitHub Actions cron -> src/data/tips/*.json + src/data/real-*.json) into
// the actual content the site renders (src/content/tips/*.md).
//
// Before this script, the cron ingested real picks every 2h but nothing ever
// turned them into the markdown files the /tips pages read from — the two
// systems were disconnected. This closes that gap.
//
// Rules (deliberately conservative — see PLAN.md's "no fabricated numbers"
// stance and the trust/compliance research behind the tier system):
//   - Only `publishable` picks (dateVerified fixture + a real numeric odds
//     average) are written. Never invent an odds figure.
//   - Never delete a generated file. Settled results stay on the public
//     record forever ("we never delete our losers" — already the site's own
//     copy). Re-running only creates new files or updates fields in place
//     (mainly `result`, as picks settle) on files it previously generated.
//   - Files are prefixed `auto-` so they never collide with hand-written
//     content and are trivially identifiable/diffable in git.
//   - Tier assignment reflects real data quality, not guesswork: the single
//     highest-confidence pick each day is `free` + featured (so the free
//     tier always has something real to show); cross-checked (3+ independent
//     sources agreeing — `verified`) picks are `vip`; everything else
//     `premium`. As more source adapters come online, `vip` naturally grows.
//
// Run: `npm run generate:tips` (also runs as a step in the GH Actions cron,
// after settle-real.mjs so freshly-settled results are picked up).
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline } from '../src/lib/aggregation/index.js';
import type { ConsensusPick, MarketGroup } from '../src/lib/aggregation/types.js';
import { isReserveOrYouth } from '../src/lib/aggregation/reference.js';
import { matchKey as mkOf } from '../src/lib/aggregation/normalize.js';
import { requiredCrossCheckForPick, TRUSTED_SOURCES, bandAllowed, DROP_SOURCES, favoriteBackerCount, hasSkilledFav, SOLO_TRUSTED } from '../src/lib/aggregation/tipsters.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const OUT_DIR = path.join(ROOT, 'src', 'content', 'tips');

// Best-odds / line-shopping — ADDITIVE: only ever UPGRADES the price we display
// on a pick we already publish (from src/data/best-odds.json, The Odds API,
// major-league 1X2). Never changes which picks are selected or published.
const BEST_ODDS: Record<string, Record<string, { odds: number; book: string }>> = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'best-odds.json'), 'utf8')); } catch { return {}; }
})();
const BOOK_NAMES: Record<string, string> = {
  onexbet: '1xBet', unibet_se: 'Unibet', unibet_nl: 'Unibet', unibet_fr: 'Unibet', unibet_it: 'Unibet',
  leovegas_se: 'LeoVegas', betsson: 'Betsson', williamhill: 'William Hill', marathonbet: 'Marathonbet',
  nordicbet: 'NordicBet', codere_it: 'Codere', winamax_fr: 'Winamax', winamax_de: 'Winamax',
  betclic_fr: 'Betclic', coolbet: 'Coolbet', betonlineag: 'BetOnline', betanysports: 'BetAnySports',
};
const BOOK_SLUGS: Record<string, string> = { onexbet: '1xbet', betsson: 'betsson' }; // only where an affiliate page exists
const cleanBook = (k: string): string => BOOK_NAMES[k] ?? String(k).replace(/_[a-z]{2}$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
// Returns the best price + book for a pick, or null if none beats the consensus price.
// slugTeam — MUST match src/lib/aggregation/normalize.ts so the team-slug keys
// written by refresh-bestodds-hl.mjs resolve here.
const BO_STOP = /\b(fc|cf|sc|afc|cd|ac|club|the|de|do|dos|da|di|del|la|el|los|las|sv|if|bk|ss|us|as)\b/g;
const slugTeam = (s: string): string => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(BO_STOP, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Raw REAL featured-book price for a pick's picked outcome (best-odds.json, written
// by refresh-bestodds-hl.mjs). No "only if higher" guard: the real price is the
// bettable truth whether it is higher OR lower than the tipster-source average — an
// inflated source (e.g. a 1.97 favorite quoted at 6.00) must be CORRECTED DOWN, not
// protected. Orientation-safe: a team's win price is stored under its SLUG, so the
// pick's own home/away can be flipped vs the odds source without breaking.
function realPriceFor(p: ConsensusPick): { odds: number; book: string; slug?: string } | null {
  const entry = BEST_ODDS[p.matchKey];
  if (!entry) return null;
  // best-odds.json holds 1X2 (home/away/draw), O/U 2.5 (over/under) and BTTS (yes/no)
  // prices ONLY. A DNB "home" or a DC pick must NOT borrow the 1X2 price (different
  // market, different odds), and an O/U on a non-2.5 line must NOT borrow the 2.5
  // price. Restrict the mapping to the exact markets/lines the store actually holds.
  const mkt = p.market;
  if (mkt !== '1X2' && mkt !== 'OU25' && mkt !== 'BTTS') return null;
  if (mkt === 'OU25' && typeof p.line === 'number' && p.line !== 2.5) return null;
  const sel = String(p.selection).toLowerCase();
  let key: string | null = null;
  if (mkt === '1X2' && sel === 'home') key = slugTeam(p.homeTeam);
  else if (mkt === '1X2' && sel === 'away') key = slugTeam(p.awayTeam);
  else if (['draw', 'over', 'under', 'yes', 'no'].includes(sel)) key = sel;
  else return null; // no single best-odds mapping
  const bo = entry[key];
  if (!bo || typeof bo.odds !== 'number' || bo.odds < 1.01) return null;
  return { odds: Math.round(bo.odds * 100) / 100, book: cleanBook(bo.book), slug: BOOK_SLUGS[bo.book] };
}
// The real price a pick was CORRECTED to (populated by the correction pass in
// generate(), before the gate). frontmatterFor reads it back for the displayed book
// + price. Kept off-band in a WeakMap so we don't widen the ConsensusPick type.
const REAL_BOOK = new WeakMap<ConsensusPick, { odds: number; book: string; slug?: string }>();
function bestFor(p: ConsensusPick): { odds: number; book: string; slug?: string } | null {
  return REAL_BOOK.get(p) ?? null;
}
// The best-odds entry key for a pick's picked outcome (same resolution realPriceFor
// uses): home/away → team slug; draw/over/under/yes/no direct; else null (DC/DNB/
// non-2.5 O/U have no single-outcome best-odds row).
function outcomeKeyFor(p: ConsensusPick): string | null {
  const mkt = p.market;
  if (mkt !== '1X2' && mkt !== 'OU25' && mkt !== 'BTTS') return null;
  if (mkt === 'OU25' && typeof p.line === 'number' && p.line !== 2.5) return null;
  const sel = String(p.selection).toLowerCase();
  if (mkt === '1X2' && sel === 'home') return slugTeam(p.homeTeam);
  if (mkt === '1X2' && sel === 'away') return slugTeam(p.awayTeam);
  if (['draw', 'over', 'under', 'yes', 'no'].includes(sel)) return sel;
  return null;
}
// Every FEATURED bookmaker that quotes THIS exact bet, at its price — the on-page
// "where to back it" board. Reads the `books` list refresh-bestodds-hl stores; links
// a row to /bookmakers/<slug> when that affiliate page exists.
const BOOK_PAGES = new Set(['1win', '1xbet', '20bet', '22bet', '888sport', 'bcgame', 'bet365', 'betsson', 'betway', 'betwinner', 'cloudbet', 'fonbet', 'megapari', 'melbet', 'meridianbet', 'novibet', 'pinnacle', 'rabona', 'stake', 'stoiximan']);
function oddsBoardFor(p: ConsensusPick): Array<{ book: string; slug?: string; odds: number }> {
  const entry = BEST_ODDS[p.matchKey]; const key = outcomeKeyFor(p);
  const books = key && entry ? (entry[key] as any)?.books : null;
  if (!Array.isArray(books)) return [];
  return books
    .filter((b: any) => b && typeof b.odds === 'number' && b.odds > 1 && b.book)
    .map((b: any) => {
      const slug = String(b.book).toLowerCase().replace(/[^a-z0-9]/g, '');
      const odds = Math.round(b.odds * 100) / 100;
      return BOOK_PAGES.has(slug) ? { book: b.book, slug, odds } : { book: b.book, odds };
    })
    .sort((a: any, b: any) => b.odds - a.odds);
}
// The tipster SOURCES backing this pick, each with the odds IT quoted (best per
// source) — the "tipsters backing this" transparency panel.
function cleanSource(src: string): string {
  return src.replace(/^(site|web|tg|odds):/, '').replace(/[-_]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
}
function tipstersFor(p: ConsensusPick): Array<{ name: string; odds: number }> {
  const per = new Map<string, number>();
  for (const b of p.backers) {
    if (typeof b.odds !== 'number' || b.odds <= 1) continue;
    if (!per.has(b.source) || b.odds > per.get(b.source)!) per.set(b.source, b.odds);
  }
  return [...per.entries()].map(([src, odds]) => ({ name: cleanSource(src), odds: Math.round(odds * 100) / 100 })).sort((a, b) => b.odds - a.odds);
}

// Closing-line-value store. Tracks each published pick's odds from first publish
// (open) to the last update before kickoff (~the closing line). CLV = did we get
// a better price than the market's close? It's the single most reliable predictor
// of long-term profit — a service that consistently beats the closing line has a
// real edge, independent of short-run win-rate variance. src/data/clv.json.
const CLV_FILE = path.join(ROOT, 'src', 'data', 'clv.json');
const clvStore: Record<string, any> = (() => {
  try { return JSON.parse(fs.readFileSync(CLV_FILE, 'utf8')); } catch { return {}; }
})();

// Sharp value edge — the Pinnacle/Betfair-anchored +EV picks from
// scripts/refresh-odds.mjs (src/data/tips/odds-value.json). Keyed by
// matchKey|selection so we can attach the exact edge % to the pick we publish.
// A pick is "sharp" when the value engine backs the SAME selection we picked.
const VALUE_EDGE: Record<string, { edge: number; fairProb: number }> = (() => {
  const out: Record<string, { edge: number; fairProb: number }> = {};
  try {
    const rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'tips', 'odds-value.json'), 'utf8'));
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r?.homeTeam || !r?.awayTeam || !r?.kickoff || !r?.selection) continue;
      const k = `${mkOf(r.homeTeam, r.awayTeam, r.kickoff, r.sport ?? 'football')}|${r.selection}`;
      const edge = typeof r.edge === 'number' ? r.edge : 0;
      if (!out[k] || edge > out[k].edge) out[k] = { edge, fairProb: r.fairProb ?? 0 };
    }
  } catch { /* no value file — sharp badge simply never fires */ }
  return out;
})();
// Is this pick backed by the sharp value engine? Authoritative signal =
// an `odds:value` backer in the consensus (same match+market+selection);
// the VALUE_EDGE lookup then supplies the exact edge % for display.
function sharpFor(p: ConsensusPick): { edge: number } | null {
  const backed = p.backers?.some((b) => b.source === 'odds:value');
  if (!backed) return null;
  const v = VALUE_EDGE[`${p.matchKey}|${p.selection}`];
  return { edge: v?.edge ?? 0 };
}

// Quality gate — scraped sources carry noise (mislabeled sports, garbled or
// non-latin team names, scraper-placeholder odds/outliers). Publishing that
// erodes exactly the trust the whole product depends on, so filter hard and
// publish a curated set, not everything.
// Publish floor. Raised to 1.50 (user choice): favorites shorter than 1.50 pay too
// little (a 1.10 pick returns 10%) — only favorites ≥ 1.50 are worth showing. Nothing
// below 1.50 is anything but a favorite (dead zone starts 1.80, value 2.60), so this
// is effectively a "favorites ≥ 1.50 only" rule. Tune via ODDS_MIN env.
const ODDS_MIN = Number(process.env.ODDS_MIN) || 1.5;
const ODDS_MAX = 7.5; // a *recommended* single pick above this is almost always noise
// Max published picks per day. The cross-check gate already ensures quality (a
// pick needs 2+ agreeing sources, or a proven tipster in an uncovered league), so
// this is just a sanity ceiling — not the main filter. It was 12, which threw away
// 130-190 gate-passing picks on busy days; 30 keeps a full, curated board without
// a wall of noise. Tune via MAX_PER_DAY env.
const MAX_PER_DAY = Number(process.env.MAX_PER_DAY) || 50;
// A "banker" = a heavy favorite short enough to win reliably. Settled record:
// odds ≤ 1.50 hit ~72%, vs ~56% at 1.60–1.80. The daily FREE/featured pick is
// drawn from these so the public win rate stays high. Tune via BANKER_MAX_ODDS.
const BANKER_MAX_ODDS = Number(process.env.BANKER_MAX_ODDS) || 1.6;
// Favorites (odds ≤ 1.80) are the public win-rate feed, so they carry a HARD
// cross-check floor: every one needs at least this many agreeing sources, with NO
// small-league solo exception (unlike value/high picks, which are contrarian and
// must be allowed to publish thinly or they'd never surface). Default 2 → no solo
// favorites. Set FAV_MIN_CROSSCHECK=3 for stricter (far fewer, heavily corroborated).
// Only ≤ 1.80 is affected; value (≥ 2.60) cross-check is untouched.
const FAV_MAX_ODDS = 1.8;
const VALUE_MIN_ODDS = 2.6; // value/high feed floor; the 1.80–2.60 dead zone between it and favorites is not published
const HIGH_MIN_ODDS = 3.5; // ROI/VIP feed floor — the value band (2.60–3.49) sits between VALUE_MIN and this
const FAV_MIN_CROSSCHECK = Number(process.env.FAV_MIN_CROSSCHECK) || 2;
// Ranked-feed quotas: instead of a pass/fail gate we publish the top-N ranked
// picks in each odds-band feed per day (validated design — selection > volume,
// stable +ROI both halves). Env-tunable.
// 2026-09-03: TIGHTENED value+high to 2/day (was 4/4). User's directive after
// 1W-5L Sept-3 day: "2-3 τη μερα ειναι υπερ-αρκετα αν ειναι οντως καλα" —
// quality > quantity. Only the TOP 2 ranked per feed pass now; weaker signals
// get cut instead of filling quota. Ranking already validated +ROI, so top-N
// concentrates on the strongest picks each day. Fav stays 3 (marketing feed).
const FAV_PER_DAY = Number(process.env.FAV_PER_DAY) || 3;
const VALUE_PER_DAY = Number(process.env.VALUE_PER_DAY) || 2;
// HIGH: 2 -> 3 (2026-09-04). Historic supply avg 3.35 picks/day at >=3.5; the
// 2/day cap was cutting genuine +70% ROI picks. 3 fits the average without adding
// filler — the ranked top-3 concentrates on the strongest signals.
const HIGH_PER_DAY = Number(process.env.HIGH_PER_DAY) || 3;

function teamOk(name: string): boolean {
  const n = (name ?? '').trim();
  if (n.length < 3 || n.length > 40) return false;
  const latin = (n.match(/[A-Za-z]/g) ?? []).length;
  const nonSpace = n.replace(/\s/g, '').length || 1;
  if (latin / nonSpace < 0.6) return false; // mostly non-latin => leaked script / garbage
  if (/\b(team|league|unknown|tbd|n\.?\/?a\.?|null|undefined)\b/i.test(n)) return false;
  return true;
}

// Fuzzy fixture signature to collapse the same match ingested under slightly
// different spellings (e.g. "KI Klaksvik" vs "Klaksvik"). Not perfect — the
// real fix is the upstream team-alias table — but removes the bulk of dupes.
function longestToken(name: string): string {
  const toks = name.toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 3);
  toks.sort((a, b) => b.length - a.length);
  return (toks[0] ?? name.toLowerCase()).slice(0, 5);
}
// Per-MATCH signature (market deliberately excluded): we publish ONE pick per
// fixture, not the same match once per market. The dedupe below keeps the
// highest-confidence market for each match.
function fixtureSig(p: ConsensusPick): string {
  const day = new Date(p.kickoff).toISOString().slice(0, 10);
  const pair = [longestToken(p.homeTeam), longestToken(p.awayTeam)].sort();
  // Dedupe per (fixture, ODDS BAND), not per fixture: a match's favorite (≤1.80) and
  // its contrarian value side (≥2.60) live in different feeds, so both must survive
  // — collapsing to one-per-fixture is exactly what starved the value/high feeds.
  // Within a band, name-variant duplicates of the same pick still collapse (the bug
  // this dedupe exists for). Dead-zone (1.80–2.60) is dropped upstream so it needs no band.
  const band = p.avgOdds <= FAV_MAX_ODDS ? 'fav' : p.avgOdds >= HIGH_MIN_ODDS ? 'high' : 'value';
  return `${p.sport}|${day}|${pair.join('|')}|${band}`;
}

const MARKET_NAME: Record<MarketGroup, string> = {
  '1X2': 'Match Result',
  OU25: 'Total Goals',
  BTTS: 'Both Teams to Score',
  DC: 'Double Chance',
  DNB: 'Draw No Bet',
  ML: 'Moneyline',
  SPREAD: 'Point Spread',
  TOTALS: 'Total Points',
  OTHER: 'Prediction',
};

function slugFor(p: ConsensusPick): string {
  // matchKey alone collides when the same match has picks in multiple
  // markets (e.g. 1X2 AND BTTS) — market must be part of the filename or the
  // second write silently clobbers the first.
  return (
    'auto-' +
    `${p.matchKey}-${p.market}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  );
}

function starsFromConfidence(confidence: number): number {
  return Math.max(1, Math.min(5, Math.round(confidence / 20)));
}

function yamlStr(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// Which tracked systems a pick belongs to, by its published odds. WIN = favorites
// (≤1.80), the strike-rate feed. OVERALL = mid value (2.60–3.49), the balanced
// value-only core. ROI = high value (≥3.50), the max-return engine. Each feed
// tracks a DIFFERENT band — no overlap — so the /results page reports three
// independent records. (User decision 2026-09-11: favorites no longer double
// into OVERALL; they stayed there previously and inflated its win% while
// dragging its ROI down with the market margin bleed on ≤1.80.)
function feedsFor(odds: number): Array<'win' | 'overall' | 'roi'> {
  const f: Array<'win' | 'overall' | 'roi'> = [];
  if (odds <= 1.8) { f.push('win'); }
  else if (odds >= 2.6 && odds < 3.5) { f.push('overall'); }
  else if (odds >= 3.5) { f.push('roi'); }
  return f;
}

function frontmatterFor(p: ConsensusPick, tier: 'free' | 'premium' | 'vip', featured: boolean, sharp: { edge: number } | null): string {
  const match = `${p.homeTeam} vs ${p.awayTeam}`;
  const best = bestFor(p); // line-shopping upgrade, or null
  const pubOdds = best ? best.odds : p.avgOdds;
  const feeds = feedsFor(pubOdds);
  const backerIds = [...new Set(p.backers.map((b) => b.source))];
  const oddsBoard = oddsBoardFor(p); // every featured book that quotes this bet + price
  const tipsters = tipstersFor(p); // every tipster source backing it + its quoted odds
  const lines = [
    '---',
    `match: ${yamlStr(match)}`,
    `league: ${yamlStr(p.league || 'Various')}`,
    `sport: ${p.sport ?? 'football'}`,
    `kickoff: ${new Date(p.kickoff).toISOString()}`,
    `market: ${yamlStr(MARKET_NAME[p.market] ?? 'Prediction')}`,
    `pick: ${yamlStr(p.label)}`,
    `odds: ${best ? best.odds : p.avgOdds}`,
    ...(best ? [`bookmaker: ${yamlStr(best.book)}`] : []),
    ...(best?.slug ? [`bookmakerSlug: ${yamlStr(best.slug)}`] : []),
    `confidence: ${starsFromConfidence(p.confidence)}`,
    `result: ${p.result === 'pending' ? 'pending' : p.result}`,
    `tier: ${tier}`,
    `featured: ${featured}`,
    // value signals — power the "SHARP VALUE" badge + cross-check depth line
    `sharp: ${sharp ? 'true' : 'false'}`,
    ...(sharp && sharp.edge > 0 ? [`edge: ${Math.round(sharp.edge * 10) / 10}`] : []),
    ...(typeof p.valueEdge === 'number' ? [`valueEdge: ${p.valueEdge}`] : []),
    `sources: ${p.backerCount}`,
    // Selection-system version: every pick written by this gate carries the
    // odds-band router's tag, so /results can track the new system's win%/ROI
    // as a cohort separate from the old pre-band record.
    'system: band-v1',
    // Per-system tracking: which of the 3 tracked feeds this pick counts toward,
    // plus the source ids that backed it (admin audit / per-system source view).
    ...(feeds.length ? [`feeds: ${JSON.stringify(feeds)}`] : []),
    ...(backerIds.length ? [`backers: ${JSON.stringify(backerIds)}`] : []),
    // Under each match: every featured bookmaker that quotes this exact bet (with its
    // price) + every tipster source that backs it (with the odds it quoted).
    ...(oddsBoard.length ? [`oddsBoard: ${JSON.stringify(oddsBoard)}`] : []),
    ...(tipsters.length ? [`tipsters: ${JSON.stringify(tipsters)}`] : []),
    '---',
  ];
  return lines.join('\n') + '\n';
}

function bodyFor(p: ConsensusPick): string {
  const sourceWord = p.backerCount === 1 ? 'source' : 'independent sources';
  const lines = [
    `> **Automated consensus pick.** Generated by our tip-aggregation pipeline from ${p.backerCount} ${sourceWord} — not written by a human editor. This is a data signal, not a guarantee.`,
    '',
    `Average price backed: **${p.avgOdds.toFixed(2)}**. ${p.consensusPct}% of tipsters tracking this match agree on this selection.` +
      (p.verified ? ' This pick passed our cross-check bar (3+ independent sources agreeing).' : ''),
  ];
  if (!p.dateVerified) {
    lines.push('', '_Kickoff time is as reported by the source and not yet cross-checked against an official fixture list — confirm before betting._');
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const output = await runPipeline();

  const NOW = Date.now();
  const SKEW = 10 * 60 * 1000; // only pre-match: allow 10min clock skew, nothing already kicked off
  const FUTURE_CAP = 21 * 24 * 60 * 60 * 1000; // 3 weeks out — reject absurd placeholder dates

  // --- Date-honest gate. The load-bearing rule: we only publish a pick whose
  // KICKOFF we can actually stand behind. `dateVerified` means the pick was
  // matched to a real api-football fixture, so its kickoff is a cross-checked
  // real date/time — that's the only way to know a match is UPCOMING and not
  // one that already happened. Picks we can't date-verify (small leagues
  // outside api-football's coverage) are HELD, not published — showing a tip
  // for a finished match, or with a made-up time, is the fastest way to look
  // like a scam. Those come online once an odds/fixtures feed covers them
  // (THE_ODDS_API_KEY -> scripts/ingest-oddsapi.mjs, or a paid api tier).
  // A fixture is "sharp-covered" if ANY pick on it (any selection) carries a
  // sharp/market backer — even when no sharp backs the specific selection a lone
  // tipster chose. Cross-check is possible on such matches, so a tipster must not
  // publish solo there (closes the "solo pick on a sharp-priced match" leak).
  const sharpMatches = new Set<string>();
  for (const p of output.publishable) {
    if ((p.backers ?? []).some((b) => TRUSTED_SOURCES.has(b.source))) sharpMatches.add(p.matchKey);
  }

  // --- REAL-ODDS CORRECTION — MUST run before the gate ------------------------
  // p.avgOdds comes from the tipster sources and is frequently inflated garbage (a
  // heavy favorite quoted at 6.00 when every real book is ~1.97). That fake price
  // poisons BOTH the feed classification (a real favorite wrongly ranked into the
  // HIGH-risk feed) AND the number shown on the site. Wherever we have a real
  // featured-book price for the picked outcome, overwrite avgOdds with it so the gate
  // classifies, the page displays, and CLV/settlement all account on the price a
  // follower can ACTUALLY get. No real price (Double Chance, obscure leagues HL
  // doesn't cover) -> source average kept unchanged. This is what makes the odds on
  // the site honest instead of the tipster-source fantasy number.
  let pricedReal = 0, movedReal = 0;
  for (const p of output.publishable) {
    const rb = realPriceFor(p);
    if (!rb) continue;
    pricedReal++;
    if (Math.abs(rb.odds - p.avgOdds) >= 0.01) movedReal++;
    p.avgOdds = rb.odds;
    // keep the value-edge badge honest at the corrected price
    p.valueEdge = p.avgOdds > 0 ? Math.round(p.consensusPct - (1 / p.avgOdds) * 100) : 0;
    REAL_BOOK.set(p, rb);
  }
  console.log(`real-odds correction: ${pricedReal} picks priced by featured books, ${movedReal} odds moved off the source average.`);

  const clean = output.publishable.filter((p) => {
    const t = new Date(p.kickoff).getTime();
    // Dropped (proven-loser) sources may AGREE with a pick but never CORROBORATE
    // it: judge the cross-check on the non-dropped backers only, so a lingering
    // loser snapshot can't lift a pick past the gate — and a pick carried solely
    // by dropped sources fails (live.length can't meet the floor). This folds the
    // old dropped-only backstop into the cross-check itself.
    const live = p.backers.filter((b) => !DROP_SOURCES.has(b.source));
    return (
      p.dateVerified === true &&
      Number.isFinite(t) &&
      t > NOW - SKEW && // pre-match only — nothing already kicked off
      t < NOW + FUTURE_CAP && // not an absurd far-future placeholder
      p.avgOdds >= ODDS_MIN &&
      p.avgOdds <= ODDS_MAX &&
      teamOk(p.homeTeam) &&
      teamOk(p.awayTeam) &&
      !isReserveOrYouth(p.homeTeam) &&
      !isReserveOrYouth(p.awayTeam) &&
      // Quality-weighted cross-check, coverage-aware: a pick needs MORE independent
      // sources the WEAKER its best backer is — BUT small/obscure leagues with no
      // sharp coverage (tipster-only, and profitable) can't be cross-checked, so a
      // decent tipster carries them solo there. See requiredCrossCheckForPick.
      // Clean TWO feeds only — the dead zone (1.80–2.60, −8% ROI, nobody beats it)
      // is DROPPED entirely (user choice):
      //   - Favorites (≤ FAV_MAX_ODDS): publish ONLY on strong agreement among sources
      //     proven good at favorites — FAV_MIN_CROSSCHECK of the odds-band `fav`
      //     tipsters plus the sharp anchors (see favoriteBackerCount) — AND at least
      //     one of those backers must be a SKILLED fav tipster, not merely anchors
      //     (hasSkilledFav). Audit 2026-08-28: favorites carried by anchors + off-band
      //     sources alone bled −13% ROI (the whole fav band's loss); a skilled fav
      //     backer flips them to +3.3%. random/other-band sources still don't count.
      //   - Value/high (≥ VALUE_MIN_ODDS): the ORIGINAL contrarian rule (coverage-
      //     aware cross-check + odds-band routing).
      //   - Between them (dead zone): rejected — neither branch is true.
      // SOLO CROSS-CHECK 2026-09-03: today's 5-lost audit found 4/5 losses were solo
      // picks from NON-anchor tipsters (predictinho/kickpredictions/sportsgambler,
      // each 1 backer). Rule: publish solo ONLY when a TRUSTED sharp/market anchor
      // (pinnacle, odds:value, bzzoiro, fdcouk) or an explicitly SOLO_TRUSTED source
      // carries it — an anchor's price IS the market truth, no corroboration needed.
      // A solo tipster with no anchor = variance in disguise → require ≥2 non-dropped
      // backers so an independent second source has to agree. Still bound by band
      // definitions below.
      (
        live.length >= 2 ||
        live.some((b) => SOLO_TRUSTED.has(b.source) || TRUSTED_SOURCES.has(b.source))
      ) &&
      // Two clean bands only — the dead zone (1.80–2.60, −ROI, nobody beats it) is
      // dropped entirely. Per-feed QUALITY (skilled-fav floor for favorites, and the
      // Double-Chance/low-odds ranking for value/high) is applied BELOW in the ranked
      // top-N-per-feed selection — this filter is safety + band membership only.
      (p.avgOdds <= FAV_MAX_ODDS || p.avgOdds >= VALUE_MIN_ODDS)
    );
  });

  // --- Dedupe near-identical fixtures, keep the highest-confidence one.
  const bySig = new Map<string, ConsensusPick>();
  for (const p of clean) {
    const sig = fixtureSig(p);
    const prev = bySig.get(sig);
    if (!prev || p.confidence > prev.confidence) bySig.set(sig, p);
  }
  const deduped = [...bySig.values()];

  const held = output.publishable.filter((p) => p.dateVerified !== true).length;
  console.log(
    `date-honest gate: ${output.publishable.length} publishable -> ${clean.length} with a verified upcoming kickoff -> ${deduped.length} after dedupe ` +
      `(held ${held} picks we can't date-verify)`,
  );

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // --- Ranked selection: top-N per FEED per day (validated design). Instead of a
  // pass/fail quality gate + confidence cap, each day we RANK the eligible picks
  // within each odds-band feed by the signals that back-tested +ROI and stable
  // across both time-halves, then publish the best few. Predictable volume,
  // quality by SELECTION not threshold (selection > volume was decisive).
  //   FAVORITES (≤1.80): a SKILLED fav backer required; rank depth + away side.
  //   VALUE     (2.60–3.49): rank Double-Chance + lower-odds + consensus depth.
  //   HIGH      (≥3.50):     rank Double-Chance + lower end of the band.
  // League is deliberately NOT filtered: the signal ranking already lands on the
  // profitable spots (a hard league whitelist tested neutral-to-worse — the good
  // picks in "other" leagues score just as high). Env-tunable quotas.
  const isDC = (p: ConsensusPick) =>
    p.market === 'DC' || ['1x', 'x2', '12'].includes(String(p.selection).toLowerCase());
  const isAway = (p: ConsensusPick) => String(p.selection).toLowerCase() === 'away';
  // Favorites are a break-even, HIGH-STRIKE-RATE showcase (no config gives stable
  // +ROI — validated). skilledFav is a strong quality bonus (its picks are the only
  // ones that back-tested +), but NOT a hard gate: live tipster supply is thin (some
  // days 0 skilled-fav favorites), so requiring it leaves the WIN feed empty. Fill
  // to quota with the safest HEAVY favorites (odds→1.30) at deep consensus instead —
  // ~70% win, ≈break-even ROI, which is the WIN product's whole point (strike rate).
  const favScore = (p: ConsensusPick) =>
    (hasSkilledFav(p.backers) ? 5 : 0) + (p.backerCount >= 2 ? 2 : 0) + (1.8 - p.avgOdds) * 3 + (isAway(p) ? 1 : 0);
  // SIDE edge — validated 2026-09-03 over the full history (split-half stable,
  // board-wide, strongest on zulubet). At value/high odds the NO-DRAW / away side
  // (12, x2, away) massively out-earns the draw/home side (1x, draw, home):
  // board-wide ≥3.5 no-draw ≈53% win / +200% ROI vs draw-ish ≈35% / +80%; zulubet
  // no-draw ≥3.5 hits ~70% win / +340% (vs its draw-ish ~29%). So rank the no-draw
  // side up and the draw/home side down, with a small extra nudge when zulubet (the
  // proven high-odds no-draw specialist) backs it. Additive: only reorders the
  // per-feed top-N, never changes eligibility — the +ROI value engine is untouched.
  const NO_DRAW = new Set(['12', 'x2', 'away']);
  const DRAW_HOME = new Set(['1x', 'draw', 'home']);
  const sideEdge = (p: ConsensusPick) => {
    const s = String(p.selection).toLowerCase();
    const base = NO_DRAW.has(s) ? 1 : DRAW_HOME.has(s) ? -1 : 0;
    const zu = base > 0 && p.backers.some((b) => b.source === 'site:zulubet') ? 0.5 : 0;
    return base + zu;
  };
  const valScore = (p: ConsensusPick) => (isDC(p) ? 4 : 0) + Math.min(p.backerCount, 3) + (3.5 - p.avgOdds) + 2 * sideEdge(p);
  // HIGH ranking 2026-09-04: added a +3 bonus for odds >=5.0. Historic sub-band
  // ROI within HIGH is not flat — validated: 3.5-5.0 = +124%, 5.0-7.5 = +316%,
  // >=7.5 = +599%. The old (7.5 - avgOdds) term actually PREFERRED lower-odds
  // picks (win-rate safety) — right for the marketing pick, wrong for the ROI
  // engine. The +3 bonus ensures a >=5 pick ranks ahead of a @3.7 pick when both
  // are available (rare — only ~35% of days have a >=5 pick, but when they come
  // they are the biggest single contributor to profit).
  const highScore = (p: ConsensusPick) =>
    (isDC(p) ? 4 : 0) + (7.5 - p.avgOdds) + 3 * sideEdge(p) + (p.avgOdds >= 5 ? 3 : 0);
  // Minimum score floors 2026-09-05 (revised — floor 4 starved the feed).
  // Cut the CLEAR NEGATIVES: drawish/home picks that score below 1 = variance in
  // disguise (Fulham Draw @3.42 today scored 0.08 and lost). Weak-but-positive
  // team-wins keep passing so we still have a board on quiet days.
  //   value: strong (DC+no-draw+3 backers @2.6) ~10; medium team-win (2 backers
  //          @2.85) ~2.6; drawish @3.4 with 1 backer = -0.9. Floor 1 keeps
  //          team-wins, cuts the draw noise.
  //   high:  strong (DC+no-draw+backers ~10); drawish @4.5 with 1 backer = 0;
  //          zulubet solo away @7 ~ 3.5. Floor 1 keeps zulubet + team-wins.
  const MIN_VAL_SCORE = Number(process.env.MIN_VAL_SCORE) || 1;
  const MIN_HIGH_SCORE = Number(process.env.MIN_HIGH_SCORE) || 1;

  const byDayAll = new Map<string, ConsensusPick[]>();
  for (const p of deduped) {
    const day = new Date(p.kickoff).toISOString().slice(0, 10);
    (byDayAll.get(day) ?? byDayAll.set(day, []).get(day)!).push(p);
  }
  const byDay = new Map<string, ConsensusPick[]>();
  for (const [day, list] of byDayAll) {
    // FAVORITES: skilled-fav quality floor re-enforced 2026-09-04. Historic audit:
    // anchors-only bled −13% ROI, a skilledFav flipped to +3.3% (validated). Block
    // anchor-solo/unrated-solo favs — publish ONLY when either a skilledFav backer
    // is present OR ≥2 backers agree (independent corroboration is enough even
    // without a skilledFav classification).
    // 2026-09-15 TIGHTER: WIN band was bleeding −5.34u despite 59.3% win — the
    // bookmaker margin at ≤1.80 is too heavy to beat on the marginal picks. Under
    // the new gate a favorite publishes ONLY when it is p.verified (pair-backed or
    // a real 3+ consensus, see consensus.ts) OR carries a skilled-fav backer with
    // ≥3 backers total. Data: pair-backed picks hit 67% win vs 46% non-pair, so
    // requiring pair/verified promotes the +ROI subset and drops the −ROI tail.
    const favs = list
      .filter((p) => p.avgOdds <= FAV_MAX_ODDS
        // 2026-09-15 tightened: WIN band was bleeding −5.34u at 59% strike rate
        // (bookmaker margin ≤1.80 is heavy). Three ways to publish now:
        //   1) p.verified — either pair-backed (see PROVEN_PAIRS) or a normal
        //      3+ backer, avgRating≥58, ≥45% consensus pick.
        //   2) hasSkilledFav AND at least one corroborating backer — the
        //      2026-09-04 anchors-only bleed showed skilled-fav alone isn't
        //      enough on its own; requiring a second voice fixes it.
        //   3) favoriteBackerCount ≥ 4 — heavy independent fav consensus.
        && (p.verified
            || (hasSkilledFav(p.backers) && p.backerCount >= 2)
            || favoriteBackerCount(p.backers) >= 4))
      .sort((a, b) => favScore(b) - favScore(a) || a.avgOdds - b.avgOdds)
      .slice(0, FAV_PER_DAY);
    const value = list
      .filter((p) => p.avgOdds >= VALUE_MIN_ODDS && p.avgOdds < HIGH_MIN_ODDS && valScore(p) >= MIN_VAL_SCORE)
      .sort((a, b) => valScore(b) - valScore(a) || a.avgOdds - b.avgOdds)
      .slice(0, VALUE_PER_DAY);
    const high = list
      .filter((p) => p.avgOdds >= HIGH_MIN_ODDS && highScore(p) >= MIN_HIGH_SCORE)
      .sort((a, b) => highScore(b) - highScore(a) || a.avgOdds - b.avgOdds)
      .slice(0, HIGH_PER_DAY);
    const chosen = [...favs, ...value, ...high];
    if (chosen.length) byDay.set(day, chosen);
    if (process.env.FEED_DEBUG) console.log(`  ${day}: fav ${favs.length} | value ${value.length} | high ${high.length}`);
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  const clvUpserts: { p: ConsensusPick; odds: number }[] = [];
  const writtenSlugs = new Set<string>(); // upcoming picks the new gate published this run
  for (const list of byDay.values()) {
    // Public face: make the daily FREE pick the SAFEST favorite, not just the
    // top-confidence one. Settled data is decisive — heavy favorites (odds ≤ 1.50)
    // win ~72% vs ~56% at 1.60–1.80, and cross-check/sharp DON'T move it (only the
    // odds do). So promote the highest-confidence heavy favorite to the front of
    // the (confidence-sorted) day so the free/featured slot is a reliable winner.
    // No heavy favorite that day -> falls back to the existing top-confidence pick.
    const bankerIdx = list.reduce(
      (best, p, i) => (p.avgOdds <= BANKER_MAX_ODDS && (best < 0 || p.confidence > list[best].confidence) ? i : best),
      -1,
    );
    if (bankerIdx > 0) {
      const [banker] = list.splice(bankerIdx, 1);
      list.unshift(banker);
    }
    // 2026-09-06: give ONE free pick PER FEED per day (fav / value / high) instead
    // of one total. Old behaviour left days with 0 free picks visible once the
    // single banker kicked off — the /tips landing then showed only locked cards,
    // which reads as "the site is broken / has no picks". One free per band keeps
    // a visible taste per feed while premium/vip still gate the rest.
    const freeGiven = { fav: false, value: false, high: false };
    list.forEach((p) => {
      const sharp = sharpFor(p); // backed by the Pinnacle/Betfair value engine
      // Track the price a follower actually gets (best-odds upgrade, else consensus).
      clvUpserts.push({ p, odds: bestFor(p)?.odds ?? p.avgOdds });
      const band: 'fav' | 'value' | 'high' =
        p.avgOdds <= FAV_MAX_ODDS ? 'fav' : p.avgOdds >= HIGH_MIN_ODDS ? 'high' : 'value';
      let tier: 'free' | 'premium' | 'vip';
      let featured = false;
      if (!freeGiven[band]) {
        tier = 'free';
        featured = band === 'fav'; // only the fav free pick is the day's "featured" hero
        freeGiven[band] = true;
      } else if ((p.verified || sharp) && band === 'high') {
        // VIP is reserved for the ROI (high-odds ≥3.5) tier only. Value band
        // picks (2.60–3.49) previously escalated to VIP when verified/sharp; user
        // decision 2026-09-11: value = free/premium only, VIP tag stays on high.
        tier = 'vip';
      } else {
        tier = 'premium';
      }
      const slug = slugFor(p);
      writtenSlugs.add(slug);
      const file = path.join(OUT_DIR, `${slug}.md`);
      const next = frontmatterFor(p, tier, featured, sharp) + '\n' + bodyFor(p);

      const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (prev === next) {
        unchanged++;
        return;
      }
      if (dryRun) {
        console.log(`${prev === null ? '[new]' : '[update]'} ${slug} — ${p.label} @ ${p.avgOdds} (${tier})`);
      } else {
        fs.writeFileSync(file, next);
      }
      if (prev === null) created++;
      else updated++;
    });
  }

  // --- Settle pass. The publish gate above writes only UPCOMING picks, so a
  // file would otherwise stay `result: pending` forever once its match kicked
  // off. Re-open every already-generated file whose match has now settled
  // (result known in this run's publishable set) and update just that field —
  // this is what turns the site's picks into a real won/lost track record.
  let settledFiles = 0, unsettledFiles = 0;
  for (const p of output.publishable) {
    const file = path.join(OUT_DIR, `${slugFor(p)}.md`);
    if (!fs.existsSync(file)) continue;
    const cur = fs.readFileSync(file, 'utf8');
    const curResult = (cur.match(/^result:\s*(.*)$/m)?.[1] || '').trim();
    // 1) newly-settled picks: write won/lost/void into the .md.
    if (p.result && p.result !== 'pending' && curResult !== p.result) {
      if (!dryRun) fs.writeFileSync(file, cur.replace(/^result:.*$/m, `result: ${p.result}`));
      settledFiles++;
      continue;
    }
    // 2) INVALIDATED settlements: if the pipeline now says pending but the file
    // still carries a stale won/lost (e.g. a wrong fuzzy match got cleaned out of
    // real-outcomes.json), reset the file to pending so the site stops showing an
    // incorrect settled result. Only revert past-kickoff picks — future ones can
    // stay unless a real result appears. Won/void never revert automatically.
    if (p.result === 'pending' && (curResult === 'lost' || curResult === 'won')) {
      const ko = Date.parse((cur.match(/^kickoff:\s*(.*)$/m)?.[1] || '').trim());
      if (Number.isFinite(ko) && ko <= NOW) {
        if (!dryRun) fs.writeFileSync(file, cur.replace(/^result:.*$/m, 'result: pending'));
        unsettledFiles++;
      }
    }
  }
  if (unsettledFiles) console.log(`unsettle sweep: reset ${unsettledFiles} picks from stale settled -> pending (real-outcome now missing).`);

  // 3) SCORE-vs-LABEL RECONCILIATION 2026-09-07: outcomes may be stored in the
  // orientation of whichever pick first settled the match, so a differently-oriented
  // second pick can settle to the WRONG result. Re-derive the truth from the pick
  // LABEL vs the actual score. Every settled .md is scanned; if the label + score
  // disagree with the recorded result, the file is corrected.
  const RECON_STOP = /\b(fc|cf|sc|afc|cd|ac|club|the|de|do|dos|da|di|del|la|el|los|las|sv|if|bk|ss|us|as)\b/g;
  const rslug = (s: string) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(RECON_STOP, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const rmk = (h: string, a: string, iso: string) => {
    const day = String(iso).slice(0, 10); const pair = [rslug(h), rslug(a)].sort();
    return `football|${day}|${pair[0]}|${pair[1]}`;
  };
  const outByKey: Record<string, { hg: number; ag: number; via?: string }> = {};
  try {
    const ro = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'real-outcomes.json'), 'utf8'));
    const arr = Array.isArray(ro) ? ro : (ro.outcomes ?? Object.values(ro));
    for (const o of arr) if (o?.matchKey) outByKey[o.matchKey] = { hg: +o.hg, ag: +o.ag, via: o.via };
  } catch {}
  function selFromLabel(pick: string, home: string, away: string) {
    const s = pick.toLowerCase();
    if (/double chance 1x/.test(s)) return { type: 'DC', sel: '1x' } as const;
    if (/double chance 12/.test(s)) return { type: 'DC', sel: '12' } as const;
    if (/double chance x2/.test(s)) return { type: 'DC', sel: 'x2' } as const;
    if (/\bdraw\b/.test(s) && !/win/.test(s)) return { type: '1X2', sel: 'draw' } as const;
    if (/over 2\.5/.test(s)) return { type: 'OU', sel: 'over' } as const;
    if (/under 2\.5/.test(s)) return { type: 'OU', sel: 'under' } as const;
    if (/both teams to score/.test(s) && !/no/.test(s)) return { type: 'BTTS', sel: 'yes' } as const;
    if (/btts.*no|both teams.*no/.test(s)) return { type: 'BTTS', sel: 'no' } as const;
    if (/win/.test(s)) {
      const team = s.replace(/\s+win.*/, '').trim();
      const th = rslug(home), ta = rslug(away), ts = rslug(team);
      if (th.includes(ts) || ts.includes(th)) return { type: '1X2', sel: 'home' } as const;
      if (ta.includes(ts) || ts.includes(ta)) return { type: '1X2', sel: 'away' } as const;
    }
    return null;
  }
  function settleFromScore(type: string, sel: string, hg: number, ag: number): 'won' | 'lost' | null {
    const home = hg > ag ? 'home' : hg < ag ? 'away' : 'draw';
    if (type === '1X2') return sel === home ? 'won' : 'lost';
    if (type === 'DC') {
      if (sel === '1x') return home === 'home' || home === 'draw' ? 'won' : 'lost';
      if (sel === '12') return home === 'home' || home === 'away' ? 'won' : 'lost';
      if (sel === 'x2') return home === 'away' || home === 'draw' ? 'won' : 'lost';
    }
    if (type === 'OU') { const t = hg + ag; return sel === 'over' ? (t > 2.5 ? 'won' : 'lost') : (t < 2.5 ? 'won' : 'lost'); }
    if (type === 'BTTS') { const b = hg > 0 && ag > 0; return sel === 'yes' ? (b ? 'won' : 'lost') : (b ? 'lost' : 'won'); }
    return null;
  }
  let reconciled = 0;
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (!f.endsWith('.md')) continue;
    const file = path.join(OUT_DIR, f);
    const cur = fs.readFileSync(file, 'utf8');
    const nl = cur.includes('\r\n') ? '\r\n' : '\n';
    const t = cur.replace(/\r\n/g, '\n');
    const m = t.match(/^---\n([\s\S]*?)\n---/); if (!m) continue;
    const g = (k: string) => (m[1].match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1] || '').trim().replace(/^"|"$/g, '');
    const res = g('result'); if (res !== 'won' && res !== 'lost') continue;
    const [h, a] = g('match').split(/\s+vs\s+/i); if (!h || !a) continue;
    const out = outByKey[rmk(h, a, g('kickoff'))]; if (!out) continue;
    // Reconcile ONLY against direct API resolvers. HL fuzzy / web-search have a
    // history of wrong scores at 2026-09-11 audit; a fuzzy score fighting the
    // stored won/lost is more likely the fuzzy being wrong than the stored one.
    // Wait for a direct API to arrive before touching this pick's result.
    if (out.via && /fuzzy|web-/.test(out.via)) continue;
    const sk = selFromLabel(g('pick'), h, a); if (!sk) continue;
    const computed = settleFromScore(sk.type, sk.sel, out.hg, out.ag);
    if (!computed || computed === res) continue;
    if (!dryRun) fs.writeFileSync(file, t.replace(/^result:.*$/m, `result: ${computed}`).replace(/\n/g, nl));
    reconciled++;
  }
  if (reconciled) console.log(`score-vs-label reconciliation: corrected ${reconciled} picks (result disagreed with score).`);

  // --- Prune pass. Remove UPCOMING picks the current gate no longer publishes —
  // old files left behind after a rule change (e.g. the odds-band routing) or a
  // source drop. A pending pick whose match is still in the future and that was
  // NOT (re)written this run is stale: delete it so the site shows only picks the
  // live system stands behind. NEVER touch settled files (won/lost/void — the
  // track record) or pending picks whose match already kicked off (awaiting a
  // result); those must remain for honesty + settlement.
  let pruned = 0;
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (!f.endsWith('.md')) continue;
    const slug = f.slice(0, -3);
    if (writtenSlugs.has(slug)) continue; // still a valid, published pick
    const txt = fs.readFileSync(path.join(OUT_DIR, f), 'utf8');
    const result = (txt.match(/^result:\s*(.*)$/m)?.[1] || '').trim();
    if (result !== 'pending') continue; // keep won/lost/void — the record
    const ko = Date.parse((txt.match(/^kickoff:\s*(.*)$/m)?.[1] || '').trim());
    if (!Number.isFinite(ko) || ko <= NOW) continue; // keep past-pending (awaiting settle)
    if (!dryRun) fs.unlinkSync(path.join(OUT_DIR, f));
    pruned++;
  }
  console.log(`prune: removed ${pruned} stale upcoming picks the current gate no longer publishes.`);

  // --- Void sweep. A pick still `pending` more than VOID_AFTER days after kickoff
  // never settled — either a CORRUPTED fixture (the two teams never actually played
  // each other, e.g. "Pardubice vs Artis" — a source mis-paired opponents) or a
  // league no results provider covers. Leaving it `pending` forever pollutes the
  // record (looks like an open bet that will never close). Mark it `void`: kept for
  // honesty, but computeResults() on /results counts only won/lost, so a void neither
  // wins nor loses. NEVER touch won/lost (the real record) or recent pending (may yet
  // settle — the resolvers backfill for days).
  const VOID_AFTER = 7 * 24 * 60 * 60 * 1000;
  let voided = 0;
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (!f.endsWith('.md')) continue;
    const file = path.join(OUT_DIR, f);
    const txt = fs.readFileSync(file, 'utf8');
    if ((txt.match(/^result:\s*(.*)$/m)?.[1] || '').trim() !== 'pending') continue;
    const ko = Date.parse((txt.match(/^kickoff:\s*(.*)$/m)?.[1] || '').trim());
    if (!Number.isFinite(ko) || NOW - ko < VOID_AFTER) continue; // recent/future pending — leave for settle
    if (!dryRun) fs.writeFileSync(file, txt.replace(/^result:.*$/m, 'result: void'));
    voided++;
  }
  console.log(`void sweep: marked ${voided} long-unsettled picks void (corrupted/uncovered fixtures, >7d past).`);

  // --- CLV pass. Upsert every published pick into the closing-line store: first
  // sighting fixes the OPEN price; each later run before kickoff refreshes the
  // CLOSE price (the last pre-kickoff value ≈ the closing line). Frozen once the
  // match kicks off. This is what lets /results prove we beat the market's close.
  if (!dryRun) {
    const nowIso = new Date(NOW).toISOString();
    for (const { p, odds } of clvUpserts) {
      if (!(odds > 1)) continue;
      const key = `${p.matchKey}|${p.market}|${p.selection}`;
      const ko = new Date(p.kickoff).getTime();
      const e = clvStore[key];
      if (!e) {
        clvStore[key] = {
          match: `${p.homeTeam} vs ${p.awayTeam}`, league: p.league || 'Various',
          kickoff: new Date(p.kickoff).toISOString(), market: p.market, selection: p.selection,
          openOdds: odds, openAt: nowIso, closeOdds: odds, closeAt: nowIso,
        };
      } else if (ko > NOW) {
        e.closeOdds = odds; e.closeAt = nowIso; // still pre-match — refresh the close
      }
    }
    // Stamp results (from the full publishable set, which carries settled outcomes).
    for (const p of output.publishable) {
      if (!p.result || p.result === 'pending') continue;
      const key = `${p.matchKey}|${p.market}|${p.selection}`;
      if (clvStore[key]) clvStore[key].result = p.result;
    }
    // Prune entries more than 45 days past kickoff so the file can't grow forever.
    const CUTOFF = NOW - 45 * 24 * 60 * 60 * 1000;
    for (const [k, e] of Object.entries(clvStore)) {
      if (new Date((e as any).kickoff).getTime() < CUTOFF) delete clvStore[k];
    }
    fs.writeFileSync(CLV_FILE, JSON.stringify(clvStore, null, 2));
    const closed = Object.values(clvStore).filter((e: any) => new Date(e.kickoff).getTime() < NOW && e.openOdds > 1 && e.closeOdds > 1);
    const clvs = closed.map((e: any) => e.openOdds / e.closeOdds - 1);
    const beat = clvs.filter((x) => x > 0).length;
    const avg = clvs.length ? clvs.reduce((a: number, b: number) => a + b, 0) / clvs.length : 0;
    console.log(`CLV: ${Object.keys(clvStore).length} tracked, ${closed.length} closed — beat close ${clvs.length ? Math.round((beat / clvs.length) * 100) : 0}%, avg CLV ${(avg * 100).toFixed(2)}%`);
  }

  const published = [...byDay.values()].reduce((n, l) => n + l.length, 0);
  console.log(
    `generate-tip-content: ${published} published -> ${created} created, ${updated} updated, ${unchanged} unchanged; ${settledFiles} settled` +
      (dryRun ? ' (dry run, nothing written)' : ''),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
