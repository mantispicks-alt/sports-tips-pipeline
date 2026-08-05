// -------------------------------------------------------------------------
// refresh-tipsters.mjs — independent-tipster ingestion (registry-driven).
//
// Reads src/data/tipster-sources.json, fetches each ACTIVE site's PUBLIC page,
// LLM-extracts picks (football + basketball), writes one snapshot per source to
// src/data/tips/ind-<id>.json. The Astro build reads those offline (jsonImport).
//
// Compliance built in:
//   * PUBLIC pages only — NEVER logs in / sends credentials (login-required
//     sources are fetched public-only; their gated data is left alone).
//   * Low rate + caching-friendly + realistic UA to avoid hammering.
//   * robots.txt is checked and LOGGED. By default it does NOT auto-skip
//     (user asked for "no skip"); set RESPECT_ROBOTS=1 to enforce robots.
//   * Attribution/source id kept on every pick (source = "ind:<id>").
//   * DEMO/dev tool, gated behind ALLOW_UNOFFICIAL_SCRAPE — not the production
//     backbone (that is official APIs + fixture matching + settlement).
//
//   node scripts/refresh-tipsters.mjs --allow-unofficial
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'src', 'data', 'tips');
const REGISTRY = path.join(ROOT, 'src', 'data', 'tipster-sources.json');

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
// Providers: 'openai' (PAID -> no 429, best for messy text), 'gemini'/'groq' (free -> 429-prone).
const PROVIDER = (env.LLM_PROVIDER || 'groq').toLowerCase();
const KEY = (PROVIDER === 'openai' ? env.OPENAI_API_KEY
  : PROVIDER === 'gemini' ? env.GEMINI_API_KEY
  : env.GROQ_API_KEY) || env.LLM_API_KEY || '';
const CFG = PROVIDER === 'openai'
  ? { endpoint: 'https://api.openai.com/v1/chat/completions', model: env.OPENAI_MODEL || 'gpt-4o-mini', maxTokens: 8000 }
  : PROVIDER === 'gemini'
  ? { endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-flash-latest', maxTokens: 8000 }
  : { endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', maxTokens: 8000 };
const RESPECT_ROBOTS = (env.RESPECT_ROBOTS || process.env.RESPECT_ROBOTS || '') === '1';
const GAP = 4000;   // ms between sites — be gentle
const SLICE = 6000; // chars kept per page
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!KEY) { console.error('No LLM API key in .env — aborting.'); process.exit(1); }

// --- production guard (same gate as refresh-tips) --------------------------
const ALLOW = (env.ALLOW_UNOFFICIAL_SCRAPE || process.env.ALLOW_UNOFFICIAL_SCRAPE || '') === '1'
  || process.argv.includes('--allow-unofficial');
if (!ALLOW) {
  console.error('Refusing to run: unofficial ingestion is demo-only, not a production source.');
  console.error('Override with ALLOW_UNOFFICIAL_SCRAPE=1 in .env (or pass --allow-unofficial).');
  process.exit(2);
}

const registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
const sites = registry.filter((s) => s.active && s.kind === 'site');
if (sites.length === 0) { console.log('No active site sources in registry.'); process.exit(0); }

// PLACEHOLDER kickoff = today's date. Real kickoff comes from fixture matching.
const KICKOFF = new Date().toISOString().slice(0, 10) + 'T00:00:00Z';
const FOOTBALL = ['1X2', 'OU25', 'BTTS', 'DC'];
const BASKET = ['ML', 'SPREAD', 'TOTALS'];

function promptFor(sport) {
  if (sport === 'basketball') {
    return `Extract today's BASKETBALL betting tips from the page text as a JSON array.
Each item: {"home":string,"away":string,"league":string,"market":"ML"|"SPREAD"|"TOTALS","selection":string,"line":number|null,"odds":number|null}.
selection: ML->home|away; SPREAD->home|away (line = home spread, e.g. -5.5); TOTALS->over|under (line = points total, e.g. 210.5).
Only real picks with two named teams. Return ONLY the JSON array, no prose.`;
  }
  return `Extract today's FOOTBALL betting tips from the page text as a JSON array.
Each item: {"home":string,"away":string,"league":string,"market":"1X2"|"OU25"|"BTTS"|"DC","selection":string,"odds":number|null}.
selection: 1X2->home|draw|away; OU25->over|under; BTTS->yes|no; DC->1x|12|x2.
Only real picks with two named teams. Return ONLY the JSON array, no prose.`;
}

function parseTips(raw) {
  const s = String(raw).replace(/```json|```/g, '').trim();
  try { return JSON.parse(s); } catch {
    const o = []; for (const m of s.matchAll(/\{[^{}]*\}/g)) { try { o.push(JSON.parse(m[0])); } catch {} } return o;
  }
}

// robots.txt check for user-agent * — returns { allowed, hadRules }.
async function robotsAllows(pageUrl) {
  try {
    const u = new URL(pageUrl);
    const res = await fetch(`${u.origin}/robots.txt`, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { allowed: true, hadRules: false };
    const txt = await res.text();
    const lines = txt.split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim());
    let applies = false;
    const disallow = [];
    for (const line of lines) {
      const m = line.match(/^(user-agent|disallow)\s*:\s*(.*)$/i);
      if (!m) continue;
      if (m[1].toLowerCase() === 'user-agent') applies = m[2].trim() === '*';
      else if (applies && m[2].trim()) disallow.push(m[2].trim());
    }
    const p = u.pathname || '/';
    const blocked = disallow.some((d) => d === '/' || p.startsWith(d));
    return { allowed: !blocked, hadRules: disallow.length > 0 };
  } catch { return { allowed: true, hadRules: false }; }
}

async function fetchPage(url) {
  const html = await (await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; the siteBot/1.0)' }, signal: AbortSignal.timeout(12000) })).text();
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, SLICE);
}

