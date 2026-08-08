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

// --- phase 1: archive ------------------------------------------------------
const history = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) : [];
const archivedKeys = new Set(history.map((h) => `${h.fixtureId}:${h.market}:${h.selection}:${h.source}:${h.tipster}`));

const files = fs.readdirSync(TIPS_DIR).filter((f) => f.endsWith('.json'));
let newlyArchived = 0;
for (const file of files) {
  let arr;
  try { arr = JSON.parse(fs.readFileSync(path.join(TIPS_DIR, file), 'utf8')); } catch { continue; }
  if (!Array.isArray(arr)) continue;
  for (const t of arr) {
    if (!t.dateVerified || !t.fixtureId) continue;
    const k = `${t.fixtureId}:${t.market}:${t.selection}:${t.source}:${t.tipster}`;
    if (archivedKeys.has(k)) continue;
    archivedKeys.add(k);
    history.push({ ...t }); // dateVerified:true already set, no result yet — settled in phase 2
    newlyArchived++;
  }
}
if (newlyArchived) fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2) + '\n');
console.log(`Archived ${newlyArchived} new dateVerified picks (history total: ${history.length}).`);

// --- phase 2: resolve outcomes for fixtures that have finished -------------
const outcomes = fs.existsSync(OUTCOMES_FILE) ? JSON.parse(fs.readFileSync(OUTCOMES_FILE, 'utf8')) : [];
const knownMatchKeys = new Set(outcomes.map((o) => o.matchKey));
const unresolved = [...new Map(history
  .filter((h) => !knownMatchKeys.has(matchKey(h.homeTeam, h.awayTeam, h.kickoff)))
  .map((h) => [h.fixtureId, h])).values()]; // unique fixtureIds only

console.log(`Fixtures awaiting a result: ${unresolved.length}`);
if (!unresolved.length) { console.log('Nothing to resolve.'); process.exit(0); }

// Free api-football plans REJECT the `ids=` multi-fetch parameter
// ("Free plans do not have access to the Ids parameter") — the old batch call
// silently returned nothing, so nothing ever settled. Resolve by DATE instead:
// one request per distinct kickoff day returns every fixture (final score +
// status) for that day; we look ours up by id. Works on the free plan and is
// far fewer calls than one-per-fixture.
const dates = [...new Set(unresolved.map((h) => String(h.kickoff).slice(0, 10)))];
const fixtureResults = new Map();
for (const date of dates) {
  try {
    const res = await fetch(`https://v3.football.api-sports.io/fixtures?date=${date}`, {
      headers: { 'x-apisports-key': KEY }, signal: AbortSignal.timeout(20000),
    });
    const json = await res.json();
    if (json.errors && !Array.isArray(json.errors) && Object.keys(json.errors).length) {
      console.log(`  ✗ ${date}: ${JSON.stringify(json.errors).slice(0, 90)}`);
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
  const stillUnresolved = history.filter((h) => !known.has(matchKey(h.homeTeam, h.awayTeam, h.kickoff)));
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
const OAI_KEY = env.ODDS_API_IO_KEY;
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
const HL_KEY = env.HIGHLIGHTLY_API_KEY;
let hlResolved = 0;
if (HL_KEY) {
  const known = new Set(outcomes.map((o) => o.matchKey));
  const hlDates = [...new Set(
    history.filter((h) => !known.has(matchKey(h.homeTeam, h.awayTeam, h.kickoff))).map((h) => String(h.kickoff).slice(0, 10)),
  )].sort().slice(-3);
  for (const date of hlDates) {
    try {
      const res = await fetch(`https://soccer.highlightly.net/matches?date=${date}&limit=100`, {
        headers: { 'x-rapidapi-key': HL_KEY }, signal: AbortSignal.timeout(20000),
      });
      const j = await res.json();
      const arr = j?.data || (Array.isArray(j) ? j : []);
      for (const m of arr) {
        if (m?.state?.description !== 'Finished') continue;
        const sc = String(m?.state?.score?.current || '').match(/(\d+)\s*-\s*(\d+)/);
        if (!sc) continue;
        const day = String(m.date || date).slice(0, 10);
        const k = matchKey(m.homeTeam?.name ?? '', m.awayTeam?.name ?? '', `${day}T00:00:00Z`);
        if (!k || known.has(k)) continue;
        known.add(k);
        outcomes.push({ matchKey: k, hg: Number(sc[1]), ag: Number(sc[2]), settledAt: new Date().toISOString() });
        hlResolved++;
      }
    } catch (e) { console.log(`  ✗ highlightly ${date}: ${String(e?.message || e).slice(0, 50)}`); }
  }
}

fs.writeFileSync(OUTCOMES_FILE, JSON.stringify(outcomes, null, 2) + '\n');
console.log(`\nResolved ${resolved} api-football + ${fdResolved} football-data + ${oaiResolved} odds-api.io + ${hlResolved} highlightly. ${stillLive} still not finished. Total outcomes: ${outcomes.length}.`);
