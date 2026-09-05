// -------------------------------------------------------------------------
// settle-real.mjs — the REAL (non-demo) track record, in two phases:
//
//  1. ARCHIVE: every dateVerified pick (from the current site-*/tg-*.json
//     snapshots) gets copied into src/data/real-history.json if not already
//     there. This matters because refresh-sites.mjs / refresh-telegram.mjs
//     OVERWRITE their snapshot with each day's fresh picks — without this
//     archive, a pick would vanish before its match even finishes.
//  2. RESOLVE: for archived picks whose fixture has finished (FT), fetch the
//     final score and record it in src/data/real-outcomes.json (keyed by the
//     same matchKey the consensus engine uses). index.ts merges that file
//     into the settlement map, so the pipeline settles real picks exactly
//     like it settles the demo ones — no separate code path needed there.
//
// Run periodically (a few times/day is plenty) after the refresh scripts:
//   node scripts/settle-real.mjs
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIPS_DIR = path.join(ROOT, 'src', 'data', 'tips');
const HISTORY_FILE = path.join(ROOT, 'src', 'data', 'real-history.json');
const OUTCOMES_FILE = path.join(ROOT, 'src', 'data', 'real-outcomes.json');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const KEY = env.API_SPORTS_KEY;
if (!KEY) { console.error('No API_SPORTS_KEY in .env — cannot check results.'); process.exit(1); }

// --- matchKey, mirrored from src/lib/aggregation/normalize.ts (football only) ---
const TEAM_ALIASES = {
  'man city': 'manchester city', 'man utd': 'manchester united', 'man united': 'manchester united',
  spurs: 'tottenham', inter: 'inter milan', juve: 'juventus', psg: 'paris saint germain',
  atleti: 'atletico madrid', atletico: 'atletico madrid', barca: 'barcelona', bayern: 'bayern munich', dortmund: 'borussia dortmund',
};
function slugTeam(name) {
  const n = String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\butd\b/g, 'united').replace(/\b(fc|cf|afc|sc|ac|club|cd|ss|as)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  return (TEAM_ALIASES[n] ?? n).replace(/\s+/g, '-');
}
function matchKey(home, away, kickoffISO) {
  const day = kickoffISO.slice(0, 10);
  const pair = [slugTeam(home), slugTeam(away)].sort();
  return `football|${day}|${pair[0]}|${pair[1]}`;
}
// Significant name tokens for FUZZY match (obscure-league name variants that the
// exact matchKey misses: "Čelik" vs "Celik Zenica", "Nautico" vs "Nautico Recife").
// Keep tokens >=4 chars, drop generic club words and city/reserve suffixes.
// Keep DISTINCTIVE tokens (united/city/real/atletico/women all stay — they separate
// Man Utd from Man City, Real from Atlético, women from men). Only truly generic
// filler is dropped; the >=4 length filter already removes fc/cf/sc/nk/cd.
const NAME_STOP = new Set(['club', 'team']);
function nameTokens(s) {
  return new Set(
    String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !NAME_STOP.has(w)),
  );
}
// STRONG team match: the smaller token set is a SUBSET of the larger. "Nautico"
// ⊆ "Nautico Recife" ✓; "Real Madrid" ⊄ "Atlético Madrid" (real absent) ✗. This is
// what makes the fuzzy pass safe — a mere shared city token ("madrid") is not enough.
function teamMatch(a, b) {
  if (!a.size || !b.size) return false;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

// --- Web-search settlement helpers (grounded score extraction) --------------
// Earliest index at which any >=2-char token of `name` appears in `hay`; -1 if
// absent (2-char tokens like "AZ" require a space-delimited match).
function webFirstIdx(name, hay) {
  const h = ' ' + String(hay).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const toks = String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((w) => w.length >= 2);
  let best = -1;
  for (const w of toks) {
    const idx = w.length === 2 ? h.indexOf(' ' + w + ' ') : h.indexOf(w);
    if (idx >= 0 && (best < 0 || idx < best)) best = idx;
  }
  return best;
}
const WEB_MONTHS = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
// One snippet -> {hg,ag} only if BOTH teams appear and there is exactly ONE
// plausible FOOTBALL score; orientation follows which team name is written
// first. Two guards learned the hard way: a number pair next to a month name is
// a DATE ("8-9 August"), not a score; and a pair where both sides are >=6 (or
// either >9) is another sport (water polo / handball / a date), never football.
function webSnippetScore(home, away, snippet) {
  const s = ' ' + String(snippet).replace(/\s+/g, ' ') + ' ';
  const hi = webFirstIdx(home, s), ai = webFirstIdx(away, s);
  if (hi < 0 || ai < 0) return null;
  const cand = [];
  for (const m of s.matchAll(/(?<!\d)(\d{1,2})\s*[-–:]\s*(\d{1,2})(?!\d)/g)) {
    const a = Number(m[1]), b = Number(m[2]);
    const end = m.index + m[0].length;
    if (WEB_MONTHS.test(s.slice(end, end + 14)) || WEB_MONTHS.test(s.slice(Math.max(0, m.index - 14), m.index))) continue;
    if (a > 9 || b > 9 || Math.min(a, b) >= 6) continue;
    cand.push([a, b]);
  }
  if (cand.length !== 1) return null;
  const [a, b] = cand[0];
  return hi < ai ? { hg: a, ag: b } : { hg: b, ag: a };
}
// Consensus across result snippets: needs >=2 agreeing, with a unique winner.
// Anything ambiguous returns null (we leave it unsettled, never guess).
function webConsensus(home, away, snippets) {
  const tally = {};
  for (const sn of snippets) { const r = webSnippetScore(home, away, sn); if (r) { const k = `${r.hg}-${r.ag}`; tally[k] = (tally[k] || 0) + 1; } }
  const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 2) return null;
  if (ranked[1] && ranked[1][1] === ranked[0][1]) return null;
  const [hg, ag] = ranked[0][0].split('-').map(Number);
  return { hg, ag, votes: ranked[0][1] };
}

