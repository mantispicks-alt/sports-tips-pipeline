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
fs.writeFileSync(OUTCOMES_FILE, JSON.stringify(outcomes, null, 2) + '\n');
console.log(`\nResolved ${resolved} new outcomes. ${stillLive} fixtures still not finished. Total outcomes on file: ${outcomes.length}.`);
