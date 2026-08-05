// -------------------------------------------------------------------------
// Shared free-text tip parser. Used by the Telegram, RSS and HTML adapters —
// any source that gives tips as human text ("Arsenal vs Chelsea — Over 2.5 @ 1.85").
// -------------------------------------------------------------------------
import type { RawTip } from './types';
import { parseMarket } from './normalize';

export interface ParseOpts {
  tipster: string;
  source: string;
  league?: string;
  kickoff?: string;
}

export function parseTipText(text: string, opts: ParseOpts): RawTip | null {
  const clean = text.replace(/\s+/g, ' ').trim();

  const teams = clean.match(/([A-Za-z0-9 .'&-]+?)\s+(?:vs?\.?|v|[-–])\s+([A-Za-z0-9 .'&-]+?)\s*[—\-–|:]/i);
  const parsed = parseMarket(clean);
  if (!teams || !parsed) return null;

  // Require an explicit @ / "at" before the price, so we don't mistake the
  // "2.5" in "Over 2.5" for the odds.
  const oddsMatch = clean.match(/(?:@|\bat\b)\s*(\d+(?:\.\d+)?)/i);
  const odds = oddsMatch ? parseFloat(oddsMatch[1]) : undefined;

  return {
    source: opts.source,
    tipster: opts.tipster,
    homeTeam: teams[1].trim(),
    awayTeam: teams[2].trim(),
    league: opts.league ?? 'Unknown',
    kickoff: opts.kickoff ?? new Date().toISOString(),
    market: parsed.market,
    selection: parsed.selection,
    odds: odds && odds >= 1.01 ? odds : undefined,
  };
}