// --- phase 1: archive ------------------------------------------------------
const history = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) : [];
// Identity of an archived pick. Falls back to matchKey when there's no
// fixtureId so picks that never matched an api-football fixture (uncovered
// leagues, non-Latin names) still get a UNIQUE key — without the teams, two
// different "1X2/home" picks from one tipster would collide and one would be
// dropped.
const archId = (h) => `${h.fixtureId || matchKey(h.homeTeam, h.awayTeam, h.kickoff)}:${h.market}:${h.selection}:${h.source}:${h.tipster}`;
const archivedKeys = new Set(history.map(archId));

const files = fs.readdirSync(TIPS_DIR).filter((f) => f.endsWith('.json'));
let newlyArchived = 0;
for (const file of files) {
  let arr;
  try { arr = JSON.parse(fs.readFileSync(path.join(TIPS_DIR, file), 'utf8')); } catch { continue; }
  if (!Array.isArray(arr)) continue;
  for (const t of arr) {
    // Was: require dateVerified + fixtureId. That silently dropped every pick
    // in a league api-football's free tier doesn't return — exactly the ones
    // the user wants tracked. Now archive any real pick (two teams + a market);
    // the broad resolvers + web search below settle whatever they can.
    if (!t.homeTeam || !t.awayTeam || !t.market || !t.selection) continue;
    const k = archId(t);
    if (archivedKeys.has(k)) continue;
    archivedKeys.add(k);
    history.push({ ...t }); // result filled in by a resolver below (phase 2)
    newlyArchived++;
  }
}
if (newlyArchived) fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2) + '\n');
console.log(`Archived ${newlyArchived} new dateVerified picks (history total: ${history.length}).`);

