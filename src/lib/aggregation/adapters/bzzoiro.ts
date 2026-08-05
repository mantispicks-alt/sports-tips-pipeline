// -------------------------------------------------------------------------
// BSD / Bzzoiro adapter → picks derived from its multi-market odds.
// Endpoint (verified live): GET https://sports.bzzoiro.com/api/events/
//   auth: Authorization: Token <key>  ·  paginated via `next`.
// Broad coverage (~400+ events). Gives 1X2 + Over/Under 2.5 + BTTS from odds,
// so it adds market breadth the h2h-only odds sources don't. Football only.
// -------------------------------------------------------------------------
import type { RawTip } from '../types';

interface BzzEvent {
  home_team: string;
  away_team: string;
  league?: { name?: string };
  event_date: string;
  odds_home?: number | null;
  odds_draw?: number | null;
  odds_away?: number | null;
  odds_over_25?: number | null;
  odds_under_25?: number | null;
  odds_btts_yes?: number | null;
  odds_btts_no?: number | null;
}

export interface BzzoiroConfig {
  apiKey?: string;
  maxEvents?: number;
}

export async function bzzoiroSource(cfg: BzzoiroConfig = {}): Promise<RawTip[]> {
  const key = cfg.apiKey ?? (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.BZZOIRO_API_KEY ?? '';
  if (!key) return [];
  const max = cfg.maxEvents ?? 100;

  const tips: RawTip[] = [];
  let url: string | null = 'https://sports.bzzoiro.com/api/events/?limit=50';
  let fetched = 0;
  try {
    while (url && fetched < max) {
      const r: Response = await fetch(url, { headers: { Authorization: `Token ${key}` } });
      if (!r.ok) break;
      const j = (await r.json()) as { results?: BzzEvent[]; next?: string | null };
      for (const e of j.results ?? []) {
        fetched++;
        const base = {
          source: 'bzzoiro',
          tipster: 'bzzoiro-odds',
          homeTeam: e.home_team,
          awayTeam: e.away_team,
          league: e.league?.name ?? 'Unknown',
          kickoff: e.event_date,
          sport: 'football' as const,
        };
        if (e.odds_home != null && e.odds_draw != null && e.odds_away != null) {
          const ranked = ([['home', e.odds_home], ['draw', e.odds_draw], ['away', e.odds_away]] as [string, number][])
            .sort((a, b) => a[1] - b[1]);
          tips.push({ ...base, market: '1X2', selection: ranked[0][0], odds: ranked[0][1] });
        }
        if (e.odds_over_25 != null && e.odds_under_25 != null) {
          const over = e.odds_over_25 <= e.odds_under_25;
          tips.push({ ...base, market: 'OU25', selection: over ? 'over' : 'under', odds: over ? e.odds_over_25 : e.odds_under_25 });
        }
        if (e.odds_btts_yes != null && e.odds_btts_no != null) {
          const yes = e.odds_btts_yes <= e.odds_btts_no;
          tips.push({ ...base, market: 'BTTS', selection: yes ? 'yes' : 'no', odds: yes ? e.odds_btts_yes : e.odds_btts_no });
        }
      }
      url = j.next && fetched < max ? j.next : null;
    }
  } catch {
    /* return whatever we gathered */
  }
  return tips;
}
