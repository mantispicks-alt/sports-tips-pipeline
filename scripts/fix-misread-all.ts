// ---------------------------------------------------------------------------
// fix-misread-all — re-read EVERY already-published pick through the new
// canonicalizePick() and correct any that the OLD extractor mis-bucketed (not
// only the Double-Chance ones). Relabels to the real market + re-settles from the
// recorded final score. Frozen past picks aren't regenerated, so they need this.
// DRY by default; --write applies.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { canonicalizePick, marketLabel, settle, matchKey } from '../src/lib/aggregation/normalize.ts';
import type { MarketGroup } from '../src/lib/aggregation/types.ts';

const ROOT = process.cwd();
const TIPS = path.join(ROOT, 'src', 'content', 'tips');
const WRITE = process.argv.includes('--write');

const MARKET_NAME: Record<string, string> = {
  '1X2': 'Match Result', OU25: 'Total Goals', BTTS: 'Both Teams to Score',
  DC: 'Double Chance', DNB: 'Draw No Bet',
};
const CODE: Record<string, MarketGroup> = {
  'match result': '1X2', 'total goals': 'OU25', 'both teams to score': 'BTTS',
  'double chance': 'DC', 'draw no bet': 'DNB', moneyline: 'ML', prediction: 'OTHER',
};

const outs = new Map<string, { hg: number; ag: number }>();
try {
  const ro = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'real-outcomes.json'), 'utf8'));
  const arr = Array.isArray(ro) ? ro : (ro.outcomes ?? Object.values(ro));
  for (const o of arr) if (o?.matchKey) outs.set(o.matchKey, { hg: +o.hg, ag: +o.ag });
} catch {}

// Recover a raw selection token from a published label so canonicalizePick can
// re-read it. The label already carries the meaning; strip the market words.
function selFromLabel(pick: string, marketName: string): string {
  let s = pick;
  if (/total goals/i.test(marketName)) return s.replace(/goals?/i, '').trim(); // "Over 2.5"
  return s
    .replace(/double chance/i, '')
    .replace(/\(draw no bet\)/i, ' dnb')
    .replace(/\bwin\b/i, '')
    .replace(/both teams to score/i, 'yes')
    .replace(/btts\s*-\s*no/i, 'no')
    .trim();
}

let scanned = 0, changed = 0, resettled = 0, dropped = 0;
const rows: string[] = [];
for (const f of fs.readdirSync(TIPS)) {
  if (!f.endsWith('.md')) continue;
  const p = path.join(TIPS, f);
  const orig = fs.readFileSync(p, 'utf8');
  const nl = orig.includes('\r\n') ? '\r\n' : '\n';
  const t = orig.replace(/\r\n/g, '\n');
  const fm = t.match(/^---\n([\s\S]*?)\n---/); if (!fm) continue;
  const g = (k: string) => (fm[1].match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1] ?? '').trim().replace(/^"|"$/g, '');
  if ((g('sport') || 'football') !== 'football') continue;
  const marketName = g('market'); const pick = g('pick');
  const [home, away] = g('match').split(/\s+vs\s+/i);
  if (!home || !away || !pick) continue;
  scanned++;

  const code = CODE[marketName.toLowerCase()] ?? 'OTHER';
  const lineNow = parseFloat(g('line')) || undefined;
  const c = canonicalizePick(code, selFromLabel(pick, marketName), home, away, lineNow);
  if (!c) { dropped++; rows.push(`DROP  "${pick}" [${marketName}] | ${home} v ${away} [${f}]`); continue; }

  const newPick = marketLabel(c.market, c.selection, home, away, c.line);
  const newMarket = MARKET_NAME[c.market] ?? marketName;
  if (newPick === pick && newMarket === marketName) continue; // already correct

  let newResult = g('result');
  const o = outs.get(matchKey(home, away, g('kickoff')));
  if (o && Number.isFinite(o.hg) && ['won', 'lost', 'void'].includes(newResult)) {
    newResult = settle(c.market, c.selection, o.hg, o.ag, c.line); resettled++;
  }
  changed++;
  rows.push(`FIX   "${pick}" -> "${newPick}"  [${marketName}->${newMarket}]  ${g('result')}->${newResult} | ${home} v ${away}`);
  if (WRITE) {
    const out = t
      .replace(/^market:\s*.*$/m, `market: ${JSON.stringify(newMarket)}`)
      .replace(/^pick:\s*.*$/m, `pick: ${JSON.stringify(newPick)}`)
      .replace(/^result:\s*.*$/m, `result: ${newResult}`);
    fs.writeFileSync(p, out.replace(/\n/g, nl));
  }
}
console.log(`scanned ${scanned}, would-change ${changed}, re-settled ${resettled}, unreadable(drop-worthy) ${dropped}, mode ${WRITE ? 'WRITE' : 'DRY'}`);
rows.slice(0, 60).forEach((x) => console.log('  ' + x));
if (rows.length > 60) console.log(`  … +${rows.length - 60} more`);
