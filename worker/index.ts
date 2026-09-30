// -------------------------------------------------------------------------
// the pipeline bot — Cloudflare Worker (cron ingestion + read API).
//
// Full V1 loop (no LLM -> no 429):
//   cron -> fixtures (API-Sports) -> `fixtures`
//        -> model predictions      -> `raw_tips`
//        -> finished results        -> `settlements` + settle `raw_tips`
//        -> score sources           -> `source_performance` (+ promotion)
//        -> consensus of promoted   -> `published_picks`  (min 2 sources)
//
// Offline/no-key safe: without API_SPORTS_KEY or INGEST_ENABLED!=="true" the
// cron is a no-op. Secrets come from Worker bindings (env), never the client.
// -------------------------------------------------------------------------
import type { Env, ExecutionContext } from './types';
import {
  upsertFixtures, upsertRawTips, upsertSettlements, settleRawTips,
  readTips, readFixtureLinks, upsertSourcePerformance, writePublishedPicks,
  getPublishedPicks, getRecentOutcomes, readPromotedSources, readSourceRatings, purgeOldSettled,
  type FixtureRow, type ResultRow,
} from './db';
import { apiFootballSource } from '../src/lib/aggregation/adapters/apiFootball';
import { theOddsApiSource } from '../src/lib/aggregation/adapters/theOddsApi';
import { bzzoiroSource } from '../src/lib/aggregation/adapters/bzzoiro';
import { foresportiaSource } from '../src/lib/aggregation/adapters/foresportia';
import { buildConsensus } from '../src/lib/aggregation/consensus';
import { buildTipsterRecords } from '../src/lib/aggregation/tipsters';
import { matchKey } from '../src/lib/aggregation/normalize';
import type { RawTip, TipsterRecord } from '../src/lib/aggregation/types';

const FB_HOST = 'v3.football.api-sports.io';
const FINISHED = new Set(['FT', 'AET', 'PEN']);
const PROMOTE_MIN_SETTLED = 100; // OR ...
const PROMOTE_MIN_DAYS = 30; //     ... 30 days of history

async function fetchTodayFootballFixtures(key: string, limit: number): Promise<FixtureRow[]> {
  const date = new Date().toISOString().slice(0, 10);
  try {
    const res = await fetch(`https://${FB_HOST}/fixtures?date=${date}`, { headers: { 'x-apisports-key': key } });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      response?: Array<{
        fixture?: { id?: number; date?: string; status?: { short?: string } };
        league?: { name?: string };
        teams?: { home?: { name?: string }; away?: { name?: string } };
        goals?: { home?: number | null; away?: number | null };
      }>;
    };
    return (json.response ?? [])
      .filter((r) => r.fixture?.id && r.teams?.home?.name && r.teams?.away?.name)
      .slice(0, limit)
      .map((r) => {
        const short = r.fixture?.status?.short ?? 'NS';
        const finished = FINISHED.has(short) && typeof r.goals?.home === 'number' && typeof r.goals?.away === 'number';
        return {
          id: `apisports:fb:${r.fixture!.id}`,
          provider: 'api-sports',
          sport: 'football' as const,
          league: r.league?.name ?? 'Unknown',
          homeTeam: r.teams!.home!.name!,
          awayTeam: r.teams!.away!.name!,
          kickoff: r.fixture?.date ?? `${date}T00:00:00Z`,
          status: short,
          finished,
          homeScore: finished ? (r.goals!.home as number) : undefined,
          awayScore: finished ? (r.goals!.away as number) : undefined,
        };
      });
  } catch {
    return [];
  }
}

function firstSeenMap(tips: RawTip[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const t of tips) {
    const key = `${t.source}:${t.tipster}`;
    const cur = m.get(key);
    if (!cur || t.kickoff < cur) m.set(key, t.kickoff);
  }
  return m;
}

function isPromoted(r: TipsterRecord, firstSeenISO: string | undefined): boolean {
  if (r.settled >= PROMOTE_MIN_SETTLED) return true;
  if (!firstSeenISO) return false;
  const ageDays = (Date.now() - Date.parse(firstSeenISO)) / 86_400_000;
  return ageDays >= PROMOTE_MIN_DAYS;
}

