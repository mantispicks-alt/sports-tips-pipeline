// -------------------------------------------------------------------------
// Poisson-based football match model.
//
// Expected goals (lambda) are derived from each team's attack / defence
// strength relative to the league average, then the Poisson distribution
// gives the probability of every scoreline. From the score matrix we derive
// 1X2, Over/Under 2.5, BTTS and the most likely correct scores.
//
// This is the same maths used by Forebet / professional models — it is what
// makes our predictions "data-driven", not gut feeling.
// -------------------------------------------------------------------------

export interface TeamStats {
  scoredAvg: number; // avg goals scored per game (season or recent form)
  concededAvg: number; // avg goals conceded per game
}

export interface MatchModelInput {
  home: TeamStats;
  away: TeamStats;
  leagueAvgGoals?: number; // avg goals a team scores per game in this league
  homeAdvantage?: number; // multiplier applied to home xG (~1.10)
  maxGoals?: number; // truncate the distribution here
}

export interface ScoreProb {
  score: string;
  prob: number; // percentage
}

export interface MatchModel {
  lambdaHome: number;
  lambdaAway: number;
  home: number; // P(home win) %
  draw: number; // %
  away: number; // %
  over25: number; // %
  under25: number; // %
  bttsYes: number; // %
  bttsNo: number; // %
  topScores: ScoreProb[]; // 5 most likely correct scores
}

export function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/** Probability of exactly k events given rate lambda. */
export function poisson(lambda: number, k: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const pct = (x: number) => round1(x * 100);

export function predictMatch(input: MatchModelInput): MatchModel {
  const leagueAvg = input.leagueAvgGoals ?? 1.35;
  const homeAdv = input.homeAdvantage ?? 1.1;
  const maxGoals = input.maxGoals ?? 8;

  // Strength ratios vs league average
  const homeAttack = input.home.scoredAvg / leagueAvg;
  const homeDefence = input.home.concededAvg / leagueAvg;
  const awayAttack = input.away.scoredAvg / leagueAvg;
  const awayDefence = input.away.concededAvg / leagueAvg;

  // Expected goals for each side
  const lambdaHome = homeAttack * awayDefence * leagueAvg * homeAdv;
  const lambdaAway = awayAttack * homeDefence * leagueAvg;

  const hp = Array.from({ length: maxGoals + 1 }, (_, k) => poisson(lambdaHome, k));
  const ap = Array.from({ length: maxGoals + 1 }, (_, k) => poisson(lambdaAway, k));

  let home = 0;
  let draw = 0;
  let away = 0;
  let over25 = 0;
  let bttsYes = 0;
  const scores: ScoreProb[] = [];

  for (let i = 0; i <= maxGoals; i++) {
    for (let j = 0; j <= maxGoals; j++) {
      const p = hp[i] * ap[j];
      if (i > j) home += p;
      else if (i === j) draw += p;
      else away += p;
      if (i + j > 2.5) over25 += p;
      if (i >= 1 && j >= 1) bttsYes += p;
      scores.push({ score: `${i}-${j}`, prob: p });
    }
  }

  const topScores = scores
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 5)
    .map((s) => ({ score: s.score, prob: pct(s.prob) }));

  return {
    lambdaHome: Math.round(lambdaHome * 100) / 100,
    lambdaAway: Math.round(lambdaAway * 100) / 100,
    home: pct(home),
    draw: pct(draw),
    away: pct(away),
    over25: pct(over25),
    under25: pct(1 - over25),
    bttsYes: pct(bttsYes),
    bttsNo: pct(1 - bttsYes),
    topScores,
  };
}

/** Bookmaker implied probability from decimal odds (%). */
export function impliedProb(odds: number): number {
  return round1((1 / odds) * 100);
}

/**
 * Value edge = model probability − implied probability (percentage points).
 * Positive means the model rates the bet more likely than the price implies.
 */
export function valueEdge(modelProbPct: number, odds: number): number {
  return round1(modelProbPct - impliedProb(odds));
}
