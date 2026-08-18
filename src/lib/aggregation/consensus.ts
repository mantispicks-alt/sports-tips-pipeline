// -------------------------------------------------------------------------
// Consensus builder + confidence scoring + backtest.
//
// For each fixture we group every tipster's pick by market, take the most
// strongly backed selection, and score confidence from three signals:
//   quality   - average rating of the tipsters backing it
//   agreement - share of tipsters on the match who agree
//   depth     - how many back it
// A pick is "verified" only when quality + agreement + depth clear the bar.
// -------------------------------------------------------------------------
import type { RawTip, ConsensusPick, Backer, MarketGroup, Backtest, Sport } from './types';
import { matchKey, consensusGroupKey, marketLabel } from './normalize';

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

// Proven earners — sources whose picks, as backers of PUBLISHED consensus picks,
// win a lot AND turn a real profit over a decent sample (audit-sources.ts):
// prosoccer 79%/+76%, kcpredict 74%/+75%, legitpredict 86%/+52%, zulubet 60%/+36%.
// A pick they back gets a confidence nudge so it ranks higher (featured/published
// more). The rating already weights them; this is an extra, tunable priority on top.
// Re-audit before trusting — small samples can regress; zulubet (n≈280) is the solid one.
const PROVEN_EARNERS = new Set(['site:prosoccer', 'web:kcpredict', 'web:legitpredict', 'site:zulubet']);
const PROVEN_BONUS = 6;

interface Agg {
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoff: string;
  sport: Sport;
  markets: Map<MarketGroup, Map<string, Backer[]>>;
  tipsterSet: Set<string>;
}

