// -------------------------------------------------------------------------
// Unified value ("high-odds") feed for /value and the homepage Sharp-value
// section.
//
// The licensed Pinnacle +EV engine (scripts/refresh-odds.mjs -> odds-value.json)
// depends on THE_ODDS_API_KEY, whose free tier (500/mo) runs out mid-month — when
// it does, odds-value.json freezes and the value feed starves down to a few stale
// picks, then empties. To keep the feed FREE and UNLIMITED, we merge in the value
// picks the 2h pipeline already produces for nothing: every PUBLISHED pick priced
// at >= 2.60 is vetted value, because the odds-band router (see tipsters.ts
// bandAllowed) only lets a >= 2.60 pick through when a PROVEN value source backs
// it. So the consensus board is a permanent, no-API value source.
//
// Order: real +EV picks (with a Pinnacle-anchored edge %) lead when fresh; the
// consensus value-band picks fill the rest so the feed is never empty.
// -------------------------------------------------------------------------

export type ValuePick = {
  kind: 'sharp' | 'consensus';
  league: string;
  homeTeam: string;
  awayTeam: string;
  pickLabel: string;
  odds: number;
  market?: string;
  edge?: number; // sharp only: best price vs Pinnacle fair, %
  fairProb?: number; // sharp only
  bookmaker?: string; // sharp only
  kickoff: string;
  kickoffDate: Date;
};

const teamsFromMatch = (m: string): [string, string] => {
  const parts = String(m ?? '').split(/\s+vs\.?\s+/i);
  return [(parts[0] ?? '').trim(), (parts[1] ?? '').trim()];
};

const keyOf = (h: string, a: string) => `${h}|${a}`.toLowerCase();

/**
 * Build the value feed from the licensed +EV file plus the free consensus board.
 * @param sharpRaw parsed odds-value.json array (may be stale/empty)
 * @param tips     content-collection tip entries (each with a `.data` frontmatter)
 */
export function buildValueFeed(opts: {
  sharpRaw: any[];
  tips: { data: any }[];
  limit: number;
  nowMs?: number;
  minOdds?: number;
}): ValuePick[] {
  const now = opts.nowMs ?? Date.now();
  const minOdds = opts.minOdds ?? 2.6;
  const seen = new Set<string>();
  const out: ValuePick[] = [];

  // 1) Licensed Pinnacle/Betfair +EV picks — upcoming only, best edge first.
  const sharp = (opts.sharpRaw ?? [])
    .filter((p) => p && Date.parse(p.kickoff) > now)
    .sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0));
  for (const p of sharp) {
    const k = keyOf(p.homeTeam, p.awayTeam);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      kind: 'sharp',
      league: p.league,
      homeTeam: p.homeTeam,
      awayTeam: p.awayTeam,
      pickLabel: p.selection === 'home' ? p.homeTeam : p.selection === 'away' ? p.awayTeam : 'Draw',
      odds: p.odds,
      market: p.market,
      edge: p.edge,
      fairProb: p.fairProb,
      bookmaker: p.bookmaker,
      kickoff: p.kickoff,
      kickoffDate: new Date(p.kickoff),
    });
  }

  // 2) Free, unlimited fallback: high-odds (>= minOdds) value-band picks the
  //    consensus already publishes. Highest odds first (biggest value on top).
  const consensus = (opts.tips ?? [])
    .map((t) => t.data)
    .filter((d) => d && d.result === 'pending' && +new Date(d.kickoff) > now && Number(d.odds) >= minOdds)
    .sort((a, b) => Number(b.odds) - Number(a.odds));
  for (const d of consensus) {
    const [homeTeam, awayTeam] = teamsFromMatch(d.match);
    if (!homeTeam || !awayTeam) continue;
    const k = keyOf(homeTeam, awayTeam);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      kind: 'consensus',
      league: d.league,
      homeTeam,
      awayTeam,
      pickLabel: d.pick,
      odds: Number(d.odds),
      market: d.market,
      kickoff: d.kickoff,
      kickoffDate: new Date(d.kickoff),
    });
  }

  return out.slice(0, opts.limit);
}
