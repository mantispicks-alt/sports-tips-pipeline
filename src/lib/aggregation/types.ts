// -------------------------------------------------------------------------
// Tip aggregation & verification — shared data model.
// Source-agnostic: every adapter normalises into RawTip.
// -------------------------------------------------------------------------

export type Sport = 'football' | 'basketball';
// Football: 1X2 / OU25 (carries a `line`, default 2.5) / BTTS / DC / DNB (draw no bet).
// Basketball: ML (moneyline) / SPREAD / TOTALS — the last two carry a `line`.
// OTHER = a recognised-but-unsupported market (handicap, HT/FT, corners, cards,
// correct score, …) — kept off the board (never settled/published), never guessed.
export type MarketGroup = '1X2' | 'OU25' | 'BTTS' | 'DC' | 'DNB' | 'ML' | 'SPREAD' | 'TOTALS' | 'OTHER';
export type Outcome = 'won' | 'lost' | 'void';

export interface RawTip {
  source: string; // e.g. "api-football", "telegram:sharpmoney"
  tipster: string; // tipster handle
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoff: string; // ISO date-time
  market: MarketGroup; // canonical market group
  selection: string; // canonical selection within the group
  line?: number; // spread/total line for basketball SPREAD/TOTALS
  odds?: number;
  sport?: Sport; // defaults to 'football' when omitted
  result?: Outcome; // known for historical/settled tips
  dateVerified?: boolean; // true when kickoff was matched to a real fixture (api-sports);
  // false/omitted means kickoff is a placeholder (extraction couldn't confirm the real date —
  // fixture not in our free-tier coverage, not that the pick itself is bad)
  fixtureId?: number; // api-sports fixture id, set alongside dateVerified:true — lets
  // scripts/settle-real.mjs look up the final score later and settle this tip for real
}

export interface TipsterRecord {
  key: string; // `${source}:${tipster}`
  source: string;
  tipster: string;
  settled: number;
  won: number;
  lost: number;
  voided: number;
  winRate: number; // %
  roi: number; // % (flat 1u)
  rating: number; // composite reliability 0-100
  tier: 'elite' | 'strong' | 'average' | 'unproven';
  form: ('W' | 'L' | '-')[]; // most recent first
}

export interface Backer {
  tipster: string;
  source: string;
  rating: number;
  odds?: number;
  line?: number;
  dateVerified?: boolean; // false = this backer's kickoff is a placeholder, not confirmed
}

export interface ConsensusPick {
  matchKey: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoff: string;
  sport?: Sport;
  market: MarketGroup;
  selection: string;
  line?: number;
  label: string; // human-readable, e.g. "Over 2.5 Goals"
  backers: Backer[];
  backerCount: number;
  consensusPct: number; // % of tipsters on this match backing this selection
  avgRating: number;
  avgOdds: number;
  confidence: number; // 0-100
  verified: boolean; // passes the high-confidence filter
  dateVerified: boolean; // false = kickoff is a placeholder (not matched to a real fixture) —
  // don't treat this as a confirmed-fresh upcoming signal, the real match date is unknown
  isFavorite?: boolean; // pick == bookmaker favorite (shortest odds = "chalk")
  valueEdge?: number; // consensus% − odds-implied% (>0 = crowd rates it above the market)
  result?: Outcome | 'pending';
}

export interface Backtest {
  picks: number;
  won: number;
  lost: number;
  winRate: number; // %
  roi: number; // %
  profit: number; // units
}

export interface PipelineOutput {
  upcoming: ConsensusPick[]; // verified + pending, ranked by confidence
  fresh: ConsensusPick[]; // pending picks that include a real external source (unverified)
  publishable: ConsensusPick[]; // ALL dateVerified picks with usable odds (any result/confidence) —
  // feeds scripts/generate-tip-content.ts, which turns these into src/content/tips/*.md.
  // Wider than `verified` on purpose: with few source adapters live, backerCount>=3
  // rarely hits yet, so the content bridge can't wait for that bar to fill up.
  tipsters: TipsterRecord[]; // ranked by rating
  backtest: Backtest; // performance of the verified filter on history (mixed demo+real)
  realBacktest: Backtest; // LIVE — only real sources (site:/tg:/web:), cross-checked
  // (backerCount >= 2) picks, settled via scripts/settle-real.mjs. Starts at 0 and
  // only grows from real match results, never seeded with synthetic data.
  sources: string[];
  totalTipsIngested: number;
  matchesCovered: number;
}
