import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const T = (s, n = 750) => String(s).replace(/\s+/g, ' ').slice(0, n);

// Odds-API.io with real bookmaker NAME
try {
  const ev = await (await fetch(`https://api.odds-api.io/v3/events?sport=football&apiKey=${env.ODDS_API_IO_KEY}`)).json();
  const up = (Array.isArray(ev) ? ev : []).find((e) => !['settled', 'cancelled'].includes(e.status)) || ev?.[0];
  console.log(`\n### oddsapiio event ${up?.id} ${up?.home} vs ${up?.away}`);
  for (const bm of ['Bet365', 'Pinnacle', '1xBet', '10BET']) {
    const od = await fetch(`https://api.odds-api.io/v3/odds?eventId=${up.id}&bookmakers=${encodeURIComponent(bm)}&apiKey=${env.ODDS_API_IO_KEY}`);
    const body = T(await od.text());
    console.log(`  bm=${bm} → ${od.status}: ${body}`);
    if (od.status === 200 && body.length > 25) break;
  }
} catch (e) { console.log('oddsapiio ERR', String(e?.message || e).slice(0, 60)); }

// OddsPapi: pick a tournament WITH fixtures, try major bookmakers
try {
  const tj = await (await fetch(`https://api.oddspapi.io/v4/tournaments?apiKey=${env.ODDSPAPI_KEY}&sportId=10`)).json();
  const tarr = Array.isArray(tj) ? tj : tj.data || [];
  const wf = tarr.find((t) => (t.upcomingFixtures || 0) > 0) || tarr.find((t) => (t.liveFixtures || 0) > 0) || tarr[1];
  console.log(`\n### oddspapi tournament ${wf?.tournamentId} ${wf?.tournamentName} upcoming=${wf?.upcomingFixtures}`);
  for (const bm of ['bet365', '1xbet', 'pinnacle', 'williamhill']) {
    const op = await fetch(`https://api.oddspapi.io/v4/odds-by-tournaments?apiKey=${env.ODDSPAPI_KEY}&tournamentIds=${wf.tournamentId}&bookmaker=${bm}`);
    const body = T(await op.text());
    console.log(`  bm=${bm} → ${op.status}: ${body}`);
    if (op.status === 200 && body.length > 25) break;
  }
} catch (e) { console.log('oddspapi ERR', String(e?.message || e).slice(0, 60)); }
console.log('\n--- done ---');
