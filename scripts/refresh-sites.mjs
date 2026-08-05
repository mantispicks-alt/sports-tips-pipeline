// -------------------------------------------------------------------------
// refresh-sites.mjs — config-driven scraper for pick-aggregator sites.
//
// Reads src/data/pick-sites.json. Per active site: renders the page (Playwright
// for JS sites, plain fetch for SSR), LLM-extracts structured picks, writes
// src/data/tips/site-<id>.json (jsonImport reads it → same consensus pipeline).
//
// Compliance: PUBLIC pages only; robots.txt checked (logged); low rate;
// picks used as SIGNALS for our own consensus, not verbatim republish.
// Extraction: use LLM_PROVIDER=openai (paid) for zero 429.
//
//   npm i -D playwright  &&  npx playwright install chromium     (once, for JS sites)
//   node scripts/refresh-sites.mjs --allow-unofficial
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFootballFixtures, matchFixture, isStale } from './lib/fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'src', 'data', 'tips');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
// Multi-provider chain: tries providers in order, falls to the next on
// 429/error, so exhausting one free tier doesn't stop the run. Order via
// LLM_PROVIDERS=groq,gemini,cerebras,openrouter (comma list) or falls back
// to LLM_PROVIDER (single, old behaviour) then a sane default order.
// Each entry only enters the chain if its key is present in .env.
const ALL_PROVIDERS = {
  groq: { endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', maxTokens: 8000, key: env.GROQ_API_KEY },
  gemini: { endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-flash-latest', maxTokens: 8000, key: env.GEMINI_API_KEY },
  cerebras: { endpoint: 'https://api.cerebras.ai/v1/chat/completions', model: env.CEREBRAS_MODEL || 'llama-3.3-70b', maxTokens: 8000, key: env.CEREBRAS_API_KEY },
  mistral: { endpoint: 'https://api.mistral.ai/v1/chat/completions', model: env.MISTRAL_MODEL || 'mistral-small-latest', maxTokens: 8000, key: env.MISTRAL_API_KEY },
  openrouter: { endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free', maxTokens: 8000, key: env.OPENROUTER_API_KEY },
  openai: { endpoint: 'https://api.openai.com/v1/chat/completions', model: env.OPENAI_MODEL || 'gpt-4o-mini', maxTokens: 8000, key: env.OPENAI_API_KEY },
};
const ORDER = (env.LLM_PROVIDERS || env.LLM_PROVIDER || 'groq,gemini,cerebras,mistral,openrouter,openai')
  .toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
const CHAIN = ORDER.map((name) => ({ name, ...ALL_PROVIDERS[name] })).filter((p) => p && p.endpoint && p.key);
// Paid providers (openai) have high rate limits -> tiny gap + parallel sites.
// Free-tier providers (groq/gemini/etc, still in the chain as fallback) need
// the old conservative pacing, so we key off whichever provider is FIRST/
// primary in the chain (the one actually used unless it fails).
const FAST = CHAIN[0]?.name === 'openai' || CHAIN[0]?.name === 'cerebras' || CHAIN[0]?.name === 'mistral';
const GAP = Number(env.SITE_GAP_MS) || (FAST ? 800 : 12000);
const CONCURRENCY = Number(env.SITE_CONCURRENCY) || (FAST ? 4 : 1);
const SLICE = 7000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pool(items, limit, worker) {
  let idx = 0;
  async function next() { const i = idx++; if (i >= items.length) return; await worker(items[i], i); return next(); }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
}

if (!CHAIN.length) { console.error('No LLM keys in .env for any provider in LLM_PROVIDERS/LLM_PROVIDER.'); process.exit(1); }
const ALLOW = (env.ALLOW_UNOFFICIAL_SCRAPE || process.env.ALLOW_UNOFFICIAL_SCRAPE || '') === '1' || process.argv.includes('--allow-unofficial');
if (!ALLOW) { console.error('Refusing: unofficial scraping is demo-only. Use --allow-unofficial.'); process.exit(2); }

const only = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];
let sites = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'pick-sites.json'), 'utf8')).filter((s) => s.active);
if (only) sites = sites.filter((s) => only.split(',').includes(s.id));
if (!sites.length) { console.log('No active sites (check --only ids).'); process.exit(0); }

