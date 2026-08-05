import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
// use an upcoming fixture id we saw earlier
const fid = process.argv[2] || '1565205';
const r = await fetch(`https://v3.football.api-sports.io/predictions?fixture=${fid}`, { headers: { 'x-apisports-key': env.API_SPORTS_KEY } });
const j = await r.json();
const p = j?.response?.[0];
console.log('advice:', p?.predictions?.advice);
console.log('percent:', JSON.stringify(p?.predictions?.percent));
const gh = p?.teams?.home?.league?.goals;
const ga = p?.teams?.away?.league?.goals;
console.log('HOME goals.for.avg:', JSON.stringify(gh?.for?.average), 'against.avg:', JSON.stringify(gh?.against?.average));
console.log('AWAY goals.for.avg:', JSON.stringify(ga?.for?.average), 'against.avg:', JSON.stringify(ga?.against?.average));