// --- phase 2: resolve outcomes for fixtures that have finished -------------
const outcomes = fs.existsSync(OUTCOMES_FILE) ? JSON.parse(fs.readFileSync(OUTCOMES_FILE, 'utf8')) : [];
const knownMatchKeys = new Set(outcomes.map((o) => o.matchKey));
// Only PAST matches await a result. Sources like Pinnacle add hundreds of FUTURE
// picks; if we don't exclude them the resolvers below chase future dates (which
// have no finished matches) and settle nothing — starving the whole pipeline.
const NOW_MS = Date.now();
// The quota-limited resolvers (Highlightly ~100 calls/day, odds-api.io ~300/mo)
// get burned if they run on every 2h pipeline pass (12×/day). Gate them to a few
// "deep" runs/day (every 6h → 4×/day), so the daily quota lasts. The UNLIMITED
// resolvers (ESPN, football-data) still run EVERY pass, so recent results settle
// promptly regardless. Force a deep pass with SETTLE_DEEP=1.
const DEEP_SETTLE = process.env.SETTLE_DEEP === '1' || new Date().getUTCHours() % 6 === 0;
const isFinished = (h) => { const t = Date.parse(h.kickoff); return Number.isFinite(t) && t < NOW_MS; };
const unresolved = [...new Map(history
  .filter((h) => isFinished(h) && !knownMatchKeys.has(matchKey(h.homeTeam, h.awayTeam, h.kickoff)))
  .map((h) => [h.fixtureId, h])).values()]; // unique fixtureIds only

console.log(`Fixtures awaiting a result: ${unresolved.length}`);
// Don't exit when api-football has nothing pending — the broad resolvers and
// the web search below settle a DIFFERENT bucket (uncovered leagues) and must
// still run.

// Free api-football plans REJECT the `ids=` multi-fetch parameter
// ("Free plans do not have access to the Ids parameter") — the old batch call
// silently returned nothing, so nothing ever settled. Resolve by DATE instead:
// one request per distinct kickoff day returns every fixture (final score +
// status) for that day; we look ours up by id. Works on the free plan and is
// far fewer calls than one-per-fixture.
// The free plan only serves a ~2-day window ("try from <today-1> to <today+1>").
// Querying an older date 400s — and the OLD code did `break` on that, so a single
// old pending date (e.g. two weeks back) aborted the whole loop and it NEVER
// reached the recent dates it COULD settle (prod: "Resolved 0 api-football"). Fix:
// only query dates inside the free window, newest first, and treat a per-date
// rejection as skip-this-date; reserve the hard stop for a truly dead account.
const API_WINDOW_MS = 3 * 24 * 3600 * 1000; // free window is ~2 days; 3 for TZ safety
const dates = [...new Set(unresolved
  .filter((h) => NOW_MS - Date.parse(h.kickoff) <= API_WINDOW_MS)
  .map((h) => String(h.kickoff).slice(0, 10)))].sort().reverse(); // newest first
const fixtureResults = new Map();
for (const date of dates) {
  try {
    const res = await fetch(`https://v3.football.api-sports.io/fixtures?date=${date}`, {
      headers: { 'x-apisports-key': KEY }, signal: AbortSignal.timeout(20000),
    });
    const json = await res.json();
    if (json.errors && !Array.isArray(json.errors) && Object.keys(json.errors).length) {
      const msg = JSON.stringify(json.errors);
      console.log(`  ✗ ${date}: ${msg.slice(0, 90)}`);
      // Distinguish a DEAD ACCOUNT (suspended / bad key / missing) — fails every
      // date, so stop — from a PER-DATE rejection (date outside the free window):
      // skip just that date and keep going to the ones inside the window.
      if (/suspend|not authorized|Missing|Invalid|disabled|not subscribed/i.test(msg)) {
        console.log('  api-football unusable (suspended / bad key) — skipping remaining dates.');
        break;
      }
      continue; // per-date rejection (outside free window) — try the next date
    }
    for (const r of json.response || []) {
      fixtureResults.set(r.fixture.id, { status: r.fixture.status?.short, hg: r.goals?.home, ag: r.goals?.away });
    }
  } catch (e) { console.log(`  ✗ ${date} fetch failed: ${String(e?.message || e).slice(0, 60)}`); }
}

