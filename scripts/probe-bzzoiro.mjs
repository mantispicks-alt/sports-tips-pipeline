import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const r = await fetch('https://sports.bzzoiro.com/api/events/?limit=30', { headers: { Authorization: `Token ${env.BZZOIRO_API_KEY}` } });
const j = await r.json();
const results = j.results || [];
console.log(`events: ${results.length}`);
// pick an event that has odds or predictions populated
const ev = results.find((e) => e.odds_home != null) || results.find((e) => JSON.stringify(e).match(/predict|prob/i)) || results[0];
console.log('TOP-LEVEL KEYS:', Object.keys(ev || {}).join(', '));
// print any field whose name hints prediction/probability
for (const k of Object.keys(ev || {})) {
  if (/predict|prob|market|tip|forecast|model/i.test(k)) console.log(`  ${k} =`, JSON.stringify(ev[k]).slice(0, 400));
}
console.log('FULL (2500):', JSON.stringify(ev).slice(0, 2500));
