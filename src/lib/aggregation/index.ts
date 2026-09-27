// -------------------------------------------------------------------------
// Pipeline orchestrator: ingest from every adapter -> score tipsters ->
// build consensus -> settle history -> filter to verified -> output.
// -------------------------------------------------------------------------
import type { PipelineOutput } from './types';
import { buildTipsterRecords } from './tipsters';
import { buildConsensus, computeBacktest } from './consensus';
import { settle, slugTeam } from './normalize';
import { mockSource } from './adapters/mock';
import { jsonImport } from './adapters/jsonImport';
import { telegramSource } from './adapters/telegram';
import { apiFootballSource } from './adapters/apiFootball';
import { rssSource } from './adapters/rss';
import { htmlSource } from './adapters/htmlSource';
import { rapidApiPredictionsSource } from './adapters/rapidApiPredictions';
import { llmExtractorSource } from './adapters/llmExtractor';
import { realOutcomes } from './adapters/realOutcomes';
import { buildOutcomeIndex, findOutcome } from './outcomeMatch';

// Set to true to bring back the synthetic demo dataset (illustrative backtest,
// example tipster leaderboard). Off = every number on the site is real,
// starting from zero until real picks actually settle.
const DEMO_DATA_ENABLED = false;

export async function runPipeline(): Promise<PipelineOutput> {
  const sources = new Set<string>();

  // --- Ingest -----------------------------------------------------------
  const { tips: mockTips, outcomes } = DEMO_DATA_ENABLED
    ? mockSource()
    : { tips: [] as ReturnType<typeof mockSource>['tips'], outcomes: new Map<string, { hg: number; ag: number }>() };
  const imported = jsonImport();
  const [telegramTips, apiTips, rssTips, htmlTips, rapidTips, llmTips] = await Promise.all([
    telegramSource(),
    apiFootballSource(),
    rssSource(),
    htmlSource(),
    rapidApiPredictionsSource(),
    llmExtractorSource(),
  ]);
  const all = [
    ...mockTips,
    ...imported,
    ...telegramTips,
    ...apiTips,
    ...rssTips,
    ...htmlTips,
    ...rapidTips,
    ...llmTips,
  ];
  all.forEach((t) => sources.add(t.source));

  // Merge REAL settled outcomes (scripts/settle-real.mjs) into the same
  // matchKey -> {hg,ag,via} map the demo/mock outcomes use, so real picks settle
  // through the identical code path below — no separate settlement logic.
  // `via` (resolver tag) is preserved so downstream can hold back high-odds
  // settlements from weak sources (HL fuzzy, web search) until a direct API
  // resolver corroborates. Demo/mock outcomes have no via and are treated as
  // trusted (they're the ground truth in the demo).
  const outcomesFull = new Map<string, { hg: number; ag: number; via?: string }>();
  for (const [mk, v] of outcomes) outcomesFull.set(mk, { hg: v.hg, ag: v.ag });
  for (const o of realOutcomes()) outcomesFull.set(o.matchKey, { hg: o.hg, ag: o.ag, via: o.via });
  // Fuzzy index so a pick settles even when its team names don't byte-match the
  // result source's (e.g. "Salzburg" vs "Red Bull Salzburg") — exact-first, then
  // a conservative same-day fuzzy match. Adds ~28% more settlements, all correct
  // in spot-checks, which matters now that api-football (the naming unifier) is down.
  const outIndex = buildOutcomeIndex([...outcomesFull.entries()].map(([matchKey, v]) => ({ matchKey, hg: v.hg, ag: v.ag, via: v.via })));

  // --- Train / test split (honest, out-of-sample validation) ------------
  // Ratings are learned on older history only; the backtest is run on newer
  // matches the ratings never saw. This avoids in-sample overfitting that
  // would inflate the numbers into scam territory.
  const settledTimes = all
    .filter((t) => t.result)
    .map((t) => +new Date(t.kickoff))
    .sort((a, b) => a - b);
  const cutoff = settledTimes.length ? settledTimes[Math.floor(settledTimes.length * 0.5)] : 0;

  const trainTips = all.filter((t) => t.result && +new Date(t.kickoff) <= cutoff);

  // --- Score tipsters (train only) --------------------------------------
  const tipsters = buildTipsterRecords(trainTips);
  const ratingOf = new Map(tipsters.map((t) => [t.key, t.rating]));

  // --- Consensus over all fixtures, settle where result is known --------
  const picks = buildConsensus(all, ratingOf);
  for (const p of picks) {
    // Never settle against an unconfirmed placeholder kickoff — we can't be
    // sure which real match it refers to, so it must stay 'pending'.
    const o = p.dateVerified ? findOutcome(p.homeTeam, p.awayTeam, p.kickoff, p.matchKey, outIndex) : undefined;
    // High-odds picks (avgOdds >= 3.5) settled ONLY via fuzzy / web-search have a
    // history of wrong scores: audit 2026-09-11 found HL fuzzy stored 1-1 for a
    // real 2-0 (Real Tomayapo, DC 12 @7.33 published LOST — actually WON) and 2-1
    // for a real 2-2 (Estrela vs Braga, DC X2 @5.09 published LOST — actually WON).
    // A weak-source score on a big pick is worse than leaving it pending: keep
    // pending until a direct API resolver (api-football / football-data / ESPN /
    // HL exact) corroborates the score. Void-sweep still clears it after 7 days.
    const weakSource = o?.via && /fuzzy|web-/.test(o.via);
    const highOdds = p.avgOdds >= 3.5;
    if (o && !(weakSource && highOdds)) {
      // Outcomes are stored in slug-ALPHABETICAL orientation (canonicalScore on
      // write): hg = first-slug team's goals, ag = second-slug's. settle()
      // expects hg = pick.homeTeam's goals, so we swap when the pick's home
      // slug sorts AFTER its away slug (e.g. 'TOTTENHAM vs ASTON VILLA' —
      // 'tottenham' > 'aston-villa', so hg/ag need swapping before settle).
      const sh = slugTeam(p.homeTeam), sa = slugTeam(p.awayTeam);
      const { hg, ag } = sh > sa ? { hg: o.ag, ag: o.hg } : { hg: o.hg, ag: o.ag };
      p.result = settle(p.market, p.selection, hg, ag, p.line);
    } else {
      p.result = 'pending';
    }
  }

  // dateVerified required here too — a high-confidence pick with an unconfirmed
  // (placeholder) kickoff must not be shown as a trustworthy upcoming pick.
  const verified = picks.filter((p) => p.verified && p.dateVerified);
  // Backtest ONLY on the out-of-sample test window.
  const backtest = computeBacktest(
    verified.filter((p) => p.result !== 'pending' && +new Date(p.kickoff) > cutoff),
  );
  const upcoming = verified
    .filter((p) => p.result === 'pending')
    .sort((a, b) => b.confidence - a.confidence);

  // Freshly ingested from real external sources (web:, site:, tg: prefixes —
  // real.mjs, refresh-sites.mjs, refresh-telegram.mjs), still pending /
  // unverified — shown so real data is visible before it settles.
  const REAL_PREFIXES = ['web:', 'site:', 'tg:'];
  const fresh = picks
    .filter((p) => p.result === 'pending' && p.backers.some((b) => REAL_PREFIXES.some((pre) => b.source.startsWith(pre))))
    .sort((a, b) => b.backerCount - a.backerCount)
    .slice(0, 15);

  // LIVE real track record: only picks backed exclusively by real sources,
  // cross-checked by 2+ of them, settled via scripts/settle-real.mjs. Starts
  // at zero and only ever grows from real match results — never seeded.
  const realCrossChecked = picks.filter(
    (p) => p.dateVerified && p.backerCount >= 2 && p.backers.every((b) => REAL_PREFIXES.some((pre) => b.source.startsWith(pre))),
  );
  const realBacktest = computeBacktest(realCrossChecked.filter((p) => p.result !== 'pending'));

  const matchesCovered = new Set(all.map((t) => `${t.homeTeam}|${t.awayTeam}|${t.kickoff}`)).size;

  // The one hard rule: never fabricate a price. odds must be a real number
  // from a real backer. dateVerified is NOT required here — same precedent as
  // `fresh` above: api-football fixture-matching and real odds currently come
  // from largely disjoint sources, so requiring both would publish ~nothing.
  // The generator script surfaces dateVerified as an honest "kickoff time
  // unconfirmed" note rather than gating existence on it. No backerCount
  // floor either: a single trustworthy real source is enough to publish (as
  // Premium), it just won't reach VIP until 3+ sources agree.
  // avgOdds > 1.01 (not just > 0): decimal odds of exactly 1.00 are a common
  // scraper artifact (failed extraction defaulting to 1), not a real price —
  // publishing it would show a bet with zero possible profit.
  const publishable = picks.filter((p) => p.avgOdds > 1.01);

  return {
    upcoming,
    fresh,
    publishable,
    tipsters,
    backtest,
    realBacktest,
    sources: [...sources],
    totalTipsIngested: all.length,
    matchesCovered,
  };
}