export function buildConsensus(tips: RawTip[], ratingOf: Map<string, number>): ConsensusPick[] {
  const matches = new Map<string, Agg>();

  for (const t of tips) {
    const sport: Sport = t.sport ?? 'football';
    // Group with the LOOSE key so spelling variants of the same fixture merge and
    // cross-check together; the pick keeps a RAW matchKey (below) for best-odds
    // and settlement lookups.
    const mk = consensusGroupKey(t.homeTeam, t.awayTeam, t.kickoff, sport);
    let agg = matches.get(mk);
    if (!agg) {
      agg = {
        homeTeam: t.homeTeam,
        awayTeam: t.awayTeam,
        league: t.league,
        kickoff: t.kickoff,
        sport,
        markets: new Map(),
        tipsterSet: new Set(),
      };
      matches.set(mk, agg);
    }
    agg.tipsterSet.add(`${t.source}:${t.tipster}`);

    let sels = agg.markets.get(t.market);
    if (!sels) {
      sels = new Map();
      agg.markets.set(t.market, sels);
    }
    let backers = sels.get(t.selection);
    if (!backers) {
      backers = [];
      sels.set(t.selection, backers);
    }
    backers.push({
      tipster: t.tipster,
      source: t.source,
      rating: ratingOf.get(`${t.source}:${t.tipster}`) ?? 50,
      odds: t.odds,
      line: t.line,
      dateVerified: t.dateVerified,
    });
  }

  const picks: ConsensusPick[] = [];
  for (const [mk, agg] of matches) {
    const totalOnMatch = agg.tipsterSet.size;

    for (const [market, sels] of agg.markets) {
      // most strongly backed selection (by summed rating)
      let best: { selection: string; backers: Backer[]; weight: number } | null = null;
      for (const [selection, backers] of sels) {
        const weight = backers.reduce((s, b) => s + b.rating, 0);
        if (!best || weight > best.weight) best = { selection, backers, weight };
      }
      if (!best) continue;

      // Dedupe by distinct source:tipster — a source that emitted the same pick
      // twice (duplicate in its snapshot) must NOT count as two backers, or a
      // solo source could be wrongly promoted to a multi-source "consensus".
      const seenBacker = new Set<string>();
      const backers = [...best.backers]
        .sort((a, b) => b.rating - a.rating)
        .filter((b) => { const k = `${b.source}:${b.tipster}`; if (seenBacker.has(k)) return false; seenBacker.add(k); return true; });
      const backerCount = backers.length;
      const avgRating = backers.reduce((s, b) => s + b.rating, 0) / backerCount;
      const oddsList = backers.map((b) => b.odds).filter((o): o is number => typeof o === 'number');
      const avgOdds = oddsList.length ? oddsList.reduce((s, o) => s + o, 0) / oddsList.length : 0;
      const consensusPct = totalOnMatch ? (backerCount / totalOnMatch) * 100 : 0;

      const quality = avgRating; // 0-100
      const agreement = clamp(consensusPct); // 0-100
      const depth = clamp(backerCount * 20); // 5+ backers -> 100
      // Extra priority when a PROVEN earner backs this pick (win+profit over sample).
      const provenBonus = backers.some((b) => PROVEN_EARNERS.has(b.source)) ? PROVEN_BONUS : 0;
      const confidence = Math.round(clamp(0.45 * quality + 0.25 * agreement + 0.3 * depth + provenBonus));

      const verified =
        confidence >= 64 && backerCount >= 3 && avgRating >= 58 && consensusPct >= 45;

      // Favorite vs value. The market favorite = the selection with the shortest
      // average odds. If the crowd's pick IS the favorite it's "chalk" (obvious,
      // little betting edge — often just agrees with the bookmaker). If it ISN'T
      // the favorite yet the crowd backs it, that contrarian agreement may carry
      // real value — the signal worth publishing. valueEdge = how far the crowd
      // rates it above the odds-implied probability.
      let favSelection: string | null = null;
      let favOdds = Infinity;
      for (const [selection, bks] of sels) {
        const os = bks.map((b) => b.odds).filter((o): o is number => typeof o === 'number');
        if (!os.length) continue;
        const a = os.reduce((s, o) => s + o, 0) / os.length;
        if (a < favOdds) { favOdds = a; favSelection = selection; }
      }
      const isFavorite = favSelection != null && favSelection === best.selection;
      const valueEdge = avgOdds > 0 ? Math.round(consensusPct - (1 / avgOdds) * 100) : 0;
      // Undefined dateVerified (mock/api-football sources that don't set the field) defaults
      // to trusted; only an EXPLICIT false (site/telegram fixture-match miss) counts against it.
      const dateVerified = backers.every((b) => b.dateVerified !== false);

      picks.push({
        matchKey: matchKey(agg.homeTeam, agg.awayTeam, agg.kickoff, agg.sport),
        homeTeam: agg.homeTeam,
        awayTeam: agg.awayTeam,
        league: agg.league,
        kickoff: agg.kickoff,
        sport: agg.sport,
        market,
        selection: best.selection,
        line: backers[0]?.line,
        label: marketLabel(market, best.selection, agg.homeTeam, agg.awayTeam, backers[0]?.line),
        backers,
        backerCount,
        consensusPct: Math.round(consensusPct),
        avgRating: Math.round(avgRating),
        avgOdds: Math.round(avgOdds * 100) / 100,
        confidence,
        verified,
        dateVerified,
        isFavorite,
        valueEdge,
      });
    }
  }

  return picks;
}

/** Historical performance of the verified picks — the "proof it works". */
export function computeBacktest(picks: ConsensusPick[]): Backtest {
  const settled = picks.filter((p) => p.result === 'won' || p.result === 'lost');
  let won = 0;
  let staked = 0;
  let returned = 0;
  for (const p of settled) {
    staked++;
    if (p.result === 'won') {
      won++;
      returned += p.avgOdds || 1.9;
    }
  }
  const profit = returned - staked;
  return {
    picks: settled.length,
    won,
    lost: settled.length - won,
    winRate: settled.length ? Math.round((won / settled.length) * 1000) / 10 : 0,
    roi: staked ? Math.round((profit / staked) * 1000) / 10 : 0,
    profit: Math.round(profit * 100) / 100,
  };
}
