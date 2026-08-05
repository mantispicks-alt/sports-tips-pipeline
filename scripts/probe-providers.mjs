// -------------------------------------------------------------------------
// probe-providers.mjs — hit each provider's best-guess endpoint with its key
// from .env and print HTTP status + a truncated sample response, so we can map
// the real shape. No writes. Read-only diagnostics.
//   node scripts/probe-providers.mjs
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const today = new Date().toISOString().slice(0, 10);

const probes = [
  { id: 'bzzoiro', url: `https://sports.bzzoiro.com/api/events/`, headers: { Authorization: `Token ${env.BZZOIRO_API_KEY || ''}` } },
  { id: 'foresportia', url: `https://api.foresportia.com/v1/matches/today`, headers: { 'X-API-Key': env.FORESPORTIA_API_KEY || '' } },
  { id: 'oddspapi', url: `https://api.oddspapi.io/v4/odds-by-tournaments?apiKey=${env.ODDSPAPI_KEY}&sportId=1`, headers: {} },
  { id: 'oddsapiio-events', url: `https://api.odds-api.io/v3/events?sport=football&apiKey=${env.ODDS_API_IO_KEY}`, headers: {} },
];

for (const p of probes) {
  try {
    const r = await fetch(p.url, { headers: p.headers, signal: AbortSignal.timeout(12000) });
    const body = (await r.text()).replace(/\s+/g, ' ').slice(0, 1100);
    console.log(`\n### ${p.id}  →  HTTP ${r.status}`);
    console.log(body || '(empty)');
  } catch (e) {
    console.log(`\n### ${p.id}  →  ERROR ${String(e?.name || e).slice(0, 40)}`);
  }
}
console.log('\n--- done ---');
