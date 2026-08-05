import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const today = new Date().toISOString().slice(0, 10);
const trunc = (s, n = 700) => String(s).replace(/\s+/g, ' ').slice(0, n);

// 1. odds-api.io: events -> first upcoming id -> /odds
try {
  const ev = await (await fetch(`https://api.odds-api.io/v3/events?sport=football&apiKey=${env.ODDS_API_IO_KEY}`)).json();
  const up = (Array.isArray(ev) ? ev : []).find((e) => e.status !== 'settled') || ev?.[0];
  console.log(`\n### odds-api.io first event: id=${up?.id} ${up?.home} vs ${up?.away} status=${up?.status}`);
  if (up?.id) {
    const od = await fetch(`https://api.odds-api.io/v3/odds?eventId=${up.id}&apiKey=${env.ODDS_API_IO_KEY}`);
    console.log(`odds HTTP ${od.status}: ${trunc(await od.text(), 900)}`);
  }
} catch (e) { console.log('oddsapiio ERR', String(e?.message || e).slice(0, 60)); }

// 2. thestatsapi matches
try {
  const r = await fetch(`https://api.thestatsapi.com/api/football/matches?date=${today}`, { headers: { Authorization: `Bearer ${env.THESTATSAPI_KEY}` } });
  console.log(`\n### thestatsapi /football/matches HTTP ${r.status}: ${trunc(await r.text())}`);
} catch (e) { console.log('thestatsapi ERR', String(e?.message || e).slice(0, 60)); }

// 3. oddspapi tournaments (need ids for odds-by-tournaments)
try {
  const r = await fetch(`https://api.oddspapi.io/v4/tournaments?apiKey=${env.ODDSPAPI_KEY}&sportId=1`);
  console.log(`\n### oddspapi /v4/tournaments HTTP ${r.status}: ${trunc(await r.text())}`);
} catch (e) { console.log('oddspapi ERR', String(e?.message || e).slice(0, 60)); }
console.log('\n--- done ---');