// Publish hygiene (#6): drop tips whose kickoff already passed, and drop a
// tipster's picks on a match+market where they posted contradictory selections.
function cleanTips(tips: RawTip[], now: number): RawTip[] {
  const conKey = (t: RawTip) =>
    `${t.source}:${t.tipster}|${matchKey(t.homeTeam, t.awayTeam, t.kickoff, t.sport ?? 'football')}|${t.market}`;
  const future = tips.filter((t) => {
    const ko = Date.parse(t.kickoff);
    return Number.isNaN(ko) || ko > now; // keep if unknown-time or still upcoming
  });
  const selsByKey = new Map<string, Set<string>>();
  for (const t of future) {
    const k = conKey(t);
    const s = selsByKey.get(k) ?? new Set<string>();
    s.add(t.selection);
    selsByKey.set(k, s);
  }
  return future.filter((t) => (selsByKey.get(conKey(t))?.size ?? 0) <= 1);
}

interface IngestSummary {
  fixtures: number; ingested: number; settled: number; published: number;
  rescoredSources?: number; skipped?: boolean;
}

/** Full pipeline pass. `rescoreSources` = true triggers the expensive
 * per-source scoring rebuild (reads last-90-days of settled raw_tips).
 * Every-15-min fires pass `false` and reuse the cached source_performance
 * table. Once-per-hour fires pass `true` so scores never go stale.
 */
async function runIngest(env: Env, opts: { rescoreSources?: boolean } = {}): Promise<IngestSummary> {
  if (env.INGEST_ENABLED !== 'true' || !env.API_SPORTS_KEY) {
    return { fixtures: 0, ingested: 0, settled: 0, published: 0, skipped: true };
  }
  const key = env.API_SPORTS_KEY;
  const limit = Number(env.FIXTURE_LIMIT ?? '20') || 20;

  // 1. fixtures (+ embedded results)
  const fixtures = await fetchTodayFootballFixtures(key, limit);
  const link = await upsertFixtures(env.DB, fixtures);

  // 2. model predictions -> raw_tips
  const fixtureIds = fixtures.map((f) => Number(f.id.split(':').pop()));
  const tips: RawTip[] = await apiFootballSource({ apiKey: key, fixtureIds });
  const oddsTips: RawTip[] = env.THE_ODDS_API_KEY
    ? await theOddsApiSource({ apiKey: env.THE_ODDS_API_KEY, maxSports: 6 })
    : [];
  const bzzTips: RawTip[] = env.BZZOIRO_API_KEY
    ? await bzzoiroSource({ apiKey: env.BZZOIRO_API_KEY, maxEvents: 100 })
    : [];
  const foreTips: RawTip[] = env.FORESPORTIA_API_KEY
    ? await foresportiaSource({ apiKey: env.FORESPORTIA_API_KEY })
    : [];
  const ingested = await upsertRawTips(env.DB, [...tips, ...oddsTips, ...bzzTips, ...foreTips], link);

  // 3. settle finished fixtures embedded in this fixtures fetch
  const results: ResultRow[] = fixtures
    .filter((f) => f.finished)
    .map((f) => ({ id: f.id, sport: f.sport, homeScore: f.homeScore!, awayScore: f.awayScore! }));
  await upsertSettlements(env.DB, results);
  const settled = await settleRawTips(env.DB, results);

  // 4. score sources — HEAVY. Only rebuild when asked (hourly cron gate).
  let rescoredSources = 0;
  if (opts.rescoreSources) {
    // sinceDays=90: a 90-day rolling window is enough to grade a source's
    // recent form. Older tips still exist for the archive endpoint but
    // do not bloat the read footprint of every ingest pass.
    const settledTips = await readTips(env.DB, 'settled', 90);
    const records = buildTipsterRecords(settledTips);
    const firstSeen = firstSeenMap(settledTips);
    await upsertSourcePerformance(env.DB, records, firstSeen, isPromoted);
    rescoredSources = records.length;
  }

  // 5. consensus — reads the CACHED source_performance table (~200 rows)
  // instead of rescanning raw_tips every fire. Reads collapse from O(N) to
  // O(sources).
  const promoted = await readPromotedSources(env.DB);
  const ratingOf = await readSourceRatings(env.DB);
  const pending = cleanTips(await readTips(env.DB, 'pending', 14), Date.now());
  const eligible = pending.filter((t) => promoted.has(`${t.source}:${t.tipster}`));
  const verified = buildConsensus(eligible, ratingOf).filter((p) => p.verified);
  const published = await writePublishedPicks(env.DB, verified, link.size ? link : await readFixtureLinks(env.DB));

  return { fixtures: fixtures.length, ingested, settled, published, rescoredSources };
}

