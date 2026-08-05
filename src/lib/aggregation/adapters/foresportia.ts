// -------------------------------------------------------------------------
// Foresportia adapter → model probabilities → 1X2 pick.
// Endpoint (verified): GET https://api.foresportia.com/v1/matches/today
//   auth: X-API-Key header. Response: { matches: [Match] }.
//   Match fields (from openapi): home, away, league/comp, kickoff_iso,
//   p_home, p_draw, p_away, confidence, status.
// An INDEPENDENT model signal (not bookmaker odds) — good for cross-check.
// -------------------------------------------------------------------------
import type { RawTip } from '../types';

interface ForesportiaMatch {
  home: string;
  away: string;
  league?: string;
  comp?: string;
  kickoff_iso?: string;
  utc?: string;
  date?: string;
  p_home?: number;
  p_draw?: number;
  p_away?: number;
  confidence?: number;
  status?: string;
}

export interface ForesportiaConfig {
  apiKey?: string;
}

export async function foresportiaSource(cfg: ForesportiaConfig = {}): Promise<RawTip[]> {
  const key = cfg.apiKey ?? (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.FORESPORTIA_API_KEY ?? '';
  if (!key) return [];
  try {
    const r = await fetch('https://api.foresportia.com/v1/matches/today', { headers: { 'X-API-Key': key } });
    if (!r.ok) return [];
    const j = (await r.json()) as { matches?: ForesportiaMatch[] };
    const tips: RawTip[] = [];
    for (const m of j.matches ?? []) {
      if (!m.home || !m.away || m.p_home == null || m.p_draw == null || m.p_away == null) continue;
      const ranked = ([['home', m.p_home], ['draw', m.p_draw], ['away', m.p_away]] as [string, number][])
        .sort((a, b) => b[1] - a[1]);
      tips.push({
        source: 'foresportia',
        tipster: 'foresportia-model',
        homeTeam: m.home,
        awayTeam: m.away,
        league: m.league ?? m.comp ?? 'Unknown',
        kickoff: m.kickoff_iso ?? m.utc ?? m.date ?? '',
        market: '1X2',
        selection: ranked[0][0],
        sport: 'football',
      });
    }
    return tips;
  } catch {
    return [];
  }
}
