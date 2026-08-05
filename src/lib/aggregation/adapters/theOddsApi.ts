// -------------------------------------------------------------------------
// The Odds API adapter → bookmaker-consensus favorite per match as a RawTip.
// ⚽ 1X2 (home/away/draw) / 🏀 ML (home/away). A 2nd independent signal:
// "the market's favorite". Verified live (v4 /sports + /odds, h2h, eu, decimal).
//
// ⚠️ Free tier ≈ 500 requests/MONTH. Each sport's odds call = 1 credit, so keep
// maxSports low and do NOT run this every 30 min — once or twice a day is plenty.
// -------------------------------------------------------------------------
import type { RawTip, MarketGroup, Sport } from '../types';

interface OddsEvent {
  id: string;
  sport_key: string;
  sport_title?: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: { markets?: { key: string; outcomes?: { name: string; price: number }[] }[] }[];
}

export interface TheOddsApiConfig {
  apiKey?: string;
  maxSports?: number;
}

export async function theOddsApiSource(cfg: TheOddsApiConfig = {}): Promise<RawTip[]> {
  const key = cfg.apiKey ?? (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.THE_ODDS_API_KEY ?? '';
  if (!key) return [];
  const maxSports = cfg.maxSports ?? 6;

  try {
    const sres = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${key}`);
    if (!sres.ok) return [];
    const sports = (await sres.json()) as { key: string; active: boolean }[];
    const wanted = sports
      .filter((s) => s.active && (s.key.startsWith('soccer_') || s.key.startsWith('basketball_')))
      .map((s) => s.key)
      .slice(0, maxSports);

    const tips: RawTip[] = [];
    for (const sk of wanted) {
      const r = await fetch(`https://api.the-odds-api.com/v4/sports/${sk}/odds/?apiKey=${key}&regions=eu&markets=h2h&oddsFormat=decimal`);
      if (!r.ok) continue;
      const events = (await r.json()) as OddsEvent[];
      const isBk = sk.startsWith('basketball_');
      const sport: Sport = isBk ? 'basketball' : 'football';
      const market: MarketGroup = isBk ? 'ML' : '1X2';

      for (const e of events) {
        const agg = new Map<string, number[]>();
        for (const bk of e.bookmakers ?? []) {
          const h2h = (bk.markets ?? []).find((m) => m.key === 'h2h');
          if (!h2h) continue;
          for (const o of h2h.outcomes ?? []) {
            const a = agg.get(o.name) ?? [];
            a.push(o.price);
            agg.set(o.name, a);
          }
        }
        if (!agg.size) continue;
        let fav: { name: string; avg: number } | null = null;
        for (const [name, prices] of agg) {
          const avg = prices.reduce((s, x) => s + x, 0) / prices.length;
          if (!fav || avg < fav.avg) fav = { name, avg };
        }
        if (!fav) continue;
        const selection = fav.name === e.home_team ? 'home' : fav.name === e.away_team ? 'away' : 'draw';
        tips.push({
          source: 'the-odds-api',
          tipster: 'odds-favorite',
          homeTeam: e.home_team,
          awayTeam: e.away_team,
          league: e.sport_title ?? sk,
          kickoff: e.commence_time,
          market,
          selection,
          odds: Math.round(fav.avg * 100) / 100,
          sport,
        });
      }
    }
    return tips;
  } catch {
    return [];
  }
}
