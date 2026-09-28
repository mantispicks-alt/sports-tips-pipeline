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
import { matchKey, consensusGroupKey, marketLabel, canonicalTeamName } from './normalize';
import { sourceBlockedForLeague } from './tipsters';

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

// Proven earners — sources whose picks, as backers of PUBLISHED consensus picks,
// win a lot AND turn a real profit over a decent sample (audit-sources.ts):
// prosoccer 79%/+76%, kcpredict 74%/+75%, legitpredict 86%/+52%, zulubet 60%/+36%.
// A pick they back gets a confidence nudge so it ranks higher (featured/published
// more). The rating already weights them; this is an extra, tunable priority on top.
// Re-audit before trusting — small samples can regress; zulubet (n≈280) is the solid one.
const PROVEN_EARNERS = new Set(['site:prosoccer', 'web:kcpredict', 'web:legitpredict', 'site:zulubet']);
const PROVEN_BONUS = 6;

// Proven pair combos — sources whose CO-BACKING of the SAME pick correlates with
// a much higher win rate than either source individually (2026-09-12 audit on
// 211 settled picks). Each pair carries a confidence bonus on top of the
// per-source PROVEN_BONUS — so a pick backed by, e.g., pinnacle AND vitibet
// jumps to the front of the queue. Pairs (alphabetical, `a|b`) with observed
// win rate + minimum sample:
//   pinnacle|site:vitibet         80% (8-2, n=10)
//   site:vitibet|site:zulubet     73% (11-4, n=15)
//   bzzoiro|pinnacle              63% (25-15, n=40)
//   site:betexplorer|site:vitibet 64% (7-4, n=11)
//   bzzoiro|site:soccerpunter     64% (7-4, n=11)
//   site:betexplorer|site:zulubet 60% (6-4, n=10)
// Re-audit with scratchpad/source-agreement.mjs monthly; drop any pair whose
// sample stops confirming (win% drops below the individual win% of its members).
const PROVEN_PAIRS = new Set([
  'pinnacle|site:vitibet',
  'site:vitibet|site:zulubet',
  'bzzoiro|pinnacle',
  'site:betexplorer|site:vitibet',
  'bzzoiro|site:soccerpunter',
  'site:betexplorer|site:zulubet',
  // 2026-09-15 re-audit adds three more:
  //   site:mybets|site:zulubet          60% (6-4, n=10)   +5.0u
  //   pinnacle-steam|site:vitibet       80% (4-1, n=5)    +1.2u
  //   bzzoiro|site:vitibet              67% (4-2, n=6)    +0.5u
  // The mybets pair is the biggest sample and the biggest profit; the
  // pinnacle-steam pair mirrors the pinnacle+vitibet (78%) signal one level down.
  'site:mybets|site:zulubet',
  'pinnacle-steam|site:vitibet',
  'bzzoiro|site:vitibet',
]);
// PAIR_BONUS raised 8 -> 10 (2026-09-15). Settled data: pair-backed picks hit
// 67% win rate vs 46% non-pair (21pt gap), so the co-signal earns a bigger nudge.
const PAIR_BONUS = 10;

