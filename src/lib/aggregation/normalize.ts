// -------------------------------------------------------------------------
// Normalisation: canonical team slugs, match identity, market parsing,
// human labels and settlement against a final score.
//
// Sport-aware: football (1X2/OU25/BTTS/DC, settled from goals) and basketball
// (ML/SPREAD/TOTALS, settled from points + a line).
// -------------------------------------------------------------------------
import type { MarketGroup, Outcome, Sport } from './types';

// Expand aggressively so tipsters' short names and api-football's official
// names collapse to the SAME slug — otherwise the same fixture generates
// two different matchKeys and settlement misses (2026-09-27 audit found
// 'TOTTENHAM' picks unsettled because api-football returns 'Tottenham
// Hotspur' and slugs diverged).
const TEAM_ALIASES: Record<string, string> = {
  // Premier League
  'man city': 'manchester city',
  'man utd': 'manchester united',
  'man united': 'manchester united',
  'manchester utd': 'manchester united',
  spurs: 'tottenham',
  'tottenham hotspur': 'tottenham',
  'tottenham hotspurs': 'tottenham',
  wolves: 'wolverhampton',
  'wolverhampton wanderers': 'wolverhampton',
  brighton: 'brighton',
  'brighton hove albion': 'brighton',
  'brighton and hove albion': 'brighton',
  'brighton hove': 'brighton',
  newcastle: 'newcastle',
  'newcastle united': 'newcastle',
  west: 'west ham', // avoid 'west' colliding with 'west ham'/'west brom' short forms
  'west ham united': 'west ham',
  'west ham utd': 'west ham',
  'west bromwich': 'west bromwich albion',
  'west brom': 'west bromwich albion',
  'nottingham forest': 'nottingham forest',
  'notts forest': 'nottingham forest',
  'nott m forest': 'nottingham forest',
  'sheffield utd': 'sheffield united',
  'sheffield weds': 'sheffield wednesday',
  'crystal palace': 'crystal palace',
  cpalace: 'crystal palace',
  // Italy
  inter: 'inter milan',
  'inter milano': 'inter milan',
  internazionale: 'inter milan',
  juve: 'juventus',
  milan: 'ac milan',
  'a c milan': 'ac milan',
  'ac milano': 'ac milan',
  napoli: 'napoli',
  'ssc napoli': 'napoli',
  // Spain
  'atleti': 'atletico madrid',
  atletico: 'atletico madrid',
  'atletico de madrid': 'atletico madrid',
  'real madrid cf': 'real madrid',
  barca: 'barcelona',
  'fc barcelona': 'barcelona',
  'real betis': 'real betis',
  betis: 'real betis',
  'real sociedad': 'real sociedad',
  // Germany
  bayern: 'bayern munich',
  'bayern munchen': 'bayern munich',
  'bayern muenchen': 'bayern munich',
  'fc bayern munich': 'bayern munich',
  dortmund: 'borussia dortmund',
  bvb: 'borussia dortmund',
  'bor dortmund': 'borussia dortmund',
  leverkusen: 'bayer leverkusen',
  'bayer 04 leverkusen': 'bayer leverkusen',
  'rb leipzig': 'rb leipzig',
  'leipzig': 'rb leipzig',
  'monchengladbach': 'borussia monchengladbach',
  'borussia m gladbach': 'borussia monchengladbach',
  // France
  psg: 'paris saint germain',
  'paris sg': 'paris saint germain',
  'paris s g': 'paris saint germain',
  om: 'marseille',
  'olympique marseille': 'marseille',
  'olympique de marseille': 'marseille',
  'olympique lyonnais': 'lyon',
  lyon: 'lyon',
  // Netherlands
  ajax: 'ajax',
  'ajax amsterdam': 'ajax',
  psv: 'psv eindhoven',
  'psv eindhoven': 'psv eindhoven',
  'feyenoord rotterdam': 'feyenoord',
  // Portugal
  'benfica': 'benfica',
  'sl benfica': 'benfica',
  porto: 'porto',
  'fc porto': 'porto',
  sporting: 'sporting cp',
  'sporting cp': 'sporting cp',
  'sporting lisbon': 'sporting cp',
  // Scotland
  celtic: 'celtic',
  'celtic fc': 'celtic',
  rangers: 'rangers',
  'glasgow rangers': 'rangers',
  'rangers fc': 'rangers',
  // Turkey
  besiktas: 'besiktas',
  fenerbahce: 'fenerbahce',
  galatasaray: 'galatasaray',
  // Copa/S.America
  boca: 'boca juniors',
  river: 'river plate',
  santos: 'santos',
  gremio: 'gremio',
  palmeiras: 'palmeiras',
  flamengo: 'flamengo',
  corinthians: 'corinthians',
  botafogo: 'botafogo',
  fluminense: 'fluminense',
  vasco: 'vasco da gama',
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

// Canonicalise a team NAME for storage — strips the same league prefixes GROUP_STOP
// strips (FC, SC, SK, FK, NK, HNK, AC, CA, AFC…) so "SK Artis Brno" and "Artis Brno"
// become identical. Consensus uses this so a fixture's aggregate homeTeam/awayTeam
// stays STABLE regardless of which source's spelling arrived first — otherwise
// matchKey (derived from the aggregate names) flips between runs and generate
// writes a SECOND .md file for the same match. Bug found 2026-09-06 on
// Artis Brno vs Viktoria Plzen (2 published picks, same game, different files).
const NAME_STRIP = /\b(fc|cf|sc|afc|cd|ac|ca|fk|kf|sk|nk|hnk|rcd|sv|if|bk|ss|us|as|club|the)\b/gi;
export function canonicalTeamName(name: string): string {
  if (!name) return name;
  const cleaned = String(name).replace(NAME_STRIP, ' ').replace(/\s+/g, ' ').trim();
  // If stripping everything left an empty string (e.g. name was just "FC"), keep original.
  return cleaned || String(name).trim();
}

// ===========================================================================
// MARKET-NOTATION DICTIONARY — read a pick EXACTLY as the source meant it.
//
// Sources are multilingual (EN/ES/IT/PT/PL/FR/DE) and use every shorthand under
// the sun (1/X/2, 1X/12/X2, GG/NG, O2.5/U2.5, +2.5/-1, "más 2.5", "ambos marcan",
// "podwójna szansa", "draw no bet"…). The OLD parser force-flattened everything
// into 4 markets, so a Draw-No-Bet, a plain Draw, and an away-win all became a
// bogus "Double Chance" that then always lost. The rule now: identify the market
// precisely; SETTLE the ones we can score from the final goals (1X2/DC/DNB/OU/
// BTTS); and REFUSE (return null → the pick is dropped, never shown) everything
// we cannot settle — handicap, HT/FT, halves, corners, cards, correct-score,
// odd/even, team-totals, props. Never guess a different bet. Research notes:
// [[pick-notation]].
// ===========================================================================

// Markets we recognise but CANNOT settle from (hg, ag) alone → dropped, not guessed.
const UNSUPPORTED_MARKET =
  /(ht[\s/\-]?ft|half[\s-]?time|halftime|1st half|2nd half|first half|second half|primo tempo|secondo tempo|1x2 ht|corners?|c[oó]rner|calci d'angolo|ro[żz]ne|cards?|booking|tarjeta|cartellin|kartk|\bfoul|offside|player|scorer|anytime|marcador|correct[\s-]?score|resultado exacto|risultato esatto|dok[lł]adny wynik|\bodd\b|\beven\b|par\/impar|pari\/dispari|parzyst|handicap|h[aá]ndicap|\bah\b|\beh\b|asian|spread|to qualify|qualif|avanza|clasific|multi[\s-]?g?ol|winning margin|race to|clean sheet|porter[ií]a|to[\s-]?nil|w2n|method|penal|red card|yellow|sending off|1st goal|first goal|last goal)/;

const DRAW_RE = /(?:^|[^a-z])(x|draw|drawn|tie|empate|empat|pareggio|\bpari\b|remis|\bnul\b|unentschieden|isopalia)(?:[^a-z0-9]|$)/;
const HOME_RE = /(?:^|[^a-z])(1|home|local|casa|domicile|heim|gospodarz|hosts?)(?:[^a-z0-9]|$)/;
const AWAY_RE = /(?:^|[^a-z])(2|away|visitor|visitante|visiting|ospite|trasferta|\bfora\b|exterieur|ext[eé]rieur|ausw[aä]rts|go[sś][cć]|guests?)(?:[^a-z0-9]|$)/;
const OVER_RE = /(?:^|[^a-z])(over|\bo\b|mas|m[aá]s|piu|pi[uù]|mais|powy[zż]ej|\bpow\b|\bplus\b|[uü]ber)(?:[^a-z]|$)|\bo\s*\d|\+\s*\d/;
const UNDER_RE = /(?:^|[^a-z])(under|menos|\bmeno\b|abaixo|poni[zż]ej|\bpon\b|moins|unter)(?:[^a-z]|$)|\bu\s*\d/;
const BTTS_RE = /(btts|\bbts\b|\bgg\b|both teams(?: to score)?|ambos (?:marcan|anotan|marcam)|entrambe(?: segnano)?|oba (?:strzel|zdob)|goal[\s-]?goal|itbts)/;
const BTTS_NO_RE = /(\bng\b|no[\s-]?goal|nogoal)/;
const DC_RE = /(double chance|doble oportunidad|doppia chance|dupla chance|podw[oó]jna szansa|\b1x\b|\b12\b|\bx2\b)/;
const DNB_RE = /(draw no bet|\bdnb\b|empate no hay|rimborso pareggio|remboursé si nul|1n\b|2n\b)/;
const NEG_RE = /(?:^|[^a-z])(no|n[aã]o|\bnie\b|\bnon\b|kein|ohne)(?:[^a-z]|$)/;

// Extract an over/under goal line (0.5, 1.5, 2.5, 3.5…). Prefers a decimal; falls
// back to a bare integer (integer lines can push → void). Ignores the "2"/"5" that
// live inside tokens like "2.5" already handled, or "x2".
function extractLine(text: string): number | null {
  const m = text.match(/(\d+(?:[.,]\d+)?)/g);
  if (!m) return null;
  // prefer a value that has a decimal part; else first integer in a sane range
  const dec = m.map((x) => parseFloat(x.replace(',', '.'))).filter((n) => Number.isFinite(n));
  const withHalf = dec.find((n) => !Number.isInteger(n));
  const cand = withHalf ?? dec.find((n) => n >= 0 && n <= 8);
  return typeof cand === 'number' ? cand : null;
}

/**
 * The one true reader. Given a source's (market, selection) — however it was
 * written, in any language — return the canonical {market, selection, line} we
 * can settle, or NULL to DROP a pick we cannot settle / cannot read confidently.
 * Never returns a wrong-bucket guess.
 */
export function canonicalizePick(
  market: string,
  selection: string,
  home?: string,
  away?: string,
  line?: number,
): { market: MarketGroup; selection: string; line?: number } | null {
  const mk = String(market ?? '').toLowerCase().trim();
  const sel = String(selection ?? '').toLowerCase().trim();
  const text = ` ${mk} ${sel} `.replace(/\s+/g, ' ');
  if (!sel && !mk) return null;

  // 1) Unsupported market → DROP (recognise precisely, never misread).
  if (UNSUPPORTED_MARKET.test(text)) return null;

  const fold = (t?: string) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const teamWords = (t?: string) => fold(t).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((x) => x.length >= 3);
  const hw = teamWords(home), aw = teamWords(away);
  const selFolded = fold(sel); // accents stripped so "brügge" matches team word "brugge"
  const nameHome = hw.length > 0 && hw.some((w) => selFolded.includes(w));
  const nameAway = aw.length > 0 && aw.some((w) => selFolded.includes(w));
  // Strip DECIMAL line numbers ("2.5", "1,5") before reading the 1/2 outcome digits,
  // so the "2" inside an over/under line is never mistaken for an away ("2") pick.
  const selO = ` ${selFolded.replace(/\d+[.,]\d+/g, ' ')} `;
  const selDraw = DRAW_RE.test(selO);
  const selHome = /(?:^|[^a-z])(1|home|local|casa)(?:[^a-z0-9]|$)/.test(selO) || nameHome;
  const selAway = /(?:^|[^a-z])(2|away|visit|fora)(?:[^a-z0-9]|$)/.test(selO) || nameAway;

  // 2) BTTS — no team tokens involved; check before 1X2/OU.
  if (mk === 'btts' || BTTS_RE.test(text) || BTTS_NO_RE.test(text)) {
    if (BTTS_NO_RE.test(text) || (BTTS_RE.test(text) && NEG_RE.test(text))) return { market: 'BTTS', selection: 'no' };
    return { market: 'BTTS', selection: 'yes' };
  }

  // 3) Draw No Bet — a two-way team bet, void on draw. Must beat DC/1X2 detection.
  if (mk === 'dnb' || DNB_RE.test(text)) {
    if (selHome && !selAway) return { market: 'DNB', selection: 'home' };
    if (selAway && !selHome) return { market: 'DNB', selection: 'away' };
    if (/\b1n\b/.test(text)) return { market: 'DNB', selection: 'home' };
    if (/\b2n\b/.test(text)) return { market: 'DNB', selection: 'away' };
    return null; // DNB but no resolvable side
  }

  // 4) Double Chance — TWO outcomes. Explicit 1x/12/x2, the words, or a verbose
  //    "<team> or draw" / "<team> or <team>" / "draw or <team>".
  const explicitDC = /\b1x\b/.test(text) ? '1x' : /\bx2\b/.test(text) ? 'x2' : /\b12\b/.test(text) ? '12' : null;
  const orForm = /\b(or|o|\/|\||,|&| e | y | oder | ou )\b/.test(sel) || / or |\/|,/.test(sel);
  const dcWord = /(double chance|doble oportunidad|doppia chance|dupla chance|podw[oó]jna szansa)/.test(text);
  if (mk === 'dc' || explicitDC || (dcWord && (selHome || selAway || selDraw))) {
    if (explicitDC) return { market: 'DC', selection: explicitDC };
    const h = selHome, a = selAway, d = selDraw;
    if (h && d) return { market: 'DC', selection: '1x' };
    if (a && d) return { market: 'DC', selection: 'x2' };
    if (h && a) return { market: 'DC', selection: '12' };
    // A DC label with only ONE outcome named is NOT a double chance — it's a
    // straight 1X2 (the old bug turned these into bogus x2/1x). Reclassify.
    if (mk === 'dc' && d && !h && !a) return { market: '1X2', selection: 'draw' };
    if (mk === 'dc' && h && !a && !d) return { market: '1X2', selection: 'home' };
    if (mk === 'dc' && a && !h && !d) return { market: '1X2', selection: 'away' };
    if (orForm && d && (h || a)) return { market: 'DC', selection: h ? '1x' : 'x2' };
    return null; // can't read the DC pair confidently → drop
  }

  // 5) Over/Under goals — needs a line (default 2.5 when the number is implicit).
  const wantsOver = OVER_RE.test(text);
  const wantsUnder = UNDER_RE.test(text);
  if (mk === 'ou25' || mk === 'ou' || mk === 'totals' || ((wantsOver || wantsUnder) && !selHome && !selAway)) {
    // read the line from the SELECTION text (+ the explicit line arg) — NOT the
    // combined text, whose "ou25"/"2.5" market label would feed a bogus 25/2 line.
    const L = extractLine(sel) ?? line ?? 2.5;
    if (wantsUnder && !wantsOver) return { market: 'OU25', selection: 'under', line: L };
    if (wantsOver && !wantsUnder) return { market: 'OU25', selection: 'over', line: L };
    if (mk === 'ou25' || mk === 'ou' || mk === 'totals') {
      if (/^u|und|men|meno|poni|moin|unter/.test(sel)) return { market: 'OU25', selection: 'under', line: L };
      return { market: 'OU25', selection: 'over', line: L };
    }
  }

  // 6) 1X2 — a single outcome.
  if (mk === '1x2' || mk === 'ml' || selHome || selAway || selDraw) {
    if (selDraw && !selHome && !selAway) return { market: '1X2', selection: 'draw' };
    if (selHome && !selAway && !selDraw) return { market: '1X2', selection: 'home' };
    if (selAway && !selHome && !selDraw) return { market: '1X2', selection: 'away' };
    if (sel === 'home' || sel === 'draw' || sel === 'away') return { market: '1X2', selection: sel };
  }

  return null; // unreadable → drop, never guess
}

/** Parse a free-text (football) market string into a canonical pick, or null. */
export function parseMarket(raw: string): { market: MarketGroup; selection: string; line?: number } | null {
  return canonicalizePick('', raw);
}

export function marketLabel(
  market: MarketGroup,
  selection: string,
  home?: string,
  away?: string,
  line?: number,
): string {
  switch (market) {
    case 'OU25': {
      const L = typeof line === 'number' ? line : 2.5;
      return selection === 'over' ? `Over ${L} Goals` : `Under ${L} Goals`;
    }
    case 'BTTS':
      return selection === 'yes' ? 'Both Teams To Score' : 'BTTS - No';
    case '1X2':
      if (selection === 'draw') return 'Draw';
      if (selection === 'home') return home ? `${home} Win` : 'Home Win';
      return away ? `${away} Win` : 'Away Win';
    case 'DNB':
      if (selection === 'home') return home ? `${home} (Draw No Bet)` : 'Home (Draw No Bet)';
      return away ? `${away} (Draw No Bet)` : 'Away (Draw No Bet)';
    case 'DC': {
      const dc: Record<string, string> = { '1x': '1X', '12': '12', x2: 'X2' };
      return `Double Chance ${dc[selection] ?? selection.toUpperCase()}`;
    }
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
      return hg + ag > (line ?? 2.5) ? 'over' : 'under';
    case 'BTTS':
      return hg > 0 && ag > 0 ? 'yes' : 'no';
    case 'DNB':
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
  if (market === 'ML' || market === 'DNB') {
    // Draw No Bet = moneyline: a draw returns the stake (void), else the picked
    // side must win. (DNB is football; ML is basketball — same settlement.)
    if (hg === ag) return 'void';
    return selection === (hg > ag ? 'home' : 'away') ? 'won' : 'lost';
  }

  // --- Football markets ----------------------------------------------------
  // Over/Under carries a real LINE now (0.5, 1.5, 2.5, 3.5…). An INTEGER line the
  // total lands on exactly is a push → void (e.g. Over 2.0 with a 2-goal game).
  if (market === 'OU25') {
    const L = line ?? 2.5;
    const total = hg + ag;
    if (total === L) return 'void';
    return selection === (total > L ? 'over' : 'under') ? 'won' : 'lost';
  }
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
    // A DC selection naming only ONE side is NOT a double chance — do not fabricate
    // a '1x'/'x2' (the old bug: it turned an away-win into "draw or away"). Leave it
    // for canonicalizePick() (used at ingestion) to reclassify to the real 1X2.
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
