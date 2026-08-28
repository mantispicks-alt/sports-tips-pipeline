// -------------------------------------------------------------------------
// Tipster reliability scoring.
// Rating blends ROI (sample-shrunk) and a Wilson lower-bound win rate, then
// shrinks the whole thing toward neutral for small samples — so a tipster
// with 3 lucky wins never outranks a proven one.
// -------------------------------------------------------------------------
import type { RawTip, TipsterRecord } from './types';
import { matchKey, canonicalSelection } from './normalize';

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

// Sharp MARKET sources only — de-vigged bookmaker/exchange prices. These reflect
// real money and are inherently trustworthy even when their ROI is ~breakeven (an
// efficient market has no edge but is NOT unreliable), so they get a trust FLOOR
// that lets a single one carry a pick with light cross-check. MODELS are NOT here
// (clubelo Elo, fdcouk-model Poisson): a home-grown model must EARN trust by its
// settled ROI like any tipster — a losing model should get heavy cross-check, not
// a floor.
export const TRUSTED_SOURCES = new Set([
  'pinnacle', 'pinnacle-steam', 'odds:value', 'bzzoiro', 'fdcouk',
]);
const TRUSTED_FLOOR = 72;

// Sources that may not carry a pick ALONE (they still count when they AGREE with
// another source — a real cross-check). Membership is judged by ROI on priced
// bets, NEVER by raw win%: a low win% can be a value picker who is +ROI on the
// odds (typersi ~36% win but +9% ROI, predictinho breakeven, mybets +5% — all
// KEPT; cutting them on win% is the exact mistake ROI exists to prevent). Only
// sources CONFIRMED to lose money on their settled priced record belong here:
//   - site:vitibet  (-19% ROI)
//   - tg:apuestas-pronosticos-deportivas  (-72% ROI; the earlier active:false
//     drop used underscores and never matched the real hyphen key, so it leaked
//     back in — this is the effective block)
// Re-audit with scripts/audit-sources.ts (ROI, not win%) before adding any.
export const SOLO_BLOCKLIST = new Set([
  'site:vitibet', 'tg:apuestas-pronosticos-deportivas',
]);

// Sources trusted enough to carry a pick ALONE (no cross-check) in EITHER band —
// the opposite end of SOLO_BLOCKLIST. Currently only the high-efficiency (>=80%)
// typersi top-5 tipsters (source site:typersi-elite): a proven-hot ranked tipster's
// pick publishes solo; their <80% peers (site:typersi) still need normal cross-check.
export const SOLO_TRUSTED = new Set<string>([
  // site:typersi-elite was here — REMOVED 2026-08-28. The "elite" tier is the
  // SITE's self-reported efficiency %, not our verified ROI. The one elite tipster
  // we actually saw (piwotyskie) was 0-2 in our settled data and lost the pick it
  // published. No source publishes SOLO until it proves n>=25 settled at +ROI.
  // typersi-elite stays a normal cross-check backer via SOURCE_BANDS (fav+value).
]);

// ==== Odds-band routing (generated 2026-08-24 from real settled history) ======
// Each tipster is +ROI only in certain odds bands. The market bleeds the margin
// on favorites (even pinnacle is −6% at ≤1.80) and is strongly beatable on value
// (global +56% ROI at ≥2.60, +247% at 6.0+), with a DEAD zone 1.80–2.60 that no
// one beats. So a pick is published only in a band where a backing tipster has a
// proven edge — see bandAllowed(). Re-audit with scripts/audit-sources.ts before
// editing these maps; ROI (not win%) decides membership.

// Proven money-losers in EVERY band with a real sample — cut entirely (also
// deactivated at the source level; this Set is a publish-time backstop).
export const DROP_SOURCES = new Set<string>([
  'site:betgenuine', // −31% ROI (audit); was unrated so it published on trust
  'site:betsloaded', 'site:bettingclosed', 'site:freesupertips', 'site:infogol',
  'site:primatips', 'site:tips180', 'site:feedinco', 'site:soccerway',
  'tg:gutmanbetting', 'tg:tipstrrtips', 'tg:ibettingxx',
  'tg:apuestas-pronosticos-deportivas', 'web:kingspredict', 'web:meritpredict',
  'web:soccerpunt', 'web:solidpredict', 'web:legitpredict', 'web:venasbet',
  'clubelo',
]);

