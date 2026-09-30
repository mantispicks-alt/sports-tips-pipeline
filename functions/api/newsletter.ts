// Cloudflare Pages Function for POST /api/newsletter.
// Runs at the edge next to the Astro static site. Stores consented emails in
// a D1 database bound as `DB` on the Pages project. Best-effort — the UX
// success message is optimistic; a store failure is logged but not surfaced.
//
// To wire this up:
//   1. In Cloudflare Pages → Project settings → Functions → D1 bindings,
//      add binding `DB` pointing at your D1 database.
//   2. Deploy — this file is auto-detected.
//
// Per-IP rate limit: 5 signups in 10 minutes.

// Minimal Cloudflare Workers / Pages types declared locally so this file
// typechecks WITHOUT pulling @cloudflare/workers-types as a dependency.
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
  first<T = unknown>(): Promise<T | null>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
}
type PagesFunction<E = unknown> = (context: {
  request: Request;
  env: E;
}) => Response | Promise<Response>;

interface Env { DB: D1Database; ALLOWED_ORIGINS?: string }

function cors(origin: string, env: Env): Record<string, string> {
  const hosts = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = hosts.length
    ? new RegExp(`^https:\\/\\/(${hosts.map((h) => `${escapeRe(h)}|.*\\.${escapeRe(h)}`).join('|')})$`)
    : null;
  const ok = pattern ? pattern.test(origin) : false;
  const fallback = hosts[0] ? `https://${hosts[0]}` : '';
  return {
    'Access-Control-Allow-Origin': ok ? origin : fallback,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export const onRequestOptions: PagesFunction<Env> = ({ request, env }) =>
  new Response(null, { status: 204, headers: cors(request.headers.get('Origin') ?? '', env) });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const headers = cors(request.headers.get('Origin') ?? '', env);
  let body: any;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON body.' }, 400, headers); }
  const email = String(body?.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
    return json({ ok: false, error: 'Please enter a valid email address.' }, 400, headers);
  }
  const ip = request.headers.get('CF-Connecting-IP') ?? '';
  try {
    await env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS newsletter (email TEXT PRIMARY KEY, ip TEXT, ua TEXT, created_at TEXT)'
    ).run();
    if (ip) {
      const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const row = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM newsletter WHERE ip = ?1 AND created_at > ?2'
      ).bind(ip, cutoff).first<{ n: number }>();
      if (row && Number(row.n) >= 5) {
        return json({ ok: false, error: 'Too many attempts, please wait a few minutes.' }, 429, headers);
      }
    }
    await env.DB.prepare(
      'INSERT OR IGNORE INTO newsletter (email, ip, ua, created_at) VALUES (?1, ?2, ?3, ?4)'
    )
      .bind(
        email,
        ip,
        (request.headers.get('User-Agent') ?? '').slice(0, 200),
        new Date().toISOString(),
      )
      .run();
  } catch (e) {
    console.log('newsletter store failed:', String(e).slice(0, 200));
  }
  return json({ ok: true }, 200, headers);
};
