// -------------------------------------------------------------------------
// Reference data: canonical teams + leagues, used to VALIDATE scraped picks.
//
// The problem this solves: scraped sources mix in reserve/B teams, youth
// sides and tiny/obscure leagues we have no way to tell apart from the real
// first-team fixtures. Two layers of defence:
//
//   1. Rule-based reserve/youth detection — works with ZERO reference data,
//      so it filters "Team II", "X B", "U21", "Primavera", etc. immediately.
//   2. Reference lookup — once src/data/reference/{teams,leagues}.json is
//      populated (run `npm run build:reference` with an API-Football key; it
//      covers lower divisions + small leagues too), we can require that both
//      teams of a pick actually exist in the reference before publishing.
//      Until it's populated, hasTeamData() is false and layer 2 is skipped.
//
// Team-name matching reuses slugTeam() so it's consistent with matchKey().
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugTeam } from './normalize';

const REF_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'reference');

export interface RefTeam {
  id?: number;
  name: string;
  aliases?: string[];
  league?: string;
  country?: string;
}
export interface RefLeague {
  id?: number;
  name: string;
  country?: string;
  type?: string;
  tier?: number;
}

function readArr<T>(file: string): T[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let _teams: Map<string, RefTeam> | null = null;
let _leagues: Set<string> | null = null;

function teamMap(): Map<string, RefTeam> {
  if (_teams) return _teams;
  const m = new Map<string, RefTeam>();
  for (const t of readArr<RefTeam>(path.join(REF_DIR, 'teams.json'))) {
    m.set(slugTeam(t.name), t);
    for (const a of t.aliases ?? []) m.set(slugTeam(a), t);
  }
  _teams = m;
  return m;
}
function leagueSet(): Set<string> {
  if (_leagues) return _leagues;
  _leagues = new Set(readArr<RefLeague>(path.join(REF_DIR, 'leagues.json')).map((l) => slugTeam(l.name)));
  return _leagues;
}

export function hasTeamData(): boolean {
  return teamMap().size > 0;
}
export function knownTeam(name: string): boolean {
  return teamMap().has(slugTeam(name));
}
export function teamInfo(name: string): RefTeam | undefined {
  return teamMap().get(slugTeam(name));
}
export function knownLeague(name: string): boolean {
  return !!name && leagueSet().has(slugTeam(name));
}

// --- Rule-based reserve / youth / academy detection (no data needed) --------
const RESERVE_RE = /(\breserves?\b|\bres\.?\b|\bamateure?\b|\bprimavera\b|\bcastilla\b|\bii\b|\biii\b|\bb[-\s]?team\b|\bfarm\b)/i;
const YOUTH_RE = /(\bu-?1[3-9]\b|\bu-?2[0-3]\b|\bsub-?2[0-3]\b|\byouth\b|\bacademy\b|\bjuniors?\b|\bprimavera\b)/i;
// Trailing single-letter/roman qualifier: "Bayern II", "Porto B", "Ajax C".
const SUFFIX_RE = /\s(b|c|ii|iii)\)?$/i;

export function isReserveOrYouth(name: string): boolean {
  const n = (name ?? '').trim();
  if (!n) return false;
  return RESERVE_RE.test(n) || YOUTH_RE.test(n) || SUFFIX_RE.test(n);
}

const WOMEN_RE = /(\bwomen'?s?\b|\bladies\b|\bf[eé]minin\w*\b|\bfrauen\b|\bfemenino\b|\(w\)|\bfem\b)/i;
export function isWomen(name: string): boolean {
  return WOMEN_RE.test(name ?? '');
}

/** One call for the quality gate: is this pick's fixture trustworthy to publish? */
export function classifyFixture(home: string, away: string): {
  reserve: boolean;
  women: boolean;
  bothKnown: boolean;
  usable: boolean; // reserve-free AND (no team DB yet OR both teams known)
} {
  const reserve = isReserveOrYouth(home) || isReserveOrYouth(away);
  const women = isWomen(home) || isWomen(away);
  const bothKnown = knownTeam(home) && knownTeam(away);
  const usable = !reserve && (!hasTeamData() || bothKnown);
  return { reserve, women, bothKnown, usable };
}
