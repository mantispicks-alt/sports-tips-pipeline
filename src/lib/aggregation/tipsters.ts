// -------------------------------------------------------------------------
// Tipster reliability scoring.
// Rating blends ROI (sample-shrunk) and a Wilson lower-bound win rate, then
// shrinks the whole thing toward neutral for small samples — so a tipster
// with 3 lucky wins never outranks a proven one.
// -------------------------------------------------------------------------
import type { RawTip, TipsterRecord } from './types';

/** Wilson score lower bound (95%) for a win proportion. */
export function wilsonLower(won: number, n: number): number {
  if (n === 0) return 0;
  const z = 1.96;
  const p = won / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return Math.max(0, (centre - margin) / denom);
}

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const r1 = (x: number) => Math.round(x * 10) / 10;

// Sharp market + independent model sources. These are de-vigged prices or models,
// not scraped tipster opinions — inherently trustworthy even when their ROI is
// only ~breakeven (an efficient market has no edge but is NOT unreliable). They
// get a trust FLOOR so a single one can carry a pick with minimal cross-check.
export const TRUSTED_SOURCES = new Set([
  'pinnacle', 'odds:value', 'bzzoiro', 'fdcouk', 'fdcouk-model', 'clubelo',
]);
const TRUSTED_FLOOR = 72;

/**
 * How many INDEPENDENT sources a pick needs before we publish it, as a function
 * of the trust in the strongest source backing it. Good sources (proven ROI, or
 * sharp/model) need little corroboration; risky sources need a lot. The floor is
 * 2 — we NEVER publish on a single source, even a sharp one (always cross-check).
 *   rating >= 70  -> 2   (elite tipster or a sharp/model source: 2 is enough)
 *   rating >= 55  -> 3
 *   rating <  55  -> 4   (unproven/negative: demand heavy agreement)
 */
export function requiredCrossCheck(rating: number): number {
  if (rating >= 70) return 2;
  if (rating >= 55) return 3;
  return 4;
}

/** Effective trust of a pick = the strongest endorsement among its backers,
 *  with a floor for trusted market/model sources. */
export function backerTrust(backers: { source: string; rating: number }[]): number {
  let best = 0;
  for (const b of backers) {
    const eff = TRUSTED_SOURCES.has(b.source) ? Math.max(b.rating, TRUSTED_FLOOR) : b.rating;
    if (eff > best) best = eff;
  }
  return best;
}

export function buildTipsterRecords(tips: RawTip[]): TipsterRecord[] {
  const groups = new Map<string, RawTip[]>();
  for (const t of tips) {
    if (!t.result) continue;
    const key = `${t.source}:${t.tipster}`;
    let arr = groups.get(key);
    if (!arr) {
      arr = [];
      groups.set(key, arr);
    }
    arr.push(t);
  }

  const records: TipsterRecord[] = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => +new Date(a.kickoff) - +new Date(b.kickoff));

    let won = 0;
    let lost = 0;
    let voided = 0;
    let staked = 0;
    let returned = 0;
    // Sanitize odds before they hit ROI: a corrupt value (0/≤1, or an absurd
    // 28+/500 from a bad scrape) on even one winning pick otherwise blows the
    // ROI to +1382% / −100% and hijacks the rating. Out-of-range → 1.9 default.
    const oddsOf = (o?: number) => (typeof o === 'number' && o > 1.01 && o <= 26 ? o : 1.9);
    for (const t of sorted) {
      if (t.result === 'won') {
        won++;
        staked++;
        returned += oddsOf(t.odds);
      } else if (t.result === 'lost') {
        lost++;
        staked++;
      } else {
        voided++;
      }
    }

    const settled = won + lost;
    const winRate = settled ? (won / settled) * 100 : 0;
    const roi = staked ? ((returned - staked) / staked) * 100 : 0;

    const reliability = Math.min(1, settled / 40); // full trust at 40+ settled
    const adjRoi = roi * (settled / (settled + 25)); // shrink ROI on small samples
    const wl = wilsonLower(won, settled); // conservative win rate
    const rawRating = 50 + adjRoi * 2.2 + (wl - 0.5) * 55;
    const rating = Math.round(clamp(50 + (rawRating - 50) * reliability));

    const tier: TipsterRecord['tier'] =
      settled >= 30 && rating >= 78
        ? 'elite'
        : settled >= 20 && rating >= 64
          ? 'strong'
          : settled >= 10 && rating >= 50
            ? 'average'
            : 'unproven';

    const form = sorted
      .slice(-8)
      .reverse()
      .map((t) => (t.result === 'won' ? 'W' : t.result === 'lost' ? 'L' : '-')) as ('W' | 'L' | '-')[];

    const sep = key.indexOf(':');
    records.push({
      key,
      source: key.slice(0, sep),
      tipster: key.slice(sep + 1),
      settled,
      won,
      lost,
      voided,
      winRate: r1(winRate),
      roi: r1(roi),
      rating,
      tier,
      form,
    });
  }

  return records.sort((a, b) => b.rating - a.rating);
}
