// -------------------------------------------------------------------------
// refresh-bestodds-oddsapi.mjs — supplementary per-bookmaker best odds
// from The Odds API, FOR MATCHES HIGHLIGHTLY DIDN'T COVER.
//
// Problem: Highlightly PRO covers the top ~30 leagues well, but exotic
// matches (small CONCACAF, Israeli lower, Asian lower) ship with zero
// featured-book quotes, so the hasBetTarget gate holds them. The Odds API
// aggregates ~70 markets from the SAME affiliate books (Pinnacle, Bet365,
// 1xBet, Unibet, Betway, ...) and sometimes stocks matches Highlightly
// doesn't. Running this AFTER refresh-bestodds-hl.mjs lets us fill those
// gaps without touching matches Highlightly already priced.
//
// Design (same key format as refresh-bestodds-hl):
//  - Build matchKey() from home + away + ISO day exactly like generate-tip-
//    content does, so the gate finds the entry.
//  - Only KEEP bookmakers in our FEATURED set (same 20 affiliate books,
//    PLUS the extended Odds-API-only brands below). Non-featured prices get
//    dropped — they'd fail the hasBetTarget gate anyway.
//  - For each matchKey + outcome (home/away/draw/over/under/yes/no), emit
//    { odds, book, books:[{book,odds}, ...] } with the BEST price upfront
//    and the full book list behind it.
//  - Writes to src/data/best-odds-oddsapi.json (separate file). Loader in
//    generate-tip-content.ts merges WITHOUT clobbering best-odds.json
//    entries — Highlightly wins when both have the same match.
//
// Free-tier budget: 500 req/month. We fetch 1 "sports" list (free, no
// quota) + ODDS_API_LEAGUE_LIMIT (default 12) /odds calls per run. At
// 12/day * 30 = 360 calls/month, we stay under the limit.
// -------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'src', 'data', 'best-odds-oddsapi.json');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }),
);
// THE_ODDS_API_KEY may be a single key OR a comma-separated list (rotation
// across multiple free-tier keys to extend the 500 req/mo budget). We rotate
// through the keys on each top-level fetch; 401/429 on one triggers failover
// to the next automatically.
const KEYS = (env.THE_ODDS_API_KEY || '').split(',').map((k) => k.trim()).filter(Boolean);
if (!KEYS.length) { console.log('no THE_ODDS_API_KEY — skip'); process.exit(0); }
let keyIdx = 0;

const LEAGUE_LIMIT = Number(env.ODDS_API_LEAGUE_LIMIT) || 12;

// Only KEEP prices from these books. The 20 we have affiliate pages for
// (BOOK_PAGES in generate-tip-content.ts) PLUS a few more Odds-API-only
// brands commonly surfaced across EU — we convert them to the canonical
// name here so downstream code sees one spelling per book.
// Keyed by The Odds API's lowercase bookmaker `key`.
const BOOK_MAP = {
  // In BOOK_PAGES (clickable to /bookmakers/<slug>)
  bet365: 'bet365', betway: 'Betway', betsson: 'Betsson', '888sport': '888sport',
  novibet: 'Novibet', '22bet': '22Bet', '20bet': '20Bet', onexbet: '1xBet',
  '1xbet': '1xBet', megapari: 'Megapari', melbet: 'Melbet', betwinner: 'Betwinner',
  fonbet: 'Fonbet', bcgame: 'BC.Game', 'bc.game': 'BC.Game', stake: 'Stake',
  cloudbet: 'Cloudbet', rabona: 'Rabona', meridianbet: 'Meridianbet',
  stoiximan: 'Stoiximan', '1win': '1win', pinnacle: 'Pinnacle',
};

