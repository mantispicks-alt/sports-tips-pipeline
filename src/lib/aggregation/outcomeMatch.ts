// -------------------------------------------------------------------------
// outcomeMatch — settle a pick against the results DB even when the pick's team
// names don't EXACTLY match the result source's names.
//
// Why: real-outcomes.json is keyed by an exact matchKey (date + slugged team
// names). A pick only settled if its matchKey was byte-identical to the result's
// — so "Man Utd" vs "Manchester United", "Bodo/Glimt" vs "Bodo Glimt" never
// settled. api-football used to unify naming; with it suspended, that join
// breaks and picks stall at "New". This does exact-first, then a conservative
// same-day fuzzy match (both team names must clear a high bar) so results
// actually reach their picks. High threshold + same-date keeps false settles
// negligible.
// -------------------------------------------------------------------------
import type { Outcome } from './types';

const STOP = /\b(fc|cf|sc|afc|cd|ac|club|the|de|do|dos|da|di|del|la|el|los|las|sv|if|bk|ss|us|as)\b/g;
function fold(s: string): string {
  return s.replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ø/g, 'o').replace(/ß/g, 'ss').replace(/ð/g, 'd').replace(/þ/g, 'th').replace(/ł/g, 'l');
}
function norm(s: string): string {
  return fold(String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')).replace(STOP, '').replace(/[^a-z0-9]+/g, '').trim();
}
function firstWord(s: string): string {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+/)?.[0] ?? '';
}
function similarity(a: string, b: string): number {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const fa = firstWord(a), fb = firstWord(b);
  if (fa.length >= 5 && fa === fb) return 0.8; // same primary club word
  const short = na.length < nb.length ? na : nb;
  const long = na.length < nb.length ? nb : na;
  let matches = 0;
  const chars = long.split('');
  for (const ch of short) { const i = chars.indexOf(ch); if (i !== -1) { matches++; chars.splice(i, 1); } }
  return (matches / long.length) * 0.6; // weak char-overlap fallback
}

export interface OutcomeRec { matchKey: string; hg: number; ag: number }
export interface OutcomeIndex {
  byKey: Map<string, OutcomeRec>;
  byDay: Map<string, OutcomeRec[]>; // 'YYYY-MM-DD' -> outcomes, with parsed team slugs
}

// matchKey format: `football|YYYY-MM-DD|slugA|slugB` (team slugs sorted). We need
// the two team slugs back for fuzzy compare, so parse them out of the key.
export function buildOutcomeIndex(outcomes: OutcomeRec[]): OutcomeIndex {
  const byKey = new Map<string, OutcomeRec>();
  const byDay = new Map<string, OutcomeRec[]>();
  for (const o of outcomes) {
    if (!o?.matchKey) continue;
    byKey.set(o.matchKey, o);
    const parts = o.matchKey.split('|');
    const day = parts[1];
    if (!day) continue;
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(o);
  }
  return { byKey, byDay };
}

const FUZZY_MIN = 0.72; // both team names must clear this on the SAME day

// Exact matchKey first; else same-day fuzzy on both team names. Returns the
// matched outcome or undefined.
export function findOutcome(
  homeTeam: string,
  awayTeam: string,
  kickoff: string,
  exactKey: string,
  index: OutcomeIndex,
): OutcomeRec | undefined {
  const exact = index.byKey.get(exactKey);
  if (exact) return exact;
  const day = String(kickoff).slice(0, 10);
  const candidates = index.byDay.get(day);
  if (!candidates) return undefined;
  // the outcome's key has slugs sorted, so compare our pair against both orders
  let best: OutcomeRec | undefined;
  let bestScore = FUZZY_MIN;
  for (const o of candidates) {
    const [, , sA = '', sB = ''] = o.matchKey.split('|');
    // try both alignments; take the min of the two team scores (both must match)
    const s1 = Math.min(similarity(homeTeam, sA), similarity(awayTeam, sB));
    const s2 = Math.min(similarity(homeTeam, sB), similarity(awayTeam, sA));
    const s = Math.max(s1, s2);
    if (s > bestScore) { bestScore = s; best = o; }
  }
  return best;
}