const KICKOFF = new Date().toISOString().slice(0, 10) + 'T00:00:00Z';
const FOOTBALL = ['1X2', 'OU25', 'BTTS', 'DC'];
const BASKET = ['ML', 'SPREAD', 'TOTALS'];
function promptFor(sport) {
  if (sport === 'basketball') {
    return `Extract BASKETBALL betting picks from this page text as a JSON array. Each: {"home":string,"away":string,"league":string,"market":"ML"|"SPREAD"|"TOTALS","selection":string,"line":number|null,"odds":number|null}. selection: ML->home|away; SPREAD->home|away; TOTALS->over|under. Only real picks with two named teams. Ignore ads/nav/promos. Return ONLY the JSON array.`;
  }
  return `Extract FOOTBALL betting picks from this page text as a JSON array. Each: {"home":string,"away":string,"league":string,"market":"1X2"|"OU25"|"BTTS"|"DC","selection":string,"odds":number|null}. selection: 1X2->home|draw|away; OU25->over|under; BTTS->yes|no; DC->1x|12|x2. Only real picks with two named teams. Ignore ads/nav/promos. Return ONLY the JSON array.`;
}
function parseTips(raw) {
  const s = String(raw).replace(/```json|```/g, '').trim();
  try { return JSON.parse(s); } catch {
    const o = []; for (const m of s.matchAll(/\{[^{}]*\}/g)) { try { o.push(JSON.parse(m[0])); } catch {} } return o;
  }
}
async function robotsAllows(u) {
  try {
    const url = new URL(u);
    const r = await fetch(`${url.origin}/robots.txt`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return true;
    const dis = []; let applies = false;
    for (const line of (await r.text()).split(/\r?\n/)) {
      const m = line.replace(/#.*/, '').trim().match(/^(user-agent|disallow)\s*:\s*(.*)$/i);
      if (!m) continue;
      if (m[1].toLowerCase() === 'user-agent') applies = m[2].trim() === '*';
      else if (applies && m[2].trim()) dis.push(m[2].trim());
    }
    return !dis.some((d) => d === '/' || url.pathname.startsWith(d));
  } catch { return true; }
}
async function fetchText(u) {
  const html = await (await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; the siteBot/1.0)' }, signal: AbortSignal.timeout(15000) })).text();
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, SLICE);
}
// One shared browser for the whole run (launch is the slow part, ~1-2s;
// reusing it instead of relaunching per site is a big chunk of the speedup).
let _browserPromise = null;
async function getBrowser() {
  if (!_browserPromise) {
    _browserPromise = import('playwright')
      .then(({ chromium }) => chromium.launch())
      .catch(() => { throw new Error('playwright not installed — run: npm i -D playwright && npx playwright install chromium'); });
  }
  return _browserPromise;
}
async function renderText(u) {
  const browser = await getBrowser();
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0' });
  try {
    await page.goto(u, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2500);
    return (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, SLICE);
  } finally { await page.close(); }
}
// $ per token, by provider — used to print a real cost total at the end.
// Free-tier providers (groq/gemini/cerebras/mistral/openrouter) cost $0 here;
// only openai is actually billed.
const PRICING = { openai: { in: 0.15 / 1e6, out: 0.60 / 1e6 } };
const usage = {}; // provider name -> {calls, inTok, outTok}
function trackUsage(name, u) {
  if (!u) return;
  const s = (usage[name] ??= { calls: 0, inTok: 0, outTok: 0 });
  s.calls++; s.inTok += u.prompt_tokens || 0; s.outTok += u.completion_tokens || 0;
}

// Tries each provider in the chain in turn (starting at chainIdx, which
// sticks at the last-working provider so we don't re-probe dead ones every
// call). On 429 retries once with backoff, then falls to the next provider.
let chainIdx = 0;
async function callOne(p, sport, text, attempt = 0) {
  const res = await fetch(p.endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${p.key}` },
    body: JSON.stringify({ model: p.model, temperature: 0, max_tokens: p.maxTokens, messages: [{ role: 'user', content: `${promptFor(sport)}\n\n${text}` }] }),
    signal: AbortSignal.timeout(60000),
  });
  if (res.status === 429 && attempt < 2) {
    const m = (await res.text().catch(() => '')).match(/retry in ([\d.]+)s/i);
    await sleep(Math.min(m ? Math.ceil(parseFloat(m[1])) : 20, 30) * 1000 + 1000);
    return callOne(p, sport, text, attempt + 1);
  }
  if (!res.ok) return { ok: false, status: res.status };
  const body = await res.json();
  trackUsage(p.name, body?.usage);
  return { ok: true, tips: parseTips(body?.choices?.[0]?.message?.content ?? '[]') };
}
async function askLLM(sport, text) {
  for (let i = 0; i < CHAIN.length; i++) {
    const idx = (chainIdx + i) % CHAIN.length;
    const p = CHAIN[idx];
    const r = await callOne(p, sport, text);
    if (r.ok) { chainIdx = idx; return { tips: r.tips, provider: p.name }; }
    console.log(`    (${p.name} failed HTTP ${r.status}, trying next provider)`);
  }
  return { tips: [], err: 'all providers failed/exhausted' };
}

console.log('Loading real fixtures for date-matching (football)...');
const FIXTURES = await loadFootballFixtures(4, 3);
console.log(`  ${FIXTURES.length} fixtures loaded (next 4 days).\n`);

console.log(`Sites: ${sites.length} active. Provider chain: ${CHAIN.map((p) => p.name).join(' -> ')}. Concurrency ${CONCURRENCY}, gap ${GAP}ms.\n`);
let written = 0, total = 0, unverified = 0, stale = 0;
await pool(sites, CONCURRENCY, async (site) => {
  const label = site.name.padEnd(24);
  try {
    await sleep(Math.random() * GAP); // small stagger so parallel workers don't all hit LLM at once
    const robots = await robotsAllows(site.url);
    if (!robots) console.log(`  ! ${label} robots.txt disallows — proceeding (public page, low rate).`);
    const text = site.render === 'playwright' ? await renderText(site.url) : await fetchText(site.url);
    if (!text || text.length < 50) { console.log(`  · ${label} empty/blocked`); return; }
    const { tips, err } = await askLLM(site.sport, text);
    if (err) { console.log(`  ✗ ${label} ${err}`); return; }
    const valid = site.sport === 'basketball' ? BASKET : FOOTBALL;
    const parsed = (Array.isArray(tips) ? tips : []).filter((t) => t?.home && t?.away && valid.includes(t.market) && t.selection);

    // Match each football pick to a REAL fixture -> real kickoff + dateVerified:true.
    // A match to a PAST fixture means the pick is genuinely stale — drop it
    // (this is the "don't show an old signal" case). No match at all (name
    // alias, or a league our free-tier fixture source doesn't cover) does NOT
    // mean the pick is bad, so it's kept with a placeholder + dateVerified:false
    // rather than discarded. Basketball has no fixture source wired -> always unverified.
    let norm = [];
    let siteUnverified = 0, siteStale = 0;
    for (const t of parsed) {
      let kickoff = KICKOFF, dateVerified = false, fixtureId;
      if (site.sport !== 'basketball') {
        const f = matchFixture(t.home, t.away, FIXTURES);
        if (f && isStale(f)) { siteStale++; continue; }
        if (f) { kickoff = f.kickoff; dateVerified = true; fixtureId = f.id; } else { siteUnverified++; }
      } else siteUnverified++;
      norm.push({
        source: `site:${site.id}`, tipster: site.name, homeTeam: String(t.home), awayTeam: String(t.away),
        league: t.league ? String(t.league) : 'Various', kickoff, dateVerified, ...(fixtureId ? { fixtureId } : {}), market: t.market,
        selection: String(t.selection).toLowerCase(), odds: typeof t.odds === 'number' ? t.odds : null,
        sport: site.sport, ...(typeof t.line === 'number' ? { line: t.line } : {}),
      });
    }
    unverified += siteUnverified;
    stale += siteStale;
    if (!norm.length) { console.log(`  · ${label} 0 picks${siteStale ? ` (${siteStale} stale, dropped)` : ''}`); return; }
    fs.writeFileSync(path.join(OUT_DIR, `site-${site.id}.json`), JSON.stringify(norm, null, 2) + '\n');
    written++; total += norm.length;
    console.log(`  ✓ ${label} ${norm.length} picks (${site.sport})${siteUnverified ? `, ${siteUnverified} unverified date` : ''}${siteStale ? `, ${siteStale} stale dropped` : ''}`);
  } catch (e) { console.log(`  ✗ ${label} ${String(e?.message || e).slice(0, 70)}`); }
});
if (_browserPromise) { try { (await _browserPromise).close(); } catch {} }
console.log(`\nDone. ${written}/${sites.length} sites, ${total} picks total (${total - unverified} real kickoffs, ${unverified} unverified date but kept, ${stale} stale dropped). All pending/unverified until settled + scored.`);
let cost = 0;
for (const [name, s] of Object.entries(usage)) {
  const price = PRICING[name] || { in: 0, out: 0 };
  const c = s.inTok * price.in + s.outTok * price.out;
  cost += c;
  console.log(`  ${name}: ${s.calls} calls, ${s.inTok} in / ${s.outTok} out tokens${c > 0 ? ` -> $${c.toFixed(4)}` : ' (free tier)'}`);
}
console.log(`Estimated cost this run: $${cost.toFixed(4)}`);
