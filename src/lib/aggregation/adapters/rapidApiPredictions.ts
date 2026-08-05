// -------------------------------------------------------------------------
// RapidAPI prediction-provider adapter.
//
// Connects model-based prediction APIs (Betminer, Boggio Football Prediction,
// "Sports Betting Predictions", etc.) that are sold on RapidAPI. Each provider
// becomes one "tipster" in our system — then OUR engine tracks its realised ROI
// over time and the verified filter surfaces the high-ROI ones automatically.
//
// Disabled without a key (returns []) so builds never hit the network.
// Each provider returns a different JSON shape, so the response→RawTip mapping
// is per-provider — see SOURCES.md for the field notes. Only the (verified,
// low-risk) shape is scaffolded here; fill the mapping in once tested with a key.
//
// ⚠️ Respect each provider's terms: you may power a product with the data, but
// most forbid reselling the raw API responses as a competing data feed.
// -------------------------------------------------------------------------
import type { RawTip } from '../types';
import { parseMarket } from '../normalize';

const RAPIDAPI_KEY = ''; // process.env.RAPIDAPI_KEY in a real build/worker

interface Provider {
  name: string; // becomes the tipster handle
  host: string; // RapidAPI host header
  path: string; // endpoint path (+ query)
  // Map one raw item from this provider's response to the fields we need.
  map: (item: any) => {
    home: string;
    away: string;
    league?: string;
    kickoff?: string;
    marketText: string; // free text -> parseMarket()
    odds?: number;
  } | null;
}

// Add providers here once you have a key. Example shape (adjust to real fields):
const PROVIDERS: Provider[] = [
  // {
  //   name: 'Betminer',
  //   host: 'betminer.p.rapidapi.com',
  //   path: '/fixture/list-predictions-by-day?date=2026-08-15',
  //   map: (m) => ({ home: m.home, away: m.away, league: m.league,
  //     kickoff: m.date, marketText: m.prediction, odds: m.odds }),
  // },
];

export async function rapidApiPredictionsSource(): Promise<RawTip[]> {
  if (!RAPIDAPI_KEY || PROVIDERS.length === 0) return [];

  const out: RawTip[] = [];
  for (const p of PROVIDERS) {
    try {
      const res = await fetch(`https://${p.host}${p.path}`, {
        headers: { 'x-rapidapi-key': RAPIDAPI_KEY, 'x-rapidapi-host': p.host },
      });
      const json: any = await res.json();
      const items: any[] = Array.isArray(json) ? json : (json.data ?? json.predictions ?? json.response ?? []);
      for (const raw of items) {
        const m = p.map(raw);
        if (!m) continue;
        const parsed = parseMarket(m.marketText);
        if (!parsed) continue;
        out.push({
          source: `rapidapi:${p.name}`,
          tipster: p.name,
          homeTeam: m.home,
          awayTeam: m.away,
          league: m.league ?? 'Various',
          kickoff: m.kickoff ?? new Date().toISOString(),
          market: parsed.market,
          selection: parsed.selection,
          odds: m.odds,
        });
      }
    } catch {
      /* skip unreachable provider */
    }
  }
  return out;
}
