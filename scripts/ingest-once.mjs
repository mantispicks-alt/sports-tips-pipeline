// -------------------------------------------------------------------------
// ingest-once.mjs — one-off API-Sports pull → scratch/ingest.json
//
// Football: fixtures + model predictions (tips).
// Basketball: games (fixtures + results only — api-sports basket has no
//             /predictions endpoint; basket tips come from odds/telegram later).
// Same API_SPORTS_KEY, different hosts. Reads key from .env (never printed).
//   node scripts/ingest-once.mjs           (10 football predictions)
//   node scripts/ingest-once.mjs 20
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const KEY = env.API_SPORTS_KEY || env.API_FOOTBALL_KEY || '';
if (!KEY) { console.error('No API_SPORTS_KEY in .env — add:  API_SPORTS_KEY=your_key'); process.exit(1); }

const H = { 'x-apisports-key': KEY };
const N = Number(process.argv[2] || '10');
const date = new Date().toISOString().slice(0, 10);
const FB_HOST = 'v3.football.api-sports.io';
const BK_HOST = 'v1.basketball.api-sports.io';
const FB_FIN = new Set(['FT', 'AET', 'PEN']);
const BK_FIN = new Set(['FT', 'AOT']);
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(fc|cf|afc|sc|ac|club|cd|ss|as)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '-');

function parseAdvice(raw) {
  const s = (raw || '').toLowerCase();
  if (/both teams.*no|\bng\b/.test(s)) return ['BTTS', 'no'];
  if (/both teams|btts|\bgg\b/.test(s)) return ['BTTS', 'yes'];
  if (/under\s*2\.?5/.test(s)) return ['OU25', 'under'];
  if (/over\s*2\.?5/.test(s)) return ['OU25', 'over'];
  if (/\bdraw\b/.test(s)) return ['1X2', 'draw'];
  if (/\(away\)|away team|win.*away/.test(s)) return ['1X2', 'away'];
  if (/\(home\)|home team|win.*home|winner/.test(s)) return ['1X2', 'home'];
  return null;
}

// --- Football fixtures ----------------------------------------------------
const fr = await fetch(`https://${FB_HOST}/fixtures?date=${date}`, { headers: H });
if (!fr.ok) { console.error(`Football fixtures HTTP ${fr.status} — check key/plan.`); process.exit(1); }
const fall = (await fr.json()).response || [];
console.log(`Key OK. Football fixtures today: ${fall.length}`);
const footballFixtures = [];
for (const r of fall.slice(0, 80)) {
  if (!r.fixture?.id || !r.teams?.home?.name || !r.teams?.away?.name) continue;
  const short = r.fixture?.status?.short ?? 'NS';
  const fin = FB_FIN.has(short) && typeof r.goals?.home === 'number' && typeof r.goals?.away === 'number';
  footballFixtures.push({
    id: `apisports:fb:${r.fixture.id}`, apiId: r.fixture.id, provider: 'api-sports', sport: 'football',
    league: r.league?.name ?? 'Unknown', home: r.teams.home.name, away: r.teams.away.name,
    homeSlug: slug(r.teams.home.name), awaySlug: slug(r.teams.away.name),
    kickoff: r.fixture?.date ?? `${date}T00:00:00Z`, status: short,
    finished: fin, homeScore: fin ? r.goals.home : null, awayScore: fin ? r.goals.away : null,
  });
}

// --- Football predictions -> tips ----------------------------------------
const upcoming = footballFixtures.filter((f) => !f.finished).slice(0, N);
const tips = [];
for (const f of upcoming) {
  try {
    const p = await (await fetch(`https://${FB_HOST}/predictions?fixture=${f.apiId}`, { headers: H })).json();
    const m = parseAdvice(p.response?.[0]?.predictions?.advice);
    if (m) tips.push({ source: 'api-sports', tipster: 'api-sports-model', fixtureId: f.id, sport: 'football',
      home: f.home, away: f.away, league: f.league, kickoff: f.kickoff, market: m[0], selection: m[1] });
  } catch { /* skip */ }
}

// --- Basketball games (fixtures + results only) --------------------------
const basketFixtures = [];
try {
  const br = await fetch(`https://${BK_HOST}/games?date=${date}`, { headers: H });
  if (br.ok) {
    const ball = (await br.json()).response || [];
    console.log(`Basketball games today: ${ball.length}`);
    for (const g of ball.slice(0, 60)) {
      if (!g.id || !g.teams?.home?.name || !g.teams?.away?.name) continue;
      const short = g.status?.short ?? 'NS';
      const fin = BK_FIN.has(short) && typeof g.scores?.home?.total === 'number' && typeof g.scores?.away?.total === 'number';
      basketFixtures.push({
        id: `apisports:bk:${g.id}`, apiId: g.id, provider: 'api-sports', sport: 'basketball',
        league: g.league?.name ?? 'Unknown', home: g.teams.home.name, away: g.teams.away.name,
        homeSlug: slug(g.teams.home.name), awaySlug: slug(g.teams.away.name),
        kickoff: g.date ?? `${date}T00:00:00Z`, status: short,
        finished: fin, homeScore: fin ? g.scores.home.total : null, awayScore: fin ? g.scores.away.total : null,
      });
    }
  } else {
    console.log(`Basketball games HTTP ${br.status} — if 403, subscribe to API-Basketball on the api-sports dashboard (same key, free).`);
  }
} catch (e) { console.log(`Basketball skipped: ${String(e?.message || e).slice(0, 50)}`); }

const fixtures = [...footballFixtures, ...basketFixtures];
fs.mkdirSync(path.join(ROOT, 'scratch'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'scratch', 'ingest.json'), JSON.stringify({ date, fixtures, tips }, null, 2));
console.log(`Wrote scratch/ingest.json: ${fixtures.length} fixtures (${footballFixtures.length} fb + ${basketFixtures.length} bk), ${tips.length} football model tips.`);
