import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const T = (s, n = 500) => String(s).replace(/\s+/g, ' ').slice(0, n);

// === Odds-API.io: bookmakers list -> odds for an upcoming event ===
try {
  const bms = await (await fetch(`https://api.odds-api.io/v3/bookmakers?apiKey=${env.ODDS_API_IO_KEY}`)).json();
  const list = Array.isArray(bms) ? bms : bms.data || bms.bookmakers || [];
  const slug = typeof list[0] === 'string' ? list[0] : (list[0]?.slug || list[0]?.key || list[0]?.id);
  console.log(`\n### oddsapiio bookmakers: n=${list.length} first=${JSON.stringify(list[0])}`);
  const ev = await (await fetch(`https://api.odds-api.io/v3/events?sport=football&apiKey=${env.ODDS_API_IO_KEY}`)).json();
  const up = (Array.isArray(ev) ? ev : []).find((e) => !['settled', 'cancelled'].includes(e.status)) || ev?.[0];
  const od = await fetch(`https://api.odds-api.io/v3/odds?eventId=${up.id}&bookmakers=${slug}&apiKey=${env.ODDS_API_IO_KEY}`);
  console.log(`oddsapiio /odds (bm=${slug}) HTTP ${od.status}: ${T(await od.text(), 900)}`);
} catch (e) { console.log('oddsapiio ERR', String(e?.message || e).slice(0, 60)); }

// === OddsPapi: bookmakers -> odds-by-tournaments (tid=7 Champions League) ===
try {
  const bp = await fetch(`https://api.oddspapi.io/v4/bookmakers?apiKey=${env.ODDSPAPI_KEY}`);
  const bpTxt = await bp.text();
  console.log(`\n### oddspapi /v4/bookmakers HTTP ${bp.status}: ${T(bpTxt, 350)}`);
  let bm = '';
  try { const j = JSON.parse(bpTxt); const arr = Array.isArray(j) ? j : j.data || j.bookmakers || []; bm = arr[0]?.slug || arr[0]?.bookmakerSlug || arr[0]?.id || arr[0]; } catch {}
  const op = await fetch(`https://api.oddspapi.io/v4/odds-by-tournaments?apiKey=${env.ODDSPAPI_KEY}&tournamentIds=7&bookmaker=${bm}`);
  console.log(`oddspapi odds (tid=7, bm=${bm}) HTTP ${op.status}: ${T(await op.text(), 1100)}`);
} catch (e) { console.log('oddspapi ERR', String(e?.message || e).slice(0, 60)); }
console.log('\n--- done ---');