async function askLLM(sport, text, attempt = 0) {
  const res = await fetch(CFG.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: CFG.model, temperature: 0, max_tokens: CFG.maxTokens, messages: [{ role: 'user', content: `${promptFor(sport)}\n\n${text}` }] }),
    signal: AbortSignal.timeout(60000),
  });
  if (res.status === 429 && attempt < 5) {
    const body = await res.text().catch(() => '');
    const m = body.match(/retry in ([\d.]+)s/i);
    const wait = Math.min(m ? Math.ceil(parseFloat(m[1])) : 35, 65);
    console.error(`   (429 — waiting ${wait}s)`);
    await sleep(wait * 1000 + 1500);
    return askLLM(sport, text, attempt + 1);
  }
  if (!res.ok) return { tips: [], err: `HTTP ${res.status}` };
  const json = await res.json();
  return { tips: parseTips(json?.choices?.[0]?.message?.content ?? '[]') };
}

function normalize(site, t) {
  const valid = site.sport === 'basketball' ? BASKET : FOOTBALL;
  if (!t?.home || !t?.away || !valid.includes(t.market) || !t.selection) return null;
  const tip = {
    source: `ind:${site.id}`,
    tipster: site.name,
    homeTeam: String(t.home),
    awayTeam: String(t.away),
    league: t.league ? String(t.league) : 'Various',
    kickoff: KICKOFF,
    market: t.market,
    selection: String(t.selection).toLowerCase(),
    odds: typeof t.odds === 'number' ? t.odds : null,
    sport: site.sport,
  };
  if (site.sport === 'basketball' && typeof t.line === 'number') tip.line = t.line;
  return tip;
}

// --- run ------------------------------------------------------------------
console.log(`Independent tipsters: ${sites.length} active site(s). Provider ${PROVIDER} (${CFG.model}).`);
console.log(`robots.txt: ${RESPECT_ROBOTS ? 'ENFORCED (skip disallowed)' : 'logged, not enforced (RESPECT_ROBOTS=1 to enforce)'}\n`);

let written = 0, total = 0;
for (const site of sites) {
  const label = site.name.padEnd(18);
  if (site.permissions === 'login-required') {
    console.log(`  · ${label} login-required → PUBLIC page only, no credentials.`);
  }
  const robots = await robotsAllows(site.url);
  if (!robots.allowed) {
    if (RESPECT_ROBOTS) { console.log(`  ✗ ${label} robots.txt disallows → skipped (RESPECT_ROBOTS=1).`); continue; }
    console.log(`  ! ${label} robots.txt disallows this path — proceeding (RESPECT_ROBOTS not set).`);
  }
  let text;
  try { text = await fetchPage(site.url); }
  catch (e) { console.log(`  ✗ ${label} fetch failed (${e?.name || 'error'}) → kept old snapshot.`); await sleep(GAP); continue; }

  const { tips, err } = await askLLM(site.sport, text);
  if (err) { console.log(`  ✗ ${label} ${err} → kept old snapshot.`); await sleep(GAP); continue; }
  const norm = (Array.isArray(tips) ? tips : []).map((t) => normalize(site, t)).filter(Boolean);
  if (norm.length === 0) { console.log(`  · ${label} 0 tips → kept old snapshot.`); await sleep(GAP); continue; }

  fs.writeFileSync(path.join(OUT_DIR, `ind-${site.id}.json`), JSON.stringify(norm, null, 2) + '\n');
  written++; total += norm.length;
  console.log(`  ✓ ${label} ${norm.length} tips (${site.sport})`);
  await sleep(GAP);
}
console.log(`\nDone. ${written}/${sites.length} snapshots, ${total} tips. All land as pending/unverified until settled + scored.`);
