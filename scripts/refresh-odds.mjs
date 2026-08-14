// -------------------------------------------------------------------------
// refresh-odds.mjs — the SHARP value engine.
//
// The site's own Poisson model can't beat closing odds (backtested: -ROI on
// every config). Real edge comes from PRICE, not prediction:
//   1. Pinnacle is the sharpest book (≈2% margin, never limits winners) — its
//      de-margined price is the closest thing to a fixture's TRUE probability.
//   2. If another book offers BETTER odds than Pinnacle's fair price, that gap
//      is genuine +EV — a value bet.
//   3. Publishing every pick at the BEST available odds lifts ROI on the same
//      picks (line-shopping) and feeds the affiliate ("back it at <book>").
//
// This pulls Pinnacle + every book from The Odds API (rotating keys so we never
// run out of the free 500/mo each), computes fair prob + best price + edge per
// selection, and writes value picks to src/data/tips/odds-value.json as a RawTip
// source (odds:value) — a sharp signal the consensus can weight heavily.
//
//   node scripts/refresh-odds.mjs
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src', 'data', 'tips', 'odds-value.json');
const BEST_OUT = path.join(ROOT, 'src', 'data', 'best-odds.json');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const KEYS = String(env.THE_ODDS_API_KEY || '').split(',').map((s) => s.trim()).filter((k) => k && !k.startsWith('PASTE'));
if (!KEYS.length) { console.error('No THE_ODDS_API_KEY in .env'); process.exit(1); }

// Self-throttle: pre-match odds/value barely move intraday, so a run every 2h
// burns the free 500/mo-per-key quota in ~a week (12 leagues × 12 runs/day = 144
// credits/day). Skip if best-odds.json was last refreshed within
// ODDS_MIN_INTERVAL_HOURS (default 11 → ~2×/day → 2 keys cover a full month).
// Uses the file's git commit time, NOT mtime — the CI checks out fresh each run,
// which would reset mtime and make an mtime check always skip. Override with
// --force or ODDS_MIN_INTERVAL_HOURS=0.
const MIN_INTERVAL_H = Number(env.ODDS_MIN_INTERVAL_HOURS ?? 11);
if (MIN_INTERVAL_H > 0 && !process.argv.includes('--force')) {
  try {
    const ct = Number(execSync('git log -1 --format=%ct -- src/data/best-odds.json', { cwd: ROOT }).toString().trim());
    const ageH = (Date.now() / 1000 - ct) / 3600;
    if (ct && ageH < MIN_INTERVAL_H) {
      console.log(`Throttled: best-odds last refreshed ${ageH.toFixed(1)}h ago (< ${MIN_INTERVAL_H}h) — skipping to save Odds API credits. Override: --force or ODDS_MIN_INTERVAL_HOURS=0.`);
      process.exit(0);
    }
  } catch { /* no git history / not a repo — proceed */ }
}

const EDGE = Number(env.ODDS_VALUE_EDGE) || 0.03; // min +EV vs Pinnacle fair (3%)
const PROB_FLOOR = Number(env.ODDS_MIN_PROB) || 0.30; // skip extreme longshots -> keeps win rate + variance sane
const MAX_SOCCER = Number(env.ODDS_MAX_LEAGUES) || 12; // leagues per run (1 credit each)
// Exchanges (Betfair/Matchbook) are the sharpest prices but NOT affiliate books
// a user can be sent to, and they charge commission — use them to JUDGE value,
// never as the price we publish. Published odds come from real bookmakers only.
const EXCHANGES = new Set(['betfair_ex_eu', 'betfair_ex_uk', 'matchbook']);

