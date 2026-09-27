// -------------------------------------------------------------------------
// D1 access layer for the tips bot. Maps our aggregation types onto the
// tables in db/schema.sql. Tables are filled in stages: fixtures -> raw_tips
// -> settlements -> source_performance -> published_picks.
// -------------------------------------------------------------------------
import type { D1Database } from './types';
import type { RawTip, ConsensusPick, TipsterRecord, Sport, MarketGroup, Outcome } from '../src/lib/aggregation/types';
import { matchKey, slugTeam, settle } from '../src/lib/aggregation/normalize';

export interface FixtureRow {
  id: string; // canonical, e.g. "apisports:fb:12345"
  provider: string;
  sport: Sport;
  league: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  status: string;
  finished?: boolean;
  homeScore?: number;
  awayScore?: number;
}

export interface ResultRow {
  id: string;
  sport: Sport;
  homeScore: number;
  awayScore: number;
}

interface RawTipDbRow {
  source_id: string;
  fixture_id: string | null;
  sport: string;
  home_team: string;
  away_team: string;
  league: string | null;
  kickoff: string | null;
  market: string;
  selection: string;
  line: number | null;
  odds: number | null;
  result: string;
}

function rowToRawTip(r: RawTipDbRow): RawTip {
  const [source, tipster] = splitSourceKey(r.source_id);
  const result = r.result === 'won' || r.result === 'lost' || r.result === 'void' ? (r.result as Outcome) : undefined;
  return {
    source,
    tipster,
    homeTeam: r.home_team,
    awayTeam: r.away_team,
    league: r.league ?? 'Unknown',
    kickoff: r.kickoff ?? '',
    market: r.market as MarketGroup,
    selection: r.selection,
    line: r.line ?? undefined,
    odds: r.odds ?? undefined,
    sport: (r.sport as Sport) ?? 'football',
    result,
  };
}

// raw_tips.source_id stores the full source id (e.g. 'api-sports'); the tipster
// handle rides along on the RawTip. We store `${source}::${tipster}` when they
// differ, else just the source.
function joinSourceKey(source: string, tipster: string): string {
  return source === tipster ? source : `${source}::${tipster}`;
}
function splitSourceKey(id: string): [string, string] {
  const i = id.indexOf('::');
  return i === -1 ? [id, id] : [id.slice(0, i), id.slice(i + 2)];
}

/** Upsert canonical fixtures. Returns a matchKey -> canonical id map for linking tips. */
export async function upsertFixtures(db: D1Database, fixtures: FixtureRow[]): Promise<Map<string, string>> {
  const link = new Map<string, string>();
  if (!fixtures.length) return link;
  const stmt = db.prepare(
    `INSERT INTO fixtures (id, provider, sport, league, home_team, away_team, home_slug, away_slug, kickoff, status)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET status=excluded.status, kickoff=excluded.kickoff, updated_at=datetime('now')`,
  );
  const batch = fixtures.map((f) => {
    link.set(matchKey(f.homeTeam, f.awayTeam, f.kickoff, f.sport), f.id);
    return stmt.bind(
      f.id, f.provider, f.sport, f.league, f.homeTeam, f.awayTeam,
      slugTeam(f.homeTeam), slugTeam(f.awayTeam), f.kickoff, f.status,
    );
  });
  await db.batch(batch);
  return link;
}

/** Insert ingested tips (idempotent via dedupe_key). Links to fixture where known. */
export async function upsertRawTips(db: D1Database, tips: RawTip[], link?: Map<string, string>): Promise<number> {
  if (!tips.length) return 0;
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO raw_tips
       (source_id, fixture_id, sport, home_team, away_team, league, kickoff, market, selection, line, odds, dedupe_key)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const batch = tips.map((t) => {
    const sport: Sport = t.sport ?? 'football';
    const mk = matchKey(t.homeTeam, t.awayTeam, t.kickoff, sport);
    const fixtureId = link?.get(mk) ?? null;
    const sourceKey = joinSourceKey(t.source, t.tipster);
    const dedupe = `${sourceKey}|${mk}|${t.market}|${t.selection}`;
    return stmt.bind(
      sourceKey, fixtureId, sport, t.homeTeam, t.awayTeam, t.league,
      t.kickoff, t.market, t.selection, t.line ?? null, t.odds ?? null, dedupe,
    );
  });
  await db.batch(batch);
  return tips.length;
}

