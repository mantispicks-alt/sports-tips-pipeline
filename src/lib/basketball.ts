// -------------------------------------------------------------------------
// Basketball projection model.
//
// Football uses Poisson (goals are rare). Basketball is high-scoring, so points
// are modelled as ~normal. We project each team's points from attack/defence
// strength (like the football model), then derive:
//   - projected score + total
//   - moneyline win probability (normal CDF of the margin)
//   - Over/Under probability vs a line (normal CDF of the total)
//
// Same idea as poisson.ts — a transparent, owned prediction source. No API key.
// -------------------------------------------------------------------------

export interface BballTeam {
  pointsFor: number; // avg points scored per game
  pointsAgainst: number; // avg points conceded per game
}

export interface BballInput {
  home: BballTeam;
  away: BballTeam;
  leagueAvgPoints?: number; // avg points a team scores per game (NBA ~114, EuroLeague ~80)
  homeAdvantage?: number; // multiplier on home points (~1.03)
  totalLine?: number; // the Over/Under line, if any
  marginSigma?: number; // std dev of game margin (NBA ~12, EuroLeague ~11)
  totalSigma?: number; // std dev of game total (~16)
}

export interface BballModel {
  projHome: number;
  projAway: number;
  total: number;
  margin: number; // + = home favoured
  homeWin: number; // %
  awayWin: number; // %
  over: number | null; // % (null if no line)
  under: number | null; // %
}

const r1 = (x: number) => Math.round(x * 10) / 10;

// Abramowitz & Stegun error-function approximation.
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

/** Standard normal CDF. */
function ncdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export function predictBasketball(input: BballInput): BballModel {
  const lg = input.leagueAvgPoints ?? 80;
  const homeAdv = input.homeAdvantage ?? 1.03;
  const mSigma = input.marginSigma ?? 11.5;
  const tSigma = input.totalSigma ?? 16;

  const homeAttack = input.home.pointsFor / lg;
  const homeDefence = input.home.pointsAgainst / lg;
  const awayAttack = input.away.pointsFor / lg;
  const awayDefence = input.away.pointsAgainst / lg;

  const projHome = homeAttack * awayDefence * lg * homeAdv;
  const projAway = awayAttack * homeDefence * lg;
  const total = projHome + projAway;
  const margin = projHome - projAway;

  const homeWin = ncdf(margin / mSigma) * 100;

  let over: number | null = null;
  let under: number | null = null;
  if (input.totalLine != null) {
    const o = (1 - ncdf((input.totalLine - total) / tSigma)) * 100;
    over = o;
    under = 100 - o;
  }

  return {
    projHome: r1(projHome),
    projAway: r1(projAway),
    total: r1(total),
    margin: r1(margin),
    homeWin: r1(homeWin),
    awayWin: r1(100 - homeWin),
    over: over == null ? null : r1(over),
    under: under == null ? null : r1(under),
  };
}
