// -------------------------------------------------------------------------
// Mock source adapter — deterministic synthetic tipster data so the whole
// pipeline runs end-to-end today. Skill is baked into each tipster, so good
// tipsters genuinely hit more, ratings separate them, and the verified filter
// really does outperform. Replace with real adapters (API / feeds) for live.
// -------------------------------------------------------------------------
import { mulberry32, pick, poissonSample } from '../rng';
import { matchKey, settle, winningSelection } from '../normalize';
import type { RawTip, MarketGroup } from '../types';

const TEAMS = [
  'Manchester City', 'Arsenal', 'Liverpool', 'Chelsea', 'Real Madrid', 'Barcelona',
  'Atletico Madrid', 'Bayern Munich', 'Borussia Dortmund', 'PSG', 'Inter Milan',
  'Juventus', 'Napoli', 'AC Milan', 'Ajax', 'PSV', 'Benfica', 'Porto', 'Sevilla', 'Real Betis',
];
const LEAGUES = ['Premier League', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1', 'Eredivisie'];
const SOURCES = ['tipster-hub', 'sharp-signals', 'value-desk', 'goal-model', 'telegram-pro'];
const NAMES = [
  'xGWizard', 'SharpMike', 'ValueHunter', 'GoalGuru', 'ProPunter', 'ColdOdds', 'TheAnalyst',
  'BetProfessor', 'FormFinder', 'UnderKing', 'DerbyDon', 'SafeStakes', 'EdgeSeeker', 'ModelMind',
  'LateGoals', 'CleanSheet', 'AccaAce', 'ContrarianV', 'StatsSensei', 'HomeEdge', 'TotalsTom', 'MarketMover',
  'GoalLine', 'TheOddsman', 'PressHigh', 'xPoints', 'BankrollBoss', 'NapMachine', 'DrawSpecialist',
  'AsianEdge', 'CornerKing', 'FirstHalfFox', 'ValueVulture', 'ChalkEater',
  'ParlayPete', 'OddsOracle', 'FadeThePublic', 'InPlayIvan', 'SetPieceSam', 'xGtotals',
  'MidweekMax', 'NordicNaps', 'TailEnders', 'RedCardRon',
];

const ALT: Record<MarketGroup, string[]> = {
  '1X2': ['home', 'draw', 'away'],
  OU25: ['over', 'under'],
  BTTS: ['yes', 'no'],
  DC: ['1x', '12', 'x2'],
  DNB: ['home', 'away'],
  ML: ['home', 'away'],
  SPREAD: ['home', 'away'],
  TOTALS: ['over', 'under'],
  OTHER: [],
};

interface Tipster {
  source: string;
  tipster: string;
  skill: number; // edge over random, -0.06 .. +0.16
}

export function mockSource(): { tips: RawTip[]; outcomes: Map<string, { hg: number; ag: number }> } {
  const rand = mulberry32(20260731);
  const tipsters: Tipster[] = NAMES.map((n, i) => ({
    source: SOURCES[i % SOURCES.length],
    tipster: n,
    skill: -0.05 + (i / (NAMES.length - 1)) * 0.19,
  }));

  const focusMarkets: MarketGroup[] = ['1X2', 'OU25', 'BTTS'];
  const tips: RawTip[] = [];
  const outcomes = new Map<string, { hg: number; ag: number }>();
  const base = new Date('2026-06-01T18:00:00Z').getTime();

  function generateMatch(dayOffset: number, settled: boolean) {
    const hi = Math.floor(rand() * TEAMS.length);
    let ai = Math.floor(rand() * TEAMS.length);
    if (ai === hi) ai = (ai + 1) % TEAMS.length;
    const home = TEAMS[hi];
    const away = TEAMS[ai];
    const league = pick(rand, LEAGUES);
    const kickoff = new Date(base + dayOffset * 86_400_000).toISOString();
    const mk = matchKey(home, away, kickoff);

    const hg = poissonSample(rand, 1.5);
    const ag = poissonSample(rand, 1.15);
    if (settled) outcomes.set(mk, { hg, ag });

    const focus = pick(rand, focusMarkets);
    const winSel = winningSelection(focus, hg, ag);
    const options = ALT[focus];

    const n = 7 + Math.floor(rand() * 8); // 7–14 tipsters per match
    const chosen = [...tipsters].sort(() => rand() - 0.5).slice(0, n);

    for (const tp of chosen) {
      const baseP = 1 / options.length;
      const p = Math.min(0.82, Math.max(0.1, baseP + tp.skill * 1.3));
      const landsWinner = rand() < p;
      let selection: string;
      if (landsWinner) {
        selection = winSel;
      } else {
        const others = options.filter((s) => s !== winSel);
        selection = others[Math.floor(rand() * others.length)];
      }
      const odds = Math.round((1.5 + rand() * 1.3) * 100) / 100;
      const result = settled ? settle(focus, selection, hg, ag) : undefined;
      tips.push({
        source: tp.source,
        tipster: tp.tipster,
        homeTeam: home,
        awayTeam: away,
        league,
        kickoff,
        market: focus,
        selection,
        odds,
        result,
      });
    }
  }

  for (let i = 0; i < 300; i++) generateMatch(i - 300, true); // long history -> settled (train + test)
  for (let i = 0; i < 12; i++) generateMatch(61 + i, false); // upcoming (early Aug 2026) -> pending

  return { tips, outcomes };
}
