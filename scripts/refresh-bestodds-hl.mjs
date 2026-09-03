// ---------------------------------------------------------------------------
// refresh-bestodds-hl — REAL per-bookmaker best odds from Highlightly PRO,
// TARGETED at the fixtures we actually pick (so every published pick can get a
// real, bettable price — not a garbage tipster-source average like a 1.10
// favorite shown at 7.25).
//
// Design (three things the old best-odds got wrong, all fixed here):
//  1. TARGETING — price the games that HAVE picks, not random upcoming matches.
//     We read the fixtures from the published picks (src/content/tips) AND the
//     raw source snapshots (src/data/tips) so both current and next-run picks are
//     covered. (The old writer priced ~18 leagues blindly; overlap with our picks
//     was tiny.)
//  2. KEY FORMAT — key by the SAME matchKey() generate uses, built from the PICK's
//     own team names, so bestFor() actually finds the entry.
//  3. ORIENTATION — a pick's home/away can be flipped vs Highlightly's. We find
//     each team by NAME (fuzzy token match) and store its win price under the
//     PICK's team SLUG. bestFor() then resolves the pick's team -> slug -> odds,
//     orientation-proof. Only FEATURED (on-site) books count.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'src', 'data', 'best-odds.json');
const TIPS_MD = path.join(ROOT, 'src', 'content', 'tips');
const SNAP_DIR = path.join(ROOT, 'src', 'data', 'tips');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }),
);
const HL = env.HIGHLIGHTLY_API_KEY;
if (!HL) { console.log('no HIGHLIGHTLY_API_KEY — skip'); process.exit(0); }

const FEATURED = new Map([
  ['bet365', 'bet365'], ['betsson', 'Betsson'], ['betway', 'Betway'], ['888sport', '888sport'],
  ['novibet', 'Novibet'], ['22bet', '22Bet'], ['20bet', '20Bet'], ['1xbet', '1xBet'],
  ['megapari', 'Megapari'], ['melbet', 'Melbet'], ['betwinner', 'Betwinner'], ['fonbet', 'Fonbet'],
  ['bcgame', 'BC.Game'], ['bc.game', 'BC.Game'], ['stake', 'Stake'], ['stake.com', 'Stake'],
  ['cloudbet', 'Cloudbet'], ['rabona', 'Rabona'], ['meridianbet', 'Meridianbet'],
  ['stoiximan', 'Stoiximan'], ['1win', '1win'], ['pinnacle', 'Pinnacle'],
]);
const normB = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const STOP = /\b(fc|cf|sc|afc|cd|ac|club|the|de|do|dos|da|di|del|la|el|los|las|sv|if|bk|ss|us|as)\b/g;
const slugTeam = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(STOP, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const matchKey = (home, away, iso, sport = 'football') => {
  const day = String(iso).slice(0, 10);
  const pair = [slugTeam(home), slugTeam(away)].sort();
  return `${sport}|${day}|${pair[0]}|${pair[1]}`;
};
// fuzzy team token match (significant tokens, subset) — same idea as settle-real
const NAME_STOP = new Set(['club', 'team', 'city', 'united', 'real', 'deportivo', 'sporting', 'athletic']);
const toks = (s) => new Set(String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((x) => x.length >= 4 && !NAME_STOP.has(x)));
const teamMatch = (A, B) => { if (!A.size || !B.size) return false; const [s, l] = A.size <= B.size ? [A, B] : [B, A]; let n = 0; for (const t of s) if (l.has(t)) n++; return n >= s.size; };

// --- gather the fixtures we care about (published picks + raw snapshots) --------
const NOW = Date.now();
const FUTURE_CAP = 21 * 24 * 3600 * 1000;
const fixtures = new Map(); // matchKey -> {home, away, kickoff}
function add(home, away, kickoff) {
  const t = Date.parse(kickoff);
  if (!home || !away || !Number.isFinite(t) || t < NOW - 6 * 3600 * 1000 || t > NOW + FUTURE_CAP) return;
  const k = matchKey(home, away, kickoff);
  if (!fixtures.has(k)) fixtures.set(k, { home, away, kickoff });
}
// published picks (what the site shows now)
try {
  for (const f of fs.readdirSync(TIPS_MD)) {
    if (!f.endsWith('.md')) continue;
    const txt = fs.readFileSync(path.join(TIPS_MD, f), 'utf8').replace(/\r\n/g, '\n');
    const fm = txt.match(/^---\n([\s\S]*?)\n---/); if (!fm) continue;
    const g = (k) => (fm[1].match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1] || '').trim().replace(/^"|"$/g, '');
    if (g('result') !== 'pending') continue;
    const m = String(g('match')).split(/\s+vs\s+/i);
    if (m.length === 2) add(m[0], m[1], g('kickoff'));
  }
} catch {}
// raw snapshots (candidates for the next generate)
try {
  for (const f of fs.readdirSync(SNAP_DIR)) {
    if (!f.endsWith('.json')) continue;
    let arr; try { arr = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); } catch { continue; }
    if (Array.isArray(arr)) for (const t of arr) if ((t.sport ?? 'football') === 'football') add(t.homeTeam, t.awayTeam, t.kickoff);
  }
} catch {}