// Same slugTeam + matchKey as generate-tip-content.ts and refresh-bestodds-hl.
const STOP = /\b(fc|cf|sc|afc|cd|ac|club|the|de|do|dos|da|di|del|la|el|los|las|sv|if|bk|ss|us|as)\b/g;
const slugTeam = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(STOP, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const matchKey = (home, away, iso, sport = 'football') => {
  const day = String(iso).slice(0, 10);
  const pair = [slugTeam(home), slugTeam(away)].sort();
  return `${sport}|${day}|${pair[0]}|${pair[1]}`;
};

// Fetch with key rotation. Replaces {{KEY}} with the current key, and on
// 401/429 rotates to the next key then retries once per round-trip.
async function fetchJSON(urlTemplate) {
  for (let i = 0; i < KEYS.length; i++) {
    const url = urlTemplate.replace('{{KEY}}', KEYS[keyIdx]);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (res.status === 401 || res.status === 429) {
        console.log(`  key[${keyIdx}] HTTP ${res.status} — rotating`);
        keyIdx = (keyIdx + 1) % KEYS.length;
        continue;
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    } catch (e) {
      // Network / timeout — try the next key before giving up.
      if (i === KEYS.length - 1) throw e;
      keyIdx = (keyIdx + 1) % KEYS.length;
    }
  }
  throw new Error('all keys exhausted');
}

// 1. Enumerate active soccer sport keys (free, no quota).
let sports;
try {
  sports = await fetchJSON(`https://api.the-odds-api.com/v4/sports/?apiKey={{KEY}}`);
} catch (e) {
  console.log(`sports list failed: ${e.message} — skip`);
  process.exit(0);
}
const soccer = sports.filter((s) => s.active && s.key.startsWith('soccer_')).map((s) => s.key);
console.log(`Odds API: ${soccer.length} active soccer leagues, pulling first ${LEAGUE_LIMIT}.`);

// 2. For each league, fetch h2h + totals odds for all upcoming matches.
const entries = {}; // matchKey -> per-outcome book list

function pushOutcome(mk, outcomeKey, book, odds) {
  if (!book || typeof odds !== 'number' || !(odds > 1)) return;
  entries[mk] = entries[mk] || {};
  const e = entries[mk];
  e[outcomeKey] = e[outcomeKey] || { books: [] };
  // Dedup: per matchKey/outcome, keep each book's best price only once.
  const existing = e[outcomeKey].books.find((b) => b.book === book);
  if (!existing || odds > existing.odds) {
    if (existing) existing.odds = odds;
    else e[outcomeKey].books.push({ book, odds });
  }
}

let totalMatches = 0, totalOutcomes = 0;
for (const sk of soccer.slice(0, LEAGUE_LIMIT)) {
  let events;
  try {
    events = await fetchJSON(
      `https://api.the-odds-api.com/v4/sports/${sk}/odds/?apiKey={{KEY}}&regions=eu,uk&markets=h2h,totals&oddsFormat=decimal&dateFormat=iso`,
    );
  } catch (e) {
    console.log(`  ${sk}: ${e.message}`);
    continue;
  }
  let n = 0;
  for (const ev of events || []) {
    const mk = matchKey(ev.home_team, ev.away_team, ev.commence_time);
    const homeSlug = slugTeam(ev.home_team);
    const awaySlug = slugTeam(ev.away_team);
    for (const bk of ev.bookmakers || []) {
      const canonical = BOOK_MAP[String(bk.key).toLowerCase()];
      if (!canonical) continue; // non-featured book, we have no affiliate page
      for (const m of bk.markets || []) {
        if (m.key === 'h2h') {
          for (const o of m.outcomes || []) {
            const label = String(o.name).toLowerCase();
            let outcomeKey = null;
            if (label === ev.home_team.toLowerCase() || label === 'home') outcomeKey = homeSlug;
            else if (label === ev.away_team.toLowerCase() || label === 'away') outcomeKey = awaySlug;
            else if (label === 'draw') outcomeKey = 'draw';
            if (outcomeKey) { pushOutcome(mk, outcomeKey, canonical, Number(o.price)); totalOutcomes++; }
          }
        } else if (m.key === 'totals') {
          for (const o of m.outcomes || []) {
            if (Number(o.point) !== 2.5) continue; // only 2.5 — matches store schema
            const label = String(o.name).toLowerCase();
            if (label === 'over' || label === 'under') {
              pushOutcome(mk, label, canonical, Number(o.price)); totalOutcomes++;
            }
          }
        }
      }
    }
    n++;
  }
  totalMatches += n;
  console.log(`  ${sk}: ${events?.length || 0} events, ${n} merged`);
}

// 3. Finalize: pick BEST (highest) price per outcome, sort books desc.
for (const entry of Object.values(entries)) {
  for (const outcome of Object.values(entry)) {
    const books = outcome.books.sort((a, b) => b.odds - a.odds);
    outcome.odds = books[0]?.odds;
    outcome.book = books[0]?.book;
  }
}

fs.writeFileSync(OUT, JSON.stringify(entries, null, 2));
console.log(`Odds API best-odds: ${Object.keys(entries).length} matches, ${totalOutcomes} outcome quotes -> ${OUT}`);
