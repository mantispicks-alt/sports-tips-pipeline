// -------------------------------------------------------------------------
// Pipeline orchestrator: ingest from every adapter -> score tipsters ->
// build consensus -> settle history -> filter to verified -> output.
// -------------------------------------------------------------------------
import type { PipelineOutput } from './types';
import { buildTipsterRecords } from './tipsters';
import { buildConsensus, computeBacktest } from './consensus';
import { settle } from './normalize';
import { mockSource } from './adapters/mock';
import { jsonImport } from './adapters/jsonImport';
import { telegramSource } from './adapters/telegram';
import { apiFootballSource } from './adapters/apiFootball';
import { rssSource } from './adapters/rss';
import { htmlSource } from './adapters/htmlSource';
import { rapidApiPredictionsSource } from './adapters/rapidApiPredictions';
import { llmExtractorSource } from './adapters/llmExtractor';
import { realOutcomes } from './adapters/realOutcomes';

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
  // matchKey -> {hg,ag} map the demo/mock outcomes use, so real picks settle
  // through the identical code path below — no separate settlement logic.
  for (const o of realOutcomes()) outcomes.set(o.matchKey, { hg: o.hg, ag: o.ag });

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
    const o = p.dateVerified ? outcomes.get(p.matchKey) : undefined;
    p.result = o ? settle(p.market, p.selection, o.hg, o.ag, p.line) : 'pending';
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

  return {
    upcoming,
    fresh,
    tipsters,
    backtest,
    realBacktest,
    sources: [...sources],
    totalTipsIngested: all.length,
    matchesCovered,
  };
}
