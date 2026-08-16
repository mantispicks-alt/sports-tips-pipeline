// -------------------------------------------------------------------------
// Normalisation: canonical team slugs, match identity, market parsing,
// human labels and settlement against a final score.
//
// Sport-aware: football (1X2/OU25/BTTS/DC, settled from goals) and basketball
// (ML/SPREAD/TOTALS, settled from points + a line).
// -------------------------------------------------------------------------
import type { MarketGroup, Outcome, Sport } from './types';

const TEAM_ALIASES: Record<string, string> = {
  'man city': 'manchester city',
  'man utd': 'manchester united',
  'man united': 'manchester united',
  spurs: 'tottenham',
  inter: 'inter milan',
  juve: 'juventus',
  psg: 'paris saint germain',
  atleti: 'atletico madrid',
  atletico: 'atletico madrid',
  barca: 'barcelona',
  bayern: 'bayern munich',
  dortmund: 'borussia dortmund',
};

// Extended-Latin letters NFD cannot decompose (ligatures / stroked letters).
// Without folding these, "Nordsjælland" -> "nordsjlland" != a results API's
// "nordsjaelland", and settlement silently never matches. Applied before the
// a-z0-9 strip.
const LATIN_FOLD: [RegExp, string][] = [
  [/æ/g, 'ae'], [/œ/g, 'oe'], [/ø/g, 'o'], [/ß/g, 'ss'],
  [/ð/g, 'd'], [/þ/g, 'th'], [/ł/g, 'l'], [/đ/g, 'd'], [/ħ/g, 'h'], [/ı/g, 'i'],
];

export function slugTeam(name: string): string {
  let n = String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [re, to] of LATIN_FOLD) n = n.replace(re, to);
  n = n
    .replace(/\butd\b/g, 'united')
    .replace(/\b(fc|cf|afc|sc|ac|club|cd|ss|as)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  // Non-Latin scripts (e.g. Greek bet-slip OCR) leave nothing after the a-z
  // strip -> an empty slug collides with every fixture that day and can settle
  // the WRONG result. Fall back to the original letters/digits so the key stays
  // unique + non-empty. (Ingestion asks the LLM for canonical Latin names; this
  // is the safety net for when a local-script name slips through.)
  if (!n) {
    n = String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }
  const canonical = TEAM_ALIASES[n] ?? n;
  return canonical.replace(/\s+/g, '-');
}

/**
 * Stable identity for a fixture regardless of source ordering/spelling.
 * Sport is part of the key so a football and basketball fixture with the same
 * team names on the same day can never collide.
 */
export function matchKey(home: string, away: string, kickoffISO: string, sport: Sport = 'football'): string {
  const day = kickoffISO.slice(0, 10);
  const pair = [slugTeam(home), slugTeam(away)].sort();
  return `${sport}|${day}|${pair[0]}|${pair[1]}`;
}

// A LOOSER key used ONLY to GROUP picks for consensus, so the same fixture
// written "Chapecoense-SC" / "Chapecoense" / "Operário" cross-checks as one match.
// Strips club-type words (FC, SC, AC…), regional state suffixes and accents.
// Deliberately does NOT drop distinguishing words (United, City, Madrid) — that
// would merge DIFFERENT clubs — so it only collapses obvious spelling variants.
const GROUP_STOP = /\b(fc|cf|sc|afc|cd|ac|ca|fk|kf|sk|nk|hnk|rcd|sv|if|bk|ss|us|as|club|the|de|do|dos|da|di|del|la|el|los|las)\b/g;
function teamGroupSlug(s: string): string {
  const n = String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[-\s]+(sc|pr|ba|rj|sp|mg|rs|go|ce|pe|df|es|pa|ma|to|al|se|pb|rn|pi|ro|rr|ap|am|mt|ms)\b/g, ' ')
    .replace(GROUP_STOP, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
  return n;
}
export function consensusGroupKey(home: string, away: string, kickoffISO: string, sport: Sport = 'football'): string {
  const pair = [teamGroupSlug(home) || slugTeam(home), teamGroupSlug(away) || slugTeam(away)].sort();
  return `${sport}|${kickoffISO.slice(0, 10)}|${pair[0]}|${pair[1]}`;
}

/** Parse a free-text (football) market string into a canonical {market, selection}. */
export function parseMarket(raw: string): { market: MarketGroup; selection: string } | null {
  const s = raw.toLowerCase().trim();
  const rules: [RegExp, MarketGroup, string][] = [
    [/\b(under|u)\s*2\.?5\b|(?:^|\s)-2\.5/, 'OU25', 'under'],
    [/\b(over|o)\s*2\.?5\b|\+2\.5/, 'OU25', 'over'],
    [/(btts|both teams).*(no)|\bng\b/, 'BTTS', 'no'],
    [/\b(btts|both teams to score|gg)\b/, 'BTTS', 'yes'],
    [/double chance.*(1x)|\b1x\b/, 'DC', '1x'],
    [/double chance.*(x2)|\bx2\b/, 'DC', 'x2'],
    [/double chance.*(12)|\b12\b/, 'DC', '12'],
    [/\b(draw|^x$)\b/, '1X2', 'draw'],
    [/\b(home win|home|^1$)\b/, '1X2', 'home'],
    [/\b(away win|away|^2$)\b/, '1X2', 'away'],
  ];
  for (const [re, market, selection] of rules) {
    if (re.test(s)) return { market, selection };
  }
  return null;
}

