// ---------------------------------------------------------------------------
// refresh-bestodds-hl — REAL per-bookmaker best odds from Highlightly PRO.
//
// Replaces the dead The-Odds-API best-odds engine. Highlightly PRO returns
// 40-49 bookmakers per match (with history), including the books we feature.
// We write the BEST price among OUR featured books for each outcome.
//
// TWO bugs this fixes:
//  1. KEY MISMATCH — the old best-odds.json keyed "date|home|away"; generate's
//     bestFor() looks up `p.matchKey` = "football|day|slugA|slugB" (sorted). They
//     never matched, so NO pick ever got a real book price (the odds shown were
//     always the raw tipster-source average — often garbage, e.g. a 1.10 favorite
//     shown at 7.25). We key by the SAME matchKey() generate uses.
//  2. ORIENTATION (home/away) — we store each team's win price under the TEAM SLUG,
//     not under "home"/"away". A pick's home/away can be flipped vs Highlightly's;
//     keying win-odds by slug makes the lookup orientation-proof (bestFor resolves
//     the pick's own team -> slug -> odds, regardless of who HL calls home).
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'src', 'data', 'best-odds.json');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }),
);
const HL = env.HIGHLIGHTLY_API_KEY;
if (!HL) { console.log('no HIGHLIGHTLY_API_KEY — skip'); process.exit(0); }

// Books we actually feature on the site (affiliate board). Only these count toward
// the advertised "best odds" — a price the reader can't reach is worthless. Keyed
// by normalized bookmakerName as Highlightly spells it.
const FEATURED = new Map([
  ['bet365', 'bet365'], ['betsson', 'Betsson'], ['betway', 'Betway'], ['888sport', '888sport'],
  ['novibet', 'Novibet'], ['22bet', '22Bet'], ['20bet', '20Bet'], ['1xbet', '1xBet'],
  ['megapari', 'Megapari'], ['melbet', 'Melbet'], ['betwinner', 'Betwinner'], ['fonbet', 'Fonbet'],
  ['bcgame', 'BC.Game'], ['bc.game', 'BC.Game'], ['stake', 'Stake'], ['stake.com', 'Stake'],
  ['cloudbet', 'Cloudbet'], ['rabona', 'Rabona'], ['meridianbet', 'Meridianbet'],
  ['stoiximan', 'Stoiximan'], ['1win', '1win'], ['pinnacle', 'Pinnacle'],
]);
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// slugTeam + matchKey — MUST match src/lib/aggregation/normalize.ts exactly so the
// keys align with generate's p.matchKey.
const STOP = /\b(fc|cf|sc|afc|cd|ac|club|the|de|do|dos|da|di|del|la|el|los|las|sv|if|bk|ss|us|as)\b/g;
const slugTeam = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(STOP, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const matchKey = (home, away, iso, sport = 'football') => {
  const day = String(iso).slice(0, 10);
  const pair = [slugTeam(home), slugTeam(away)].sort();
  return `${sport}|${day}|${pair[0]}|${pair[1]}`;
};

const HDRS = { 'x-rapidapi-key': HL };
const MAX_ODDS_CALLS = Number(process.env.BESTODDS_MAX_CALLS) || 250;
const DAYS = Number(process.env.BESTODDS_DAYS) || 4; // today + next 3

async function matchesOn(date) {
  const out = [];
  for (let off = 0; off < 1000; off += 100) {
    try {
      const r = await fetch(`https://soccer.highlightly.net/matches?date=${date}&limit=100&offset=${off}`, { headers: HDRS, signal: AbortSignal.timeout(20000) });
      const j = await r.json();
      const arr = j?.data || [];
      for (const m of arr) {
        // only upcoming (odds markets only exist pre-match); skip finished/live
        if (/^Finished|Live|Half|Penalt/i.test(String(m?.state?.description || ''))) continue;
        out.push({ id: m.id, home: m.homeTeam?.name, away: m.awayTeam?.name, date });
      }
      if (arr.length < 100) break;
    } catch { break; }
  }
  return out;
}

function bestAmongFeatured(values, wanted) {
  // values: [{odd, value:'Home'|'Draw'|'Away'|'Over'|'Under'|...}], with bookmakerName on the parent
  let best = null;
  for (const v of values) {
    if (!new RegExp(`^${wanted}$`, 'i').test(String(v.value))) continue;
    if (!v._book) continue;
    if (!best || v.odd > best.odds) best = { odds: v.odd, book: v._book };
  }
  return best;
}

async function oddsFor(id) {
  try {
    const r = await fetch(`https://soccer.highlightly.net/odds?matchId=${id}`, { headers: HDRS, signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    return j?.data?.[0]?.odds || [];
  } catch { return null; }
}

const store = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
let calls = 0, written = 0;
const today = new Date();
const dates = Array.from({ length: DAYS }, (_, i) => new Date(today.getTime() + i * 864e5).toISOString().slice(0, 10));

for (const date of dates) {
  if (calls >= MAX_ODDS_CALLS) break;
  const ms = await matchesOn(date);
  for (const m of ms) {
    if (calls >= MAX_ODDS_CALLS) break;
    if (!m.home || !m.away) continue;
    calls++;
    const odds = await oddsFor(m.id);
    if (!odds || !odds.length) continue;
    // flatten featured-book values per market
    const ftr = []; // Full Time Result
    const ou = {}; // 'Over'/'Under' at 2.5
    const btts = {};
    for (const bk of odds) {
      const bname = FEATURED.get(norm(bk.bookmakerName));
      if (!bname) continue; // only featured books
      const mk = String(bk.market || '');
      if (/full time result/i.test(mk)) {
        for (const v of (bk.values || [])) ftr.push({ ...v, _book: bname });
      } else if (/^total goals 2\.5$/i.test(mk)) {
        for (const v of (bk.values || [])) { const k = norm(v.value); if (!ou[k] || v.odd > ou[k].odds) ou[k] = { odds: v.odd, book: bname }; }
      } else if (/both teams to score/i.test(mk)) {
        for (const v of (bk.values || [])) { const k = norm(v.value); if (!btts[k] || v.odd > btts[k].odds) btts[k] = { odds: v.odd, book: bname }; }
      }
    }
    const homeSlug = slugTeam(m.home), awaySlug = slugTeam(m.away);
    const entry = {};
    const bh = bestAmongFeatured(ftr, 'Home'); if (bh) entry[homeSlug] = bh;      // home team's win price, keyed by SLUG (orientation-proof)
    const ba = bestAmongFeatured(ftr, 'Away'); if (ba) entry[awaySlug] = ba;
    const bd = bestAmongFeatured(ftr, 'Draw'); if (bd) entry.draw = bd;
    if (ou.over) entry.over = ou.over; if (ou.under) entry.under = ou.under;
    if (btts.yes) entry.yes = btts.yes; if (btts.no) entry.no = btts.no;
    if (Object.keys(entry).length) { store[matchKey(m.home, m.away, m.date)] = entry; written++; }
  }
}

fs.writeFileSync(OUT, JSON.stringify(store, null, 2) + '\n');
console.log(`refresh-bestodds-hl: ${calls} odds calls, wrote best-odds for ${written} matches (featured books only). Total store: ${Object.keys(store).length}.`);
