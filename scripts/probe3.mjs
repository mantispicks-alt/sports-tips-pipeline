import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const T = (s, n = 900) => String(s).replace(/\s+/g, ' ').slice(0, n);

// === OddsPapi (sportId=10 football): tournaments -> odds-by-tournaments ===
try {
  const t = await (await fetch(`https://api.oddspapi.io/v4/tournaments?apiKey=${env.ODDSPAPI_KEY}&sportId=10`)).json();
  const arr = Array.isArray(t) ? t : t.data || t.tournaments || t.results || [];
  console.log(`\n### oddspapi tournaments: count=${arr.length}  sample=${T(JSON.stringify(arr.slice(0, 2)), 400)}`);
  const tid = arr[0]?.id ?? arr[0]?.tournamentId;
  if (tid != null) {
    const o = await fetch(`https://api.oddspapi.io/v4/odds-by-tournaments?apiKey=${env.ODDSPAPI_KEY}&tournamentIds=${tid}`);
    console.log(`oddspapi odds(tid=${tid}) HTTP ${o.status}: ${T(await o.text(), 1100)}`);
  }
} catch (e) { console.log('oddspapi ERR', String(e?.message || e).slice(0, 60)); }

// === Odds-API.io: upcoming event -> /odds with bookmakers=all ===
try {
  const ev = await (await fetch(`https://api.odds-api.io/v3/events?sport=football&apiKey=${env.ODDS_API_IO_KEY}`)).json();
  const up = (Array.isArray(ev) ? ev : []).find((e) => !['settled', 'cancelled'].includes(e.status)) || ev?.[0];
  console.log(`\n### oddsapiio upcoming: id=${up?.id} ${up?.home} vs ${up?.away}`);
  for (const bm of ['all', 'bet365', 'pinnacle']) {
    const od = await fetch(`https://api.odds-api.io/v3/odds?eventId=${up.id}&bookmakers=${bm}&apiKey=${env.ODDS_API_IO_KEY}`);
    const body = T(await od.text(), 500);
    console.log(`  bookmakers=${bm} → HTTP ${od.status}: ${body}`);
    if (od.status === 200 && body.length > 20) break;
  }
} catch (e) { console.log('oddsapiio ERR', String(e?.message || e).slice(0, 60)); }

// === Foresportia openapi schemas (Match + Probabilities field names) ===
try {
  const spec = await (await fetch('https://api.foresportia.com/openapi.json')).json();
  const schemas = spec.components?.schemas || {};
  for (const name of Object.keys(schemas)) {
    if (/match|probab|fixture/i.test(name)) {
      const props = schemas[name].properties ? Object.keys(schemas[name].properties) : Object.keys(schemas[name]);
      console.log(`\n### foresportia schema ${name}: ${T(JSON.stringify(props), 300)}`);
    }
  }
} catch (e) { console.log('foresportia ERR', String(e?.message || e).slice(0, 60)); }
console.log('\n--- done ---');