const FINISHED = new Set(['FT', 'AET', 'PEN']);
let resolved = 0, stillLive = 0;
for (const h of unresolved) {
  const r = fixtureResults.get(h.fixtureId);
  if (!r || !FINISHED.has(r.status) || typeof r.hg !== 'number' || typeof r.ag !== 'number') { stillLive++; continue; }
  outcomes.push({ matchKey: matchKey(h.homeTeam, h.awayTeam, h.kickoff), hg: r.hg, ag: r.ag, settledAt: new Date().toISOString() });
  resolved++;
}
// --- Secondary resolver: football-data.org. Free and HISTORICAL (no ~2-day
// window like api-football's free plan), so it backfills matches that plan
// couldn't reach. Matched by matchKey (team names + date), NOT fixture id, so
// it settles any still-pending pick whose match it covers (major leagues).
const FD_KEY = env.FOOTBALL_DATA_ORG_KEY;
let fdResolved = 0;
if (FD_KEY) {
  const known = new Set(outcomes.map((o) => o.matchKey));
  const stillUnresolved = history.filter((h) => isFinished(h) && !known.has(matchKey(h.homeTeam, h.awayTeam, h.kickoff)));
  const fdDates = [...new Set(stillUnresolved.map((h) => String(h.kickoff).slice(0, 10)))];
  for (const date of fdDates) {
    try {
      const res = await fetch(`https://api.football-data.org/v4/matches?dateFrom=${date}&dateTo=${date}`, {
        headers: { 'X-Auth-Token': FD_KEY }, signal: AbortSignal.timeout(20000),
      });
      const json = await res.json();
      for (const m of json.matches || []) {
        if (m.status !== 'FINISHED') continue;
        const hg = m.score?.fullTime?.home, ag = m.score?.fullTime?.away;
        if (typeof hg !== 'number' || typeof ag !== 'number') continue;
        const k = matchKey(m.homeTeam?.name ?? m.homeTeam?.shortName ?? '', m.awayTeam?.name ?? m.awayTeam?.shortName ?? '', `${date}T00:00:00Z`);
        if (!k || known.has(k)) continue;
        known.add(k);
        outcomes.push({ matchKey: k, hg, ag, settledAt: new Date().toISOString() });
        fdResolved++;
      }
    } catch (e) { console.log(`  ✗ football-data ${date}: ${String(e?.message || e).slice(0, 50)}`); }
  }
}

// Tertiary resolver: odds-api.io. Free + broad coverage incl. the small
// leagues api-football/football-data miss (Swiss Challenge, Austrian amateur,
// etc.), returns settled scores. Free tier is rate-limited (~300/mo) so make
// just ONE call per run and match by matchKey. Best-effort; never blocks.
const OAI_KEY = DEEP_SETTLE ? env.ODDS_API_IO_KEY : ''; // quota-gated (see DEEP_SETTLE)
let oaiResolved = 0;
if (OAI_KEY) {
  try {
    const known = new Set(outcomes.map((o) => o.matchKey));
    const res = await fetch(`https://api.odds-api.io/v3/events?sport=football&apiKey=${OAI_KEY}`, { signal: AbortSignal.timeout(20000) });
    const arr = await res.json();
    for (const e of (Array.isArray(arr) ? arr : [])) {
      if (e?.status !== 'settled') continue;
      const ft = e?.scores?.ft;
      if (!ft || typeof ft.home !== 'number' || typeof ft.away !== 'number') continue;
      const day = String(e.date || '').slice(0, 10);
      const k = day && matchKey(e.home ?? '', e.away ?? '', `${day}T00:00:00Z`);
      if (!k || known.has(k)) continue;
      known.add(k);
      outcomes.push({ matchKey: k, hg: ft.home, ag: ft.away, settledAt: new Date().toISOString() });
      oaiResolved++;
    }
  } catch (e) { console.log(`  ✗ odds-api.io: ${String(e?.message || e).slice(0, 50)}`); }
}