/** Write final results per fixture. */
export async function upsertSettlements(db: D1Database, results: ResultRow[]): Promise<number> {
  if (!results.length) return 0;
  const stmt = db.prepare(
    `INSERT INTO settlements (fixture_id, sport, home_score, away_score, status)
     VALUES (?,?,?,?, 'settled')
     ON CONFLICT(fixture_id) DO UPDATE SET home_score=excluded.home_score, away_score=excluded.away_score, status='settled', settled_at=datetime('now')`,
  );
  await db.batch(results.map((r) => stmt.bind(r.id, r.sport, r.homeScore, r.awayScore)));
  return results.length;
}

/** Settle still-pending raw_tips whose fixture now has a result. */
export async function settleRawTips(db: D1Database, results: ResultRow[]): Promise<number> {
  let n = 0;
  for (const r of results) {
    const rows = (
      await db
        .prepare(`SELECT id, market, selection, line FROM raw_tips WHERE fixture_id=? AND result='pending'`)
        .bind(r.id)
        .all<{ id: number; market: string; selection: string; line: number | null }>()
    ).results;
    if (!rows.length) continue;
    const upd = db.prepare(`UPDATE raw_tips SET result=? WHERE id=?`);
    const batch = rows.map((row) =>
      upd.bind(settle(row.market as MarketGroup, row.selection, r.homeScore, r.awayScore, row.line ?? undefined), row.id),
    );
    await db.batch(batch);
    n += rows.length;
  }
  return n;
}

/** Read tips by settlement state (mapped back to RawTip).
 *
 * `sinceDays` bounds the query to a rolling window on the raw_tips.kickoff
 * column so a 5-year-old row never gets scanned in the hot path. Default:
 *   settled → last 90 days (enough history for source scoring)
 *   pending → last 14 days (older pending is either forgotten or void-swept)
 * Pass `0` (or `Infinity`) to disable the window and scan the whole table —
 * only meaningful for one-off migrations, never for the cron path.
 */
export async function readTips(
  db: D1Database,
  state: 'pending' | 'settled',
  sinceDays?: number,
): Promise<RawTip[]> {
  const where = state === 'settled' ? `result IN ('won','lost','void')` : `result='pending'`;
  const bound = sinceDays ?? (state === 'settled' ? 90 : 14);
  const useWindow = Number.isFinite(bound) && bound > 0;
  const rows = useWindow
    ? (await db
        .prepare(`SELECT * FROM raw_tips WHERE ${where} AND kickoff > datetime('now', ?1)`)
        .bind(`-${bound} days`)
        .all<RawTipDbRow>()).results
    : (await db.prepare(`SELECT * FROM raw_tips WHERE ${where}`).all<RawTipDbRow>()).results;
  return rows.map(rowToRawTip);
}

/** Read cached tipster scores + fixture links without rescanning raw_tips.
 *
 * The consensus step needs "which sources are promoted?" and a matchKey →
 * fixture_id map. Both live in tables (source_performance, fixtures) that
 * grow at O(source × 1) and O(fixtures × 1) instead of O(raw_tips × 1). This
 * lets an ingest fire stay under a few thousand reads even as raw_tips
 * grows into the millions.
 */
export async function readPromotedSources(db: D1Database): Promise<Set<string>> {
  const rows = (await db
    .prepare(`SELECT source_id FROM source_performance WHERE promoted = 1`)
    .all<{ source_id: string }>()).results;
  return new Set(rows.map((r) => r.source_id));
}

export async function readSourceRatings(db: D1Database): Promise<Map<string, number>> {
  const rows = (await db
    .prepare(`SELECT source_id, rating FROM source_performance`)
    .all<{ source_id: string; rating: number }>()).results;
  return new Map(rows.map((r) => [r.source_id, r.rating]));
}

/** Purge raw_tips older than `days` (default 180) with result != 'pending'.
 * Keeps storage flat while the pipeline runs forever. */
export async function purgeOldSettled(db: D1Database, days = 180): Promise<number> {
  const r = await db
    .prepare(
      `DELETE FROM raw_tips
       WHERE result IN ('won','lost','void')
       AND kickoff < datetime('now', ?1)`,
    )
    .bind(`-${days} days`)
    .run();
  return Number((r as any).meta?.changes ?? 0);
}

/** matchKey -> canonical fixture id, for linking consensus picks back to a fixture. */
export async function readFixtureLinks(db: D1Database): Promise<Map<string, string>> {
  const rows = (
    await db.prepare(`SELECT id, sport, home_team, away_team, kickoff FROM fixtures`).all<{
      id: string;
      sport: string;
      home_team: string;
      away_team: string;
      kickoff: string;
    }>()
  ).results;
  const link = new Map<string, string>();
  for (const r of rows) link.set(matchKey(r.home_team, r.away_team, r.kickoff, (r.sport as Sport) ?? 'football'), r.id);
  return link;
}

