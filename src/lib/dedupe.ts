// One tip per real match. The same fixture reaches the site many times — under
// several markets (1X2 + DC + O/U + BTTS), under different spellings ("Viborg FF"
// vs "Viborg", "BK Häcken" vs "Hacken", "Qarabağ FK" vs "Qarabag"), with home/away
// SWAPPED between sources ("Deportes Recoleta vs Deportes Temuco" vs "Deportes
// Temuco vs Recoleta"), and even on a ±1-day-different reported date — because
// generated files are never deleted. A fixed slug/stopword key can't catch all of
// that, so we FUZZY-CLUSTER instead: two picks are the same fixture when their team
// name-token SETS match (subset or Jaccard ≥ ½, order-independent) and their dates
// are within a day. Collapse each cluster to its strongest pick.
import type { CollectionEntry } from 'astro:content';

// Pure club-TYPE words — safe to drop because they never distinguish two clubs.
// Deliberately NOT here: Real/Atletico/Deportivo/Sporting/Universidad/City/United/
// Racing/Nacional… — those DO distinguish (Real vs Atletico Madrid, Man Utd vs Man
// City), and the set-overlap test below handles them without stripping.
const TYPE_WORDS = new Set([
  'fc', 'cf', 'sc', 'afc', 'ac', 'fk', 'kf', 'sk', 'nk', 'hnk', 'rcd', 'sv', 'if',
  'bk', 'ss', 'us', 'kv', 'kvc', 'vfl', 'vfb', 'bsc', 'ff', 'gif', 'aik', 'ik',
  'club', 'cd', 'ca', 'ec', 'sd', 'ud', 'ad', 'jk', 'ks', 'ol', 'rc',
]);

function tokens(name: string): Set<string> {
  const cleaned = String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' '); // drop "(Bookings)"/"(Corners)" market words
  const out = new Set<string>();
  for (const t of cleaned.split(/[^a-z0-9]+/)) {
    if (t.length >= 3 && !TYPE_WORDS.has(t)) out.add(t);
  }
  // fall back to any 3+ token if stripping left nothing (e.g. a name that IS a type word)
  if (out.size === 0) for (const t of cleaned.split(/[^a-z0-9]+/)) if (t.length >= 3) out.add(t);
  return out;
}
// Two tokens match when equal or one is a prefix of the other (≥4 chars) — so
// "halmstads"/"halmstad" and "reykjavik"/"reykjavík" (already accent-folded) count
// as the same, without merging unrelated short words.
const tokMatch = (x: string, y: string): boolean =>
  x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x)));
function teamMatch(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false;
  const A = [...a], B = [...b];
  let inter = 0;
  for (const x of A) if (B.some((y) => tokMatch(x, y))) inter++;
  if (inter === 0) return false;
  if (inter === A.length || inter === B.length) return true; // one side fully covered = subset
  return inter / (A.length + B.length - inter) >= 0.5; // Jaccard
}

interface Node { home: Set<string>; away: Set<string>; day: number; }
function sameFixture(x: Node, y: Node): boolean {
  if (Math.abs(x.day - y.day) > 1) return false; // within a day (covers date disagreements)
  return (
    (teamMatch(x.home, y.home) && teamMatch(x.away, y.away)) ||
    (teamMatch(x.home, y.away) && teamMatch(x.away, y.home)) // home/away swapped
  );
}

// Lower rank = preferred when confidence ties. 1X2/Moneyline is the headline market.
const MARKET_RANK: Record<string, number> = {
  'Match Result': 0, Moneyline: 0, 'Double Chance': 1,
  'Both Teams to Score': 2, 'Total Goals': 3, 'Total Points': 3, 'Point Spread': 4,
};
function isBetter(a: CollectionEntry<'tips'>, b: CollectionEntry<'tips'>): boolean {
  const aSettled = a.data.result === 'won' || a.data.result === 'lost';
  const bSettled = b.data.result === 'won' || b.data.result === 'lost';
  if (aSettled !== bSettled) return aSettled;            // a real result beats an unsettled dupe
  if (a.data.featured !== b.data.featured) return a.data.featured; // the free/showcase pick wins
  if (a.data.confidence !== b.data.confidence) return a.data.confidence > b.data.confidence;
  return (MARKET_RANK[a.data.market] ?? 9) < (MARKET_RANK[b.data.market] ?? 9);
}

export function dedupeByMatch(tips: CollectionEntry<'tips'>[]): CollectionEntry<'tips'>[] {
  const nodes: Node[] = tips.map((t) => {
    const [home, away] = t.data.match.split(/\s+vs\s+/i);
    return {
      home: tokens(home ?? t.data.match),
      away: tokens(away ?? ''),
      day: Math.floor(new Date(t.data.kickoff).getTime() / 86_400_000),
    };
  });
  // Union-find over fixtures. Bucket by day (±1) so we never do the full O(n²).
  const parent = tips.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (i: number, j: number) => { const a = find(i), b = find(j); if (a !== b) parent[a] = b; };
  const byDay = new Map<number, number[]>();
  nodes.forEach((n, i) => { for (const d of [n.day - 1, n.day, n.day + 1]) (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(i); });
  const checked = new Set<string>();
  nodes.forEach((n, i) => {
    for (const j of byDay.get(n.day) ?? []) {
      if (j <= i) continue;
      const pk = `${i}:${j}`; if (checked.has(pk)) continue; checked.add(pk);
      if (sameFixture(n, nodes[j])) union(i, j);
    }
  });
  const best = new Map<number, number>(); // root -> index of best pick
  tips.forEach((t, i) => {
    const r = find(i);
    const cur = best.get(r);
    if (cur === undefined || isBetter(t, tips[cur])) best.set(r, i);
  });
  return [...best.values()].map((i) => tips[i]);
}
