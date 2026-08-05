// -------------------------------------------------------------------------
// ingest-oddsapi.mjs — The Odds API → implied-favorite picks (⚽ 1X2 / 🏀 ML)
// A 2nd independent SIGNAL: the bookmaker-consensus favorite per match.
// Reads THE_ODDS_API_KEY from .env. Writes scratch/ingest-oddsapi.json.
//   node scripts/ingest-oddsapi.mjs
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const KEY = env.THE_ODDS_API_KEY || '';
if (!KEY) { console.error('No THE_ODDS_API_KEY in .env'); process.exit(1); }

const date = new Date().toISOString().slice(0, 10);
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(fc|cf|afc|sc|ac|club|cd|ss|as)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '-');

const MAX_SPORTS = Number(process.argv[2] || '12');

// 1. list sports (free, no credit cost) → active soccer_* / basketball_*
const sres = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${KEY}`);
if (!sres.ok) { console.error(`sports HTTP ${sres.status}: ${(await sres.text()).slice(0, 200)}`); process.exit(1); }
const sports = await sres.json();
const wanted = sports
  .filter((s) => s.active && (s.key.startsWith('soccer_') || s.key.startsWith('basketball_')))
  .map((s) => s.key);
console.log(`Active soccer/basket sports: ${wanted.length} → using ${Math.min(wanted.length, MAX_SPORTS)}`);

const fixtures = [];
const tips = [];
for (const sk of wanted.slice(0, MAX_SPORTS)) {
  const r = await fetch(`https://api.the-odds-api.com/v4/sports/${sk}/odds/?apiKey=${KEY}&regions=eu&markets=h2h&oddsFormat=decimal`);
  if (!r.ok) { console.log(`  ${sk}: HTTP ${r.status}`); continue; }
  const events = await r.json();
  const isBk = sk.startsWith('basketball_');
  let n = 0;
  for (const e of events) {
    const agg = new Map();
    for (const bk of e.bookmakers || []) {
      const h2h = (bk.markets || []).find((m) => m.key === 'h2h');
      if (!h2h) continue;
      for (const o of h2h.outcomes || []) { const a = agg.get(o.name) || []; a.push(o.price); agg.set(o.name, a); }
    }
    if (!agg.size) continue;
    let fav = null;
    for (const [name, prices] of agg) { const avg = prices.reduce((s, x) => s + x, 0) / prices.length; if (!fav || avg < fav.avg) fav = { name, avg }; }
    const sport = isBk ? 'basketball' : 'football';
    const market = isBk ? 'ML' : '1X2';
    const selection = fav.name === e.home_team ? 'home' : fav.name === e.away_team ? 'away' : 'draw';
    const id = `oddsapi:${e.id}`;
    fixtures.push({ id, provider: 'the-odds-api', sport, league: e.sport_title || sk,
      home: e.home_team, away: e.away_team, homeSlug: slug(e.home_team), awaySlug: slug(e.away_team),
      kickoff: e.commence_time, status: 'NS', finished: false, homeScore: null, awayScore: null });
    tips.push({ source: 'the-odds-api', tipster: 'odds-favorite', fixtureId: id, sport,
      home: e.home_team, away: e.away_team, league: e.sport_title || sk, kickoff: e.commence_time,
      market, selection, odds: Math.round(fav.avg * 100) / 100 });
    n++;
  }
  console.log(`  ${sk}: ${events.length} events → ${n} picks`);
}
fs.mkdirSync(path.join(ROOT, 'scratch'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'scratch', 'ingest-oddsapi.json'), JSON.stringify({ date, fixtures, tips }, null, 2));
console.log(`Wrote scratch/ingest-oddsapi.json: ${fixtures.length} fixtures, ${tips.length} favorite-picks (⚽ + 🏀).`);