function pairKey(a: string, b: string): string { return a < b ? `${a}|${b}` : `${b}|${a}`; }
function hasProvenPair(backers: Backer[]): boolean {
  for (let i = 0; i < backers.length; i++)
    for (let j = i + 1; j < backers.length; j++)
      if (PROVEN_PAIRS.has(pairKey(backers[i].source, backers[j].source))) return true;
  return false;
}

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
    // Per-source LEAGUE block: sources with a proven-negative record in a bucket
    // lose their vote there (see SOURCE_LEAGUE_BLOCKS in tipsters.ts). Drop the
    // tip entirely — it must not count toward this fixture's backer roster or
    // consensus weight.
    if (sourceBlockedForLeague(t.source, t.league)) continue;
    const sport: Sport = t.sport ?? 'football';
    // Group with the LOOSE key so spelling variants of the same fixture merge and
    // cross-check together; the pick keeps a RAW matchKey (below) for best-odds
    // and settlement lookups.
    const mk = consensusGroupKey(t.homeTeam, t.awayTeam, t.kickoff, sport);
    let agg = matches.get(mk);
    if (!agg) {
      agg = {
        // Store the CANONICAL name (strips FC/SK/FK/NK/… prefixes) so the aggregate
        // is IDENTITY-STABLE across runs: without this, the aggregate's homeTeam is
        // whichever source happened to be scanned first, and later runs where a
        // source flipped its label from "Artis Brno" to "SK Artis Brno" changed the
        // downstream matchKey and made generate write a SECOND .md file for the
        // same match (bug found 2026-09-06).
        homeTeam: canonicalTeamName(t.homeTeam),
        awayTeam: canonicalTeamName(t.awayTeam),
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
      const avgOddsOf = (bks: Backer[]) => {
        // Median (not arithmetic mean) — one rogue tipster with fake-high odds
        // (e.g. Zulubet quoting Arsenal DC X2 @5.16 when the real market is
        // ~1.90) inflated the average badly and blew up the displayed ROI.
        // Median is outlier-resistant and no worse when the list is short.
        const os = bks.map((b) => b.odds).filter((o): o is number => typeof o === 'number').sort((a, b) => a - b);
        if (!os.length) return Infinity;
        const mid = Math.floor(os.length / 2);
        return os.length % 2 ? os[mid] : (os[mid - 1] + os[mid]) / 2;
      };
      // Market favorite = shortest average odds. Used for isFavorite AND to locate
      // the value side.
      let favSelection: string | null = null;
      let favOdds = Infinity;
      for (const [selection, bks] of sels) {
        const a = avgOddsOf(bks);
        if (a < favOdds) { favOdds = a; favSelection = selection; }
      }

      // Consensus = most strongly backed selection (by summed rating). Almost always
      // the favorite/low-odds pick.
      let best: { selection: string; backers: Backer[]; weight: number } | null = null;
      for (const [selection, backers] of sels) {
        const weight = backers.reduce((s, b) => s + b.rating, 0);
        if (!best || weight > best.weight) best = { selection, backers, weight };
      }
      if (!best) continue;

      // VALUE side: the highest-odds selection a source backs in the value/high band
      // (≥ 2.60). The consensus rule above almost always emits the favorite, so the
      // value & high feeds would starve (0 candidates/day) without ALSO surfacing this
      // contrarian pick. Emit it as a SECOND candidate; the gate's per-feed top-N
      // ranking + daily cap decide whether it's good enough to publish. Bounded to
      // ≤ 7.50 so we don't surface lottery-ticket longshots.
      let valueAlt: string | null = null;
      let valueAltOdds = 0;
      for (const [selection, bks] of sels) {
        const a = avgOddsOf(bks);
        if (a >= 2.6 && a <= 7.5 && a > valueAltOdds) { valueAltOdds = a; valueAlt = selection; }
      }

      const emit = (selection: string, rawBackers: Backer[]) => {
        // Dedupe by distinct source:tipster — a source that emitted the same pick
        // twice must NOT count as two backers (a solo source wrongly promoted to a
        // multi-source "consensus").
        const seenBacker = new Set<string>();
        const backers = [...rawBackers]
          .sort((a, b) => b.rating - a.rating)
          .filter((b) => { const k = `${b.source}:${b.tipster}`; if (seenBacker.has(k)) return false; seenBacker.add(k); return true; });
        const backerCount = backers.length;
        if (!backerCount) return;
        const avgRating = backers.reduce((s, b) => s + b.rating, 0) / backerCount;
        const oddsList = backers.map((b) => b.odds).filter((o): o is number => typeof o === 'number').sort((a, b) => a - b);
        // Median odds — same outlier-resistance rationale as avgOddsOf above.
        // Displayed odds drive band routing, ROI, CLV; a single wrong tipster
        // quote must not flip a real 1.90 pick into a fake 5.16 pick.
        const avgOdds = !oddsList.length ? 0 : (oddsList.length % 2
          ? oddsList[Math.floor(oddsList.length / 2)]
          : (oddsList[oddsList.length / 2 - 1] + oddsList[oddsList.length / 2]) / 2);
        const consensusPct = totalOnMatch ? (backerCount / totalOnMatch) * 100 : 0;
        const quality = avgRating; // 0-100
        const agreement = clamp(consensusPct); // 0-100
        const depth = clamp(backerCount * 20); // 5+ backers -> 100
        const provenBonus = backers.some((b) => PROVEN_EARNERS.has(b.source)) ? PROVEN_BONUS : 0;
        // Proven-pair bonus stacks on top of the per-source proven-earner bonus.
        // Two members of a validated agreement pair backing the same pick is a
        // stronger signal than either backing it alone (see PROVEN_PAIRS notes).
        const pairBonus = hasProvenPair(backers) ? PAIR_BONUS : 0;
        const confidence = Math.round(clamp(0.45 * quality + 0.25 * agreement + 0.3 * depth + provenBonus + pairBonus));
        // A proven pair lets the pick verify with 2 backers instead of the usual
        // 3, since the pair itself has been validated as a reliable co-signal —
        // matches the "featured" behavior on the site for these strong combos.
        const verified = (confidence >= 64 && backerCount >= 3 && avgRating >= 58 && consensusPct >= 45)
          || (pairBonus > 0 && backerCount >= 2 && avgRating >= 55);
        const isFavorite = favSelection != null && favSelection === selection;
        const valueEdge = avgOdds > 0 ? Math.round(consensusPct - (1 / avgOdds) * 100) : 0;
        // Undefined dateVerified defaults to trusted; only an EXPLICIT false counts against it.
        const dateVerified = backers.every((b) => b.dateVerified !== false);
        picks.push({
          matchKey: matchKey(agg.homeTeam, agg.awayTeam, agg.kickoff, agg.sport),
          homeTeam: agg.homeTeam,
          awayTeam: agg.awayTeam,
          league: agg.league,
          kickoff: agg.kickoff,
          sport: agg.sport,
          market,
          selection,
          line: backers[0]?.line,
          label: marketLabel(market, selection, agg.homeTeam, agg.awayTeam, backers[0]?.line),
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
      };

      emit(best.selection, best.backers);
      if (valueAlt && valueAlt !== best.selection) emit(valueAlt, sels.get(valueAlt)!);
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
