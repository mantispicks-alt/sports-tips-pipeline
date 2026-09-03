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
import { matchKey, settle, canonicalizePick } from '../src/lib/aggregation/normalize.js';
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

const validOdds = (o: any): number | null => (typeof o === 'number' && o > 1.01 && o <= 15 ? o : null);
const median = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Cross-source odds backfill: many sources (soccerpunter, adibet …) never archive
// their own `odds`, so ROI can't be judged on their picks. But OTHER sources
// usually quoted a price on the SAME match+market+selection. Build a map of every
// quoted price per exact pick, so a source that quoted nothing can be judged at
// the market price a follower would actually have gotten (the median across
// sources that did quote it). Keyed identically to settle() — matchKey|market|
// canonical selection.
const oddsMap = new Map<string, number[]>();
for (const t of history) {
  const o = validOdds(t?.odds);
  if (!o || !t?.homeTeam || !t?.awayTeam || !t?.kickoff || !t?.market || !t?.selection) continue;
  if ((t.sport ?? 'football') !== 'football') continue;
  const c = canonicalizePick(t.market as MarketGroup, t.selection, t.homeTeam, t.awayTeam, t.line);
  if (!c) continue;
  const k = `${matchKey(t.homeTeam, t.awayTeam, t.kickoff, 'football')}|${c.market}|${c.selection}`;
  (oddsMap.get(k) ?? oddsMap.set(k, []).get(k)!).push(o);
}

interface Row { n: number; won: number; lost: number; pricedN: number; pricedWon: number; staked: number; returned: number; backfilledN: number; }
const table = new Map<string, Row>();
const bump = (key: string): Row => { let r = table.get(key); if (!r) table.set(key, (r = { n: 0, won: 0, lost: 0, pricedN: 0, pricedWon: 0, staked: 0, returned: 0, backfilledN: 0 })); return r; };

let joined = 0;
for (const t of history) {
  if (!t?.homeTeam || !t?.awayTeam || !t?.kickoff || !t?.market || !t?.selection) continue;
  const sport = t.sport ?? 'football';
  if (sport !== 'football') continue; // outcomes are football goals only
  const mk = matchKey(t.homeTeam, t.awayTeam, t.kickoff, sport);
  const out = outByKey.get(mk);
  if (!out) continue;
  const c = canonicalizePick(t.market as MarketGroup, t.selection, t.homeTeam, t.awayTeam, t.line);
  if (!c) continue; // unreadable / unsupported market → not settled here either
  const res = settle(c.market, c.selection, out.hg, out.ag, c.line);
  if (res !== 'won' && res !== 'lost') continue; // skip void/unknown
  joined++;
  const key = byTipster ? `${t.source}:${t.tipster}` : String(t.source);
  const r = bump(key);
  r.n++;
  if (res === 'won') r.won++; else r.lost++;
  // ROI odds: the source's own quote if it archived one, else the cross-source
  // market median for this exact pick (so no-odds sources still get judged).
  const own = validOdds(t.odds);
  let eff = own;
  if (!eff) { const arr = oddsMap.get(`${mk}|${c.market}|${c.selection}`); if (arr && arr.length) eff = median(arr); }
  if (eff) {
    r.pricedN++; r.staked += 1; if (res === 'won') { r.pricedWon++; r.returned += eff; }
    if (!own) r.backfilledN++;
  }
}

const rows = [...table.entries()].map(([src, r]) => ({
  src,
  n: r.n,
  win: r.n ? (r.won / r.n) * 100 : 0,
  pricedN: r.pricedN,
  backfilledN: r.backfilledN,
  roi: r.staked ? ((r.returned - r.staked) / r.staked) * 100 : null,
  profit: r.staked ? r.returned - r.staked : null,
}));

const priced = rows.filter((r) => r.roi !== null && r.pricedN >= MIN).sort((a, b) => (b.roi! - a.roi!));
const blind = rows.filter((r) => (r.roi === null || r.pricedN < MIN) && r.n >= MIN).sort((a, b) => b.win - a.win);

const pct = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`;
console.log(`\nJoined ${joined} settled picks from ${history.length} history × ${outByKey.size} outcomes. Grouped by ${byTipster ? 'source:tipster' : 'source'}, min ${MIN} priced.\n`);
console.log(`=== RANKED BY ROI (priced picks, n>=${MIN}) — the money-honest ranking ===`);
console.log(`  (ROI uses each source's own odds; * = mostly cross-source market odds, the source didn't archive its own)`);
console.log('  ' + 'source'.padEnd(byTipster ? 42 : 26) + 'pricedN  win%    ROI      profit');
for (const r of priced) {
  const star = r.backfilledN > r.pricedN / 2 ? ' *' : '';
  console.log('  ' + r.src.padEnd(byTipster ? 42 : 26) + String(r.pricedN).padStart(6) + '  ' + r.win.toFixed(0).padStart(3) + '%  ' + pct(r.roi!).padStart(8) + '  ' + (r.profit! >= 0 ? '+' : '') + r.profit!.toFixed(1) + 'u' + star);
}
console.log(`\n=== ROI-BLIND (few/no priced picks — win% only, can't judge on money) ===`);
for (const r of blind) console.log('  ' + r.src.padEnd(byTipster ? 42 : 26) + `n=${r.n}  win=${r.win.toFixed(0)}%`);

// Verdicts
const losers = priced.filter((r) => r.roi! < -8 && r.pricedN >= 15);
const winners = priced.filter((r) => r.roi! > 8 && r.pricedN >= 15);
console.log(`\n=== VERDICT ===`);
console.log(`  KEEP (ROI > +8%, n>=15): ${winners.map((r) => `${r.src} ${pct(r.roi!)}`).join(' | ') || '—'}`);
console.log(`  DROP CANDIDATES (ROI < -8%, n>=15): ${losers.map((r) => `${r.src} ${pct(r.roi!)}`).join(' | ') || '—'}`);