let keyIdx = 0;
// Rotate keys on quota/limit errors; return the response of the first key that works.
async function api(url) {
  let lastErr = 'no keys';
  for (let n = 0; n < KEYS.length; n++) {
    const key = KEYS[keyIdx++ % KEYS.length];
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}apiKey=${key}`, { signal: AbortSignal.timeout(20000) });
    if (res.status === 401 || res.status === 429) { lastErr = `HTTP ${res.status}`; continue; }
    return res;
  }
  throw new Error(`all odds keys failed (${lastErr})`);
}

// De-margin a set of book prices for one match into fair probabilities.
// prices = {selection: decimalOdds}. Returns {selection: fairProb} (sums to 1).
function fairProbs(prices) {
  const inv = {}; let sum = 0;
  for (const [sel, p] of Object.entries(prices)) { if (p > 1) { inv[sel] = 1 / p; sum += inv[sel]; } }
  const out = {};
  for (const [sel, v] of Object.entries(inv)) out[sel] = v / sum;
  return out;
}

// matchKey — mirror src/lib/aggregation/normalize.ts so best-odds.json keys join
// the site's picks. Best-odds is ADDITIVE: it only upgrades the odds we display
// on a pick we already publish; it never changes which picks are selected.
const TEAM_ALIASES = {
  'man city': 'manchester city', 'man utd': 'manchester united', 'man united': 'manchester united',
  spurs: 'tottenham', inter: 'inter milan', juve: 'juventus', psg: 'paris saint germain',
  atleti: 'atletico madrid', atletico: 'atletico madrid', barca: 'barcelona', bayern: 'bayern munich', dortmund: 'borussia dortmund',
};
const LATIN_FOLD = [[/æ/g, 'ae'], [/œ/g, 'oe'], [/ø/g, 'o'], [/ß/g, 'ss'], [/ð/g, 'd'], [/þ/g, 'th'], [/ł/g, 'l'], [/đ/g, 'd'], [/ħ/g, 'h'], [/ı/g, 'i']];
function slugTeam(name) {
  let n = String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [re, to] of LATIN_FOLD) n = n.replace(re, to);
  n = n.replace(/\butd\b/g, 'united').replace(/\b(fc|cf|afc|sc|ac|club|cd|ss|as)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  if (!n) n = String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return (TEAM_ALIASES[n] ?? n).replace(/\s+/g, '-');
}
const matchKey = (home, away, kickoff) => `football|${String(kickoff).slice(0, 10)}|${[slugTeam(home), slugTeam(away)].sort().join('|')}`;

const sportsRes = await api('https://api.the-odds-api.com/v4/sports/');
if (!sportsRes.ok) { console.error('sports list failed', sportsRes.status); process.exit(1); }
const sports = await sportsRes.json();
const leagues = sports.filter((s) => s.active && s.key.startsWith('soccer_')).map((s) => s.key).slice(0, MAX_SOCCER);
console.log(`Active soccer leagues: ${leagues.length}. Edge threshold: ${(EDGE * 100).toFixed(0)}%.\n`);

const picks = [];
const bestOdds = {}; // matchKey -> { home|draw|away: {odds, book} } for line-shopping
let scanned = 0, remaining = '';
for (const lg of leagues) {
  try {
    const res = await api(`https://api.the-odds-api.com/v4/sports/${lg}/odds/?regions=eu&markets=h2h&oddsFormat=decimal`);
    remaining = res.headers.get('x-requests-remaining') ?? remaining;
    if (!res.ok) { console.log(`  ✗ ${lg}: HTTP ${res.status}`); continue; }
    const events = await res.json();
    for (const e of events) {
      scanned++;
      const home = e.home_team, away = e.away_team;
      // Collect prices per canonical selection (home/draw/away) from every book.
      const byBook = {}; // book -> {home,draw,away}
      const pinPrices = {}; // sharp reference prices (Pinnacle)
      const betPrices = {}; // Betfair exchange — also sharp, often sharper than Pinnacle
      for (const b of e.bookmakers || []) {
        const h2h = b.markets?.find((m) => m.key === 'h2h'); if (!h2h) continue;
        for (const o of h2h.outcomes || []) {
          const sel = o.name === home ? 'home' : o.name === away ? 'away' : o.name === 'Draw' ? 'draw' : null;
          if (!sel) continue;
          (byBook[b.key] ??= {})[sel] = o.price;
          if (b.key === 'pinnacle') pinPrices[sel] = o.price;
          else if (b.key === 'betfair_ex_eu' || b.key === 'betfair_ex_uk') betPrices[sel] = o.price;
        }
      }
      // best price per selection across real BOOKMAKERS (exchanges excluded) —
      // recorded for EVERY match (line-shopping), not only the value ones.
      const best = {}; // sel -> {price, book}
      for (const [book, sels] of Object.entries(byBook)) {
        if (EXCHANGES.has(book)) continue;
        for (const [sel, price] of Object.entries(sels)) {
          if (!best[sel] || price > best[sel].price) best[sel] = { price, book };
        }
      }
      const mk = matchKey(home, away, e.commence_time);
      if (best.home || best.draw || best.away) {
        bestOdds[mk] = {};
        for (const sel of ['home', 'draw', 'away']) if (best[sel]) bestOdds[mk][sel] = { odds: Math.round(best[sel].price * 100) / 100, book: best[sel].book };
      }
      // Sharp anchor(s): Pinnacle and/or Betfair exchange (both ≈ true probability).
      // Blend when both exist (sharper estimate); use whichever is present otherwise.
      // Also EXPANDS coverage to matches Betfair prices but Pinnacle doesn't.
      const pinFair = (pinPrices.home && pinPrices.away) ? fairProbs(pinPrices) : null;
      const betFair = (betPrices.home && betPrices.draw && betPrices.away) ? fairProbs(betPrices) : null;
      if (!pinFair && !betFair) continue;
      const anchor = pinFair && betFair ? 'Pinnacle+Betfair' : pinFair ? 'Pinnacle' : 'Betfair';
      const fair = {};
      for (const s of ['home', 'draw', 'away']) {
        const vals = [pinFair?.[s], betFair?.[s]].filter((v) => typeof v === 'number');
        if (vals.length) fair[s] = vals.reduce((a, b) => a + b, 0) / vals.length;
      }
      // value = best bookmaker price beats the sharp fair prob by >= EDGE,
      // and the pick isn't an extreme longshot (win-rate/variance floor).
      for (const sel of ['home', 'draw', 'away']) {
        if (!best[sel] || !fair[sel] || fair[sel] < PROB_FLOOR) continue;
        const edge = best[sel].price * fair[sel] - 1;
        if (edge >= EDGE) {
          picks.push({
            source: 'odds:value',
            tipster: `Sharp Value (${anchor}-anchored)`,
            homeTeam: home, awayTeam: away,
            league: e.sport_title || lg, kickoff: e.commence_time,
            sport: 'football', dateVerified: true,
            market: '1X2', selection: sel,
            odds: Math.round(best[sel].price * 100) / 100,
            bookmaker: best[sel].book,
            fairProb: Math.round(fair[sel] * 1000) / 10, // %
            edge: Math.round(edge * 1000) / 10, // %
          });
        }
      }
    }
  } catch (err) { console.log(`  ✗ ${lg}: ${String(err?.message || err).slice(0, 50)}`); }
}