console.log(`best-odds targets: ${fixtures.size} distinct upcoming pick fixtures`);

// --- fetch HL matches per needed day (cached), then odds per matched fixture ----
const HDRS = { 'x-rapidapi-key': HL };
const MAX_ODDS_CALLS = Number(process.env.BESTODDS_MAX_CALLS) || 400;
const dayCache = new Map();
async function matchesOn(date) {
  if (dayCache.has(date)) return dayCache.get(date);
  const out = [];
  for (let off = 0; off < 1200; off += 100) {
    try {
      const r = await fetch(`https://soccer.highlightly.net/matches?date=${date}&limit=100&offset=${off}`, { headers: HDRS, signal: AbortSignal.timeout(20000) });
      const j = await r.json(); const arr = j?.data || [];
      for (const m of arr) out.push({ id: m.id, home: m.homeTeam?.name, away: m.awayTeam?.name, ht: toks(m.homeTeam?.name), at: toks(m.awayTeam?.name) });
      if (arr.length < 100) break;
    } catch { break; }
  }
  dayCache.set(date, out); return out;
}
async function oddsFor(id) {
  try { const r = await fetch(`https://soccer.highlightly.net/odds?matchId=${id}`, { headers: HDRS, signal: AbortSignal.timeout(20000) }); const j = await r.json(); return j?.data?.[0]?.odds || []; } catch { return null; }
}

const raw = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const store = {};
for (const [k, v] of Object.entries(raw)) if (k.startsWith('football|')) store[k] = v; // drop legacy unresolvable keys

let calls = 0, priced = 0, nomatch = 0;
for (const [key, fx] of fixtures) {
  if (calls >= MAX_ODDS_CALLS) break;
  const date = String(fx.kickoff).slice(0, 10);
  const gs = await matchesOn(date);
  const ht = toks(fx.home), at = toks(fx.away);
  // find the HL game for THIS pick fixture (both teams, either orientation)
  const g = gs.find((x) => (teamMatch(ht, x.ht) && teamMatch(at, x.at)) || (teamMatch(ht, x.at) && teamMatch(at, x.ht)));
  if (!g) { nomatch++; continue; }
  calls++;
  const odds = await oddsFor(g.id);
  if (!odds || !odds.length) continue;
  // is the PICK's home team the HL home side?
  const pickHomeIsHlHome = teamMatch(ht, g.ht);
  // Per outcome: the single BEST featured price (kept as {odds,book} for bestFor's
  // back-compat) PLUS `books` — every featured bookmaker's price, deduped to one row
  // per book (its own best), sorted best-first. `books` powers the on-page "where to
  // back it" odds board (every bookmaker that quotes this exact bet, at its price).
  const collect = (marketRe, want) => {
    const perBook = new Map();
    for (const bk of odds) {
      if (!marketRe.test(String(bk.market))) continue;
      const bn = FEATURED.get(normB(bk.bookmakerName)); if (!bn) continue;
      for (const v of (bk.values || [])) {
        if (!new RegExp(`^${want}$`, 'i').test(String(v.value))) continue;
        const o = Number(v.odd); if (!Number.isFinite(o) || o <= 1) continue;
        if (!perBook.has(bn) || o > perBook.get(bn)) perBook.set(bn, o);
      }
    }
    if (!perBook.size) return null;
    const books = [...perBook.entries()].map(([book, odds]) => ({ book, odds })).sort((a, b) => b.odds - a.odds);
    return { odds: books[0].odds, book: books[0].book, books };
  };
  const FTR = /full time result/i, OU25 = /^total goals 2\.5$/i, BTS = /both teams to score/i;

  // map to the PICK's teams by NAME (orientation-proof): the pick's home-team win
  // price = HL Home odds if the pick's home IS hl home, else HL Away odds.
  const homeWin = collect(FTR, pickHomeIsHlHome ? 'Home' : 'Away');
  const awayWin = collect(FTR, pickHomeIsHlHome ? 'Away' : 'Home');
  const draw = collect(FTR, 'Draw');
  const entry = {};
  const hs = slugTeam(fx.home), as = slugTeam(fx.away);
  if (homeWin) entry[hs] = homeWin;
  if (awayWin) entry[as] = awayWin;
  if (draw) entry.draw = draw;
  const ov = collect(OU25, 'Over'); if (ov) entry.over = ov;
  const un = collect(OU25, 'Under'); if (un) entry.under = un;
  const yy = collect(BTS, 'Yes'); if (yy) entry.yes = yy;
  const nn = collect(BTS, 'No'); if (nn) entry.no = nn;
  if (Object.keys(entry).length) { store[key] = entry; priced++; }
}

fs.writeFileSync(OUT, JSON.stringify(store, null, 2) + '\n');
console.log(`refresh-bestodds-hl: ${fixtures.size} pick fixtures, ${calls} odds calls, priced ${priced} (no HL match: ${nomatch}). Store: ${Object.keys(store).length}.`);