// Cheap settlement-only pass. Runs every 5 minutes on the schedule.
// Fetches the fixtures list for TODAY and YESTERDAY (2 api-football calls
// max), settles anything finished, records the outcome. No new tip ingest,
// no consensus rebuild — that keeps CPU + API cost close to zero and lets a
// finished match's result reach the site within one cron tick.
async function runSettlementPass(env: Env): Promise<{ checked: number; settled: number; skipped?: boolean }> {
  if (env.INGEST_ENABLED !== 'true' || !env.API_SPORTS_KEY) {
    return { checked: 0, settled: 0, skipped: true };
  }
  const key = env.API_SPORTS_KEY;
  const today = new Date().toISOString().slice(0, 10);
  const yday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const [fToday, fYesterday] = await Promise.all([
    fetchFixturesForDate(key, today),
    fetchFixturesForDate(key, yday),
  ]);
  const finished = [...fToday, ...fYesterday].filter((f) => f.finished);
  const results: ResultRow[] = finished.map((f) => ({
    id: f.id, sport: f.sport, homeScore: f.homeScore!, awayScore: f.awayScore!,
  }));
  await upsertSettlements(env.DB, results);
  const settled = await settleRawTips(env.DB, results);
  return { checked: finished.length, settled };
}

async function fetchFixturesForDate(key: string, date: string): Promise<FixtureRow[]> {
  try {
    const res = await fetch(`https://${FB_HOST}/fixtures?date=${date}`, { headers: { 'x-apisports-key': key } });
    if (!res.ok) return [];
    const json = (await res.json()) as { response?: Array<{
      fixture?: { id?: number; date?: string; status?: { short?: string } };
      league?: { name?: string };
      teams?: { home?: { name?: string }; away?: { name?: string } };
      goals?: { home?: number | null; away?: number | null };
    }> };
    return (json.response ?? [])
      .filter((r) => r.fixture?.id && r.teams?.home?.name && r.teams?.away?.name)
      .map((r) => {
        const short = r.fixture?.status?.short ?? 'NS';
        const finished = FINISHED.has(short) && typeof r.goals?.home === 'number' && typeof r.goals?.away === 'number';
        return {
          id: `apisports:fb:${r.fixture!.id}`,
          provider: 'api-sports',
          sport: 'football' as const,
          league: r.league?.name ?? 'Unknown',
          homeTeam: r.teams!.home!.name!,
          awayTeam: r.teams!.away!.name!,
          kickoff: r.fixture?.date ?? `${date}T00:00:00Z`,
          status: short,
          finished,
          homeScore: finished ? (r.goals!.home as number) : undefined,
          awayScore: finished ? (r.goals!.away as number) : undefined,
        };
      });
  } catch {
    return [];
  }
}

// One-shot per day: mark any tip that has stayed "pending" for 7+ days after
// kickoff as void, so the visible record never carries a stale unresolved
// pick. Every automated resolver has had ample time by then; the extra
// cases live in outcome-conflicts for manual audit.
async function sweepStuckPending(env: Env): Promise<{ swept: number }> {
  try {
    const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const result = await env.DB.prepare(
      "UPDATE raw_tips SET result = 'void', settled_at = ?1 WHERE result = 'pending' AND kickoff < ?2"
    ).bind(new Date().toISOString(), cutoff).run();
    return { swept: Number((result as any).meta?.changes ?? 0) };
  } catch {
    return { swept: 0 };
  }
}

function json(data: unknown, extraHeaders?: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
      ...(extraHeaders ?? {}),
    },
  });
}

