// -------------------------------------------------------------------------
// Turns settled tips into transparent performance stats (flat 1-unit stakes).
// Powers the /results page and the homepage trust snapshot.
// -------------------------------------------------------------------------
import type { CollectionEntry } from 'astro:content';

export interface MonthStat {
  label: string;
  profit: number;
  count: number;
}

export interface EquityPoint {
  date: Date;
  cum: number;
}

export interface ResultsSummary {
  total: number;
  pending: number;
  settled: number;
  won: number;
  lost: number;
  voided: number;
  winRate: number; // %
  staked: number; // units
  profit: number; // units (flat 1u stakes)
  roi: number; // %
  avgOdds: number;
  equity: EquityPoint[];
  byMonth: MonthStat[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function computeResults(tips: CollectionEntry<'tips'>[]): ResultsSummary {
  const settledTips = tips
    .filter((t) => ['won', 'lost', 'void'].includes(t.data.result))
    .sort((a, b) => +a.data.kickoff - +b.data.kickoff);

  let won = 0;
  let lost = 0;
  let voided = 0;
  let staked = 0;
  let profit = 0;
  let oddsSum = 0;
  let cum = 0;
  const equity: EquityPoint[] = [];
  const monthMap = new Map<string, { profit: number; count: number; order: number }>();

  for (const t of settledTips) {
    const { odds, result, kickoff } = t.data;
    let p = 0;
    if (result === 'won') {
      won++;
      staked += 1;
      oddsSum += odds;
      p = odds - 1;
    } else if (result === 'lost') {
      lost++;
      staked += 1;
      oddsSum += odds;
      p = -1;
    } else {
      voided++;
    }
    profit += p;
    cum += p;
    equity.push({ date: kickoff, cum: r2(cum) });

    const key = `${kickoff.getFullYear()}-${kickoff.getMonth()}`;
    const m = monthMap.get(key) ?? { profit: 0, count: 0, order: +kickoff };
    m.profit += p;
    if (result !== 'void') m.count += 1;
    monthMap.set(key, m);
  }

  const settled = won + lost;
  const fmtMonth = (ms: number) =>
    new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit' }).format(new Date(ms));

  return {
    total: tips.length,
    pending: tips.length - settledTips.length,
    settled,
    won,
    lost,
    voided,
    winRate: settled ? Math.round((won / settled) * 1000) / 10 : 0,
    staked,
    profit: r2(profit),
    roi: staked ? Math.round((profit / staked) * 1000) / 10 : 0,
    avgOdds: settled ? r2(oddsSum / settled) : 0,
    equity,
    byMonth: [...monthMap.values()]
      .sort((a, b) => a.order - b.order)
      .map((v) => ({ label: fmtMonth(v.order), profit: r2(v.profit), count: v.count })),
  };
}