export function marketLabel(
  market: MarketGroup,
  selection: string,
  home?: string,
  away?: string,
  line?: number,
): string {
  switch (market) {
    case 'OU25':
      return selection === 'over' ? 'Over 2.5 Goals' : 'Under 2.5 Goals';
    case 'BTTS':
      return selection === 'yes' ? 'Both Teams To Score' : 'BTTS - No';
    case '1X2':
      if (selection === 'draw') return 'Draw';
      if (selection === 'home') return home ? `${home} Win` : 'Home Win';
      return away ? `${away} Win` : 'Away Win';
    case 'DC':
      return `Double Chance ${selection.toUpperCase()}`;
    case 'ML':
      if (selection === 'home') return home ? `${home} (ML)` : 'Home (ML)';
      return away ? `${away} (ML)` : 'Away (ML)';
    case 'TOTALS': {
      const l = typeof line === 'number' ? ` ${line}` : '';
      return (selection === 'over' ? `Over${l} Points` : `Under${l} Points`).trim();
    }
    case 'SPREAD': {
      const team = selection === 'home' ? home ?? 'Home' : away ?? 'Away';
      const l = typeof line === 'number' ? (line > 0 ? `+${line}` : `${line}`) : '';
      return `${team} ${l}`.trim();
    }
    default:
      return selection;
  }
}

/** The winning selection for a market given the final score/points. */
export function winningSelection(market: MarketGroup, hg: number, ag: number, line?: number): string {
  switch (market) {
    case '1X2':
      return hg > ag ? 'home' : hg < ag ? 'away' : 'draw';
    case 'OU25':
      return hg + ag > 2.5 ? 'over' : 'under';
    case 'BTTS':
      return hg > 0 && ag > 0 ? 'yes' : 'no';
    case 'ML':
      return hg >= ag ? 'home' : 'away';
    case 'TOTALS':
      return hg + ag > (line ?? 0) ? 'over' : 'under';
    case 'SPREAD':
      return hg + (line ?? 0) >= ag ? 'home' : 'away';
    default:
      return 'home';
  }
}

/** Settle a selection against a final score/points (with a line for basketball). */
export function settle(
  market: MarketGroup,
  selection: string,
  hg: number,
  ag: number,
  line?: number,
): Outcome {
  // --- Basketball line/points markets (exact line = push -> void) ----------
  if (market === 'TOTALS') {
    const total = hg + ag;
    const L = line ?? 0;
    if (total === L) return 'void';
    return selection === (total > L ? 'over' : 'under') ? 'won' : 'lost';
  }
  if (market === 'SPREAD') {
    const adj = hg + (line ?? 0); // line is the home spread
    if (adj === ag) return 'void';
    return selection === (adj > ag ? 'home' : 'away') ? 'won' : 'lost';
  }
  if (market === 'ML') {
    if (hg === ag) return 'void';
    return selection === (hg > ag ? 'home' : 'away') ? 'won' : 'lost';
  }

  // --- Football markets ----------------------------------------------------
  const o = winningSelection(market === 'DC' ? '1X2' : market, hg, ag);
  if (market === 'DC') {
    const map: Record<string, string[]> = {
      '1x': ['home', 'draw'],
      '12': ['home', 'away'],
      x2: ['draw', 'away'],
    };
    return map[selection]?.includes(o) ? 'won' : 'lost';
  }
  return selection === o ? 'won' : 'lost';
}

// Normalise a source's free-text selection to the canonical token settle()
// expects. Many scrapers emit "HJK Helsinki or X" instead of "1x", "ov2.5"
// instead of "over", etc. — those never matched, so settle() marked EVERY one
// 'lost' and consensus never grouped them. Uses the team names to resolve DC/1X2
// verbose forms. Returns the input unchanged if it can't be confidently mapped.
export function canonicalSelection(market: MarketGroup, selection: string, home?: string, away?: string): string {
  const s = String(selection ?? '').toLowerCase().trim();
  if (!s) return selection;
  const words = (t?: string) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((x) => x.length >= 3);
  const hw = words(home), aw = words(away);
  const hitsHome = s === '1' || (hw.length > 0 && hw.some((x) => s.includes(x)));
  const hitsAway = s === '2' || (aw.length > 0 && aw.some((x) => s.includes(x)));
  const hitsDraw = /(^|[^a-z])(x|draw|tie)([^a-z]|$)/.test(s);
  if (market === '1X2') {
    if (s === 'home' || s === 'draw' || s === 'away') return s;
    if (hitsHome && !hitsAway && !hitsDraw) return 'home';
    if (hitsAway && !hitsHome && !hitsDraw) return 'away';
    if (hitsDraw && !hitsHome && !hitsAway) return 'draw';
    return selection;
  }
  if (market === 'DC') {
    if (s === '1x' || s === '12' || s === 'x2') return s;
    if (hitsHome && hitsDraw) return '1x';
    if (hitsHome && hitsAway) return '12';
    if (hitsDraw && hitsAway) return 'x2';
    if (hitsHome) return '1x'; // "<home> or X" with only the home name recognised
    if (hitsAway) return 'x2';
    return selection;
  }
  if (market === 'OU25') {
    if (s === 'over' || s === 'under') return s;
    if (s === 'o' || /\bo(ver)?\b/.test(s)) return 'over';
    if (s === 'u' || /\bu(nder)?\b/.test(s)) return 'under';
    return selection;
  }
  if (market === 'BTTS') {
    if (s === 'yes' || s === 'no') return s;
    if (s === 'gg' || s.startsWith('yes') || s.startsWith('bt')) return 'yes';
    if (s === 'ng' || s.startsWith('no')) return 'no';
    return selection;
  }
  return selection;
}