// Quaternary resolver: Highlightly (soccer.highlightly.net). Free tier,
// 950+ leagues — reaches the obscure leagues nothing else covers (Argentine
// lower divisions, etc.), returns finished scores as "H - A". Matched by
// matchKey. Free tier ~100/day, so only the 3 most recent unresolved days.
// Paid Highlightly (PRO = 7,500 req/day, ~$9.49/mo) removes the free-tier 100/day
// ceiling that forced the throttles below. Set HIGHLIGHTLY_PAID=1 (repo secret)
// after upgrading — SAME api key, only the plan changes — to run this EVERY pass
// with a wide backfill window; unset it and behavior is exactly the free-safe path.
const HL_PAID = env.HIGHLIGHTLY_PAID === '1';
const HL_KEY = (DEEP_SETTLE || HL_PAID) ? env.HIGHLIGHTLY_API_KEY : ''; // free: deep-pass only; paid: every pass
let hlResolved = 0;
if (HL_KEY) {
  const known = new Set(outcomes.map((o) => o.matchKey));
  const hlFinished = []; // every finished HL game this run {ht,at,hg,ag} — for the fuzzy pass
  const HL_DAYS = HL_PAID ? 21 : 4; // paid: backfill 3 weeks of stuck picks; free: 4 recent days
  const hlDates = [...new Set(
    history.filter((h) => isFinished(h) && !known.has(matchKey(h.homeTeam, h.awayTeam, h.kickoff))).map((h) => String(h.kickoff).slice(0, 10)),
  )].sort().slice(-HL_DAYS); // most recent PAST unresolved days (future excluded)
  // Highlightly caps at 100 matches/call but a busy day has 300+, so PAGINATE
  // (offset) up to the reported totalCount. Cap total calls per run: free stays
  // under ~100/day (8 × 12 runs = 96); paid 150 × 12 = 1800/day, far under 7,500,
  // and clears the backlog across a few runs (known-dedup accumulates coverage).
  let calls = 0; const MAX_CALLS = HL_PAID ? 150 : 8;
  // Iterate NEWEST FIRST so if MAX_CALLS runs out mid-loop, TODAY's fixtures
  // always get their pages fetched. Bug found 2026-09-05: the old ascending order
  // (Aug 12 → Sep 5) could exhaust the 150-call cap before reaching today,
  // leaving a fresh pick like "Antigua GFC vs Aurora" (state=Finished on HL, id
  // 1327241659) stuck in the "77 still not finished" bucket every run. Recent
  // days are priority — old backlog will still get chipped away in later runs.
  outer: for (const date of [...hlDates].reverse()) {
    for (let offset = 0; offset < 800; offset += 100) {
      if (calls >= MAX_CALLS) break outer;
      try {
        calls++;
        const res = await fetch(`https://soccer.highlightly.net/matches?date=${date}&limit=100&offset=${offset}`, {
          headers: { 'x-rapidapi-key': HL_KEY }, signal: AbortSignal.timeout(20000),
        });
        const j = await res.json();
        const arr = j?.data || (Array.isArray(j) ? j : []);
        for (const m of arr) {
          if (!/^Finished/.test(String(m?.state?.description || ''))) continue; // Finished / Finished after penalties
          const sc = String(m?.state?.score?.current || '').match(/(\d+)\s*-\s*(\d+)/);
          if (!sc) continue;
          const hg = Number(sc[1]), ag = Number(sc[2]);
          const day = String(m.date || date).slice(0, 10);
          // Keep every finished game for the fuzzy fallback below.
          hlFinished.push({ ht: nameTokens(m.homeTeam?.name ?? ''), at: nameTokens(m.awayTeam?.name ?? ''), hg, ag });
          const k = matchKey(m.homeTeam?.name ?? '', m.awayTeam?.name ?? '', `${day}T00:00:00Z`);
          if (!k || known.has(k)) continue;
          known.add(k);
          outcomes.push({ matchKey: k, hg, ag, settledAt: new Date().toISOString() });
          hlResolved++;
        }
        const total = j?.pagination?.totalCount ?? 0;
        if (!arr.length || offset + 100 >= total) break; // last page for this day
      } catch (e) { console.log(`  ✗ highlightly ${date}: ${String(e?.message || e).slice(0, 50)}`); break; }
    }
  }
  // FUZZY fallback: obscure-league picks whose exact matchKey missed Highlightly's
  // spelling ("Čelik" vs "Celik Zenica", "Nautico" vs "Nautico Recife"). Match each
  // still-unresolved finished pick to a UNIQUE finished HL game by significant-token
  // overlap on BOTH teams (orientation-agnostic); ambiguous → skipped, never guessed.
  // Recovers coverage we already pay for (PRO) that the exact join was discarding.
  let hlFuzzy = 0;
  for (const h of history) {
    if (!isFinished(h)) continue;
    const k = matchKey(h.homeTeam, h.awayTeam, h.kickoff);
    if (known.has(k)) continue;
    const ht = nameTokens(h.homeTeam), at = nameTokens(h.awayTeam);
    if (!ht.size || !at.size) continue;
    const cands = hlFinished.filter((m) =>
      (teamMatch(ht, m.ht) && teamMatch(at, m.at)) || (teamMatch(ht, m.at) && teamMatch(at, m.ht)));
    if (cands.length !== 1) continue; // unique match only
    const m = cands[0];
    const swapped = !(teamMatch(ht, m.ht) && teamMatch(at, m.at)); // pick-home aligns with HL-away → reverse
    known.add(k);
    outcomes.push({ matchKey: k, hg: swapped ? m.ag : m.hg, ag: swapped ? m.hg : m.ag, settledAt: new Date().toISOString(), via: 'highlightly-fuzzy' });
    hlResolved++; hlFuzzy++;
  }
  if (hlFuzzy) console.log(`  ✓ highlightly-fuzzy: ${hlFuzzy} settled by name-token match`);
}