picks.sort((a, b) => b.edge - a.edge);
// Guard: only overwrite the value/best-odds feeds when we actually pulled odds.
// If every league failed (dead/exhausted keys, network), scanned===0 — writing
// then would WIPE the last-good feeds. Keep them instead.
if (scanned > 0) {
  fs.writeFileSync(OUT, JSON.stringify(picks, null, 2) + '\n');
  fs.writeFileSync(BEST_OUT, JSON.stringify(bestOdds, null, 2) + '\n');
} else {
  console.log('  ⚠ 0 matches scanned (all odds calls failed — likely exhausted/invalid THE_ODDS_API_KEY). Kept existing odds-value.json + best-odds.json (not overwritten).');
}
console.log(`Scanned ${scanned} matches across ${leagues.length} leagues. Found ${picks.length} value picks (edge >= ${(EDGE * 100).toFixed(0)}%). Best-odds for ${Object.keys(bestOdds).length} matches. Credits remaining: ${remaining}.`);
console.log('\nTop value picks:');
for (const p of picks.slice(0, 12)) {
  console.log(`  +${p.edge}%  ${p.homeTeam} vs ${p.awayTeam} — ${p.selection.toUpperCase()} @ ${p.odds} (${p.bookmaker})  [fair ${p.fairProb}%]`);
}
