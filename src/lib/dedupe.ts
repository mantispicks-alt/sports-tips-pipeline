// One tip per real match. The same fixture can reach the site more than once —
// under multiple markets (1X2 + Double Chance + O/U) or slightly different
// spellings — because generated files are never deleted. Collapse them to a
// single card, keeping the strongest pick, so a match never shows twice.
import type { CollectionEntry } from 'astro:content';

// Most distinctive token of a team name, accent-folded, 5-char capped. Parentheticals
// ("(Bookings)", "(Corners)") are stripped FIRST — otherwise that market word becomes
// the "longest token" and every bookings match collapses into one (Andorra vs Ceuta
// merged with Oviedo vs Granada). Generic club words are dropped so the real name wins.
const CLUB_WORDS = new Set(['fc', 'cf', 'sc', 'afc', 'ac', 'cd', 'ca', 'fk', 'kf', 'sk', 'nk', 'hnk', 'rcd', 'sv', 'if', 'bk', 'ss', 'us', 'as', 'kv', 'kvc', 'vfl', 'vfb', 'bsc', 'ff', 'gif', 'aik', 'ik', 'club', 'real', 'deportivo', 'sd', 'ud', 'cd']);
function distinctToken(name: string): string {
  const cleaned = String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' '); // drop "(Bookings)" etc.
  const toks = cleaned.split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !CLUB_WORDS.has(t));
  toks.sort((a, b) => b.length - a.length);
  return (toks[0] ?? cleaned.replace(/[^a-z0-9]+/g, '') ?? name.toLowerCase()).slice(0, 5);
}

// Lower rank = preferred when confidence ties. 1X2/Moneyline is the headline
// market; keep it over a Double Chance / totals pick on the same match.
const MARKET_RANK: Record<string, number> = {
  'Match Result': 0, Moneyline: 0, 'Double Chance': 1,
  'Both Teams to Score': 2, 'Total Goals': 3, 'Total Points': 3, 'Point Spread': 4,
};

function keyFor(t: CollectionEntry<'tips'>): string {
  const [home, away] = t.data.match.split(/\s+vs\s+/i);
  // Same fixture written differently ("Viborg FF" vs "Viborg", "AGF Aarhus" vs
  // "Aarhus", "FC Brügge" vs "Club Brugge", "Newcastle United" vs "Newcastle")
  // must collapse to one card — the strict matchKey and the club-word list both
  // missed these. Key on each team's most-distinctive token + the day. A team
  // plays once per day, so the opponent token keeps different fixtures apart.
  const day = new Date(t.data.kickoff).toISOString().slice(0, 10);
  const pair = [distinctToken(home ?? t.data.match), distinctToken(away ?? '')].sort();
  return `${t.data.sport}|${day}|${pair[0]}|${pair[1]}`;
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