// The bands where each kept source is +ROI. `anchor` = sharp/market source: it
// corroborates a pick (cross-check) but does NOT justify an odds band on its own.
// A source absent from BOTH maps is new/unrated → given the benefit of the doubt.
export const SOURCE_BANDS: Record<string, { fav?: boolean; mid?: boolean; value?: boolean; anchor?: boolean }> = {
  // anchors (cross-check backbone)
  'pinnacle': { anchor: true }, 'pinnacle-steam': { anchor: true },
  'bzzoiro': { anchor: true }, 'fdcouk': { anchor: true },
  // win / favorites (+ROI at ≤1.80)
  'web:tips1960': { fav: true }, 'site:sportsmole': { fav: true },
  'site:soccer-rating': { fav: true }, 'site:andysbetclub': { fav: true },
  // 'fdcouk-model' removed from fav 2026-08-28 — its published FAVORITES were 31-21 / −8.3% ROI.
  // Now unrated: still counts as a raw cross-check body, but no longer JUSTIFIES a favorite band.
  'web:kcpredict': { fav: true },
  'site:adibet': { fav: true },
  'web:confirmbets': { fav: true },
  'site:prosoccer': { fav: true, mid: true }, 'site:twoscores': { fav: true, mid: true },
  // value (+ROI at ≥2.60)
  'odds:value': { value: true }, 'site:zulubet': { value: true },
  'site:typersi': { value: true }, // top-5-ranked tipsters, <80% efficiency (see refresh-sites processTypersi)
  'site:typersi-elite': { fav: true, value: true }, // top-5 tipsters with >=80% efficiency — cross-check backer both bands (NO LONGER solo; see SOLO_TRUSTED note)
  'web:kickpredictions': { value: true }, 'site:vitibet': { value: true },
  'site:soccerpunter': { value: true }, 'site:mybets': { value: true },
  'site:olbg': { value: true }, 'site:predictinho': { value: true },
  'web:statarea': { value: true }, 'site:sportsgambler': { value: true },
  'site:soccerstats': { value: true },
  // 'site:betexplorer' moved value→fav 2026-08-28: its VALUE picks were 3-10 / −38% ROI,
  // but its FAVORITES were 83-36 / +4.8% ROI (n=119). It's a favorite source, not a value one.
  'site:betexplorer': { fav: true },
  'site:footballpredictions-ai': { value: true },
  'site:cappertek-soccer': { value: true, mid: true },
  // mid only (+ROI in the 1.80–2.60 band that's dead for everyone else)
  'site:stakegains': { mid: true },
};

export function bandOf(odds: number): 'fav' | 'dead' | 'value' {
  if (!(odds > 0)) return 'dead';
  if (odds <= 1.8) return 'fav';
  if (odds >= 2.6) return 'value';
  return 'dead';
}

// Is this pick allowed to publish at its odds? Gentle rule: suppress ONLY when a
// RATED tipster backs it yet no rated backer has an edge in this band (e.g. a
// value-source's favorite pick, or any pick in the dead zone). Picks carried only
// by anchors or by new/unrated sources pass — anchors keep small-league coverage,
// unrated sources get a fair trial. This is orthogonal to the cross-check count.
export function bandAllowed(backers: { source: string }[], odds: number): boolean {
  const band = bandOf(odds);
  const rated = backers
    .map((b) => SOURCE_BANDS[b.source])
    .filter((r): r is NonNullable<typeof r> => !!r && !r.anchor);
  if (rated.length === 0) {
    // Only anchors / unrated backing this pick. Favorites & value keep the pass
    // (anchor coverage on the match, or a fair trial for a new source). The dead
    // zone (1.80–2.60) is −8% ROI for everyone with no proven beater, so its
    // weakest picks — anchor-coverage-only or unrated-only — are NOT worth
    // publishing: require a proven mid-keeper there.
    return band !== 'dead';
  }
  return rated.some((r) => (band === 'fav' && r.fav) || (band === 'value' && r.value) || (band === 'dead' && r.mid));
}
// Count backers that are PROVEN-GOOD FAVORITE sources: the odds-band `fav` tipsters
// (audited +ROI on favorites) plus the sharp market anchors (Pinnacle/Betfair/
// bzzoiro/fdcouk) — a de-vigged sharp price is the single best favorite signal.
// The favorites feed publishes only on strong agreement among THESE (not just any
// source): a favorite N of them independently back is a real banker. Value/high
// picks are judged separately (they're contrarian) — do NOT use this for them.
export function favoriteBackerCount(backers: { source: string }[]): number {
  let n = 0;
  for (const b of backers) {
    const c = SOURCE_BANDS[b.source];
    if (c && (c.fav === true || c.anchor === true)) n++;
  }
  return n;
}
// ==============================================================================

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

