// -------------------------------------------------------------------------
// audit-sources.ts — per-source WIN% + ROI from OUR OWN settled database.
//
// Joins every historical pick (src/data/real-history.json) to its real result
// (src/data/real-outcomes.json, by matchKey) and settles it with the site's own
// settle() — the SAME logic the live results use. Then ranks each source by ROI
// on its PRICED picks (the only honest measure — advertised win-rate claims are
// marketing; only money settled counts). Use it to decide which sources to keep,
// down-weight, or drop.
//
//   npx tsx scripts/audit-sources.ts                # full table
//   npx tsx scripts/audit-sources.ts --min=15       # only sources with >=15 priced settled
//   npx tsx scripts/audit-sources.ts --by=tipster   # group by source:tipster (finer)
//
// ROI = profit / staked on picks that carry a real `odds` (flat 1u). Odds capped
// at 15 to kill corrupt scraper fields. Sources with no priced picks are shown
// separately as ROI-BLIND (can't be judged on money — win% only).
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchKey, settle, canonicalSelection } from '../src/lib/aggregation/normalize.js';
import type { MarketGroup } from '../src/lib/aggregation/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const MIN = Number(args.find((a) => a.startsWith('--min='))?.split('=')[1]) || 10;
const byTipster = args.includes('--by=tipster');

const readJson = (f: string): any[] => { try { const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', f), 'utf8')); return Array.isArray(p) ? p : []; } catch { return []; } };

const history = readJson('real-history.json');
const outcomes = readJson('real-outcomes.json');
// matchKey -> {hg, ag}
const outByKey = new Map<string, { hg: number; ag: number }>();
for (const o of outcomes) if (o?.matchKey && Number.isFinite(o.hg) && Number.isFinite(o.ag)) outByKey.set(o.matchKey, { hg: o.hg, ag: o.ag });

interface Row { n: number; won: number; lost: number; pricedN: number; pricedWon: number; staked: number; returned: number; }
const table = new Map<string, Row>();
const bump = (key: string): Row => { let r = table.get(key); if (!r) table.set(key, (r = { n: 0, won: 0, lost: 0, pricedN: 0, pricedWon: 0, staked: 0, returned: 0 })); return r; };

let joined = 0;
for (const t of history) {
  if (!t?.homeTeam || !t?.awayTeam || !t?.kickoff || !t?.market || !t?.selection) continue;
  const sport = t.sport ?? 'football';
  if (sport !== 'football') continue; // outcomes are football goals only
  const mk = matchKey(t.homeTeam, t.awayTeam, t.kickoff, sport);
  const out = outByKey.get(mk);
  if (!out) continue;
  const sel = canonicalSelection(t.market as MarketGroup, t.selection, t.homeTeam, t.awayTeam);
  const res = settle(t.market as MarketGroup, sel, out.hg, out.ag, t.line);
  if (res !== 'won' && res !== 'lost') continue; // skip void/unknown
  joined++;
  const key = byTipster ? `${t.source}:${t.tipster}` : String(t.source);
  const r = bump(key);
  r.n++;
  if (res === 'won') r.won++; else r.lost++;
  const odds = typeof t.odds === 'number' && t.odds > 1.01 && t.odds <= 15 ? t.odds : null;
  if (odds) {
    r.pricedN++; r.staked += 1; if (res === 'won') { r.pricedWon++; r.returned += odds; }
  }
}

const rows = [...table.entries()].map(([src, r]) => ({
  src,
  n: r.n,
  win: r.n ? (r.won / r.n) * 100 : 0,
  pricedN: r.pricedN,
  roi: r.staked ? ((r.returned - r.staked) / r.staked) * 100 : null,
  profit: r.staked ? r.returned - r.staked : null,
}));

const priced = rows.filter((r) => r.roi !== null && r.pricedN >= MIN).sort((a, b) => (b.roi! - a.roi!));
const blind = rows.filter((r) => (r.roi === null || r.pricedN < MIN) && r.n >= MIN).sort((a, b) => b.win - a.win);

const pct = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`;
console.log(`\nJoined ${joined} settled picks from ${history.length} history × ${outByKey.size} outcomes. Grouped by ${byTipster ? 'source:tipster' : 'source'}, min ${MIN} priced.\n`);
console.log(`=== RANKED BY ROI (priced picks, n>=${MIN}) — the money-honest ranking ===`);
console.log('  ' + 'source'.padEnd(byTipster ? 42 : 26) + 'pricedN  win%    ROI      profit');
for (const r of priced) {
  console.log('  ' + r.src.padEnd(byTipster ? 42 : 26) + String(r.pricedN).padStart(6) + '  ' + r.win.toFixed(0).padStart(3) + '%  ' + pct(r.roi!).padStart(8) + '  ' + (r.profit! >= 0 ? '+' : '') + r.profit!.toFixed(1) + 'u');
}
console.log(`\n=== ROI-BLIND (few/no priced picks — win% only, can't judge on money) ===`);
for (const r of blind) console.log('  ' + r.src.padEnd(byTipster ? 42 : 26) + `n=${r.n}  win=${r.win.toFixed(0)}%`);

// Verdicts
const losers = priced.filter((r) => r.roi! < -8 && r.pricedN >= 15);
const winners = priced.filter((r) => r.roi! > 8 && r.pricedN >= 15);
console.log(`\n=== VERDICT ===`);
console.log(`  KEEP (ROI > +8%, n>=15): ${winners.map((r) => `${r.src} ${pct(r.roi!)}`).join(' | ') || '—'}`);
console.log(`  DROP CANDIDATES (ROI < -8%, n>=15): ${losers.map((r) => `${r.src} ${pct(r.roi!)}`).join(' | ') || '—'}`);
