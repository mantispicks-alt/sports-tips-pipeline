// One tip per real match. The same fixture can reach the site more than once —
// under multiple markets (1X2 + Double Chance + O/U) or slightly different
// spellings — because generated files are never deleted. Collapse them to a
// single card, keeping the strongest pick, so a match never shows twice.
import { matchKey } from './aggregation/normalize';
import type { CollectionEntry } from 'astro:content';

// Lower rank = preferred when confidence ties. 1X2/Moneyline is the headline
// market; keep it over a Double Chance / totals pick on the same match.
const MARKET_RANK: Record<string, number> = {
  'Match Result': 0, Moneyline: 0, 'Double Chance': 1,
  'Both Teams to Score': 2, 'Total Goals': 3, 'Total Points': 3, 'Point Spread': 4,
};

function keyFor(t: CollectionEntry<'tips'>): string {
  const [home, away] = t.data.match.split(/\s+vs\s+/i);
  return matchKey(home ?? t.data.match, away ?? '', new Date(t.data.kickoff).toISOString(), t.data.sport);
}

function isBetter(a: CollectionEntry<'tips'>, b: CollectionEntry<'tips'>): boolean {
  const aSettled = a.data.result === 'won' || a.data.result === 'lost';
  const bSettled = b.data.result === 'won' || b.data.result === 'lost';
  if (aSettled !== bSettled) return aSettled;            // a real result beats an unsettled dupe
  if (a.data.featured !== b.data.featured) return a.data.featured; // the free/showcase pick wins
  if (a.data.confidence !== b.data.confidence) return a.data.confidence > b.data.confidence;
  return (MARKET_RANK[a.data.market] ?? 9) < (MARKET_RANK[b.data.market] ?? 9);
}

export function dedupeByMatch(tips: CollectionEntry<'tips'>[]): CollectionEntry<'tips'>[] {
  const best = new Map<string, CollectionEntry<'tips'>>();
  for (const t of tips) {
    const k = keyFor(t);
    const cur = best.get(k);
    if (!cur || isBetter(t, cur)) best.set(k, t);
  }
  return [...best.values()];
}