/** Upsert rolling per-source performance + promotion flag. */
export async function upsertSourcePerformance(
  db: D1Database,
  records: TipsterRecord[],
  firstSeen: Map<string, string>,
  isPromoted: (r: TipsterRecord, firstSeenISO: string | undefined) => boolean,
): Promise<number> {
  if (!records.length) return 0;
  const stmt = db.prepare(
    `INSERT INTO source_performance (source_id, settled, won, lost, voided, win_rate, roi, rating, first_seen, promoted, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now'))
     ON CONFLICT(source_id) DO UPDATE SET
       settled=excluded.settled, won=excluded.won, lost=excluded.lost, voided=excluded.voided,
       win_rate=excluded.win_rate, roi=excluded.roi, rating=excluded.rating,
       first_seen=excluded.first_seen, promoted=excluded.promoted, updated_at=datetime('now')`,
  );
  const batch = records.map((r) => {
    const fs = firstSeen.get(r.key);
    return stmt.bind(
      r.key, r.settled, r.won, r.lost, r.voided, r.winRate, r.roi, r.rating,
      fs ?? null, isPromoted(r, fs) ? 1 : 0,
    );
  });
  await db.batch(batch);
  return records.length;
}

/** Insert verified consensus picks (idempotent). Only picks with a known fixture. */
export async function writePublishedPicks(
  db: D1Database,
  picks: ConsensusPick[],
  link: Map<string, string>,
): Promise<number> {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO published_picks
       (fixture_id, sport, market, selection, line, label, backer_count, consensus_pct, avg_odds, confidence)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  const batch = picks
    .map((p) => ({ p, fixtureId: link.get(p.matchKey) }))
    .filter((x): x is { p: ConsensusPick; fixtureId: string } => !!x.fixtureId)
    .map(({ p, fixtureId }) =>
      stmt.bind(
        fixtureId, p.sport ?? 'football', p.market, p.selection, p.line ?? null, p.label,
        p.backerCount, p.consensusPct, p.avgOdds, p.confidence,
      ),
    );
  if (!batch.length) return 0;
  await db.batch(batch);
  return batch.length;
}

/** Read currently-published (pending) picks for the site to render.
 *
 * Joins fixtures so the site gets team + kickoff + league in one call.
 * Deliberately omits `backer_count` and `consensus_pct`. Those numbers
 * are proprietary — publishing them lets competing operators copy our
 * edge without doing the vetting, and lets scrapers front-run our picks.
 * See src/pages/methodology.astro for the public-facing rationale.
 */
export async function getPublishedPicks(db: D1Database, limit = 50): Promise<unknown[]> {
  const r = await db
    .prepare(
      `SELECT p.fixture_id, p.sport, p.market, p.selection, p.line, p.label, p.avg_odds, p.confidence,
              f.home_team, f.away_team, f.kickoff, f.league
       FROM published_picks p
       JOIN fixtures f ON f.id = p.fixture_id
       WHERE p.result='pending'
       ORDER BY p.confidence DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all();
  return r.results;
}

/** Read RECENTLY-SETTLED outcomes so the static site can update its WON/LOST
 * badges without waiting for the next 2h pipeline rebuild. Keyed by matchKey
 * (same key the static content uses) so the client-side poller can O(1) look
 * up whether a card's fixture has resolved.
 *
 * Window: only picks whose fixture kicked off in the last N days (default 3).
 * Older results are already baked into the static build.
 */
export async function getRecentOutcomes(
  db: D1Database,
  sinceDays = 3,
): Promise<{ matchKey: string; result: 'won' | 'lost' | 'void'; market: string; selection: string; line: number | null }[]> {
  const rows = (await db
    .prepare(
      `SELECT p.market, p.selection, p.line, p.result,
              f.sport, f.home_team, f.away_team, f.kickoff
       FROM published_picks p
       JOIN fixtures f ON f.id = p.fixture_id
       WHERE p.result IN ('won','lost','void')
         AND f.kickoff > datetime('now', ?1)`,
    )
    .bind(`-${sinceDays} days`)
    .all<{
      market: string;
      selection: string;
      line: number | null;
      result: string;
      sport: string;
      home_team: string;
      away_team: string;
      kickoff: string;
    }>()).results;
  return rows.map((r) => ({
    matchKey: matchKey(r.home_team, r.away_team, r.kickoff, (r.sport as Sport) ?? 'football'),
    result: r.result as 'won' | 'lost' | 'void',
    market: r.market,
    selection: r.selection,
    line: r.line,
  }));
}