// Reliable 2h trigger for the GitHub Actions pipeline. GitHub's own cron is
// best-effort and drops runs on private repos, so this Worker (Cloudflare cron
// is reliable) fires the pipeline via workflow_dispatch. Inert until the
// GH_DISPATCH_TOKEN + GH_REPO secrets are set:
//   wrangler secret put GH_DISPATCH_TOKEN
//   wrangler secret put GH_REPO   (owner/repo, e.g. "acme/tips-pipeline")
async function triggerGithubPipeline(env: Env): Promise<void> {
  if (!env.GH_DISPATCH_TOKEN || !env.GH_REPO) return;
  try {
    await fetch(
      `https://api.github.com/repos/${env.GH_REPO}/actions/workflows/pipeline.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'tips-pipeline-worker',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ref: 'master' }),
      },
    );
  } catch {
    // best-effort — a manual workflow_dispatch is always a fallback
  }
}

export default {
  async scheduled(_event: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date();
    const min = now.getUTCMinutes();

    // ── Every 5 min: settlement pass ──────────────────────────────────────
    // Fetches finished fixtures for TODAY + YESTERDAY, updates results in D1.
    // Cheap: 2 api-football calls per fire × 288 fires/day = 576 calls/day.
    ctx.waitUntil(runSettlementPass(env));

    // ── Every 15 min: fast ingest cycle ───────────────────────────────────
    // Ingest new raw tips, settle finished fixtures, publish consensus.
    // Reads the CACHED source_performance table (~200 rows) — does NOT
    // re-score sources. Reads scale O(sources) not O(raw_tips).
    if (min % 15 === 0) {
      ctx.waitUntil(runIngest(env, { rescoreSources: false }));
    }
    // GH pipeline dispatch: ONLY every 2h at :00 UTC (~$1.30/mo overage on 2000-min free tier).
    // Firing every 15 min would burn ~$50-100/mo of GH Actions minutes.
    if (min === 0 && now.getUTCHours() % 2 === 0) {
      ctx.waitUntil(triggerGithubPipeline(env));
    }

    // ── Every hour :05: rebuild source scores ─────────────────────────────
    // The expensive per-source scoring pass. Reads settled raw_tips within
    // the 90-day rolling window (bounded), recomputes ratings + promotion,
    // writes back to source_performance. Once/hour = 24×/day.
    if (min >= 5 && min < 10) {
      ctx.waitUntil(runIngest(env, { rescoreSources: true }));
    }

    // ── Every hour :00: sweep stuck-pending picks ─────────────────────────
    // Any raw_tip still pending 7+ days after kickoff is unsettleable from
    // automated resolvers; mark it void. Zero API cost — pure D1 update.
    if (min < 5) {
      ctx.waitUntil(sweepStuckPending(env));
    }

    // ── Weekly (Monday 04:15 UTC): purge >180-day settled rows ────────────
    // Keeps raw_tips table at a bounded size regardless of years of runs.
    // Everything <180 days stays available for rolling-window scoring, older
    // data is compacted out of the hot table.
    const day = now.getUTCDay(); // 0=Sun, 1=Mon
    const hour = now.getUTCHours();
    if (day === 1 && hour === 4 && min >= 15 && min < 20) {
      ctx.waitUntil(purgeOldSettled(env.DB, 180).then((n) => console.log('purged', n, 'old raw_tips')));
    }
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const cors = corsHeadersFor(req, env);
    // CORS preflight — needed once the newsletter form starts posting from the site
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/api/picks') return json(await getPublishedPicks(env.DB), cors);
    // Live outcomes feed — the static site's client-side poller reads this
    // every 5 min and updates WON/LOST badges in place, so a match finished
    // at 22:00 shows its result on the live site by 22:05 (not by the next
    // 2h pipeline rebuild). Window kept short so payload stays small.
    if (url.pathname === '/api/outcomes') {
      const sinceDays = Number(url.searchParams.get('days') ?? 3);
      const outcomes = await getRecentOutcomes(env.DB, Math.max(1, Math.min(sinceDays, 30)));
      // Short cache: outcomes only change on the 5-min settle pass, so a
      // ~30s edge cache still gives every request in that window a hit.
      return json(outcomes, { ...cors, 'cache-control': 'public, max-age=30' });
    }
    if (url.pathname === '/api/ingest' && req.method === 'POST') return json(await runIngest(env, { rescoreSources: url.searchParams.has('rescore') }), cors);
    if (url.pathname === '/api/settle' && req.method === 'POST') return json(await runSettlementPass(env), cors);
    if (url.pathname === '/api/sweep' && req.method === 'POST') return json(await sweepStuckPending(env), cors);
    if (url.pathname === '/api/purge' && req.method === 'POST') return json({ purged: await purgeOldSettled(env.DB, Number(url.searchParams.get('days') ?? 180)) }, cors);
    if (url.pathname === '/api/newsletter' && req.method === 'POST') return json(await subscribeNewsletter(req, env), cors);
    // Admin — live subscription status. Auth-gated by a shared secret in the
    // query string (?k=…) so anyone stumbling on the URL can't see billing
    // dashboards. Returns real expiry / quota data from each vendor's API.
    if (url.pathname === '/api/subscriptions') {
      // Open-CORS on this admin route because the local .html tracker file loads
      // from file:// (Origin: null); the endpoint is protected by ADMIN_KEY, so
      // relaxed CORS doesn't add exposure. Any origin can attempt to read but
      // only requests carrying the correct ?k=… get past the auth check below.
      const openCors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
      if (!env.ADMIN_KEY || url.searchParams.get('k') !== env.ADMIN_KEY) {
        return new Response('unauthorized', { status: 401, headers: openCors });
      }
      const out: Record<string, unknown> = { checkedAt: new Date().toISOString() };
      // api-football — /status returns account.subscription.end + requests.current
      try {
        const r = await fetch('https://v3.football.api-sports.io/status', {
          headers: { 'x-apisports-key': env.API_SPORTS_KEY ?? '' },
          signal: AbortSignal.timeout(8000),
        });
        const j = await r.json() as any;
        out.apifootball = {
          plan: j?.response?.subscription?.plan ?? 'unknown',
          expires: j?.response?.subscription?.end ?? null,
          active: j?.response?.subscription?.active === true,
          requestsToday: j?.response?.requests?.current ?? null,
          limitPerDay: j?.response?.requests?.limit_day ?? null,
        };
      } catch (e) { out.apifootball = { error: String(e).slice(0, 80) }; }
      // Highlightly — probe the Football API on soccer.highlightly.net (that's
      // the PRO endpoint the pipeline actually uses; sports.highlightly.net is
      // the multi-sport BASIC gateway which reports "BASIC" for every account,
      // so it's not a reliable tier check). PRO exposes /odds with 7500/day,
      // BASIC/no-access returns 401.
      try {
        const r = await fetch('https://soccer.highlightly.net/odds?matchId=1318752934', {
          headers: { 'x-rapidapi-key': env.HIGHLIGHTLY_API_KEY ?? '', 'x-rapidapi-host': 'soccer.highlightly.net' },
          signal: AbortSignal.timeout(8000),
        });
        const rateLimit = r.headers.get('x-ratelimit-requests-limit');
        const rateRemaining = r.headers.get('x-ratelimit-requests-remaining');
        out.highlightly = {
          host: 'soccer.highlightly.net',
          tier: r.status === 200 ? 'PRO' : (r.status === 401 ? 'BASIC / no-odds' : `unknown (HTTP ${r.status})`),
          limitPerDay: rateLimit ? Number(rateLimit) : null,
          remainingToday: rateRemaining ? Number(rateRemaining) : null,
          oddsEndpointOk: r.status === 200,
        };
      } catch (e) { out.highlightly = { error: String(e).slice(0, 80) }; }
      return json(out, { ...openCors, 'cache-control': 'no-store' });
    }
    return new Response('tips bot — see /api/picks', { status: 200 });
  },
};

// Allowed origins come from ALLOWED_ORIGINS env var (comma-separated exact
// hostnames — pages.dev URL + any custom domain). Empty = no CORS.
// Any subdomain of a listed host also matches (for Pages preview deploys).
function corsHeadersFor(req: Request, env?: { ALLOWED_ORIGINS?: string }): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const hosts = (env?.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = hosts.length
    ? new RegExp(`^https:\\/\\/(${hosts.map((h) => `${escapeRe(h)}|.*\\.${escapeRe(h)}`).join('|')})$`)
    : null;
  const ok = pattern ? pattern.test(origin) : false;
  const fallback = hosts[0] ? `https://${hosts[0]}` : '';
  return {
    'Access-Control-Allow-Origin': ok ? origin : fallback,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

// Newsletter signup — reads the JSON {email}, validates the address shape, and
// stores a compact record in D1. Rate-limited by IP so a single client can't
// flood the endpoint. Idempotent: existing subscribers get success without a
// duplicate row. Real email delivery is wired in Phase 2 (SendGrid / Mailchimp
// via env vars); today's job is capturing consented addresses safely.
async function subscribeNewsletter(req: Request, env: Env): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return jsonErr('Invalid JSON body.', 400); }
  const email = String(body?.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
    return jsonErr('Please enter a valid email address.', 400);
  }
  const ip = req.headers.get('CF-Connecting-IP') ?? '';
  try {
    // Best-effort D1 store; if the schema isn't present the endpoint still
    // returns success so the UX doesn't visibly break during migration.
    await env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS newsletter (email TEXT PRIMARY KEY, ip TEXT, ua TEXT, created_at TEXT)'
    ).run();
    // Per-IP rate limit: at most 5 signups from the same IP in 10 minutes.
    // Blocks obvious flood/enum bots without penalising a household router.
    if (ip) {
      const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const row = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM newsletter WHERE ip = ?1 AND created_at > ?2'
      ).bind(ip, cutoff).first<{ n: number }>();
      if (row && Number(row.n) >= 5) {
        return jsonErr('Too many attempts, please wait a few minutes.', 429);
      }
    }
    await env.DB.prepare(
      'INSERT OR IGNORE INTO newsletter (email, ip, ua, created_at) VALUES (?1, ?2, ?3, ?4)'
    )
      .bind(
        email,
        ip,
        (req.headers.get('User-Agent') ?? '').slice(0, 200),
        new Date().toISOString(),
      )
      .run();
  } catch (e) {
    // Log but never leak — user still sees success.
    console.log('newsletter store failed:', String(e).slice(0, 120));
  }
  return json({ ok: true }, undefined, 200);
}

function jsonErr(msg: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
