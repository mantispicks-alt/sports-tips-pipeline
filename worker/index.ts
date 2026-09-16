// -------------------------------------------------------------------------
// the site tips bot — Cloudflare Worker (cron ingestion + read API).
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
  getPublishedPicks, type FixtureRow, type ResultRow,
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
  fixtures: number; ingested: number; settled: number; published: number; skipped?: boolean;
}

async function runIngest(env: Env): Promise<IngestSummary> {
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
  // 2nd independent source: The Odds API bookmaker-favorite (quota-light: 6 sports max,
  // free tier ~500/month — do not widen without watching credits).
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

  // 3. settle finished fixtures
  const results: ResultRow[] = fixtures
    .filter((f) => f.finished)
    .map((f) => ({ id: f.id, sport: f.sport, homeScore: f.homeScore!, awayScore: f.awayScore! }));
  await upsertSettlements(env.DB, results);
  const settled = await settleRawTips(env.DB, results);

  // 4. score sources from settled history (+ promotion)
  const settledTips = await readTips(env.DB, 'settled');
  const records = buildTipsterRecords(settledTips);
  const firstSeen = firstSeenMap(settledTips);
  await upsertSourcePerformance(env.DB, records, firstSeen, isPromoted);
  const promoted = new Set(records.filter((r) => isPromoted(r, firstSeen.get(r.key))).map((r) => r.key));
  const ratingOf = new Map(records.map((r) => [r.key, r.rating]));

  // 5. consensus over pending tips from PROMOTED sources only -> published_picks
  const pending = cleanTips(await readTips(env.DB, 'pending'), Date.now());
  const eligible = pending.filter((t) => promoted.has(`${t.source}:${t.tipster}`));
  const verified = buildConsensus(eligible, ratingOf).filter((p) => p.verified);
  const published = await writePublishedPicks(env.DB, verified, link.size ? link : await readFixtureLinks(env.DB));

  return { fixtures: fixtures.length, ingested, settled, published };
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
// GH_DISPATCH_TOKEN secret is set (`wrangler secret put GH_DISPATCH_TOKEN`).
const GH_REPO = 'the-site-alt/the-site-tips-pipeline';
async function triggerGithubPipeline(env: Env): Promise<void> {
  if (!env.GH_DISPATCH_TOKEN) return;
  try {
    await fetch(
      `https://api.github.com/repos/${GH_REPO}/actions/workflows/pipeline.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'the-site-tips-worker',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ref: 'master' }),
      },
    );
  } catch {
    // best-effort — the GitHub schedule is still a backup trigger
  }
}

export default {
  async scheduled(_event: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runIngest(env));
    // The cron fires every 30 min; dispatch the pipeline only once per 2h
    // (even UTC hour, top-of-hour fire) so it doesn't run 48x/day.
    // Dispatch the pipeline every 2h. The account now has a PAID Actions spending
    // limit, so we can exceed the free 2000 min/month: 12 runs/day × ~8 min ≈ 2880
    // min → ~$5-7/mo of overage (or free if on a 3000-min plan). Sole cloud trigger
    // (no GitHub schedule, to avoid double-firing). Bump to %1 for hourly (~$30/mo)
    // or back to %3 to stay in the free tier.
    const now = new Date();
    if (now.getUTCHours() % 2 === 0 && now.getUTCMinutes() < 15) {
      ctx.waitUntil(triggerGithubPipeline(env));
    }
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const cors = corsHeadersFor(req);
    // CORS preflight — needed once the newsletter form starts posting from the site
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/api/picks') return json(await getPublishedPicks(env.DB), cors);
    if (url.pathname === '/api/ingest' && req.method === 'POST') return json(await runIngest(env), cors);
    if (url.pathname === '/api/newsletter' && req.method === 'POST') return json(await subscribeNewsletter(req, env), cors);
    return new Response('the site tips bot — see /api/picks', { status: 200 });
  },
};

// Same-origin + the-site-tips.pages.dev + the-site.com allowed.
function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const ok = /^https:\/\/(the-site-tips\.pages\.dev|the-site\.com|.*\.the-site-tips\.pages\.dev)$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'https://the-site-tips.pages.dev',
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