/**
 * Cross-check requirement for a WHOLE pick, aware of whether the fixture even HAS
 * sharp coverage. Small/obscure leagues (3rd tier, foreign 2nd divisions) are
 * covered ONLY by tipsters — no sharp/market source prices them — yet the data
 * shows those tipster picks are +ROI. Demanding the normal floor-2 cross-check
 * there is impossible (there's no 2nd independent source to agree), so it would
 * silently kill exactly that profitable small-league stream. So:
 *   - fixture HAS a sharp/market backer -> normal quality-weighted rule (floor 2:
 *     cross-check IS possible here, so demand it).
 *   - fixture is tipster-only (no sharp) -> a DECENT tipster (rating >= 55) may
 *     carry it solo; a weak/negative one (< 55) still needs a 2nd tipster to agree.
 */
export function requiredCrossCheckForPick(
  backers: { source: string; rating: number }[],
  matchHasSharp = false,
): number {
  const hasSharp = backers.some((b) => TRUSTED_SOURCES.has(b.source));
  if (hasSharp) return requiredCrossCheck(backerTrust(backers));
  // The fixture IS sharp-covered (a sharp/market source priced the MATCH) even
  // though none backs THIS selection — so cross-check IS possible here. A lone
  // tipster must not carry a pick beside sharp money: demand a 2nd agreeing
  // source. (Floor 2, not the full 2/3/4 rule, so this closes the "solo pick on
  // a sharp-priced match" leak without over-cutting the board.)
  if (matchHasSharp) return 2;
  // Genuinely uncovered small league (no sharp anywhere on the fixture). A proven
  // SOLO loser (see SOLO_BLOCKLIST) still needs a 2nd source to agree; otherwise
  // a non-loser tipster (rating >= 50, i.e. neutral or better — proven losers were
  // already dropped) may carry it solo. The daily curation cap + confidence
  // ranking keep the sharp-covered picks featured first, so these fill the
  // remaining slots rather than flooding the page.
  if (backers.length === 1 && SOLO_BLOCKLIST.has(backers[0].source)) return 2;
  const best = backers.reduce((m, b) => Math.max(m, b.rating), 0);
  return best >= 50 ? 1 : 2;
}

export function buildTipsterRecords(tips: RawTip[]): TipsterRecord[] {
  // Cross-source odds backfill. Many sources (soccerpunter, betexplorer, …) never
  // archive their OWN odds, so their ROI defaulted to a flat 1.9 — which pins them
  // to ~0% ROI regardless of how they actually did, under-rating real earners
  // (e.g. betexplorer is +10.8% on backfilled prices but was rated ~46). Build a
  // price pool per exact pick (matchKey|market|selection) from every source that
  // DID quote it, so a no-odds pick is scored at the market price a follower would
  // have gotten (the median) instead of the blunt 1.9 default.
  const inRange = (o?: number): number | null => (typeof o === 'number' && o > 1.01 && o <= 26 ? o : null);
  const pickKey = (t: RawTip) =>
    `${matchKey(t.homeTeam, t.awayTeam, t.kickoff, t.sport ?? 'football')}|${t.market}|${canonicalSelection(t.market, t.selection, t.homeTeam, t.awayTeam)}`;
  const oddsPool = new Map<string, number[]>();
  for (const t of tips) {
    const o = inRange(t.odds);
    if (!o || !t.homeTeam || !t.awayTeam || !t.kickoff) continue;
    const k = pickKey(t);
    const arr = oddsPool.get(k) ?? oddsPool.set(k, []).get(k)!;
    arr.push(o);
  }
  const median = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  // Effective ROI odds for a pick: its own price if archived, else the cross-source
  // median for that exact pick, else the 1.9 last-resort default.
  const oddsOf = (t: RawTip): number => {
    const own = inRange(t.odds);
    if (own) return own;
    const pool = oddsPool.get(pickKey(t));
    return pool && pool.length ? median(pool) : 1.9;
  };

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
    for (const t of sorted) {
      if (t.result === 'won') {
        won++;
        staked++;
        returned += oddsOf(t);
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
