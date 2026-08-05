// -------------------------------------------------------------------------
// API-Sports football predictions adapter (api-football.com).
//
// From ONE /predictions call per fixture we emit TWO independent signals:
//   1. "api-sports"   — the provider's own 1X2 probabilities (predictions.percent)
//   2. "our-poisson"  — OUR Poisson model (src/lib/poisson.ts) run on the team
//                        goal-averages in the same response → 1X2 + OU25 + BTTS.
// Same network cost, two signals — the owned model is a different METHOD, so it
// strengthens consensus (and adds OU/BTTS the provider advice often lacks).
//
// Portable: pass the key explicitly (Worker env) or fall back to process.env.
// No key / no fixture ids → [] so `astro build` never hits the network.
// -------------------------------------------------------------------------
import type { RawTip } from '../types';
import { parseMarket } from '../normalize';
import { predictMatch } from '../../poisson';

export interface ApiSportsConfig {
  apiKey?: string;
  fixtureIds?: number[];
  host?: string; // default v3.football.api-sports.io
}

const DEFAULT_HOST = 'v3.football.api-sports.io';

function resolveKey(cfg?: ApiSportsConfig): string {
  if (cfg?.apiKey) return cfg.apiKey;
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env;
  return env?.API_SPORTS_KEY ?? '';
}

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? '').replace('%', ''));
  return Number.isFinite(n) ? n : 0;
};

export async function apiFootballSource(cfg?: ApiSportsConfig): Promise<RawTip[]> {
  const key = resolveKey(cfg);
  const fixtureIds = cfg?.fixtureIds ?? [];
  if (!key || fixtureIds.length === 0) return []; // offline-safe default
  const host = cfg?.host ?? DEFAULT_HOST;

  const out: RawTip[] = [];
  for (const id of fixtureIds) {
    try {
      const res = await fetch(`https://${host}/predictions?fixture=${id}`, { headers: { 'x-apisports-key': key } });
      if (!res.ok) continue;
      const json = (await res.json()) as { response?: any[] };
      for (const r of json?.response ?? []) {
        const homeTeam = r?.teams?.home?.name ?? '';
        const awayTeam = r?.teams?.away?.name ?? '';
        const kickoff = r?.fixture?.date ?? '';
        if (!homeTeam || !awayTeam || !kickoff) continue;
        const base = { homeTeam, awayTeam, league: r?.league?.name ?? 'Unknown', kickoff, sport: 'football' as const };

        // --- 1) api-sports own 1X2 (percent), fallback to advice ------------
        const pc = r?.predictions?.percent;
        const ph = num(pc?.home), pd = num(pc?.draw), pa = num(pc?.away);
        if (ph || pd || pa) {
          const sel = ph >= pd && ph >= pa ? 'home' : pa >= pd ? 'away' : 'draw';
          out.push({ ...base, source: 'api-sports', tipster: 'api-sports-model', market: '1X2', selection: sel });
        } else {
          const parsed = parseMarket(r?.predictions?.advice ?? '');
          if (parsed) out.push({ ...base, source: 'api-sports', tipster: 'api-sports-model', market: parsed.market, selection: parsed.selection });
        }

        // --- 2) our Poisson model from team goal-averages -------------------
        const hs = num(r?.teams?.home?.league?.goals?.for?.average?.total);
        const hc = num(r?.teams?.home?.league?.goals?.against?.average?.total);
        const as = num(r?.teams?.away?.league?.goals?.for?.average?.total);
        const ac = num(r?.teams?.away?.league?.goals?.against?.average?.total);
        if (hs > 0 && hc > 0 && as > 0 && ac > 0) {
          const m = predictMatch({ home: { scoredAvg: hs, concededAvg: hc }, away: { scoredAvg: as, concededAvg: ac } });
          const x2 = m.home >= m.draw && m.home >= m.away ? 'home' : m.away >= m.draw ? 'away' : 'draw';
          out.push({ ...base, source: 'our-poisson', tipster: 'poisson-model', market: '1X2', selection: x2 });
          out.push({ ...base, source: 'our-poisson', tipster: 'poisson-model', market: 'OU25', selection: m.over25 >= m.under25 ? 'over' : 'under' });
          out.push({ ...base, source: 'our-poisson', tipster: 'poisson-model', market: 'BTTS', selection: m.bttsYes >= m.bttsNo ? 'yes' : 'no' });
        }
      }
    } catch {
      // network/parse error -> skip this fixture, keep the rest
    }
  }
  return out.filter((t) => t.homeTeam && t.awayTeam && t.kickoff);
}
