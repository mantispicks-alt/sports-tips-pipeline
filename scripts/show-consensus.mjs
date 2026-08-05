// -------------------------------------------------------------------------
// show-consensus.mjs — quick cross-check over all collected snapshots.
// Groups every pick by match+market+selection and shows where >=2 INDEPENDENT
// sources agree. No deploy, no D1 — just proves the cross-check on real data.
//   node scripts/show-consensus.mjs
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'src', 'data', 'tips');
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(fc|cf|afc|sc|ac|cd|ss|as|w|women|u21|u19)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '-');

const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.json')) : [];
const picks = [];
for (const f of files) {
  try {
    const arr = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    if (!Array.isArray(arr)) continue;
    for (const t of arr) {
      const home = t.homeTeam || t.home, away = t.awayTeam || t.away;
      if (home && away && t.market && t.selection) {
        picks.push({ source: t.source || f.replace('.json', ''), home, away, sport: t.sport || 'football', market: t.market, selection: String(t.selection).toLowerCase() });
      }
    }
  } catch { /* skip bad file */ }
}

const groups = new Map();
for (const p of picks) {
  const pair = [slug(p.home), slug(p.away)].sort();
  const key = `${p.sport}|${pair[0]}|${pair[1]}|${p.market}|${p.selection}`;
  const g = groups.get(key) || { home: p.home, away: p.away, market: p.market, selection: p.selection, sport: p.sport, sources: new Set() };
  g.sources.add(p.source);
  groups.set(key, g);
}
const consensus = [...groups.values()].filter((g) => g.sources.size >= 2).sort((a, b) => b.sources.size - a.sources.size);

console.log(`Snapshots: ${files.length}   Total picks: ${picks.length}   Distinct match+market+selection: ${groups.size}`);
console.log(`\n=== CONSENSUS: ${consensus.length} picks where >=2 sources AGREE ===\n`);
for (const c of consensus.slice(0, 25)) {
  const em = c.sport === 'basketball' ? '🏀' : '⚽';
  console.log(`  ${String(c.sources.size)}×  ${em} ${c.home} v ${c.away}  —  ${c.market} ${c.selection}`);
  console.log(`       [${[...c.sources].slice(0, 6).join(', ')}]`);
}
if (!consensus.length) console.log('  (no overlap yet — sources cover different matches)');