// Sixth resolver: ESPN — genuinely PUBLIC, NO key, UNLIMITED (no per-day quota).
// Per-league scoreboards for the major leagues + continental cups. Complements
// Highlightly (which reaches tiny leagues but is quota-limited) by settling the
// big-league picks for free without touching that quota. Fully offline-safe: if
// the runner's IP is blocked (some sandboxes 403 it) it just resolves 0.
const ESPN_LEAGUES = [
  'eng.1', 'eng.2', 'eng.3', 'eng.4', 'esp.1', 'esp.2', 'ita.1', 'ita.2', 'ger.1', 'ger.2',
  'fra.1', 'fra.2', 'ned.1', 'ned.2', 'por.1', 'sco.1', 'sco.2', 'tur.1', 'bel.1', 'gre.1',
  'rus.1', 'ukr.1', 'aut.1', 'sui.1', 'den.1', 'nor.1', 'swe.1', 'pol.1', 'cro.1', 'rou.1',
  'srb.1', 'cze.1', 'hun.1', 'usa.1', 'mex.1', 'bra.1', 'bra.2', 'arg.1', 'chi.1', 'col.1',
  'uru.1', 'ecu.1', 'jpn.1', 'kor.1', 'aus.1', 'uefa.champions', 'uefa.europa', 'uefa.europa.conf',
  'conmebol.libertadores', 'conmebol.sudamericana', 'uefa.champions_qual', 'club.friendly',
];
let espnResolved = 0;
{
  const known = new Set(outcomes.map((o) => o.matchKey));
  const espnDates = [...new Set(
    history.filter((h) => isFinished(h) && !known.has(matchKey(h.homeTeam, h.awayTeam, h.kickoff))).map((h) => String(h.kickoff).slice(0, 10)),
  )].sort().slice(-4);
  let espnBlocked = false;
  for (const date of espnDates) {
    if (espnBlocked) break;
    const d = date.replace(/-/g, '');
    for (const lg of ESPN_LEAGUES) {
      try {
        const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${lg}/scoreboard?dates=${d}`, {
          headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' }, signal: AbortSignal.timeout(12000),
        });
        if (!/json/.test(res.headers.get('content-type') || '')) { espnBlocked = true; break; } // IP-blocked here -> stop
        const j = await res.json();
        for (const e of j.events || []) {
          const comp = e.competitions?.[0];
          if (!comp?.status?.type?.completed) continue;
          const home = comp.competitors?.find((c) => c.homeAway === 'home');
          const away = comp.competitors?.find((c) => c.homeAway === 'away');
          if (!home?.team?.displayName || !away?.team?.displayName) continue;
          const hg = Number(home.score), ag = Number(away.score);
          if (!Number.isFinite(hg) || !Number.isFinite(ag)) continue;
          const day = String(e.date || date).slice(0, 10);
          const k = matchKey(home.team.displayName, away.team.displayName, `${day}T00:00:00Z`);
          if (!k || known.has(k)) continue;
          known.add(k);
          outcomes.push({ matchKey: k, hg, ag, settledAt: new Date().toISOString() });
          espnResolved++;
        }
      } catch { /* skip this league/day */ }
    }
  }
}

// Fifth resolver: real WEB SEARCH — the only resolver for matches no sports API
// covers. Works with Brave Search OR Tavily, whichever key is present (Tavily's
// free tier needs no card). GROUNDED: it reads actual result snippets, not the
// model's memory, and records a score only when >=2 independent snippets AGREE
// (orientation-aware); anything ambiguous is left unsettled, never guessed.
// Capped per run + an attempt cache so a permanently-unfindable match can't
// drain the free quota. Outcomes tagged via:'web-<provider>'.
const BRAVE_KEY = env.BRAVE_SEARCH_API_KEY;
const usable = (k) => k && !k.startsWith('PASTE');
// TAVILY_API_KEY may be a comma-separated LIST of free-tier keys. We round-robin
// across them and fall over to the next when one errors/exhausts, so N keys give
// ~N x the free monthly quota (and WEB_LIMIT scales up to match).
const TAVILY_KEYS = String(env.TAVILY_API_KEY || '').split(',').map((s) => s.trim()).filter(usable);
const webProvider = usable(BRAVE_KEY) ? 'brave' : TAVILY_KEYS.length ? 'tavily' : null;
let tavilyIdx = 0;
// Return an array of text snippets (title + description/content) for a query.
async function webSearch(q) {
  if (webProvider === 'brave') {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=8`, {
      headers: { 'x-subscription-token': BRAVE_KEY, accept: 'application/json' }, signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    return (j.web?.results || []).flatMap((r) => [r.title, r.description].filter(Boolean));
  }
  // Tavily — rotate keys; a rate-limited/exhausted key just falls through to the
  // next one. Only throw once every key has failed for this query.
  let lastErr = 'no keys';
  for (let n = 0; n < TAVILY_KEYS.length; n++) {
    const key = TAVILY_KEYS[tavilyIdx++ % TAVILY_KEYS.length];
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: key, query: q, max_results: 8, search_depth: 'basic' }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
    const j = await res.json();
    const s = (j.results || []).flatMap((r) => [r.title, r.content].filter(Boolean));
    if (j.answer) s.push(j.answer);
    return s;
  }
  throw new Error(`all tavily keys failed (${lastErr})`);
}
let webResolved = 0;
if (webProvider) {
  const ATTEMPTS_FILE = path.join(ROOT, 'src', 'data', 'web-settle-attempts.json');
  // Never let a corrupt/half-written cache (e.g. leftover git merge markers)
  // crash the whole settlement pass — fall back to an empty cache instead.
  let attempts = {};
  if (fs.existsSync(ATTEMPTS_FILE)) {
    try { attempts = JSON.parse(fs.readFileSync(ATTEMPTS_FILE, 'utf8')); }
    catch (e) { console.log(`  ! web-settle-attempts.json unreadable (${String(e?.message || e).slice(0, 60)}) — using empty cache`); }
  }
  const known = new Set(outcomes.map((o) => o.matchKey));
  const NOWMS = Date.now();
  // Steady default ~3/run per Tavily key (each free key ~1k/mo, ~1080/mo at
  // 3/run). More keys -> higher cap automatically. Override via WEB_SETTLE_LIMIT
  // for a one-time backlog backfill (e.g. 400).
  const RETRY_MS = 7 * 86400000, MAX_TRIES = 3;
  const WEB_LIMIT = Number(process.env.WEB_SETTLE_LIMIT || env.WEB_SETTLE_LIMIT)
    || Math.max(3, (webProvider === 'tavily' ? TAVILY_KEYS.length : 1) * 3);
  const seen = new Set(), targets = [];
  for (const h of history) {
    const ko = Date.parse(h.kickoff);
    if (!Number.isFinite(ko) || ko > NOWMS) continue;                 // not played yet
    const mk = matchKey(h.homeTeam, h.awayTeam, h.kickoff);
    if (known.has(mk) || seen.has(mk)) continue;                      // already settled / deduped
    const a = attempts[mk];
    if (a) {
      // A RECENT match that returned nothing is usually "hasn't finished yet",
      // not "unfindable" — retry it every few hours and don't spend its try
      // budget, or a today-game searched before kickoff would be locked out for
      // days. Only matches older than 2 days get the long backoff + give-up cap.
      const recent = NOWMS - ko < 2 * 86400000;
      if (!recent && a.tries >= MAX_TRIES) continue;
      if (NOWMS - Date.parse(a.last) < (recent ? 3 * 3600 * 1000 : RETRY_MS)) continue;
    }
    seen.add(mk);
    targets.push({ mk, home: h.homeTeam, away: h.awayTeam, kickoff: h.kickoff });
  }
  targets.sort((x, y) => String(y.kickoff).localeCompare(String(x.kickoff))); // newest first
  for (const t of targets.slice(0, WEB_LIMIT)) {
    const q = `"${t.home}" vs "${t.away}" result ${String(t.kickoff).slice(0, 7)}`;
    try {
      const snippets = await webSearch(q);
      const r = webConsensus(t.home, t.away, snippets);
      attempts[t.mk] = { tries: (attempts[t.mk]?.tries || 0) + 1, last: new Date().toISOString() };
      if (r) {
        outcomes.push({ matchKey: t.mk, hg: r.hg, ag: r.ag, settledAt: new Date().toISOString(), via: `web-${webProvider}`, votes: r.votes });
        known.add(t.mk); webResolved++;
        console.log(`  🌐 ${t.home} ${r.hg}-${r.ag} ${t.away} (${webProvider}, ${r.votes} agreeing sources)`);
      }
      await new Promise((s) => setTimeout(s, 1200)); // stay under free-tier rate limits
    } catch (e) { console.log(`  ✗ web ${t.home} v ${t.away}: ${String(e?.message || e).slice(0, 50)}`); }
  }
  fs.writeFileSync(ATTEMPTS_FILE, JSON.stringify(attempts, null, 2) + '\n');
}

fs.writeFileSync(OUTCOMES_FILE, JSON.stringify(outcomes, null, 2) + '\n');
console.log(`\nResolved ${resolved} api-football + ${fdResolved} football-data + ${oaiResolved} odds-api.io + ${hlResolved} highlightly + ${espnResolved} espn + ${webResolved} web-search. ${stillLive} still not finished. Total outcomes: ${outcomes.length}.`);
