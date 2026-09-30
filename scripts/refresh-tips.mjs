// -------------------------------------------------------------------------
// refresh-tips.mjs — DEMO ONLY (unofficial). The "AI auto-pull" made runnable
// on demand. NOT the production ingestion path — the production path is the
// official-API adapters (API-Sports) + fixture matching + D1.
//
// Fetches the confirmed tipster sites (fetch has no rate limit), then BATCHES
// several sites' text into ONE LLM call — so 17 sites = ~4-5 calls, not 17.
// That keeps us well under free-tier request limits (Gemini = 20 req/min) and
// makes a full refresh finish in well under a minute.
//
// Writes one snapshot/tipster to src/data/tips/real-<slug>.json. The Astro
// build reads those snapshots offline (jsonImport) — the build never hits net.
//
//   node scripts/refresh-tips.mjs        (provider/key from .env)
// Cron this daily to keep tips fresh.
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'src', 'data', 'tips');

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
import { persistUsage } from './lib/llm-usage.mjs';
import { loadCache, saveCache, contentHash } from './lib/ingest-cache.mjs';
const PROVIDER = (env.LLM_PROVIDER || 'groq').toLowerCase();
let usageCalls = 0, usageInTok = 0, usageOutTok = 0;
const CF_ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID || '';
const KEY = (PROVIDER === 'workers-ai' ? (env.CF_AI_TOKEN || env.CLOUDFLARE_API_TOKEN)
  : PROVIDER === 'openai' ? env.OPENAI_API_KEY
  : PROVIDER === 'gemini' ? env.GEMINI_API_KEY
  : env.GROQ_API_KEY) || env.LLM_API_KEY || '';
const CFG = PROVIDER === 'workers-ai'
  ? { endpoint: `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/v1/chat/completions`, model: env.CF_AI_MODEL || '@cf/mistral/mistral-7b-instruct-v0.1', maxTokens: 8000 }
  : PROVIDER === 'openai'
  ? { endpoint: 'https://api.openai.com/v1/chat/completions', model: env.OPENAI_MODEL || 'gpt-4o-mini', maxTokens: 8000 }
  : PROVIDER === 'gemini'
  ? { endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-flash-latest', maxTokens: 8000 }
  : { endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', maxTokens: 8000 };
const BATCH = 4;         // sites per LLM call
const GAP = 4000;        // ms between batches (few batches -> tiny total)
const SLICE = 5000;      // chars kept per site page
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!KEY) { console.error('No API key in .env — aborting.'); process.exit(1); }

// --- PRODUCTION GUARD ------------------------------------------------------
// This script LLM-extracts tips from third-party prediction sites. It is a
// DEMO/dev tool, NOT the production ingestion path. It refuses to run unless
// explicitly opted in, so it can never silently become the live source.
const ALLOW = (env.ALLOW_UNOFFICIAL_SCRAPE || process.env.ALLOW_UNOFFICIAL_SCRAPE || '') === '1'
  || process.argv.includes('--allow-unofficial');
if (!ALLOW) {
  console.error('Refusing to run: unofficial LLM-scrape is demo-only, not a production source.');
  console.error('Override with ALLOW_UNOFFICIAL_SCRAPE=1 in .env (or pass --allow-unofficial).');
  process.exit(2);
}

// --- confirmed-working sites (each becomes one tipster snapshot) -----------
const SITES = [
  { url: 'https://kickpredictions.co.ke/', tipster: 'KickPredictions' },
  { url: 'https://eaglepredict.com/', tipster: 'EaglePredict' },
  // meritpredict dropped 2026-08-16 (audit-sources w/ backfill) — ROI −40.6% on 21 settled, money-loser.
  // statarea dropped 2026-08-16 (audit-sources) — ROI −22.8% on 30 priced settled picks, money-loser.
  // venasbet dropped 2026-08-12 — 27% win + ROI −62% (roi_n=11), money-loser.
  { url: 'https://solopredict.com/', tipster: 'Solopredict' },
  { url: 'https://kcpredict.com/', tipster: 'KCPredict' },
  // soccerpunt DROP 2026-08-24 (odds-band audit) — ROI -11% and no +ROI band.
  // solidpredict DROP 2026-08-24 — -9% favs, no value picks.
  // legitpredict DROP 2026-08-24 — -11% favorites-only, no value band.
  // kingspredict dropped 2026-08-16 (audit-sources) — ROI −11.7% on 29 settled, money-loser.
  { url: 'https://1960tips.com/', tipster: 'Tips1960' },
  { url: 'https://accuratepredict.com/', tipster: 'AccuratePredict' },
  { url: 'https://betagamers.net/', tipster: 'BetaGamers' },
  { url: 'https://confirmbets.com/', tipster: 'ConfirmBets' },
  { url: 'https://www.mightytips.com/', tipster: 'MightyTips' },
];
const slugOf = (t) => t.toLowerCase();

const PROMPT = `Below are several football-prediction websites, each after a line "### SITE: <id>".
Extract today's football betting tips from EVERY site as ONE JSON array.
Each item: {"site":"<id>","home":string,"away":string,"league":string,"market":"1X2"|"OU25"|"BTTS"|"DC"|"DNB","selection":string,"line":number|null,"odds":number|null}.
"site" MUST be the id from the "### SITE:" line the pick came from.
selection by market: 1X2->"home"|"draw"|"away"; DC (double chance, TWO outcomes)->"1x"(home or draw)|"12"(home or away)|"x2"(away or draw); DNB (draw no bet)->"home"|"away"; OU25 (over/under total goals)->"over"|"under" with the goals line in "line" (2.5 if unstated; also 0.5/1.5/3.5…); BTTS->"yes"|"no".
RULES: a SINGLE outcome (one team to win, or the draw alone) is 1X2 — NEVER DC (DC is only a two-outcome team-or-draw / either-team). Translate any language ("más 2.5"/"powyżej"=over; "menos"/"poniżej"=under; "ambos marcan"=BTTS yes; "doble oportunidad"/"doppia chance"=DC; "empate no hay apuesta"=DNB). SKIP any pick you cannot express above (Asian/European handicap, HT/FT, halves, corners, cards, correct score, odd/even, team totals, props, to-qualify).
Only real picks with two named teams. Return ONLY the JSON array, no prose.`;
const VALID = ['1X2', 'OU25', 'BTTS', 'DC', 'DNB'];
// PLACEHOLDER kickoff = today's date only. matchKey() keys on the day, and real
// settlement needs a match to a canonical fixture anyway. The old fake "18:00"
// precision was misleading; real kickoff comes from the fixtures subsystem.
const KICKOFF = new Date().toISOString().slice(0, 10) + 'T00:00:00Z';

function parseTips(raw) {
  const s = String(raw).replace(/```json|```/g, '').trim();
  try { return JSON.parse(s); } catch {
    const o = []; for (const m of s.matchAll(/\{[^{}]*\}/g)) { try { o.push(JSON.parse(m[0])); } catch {} } return o;
  }
}

async function fetchPage(site) {
  try {
    const html = await (await fetch(site.url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) })).text();
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, SLICE);
    return { site, text };
  } catch { return null; }
}

// One batched LLM call, retry on 429 honoring Gemini's "retry in Xs" body.
async function askBatch(pages, attempt = 0) {
  const combined = pages.map((p) => `### SITE: ${slugOf(p.site.tipster)}\n${p.text}`).join('\n\n');
  const res = await fetch(CFG.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: CFG.model, temperature: 0, max_tokens: CFG.maxTokens, messages: [{ role: 'user', content: `${PROMPT}\n\n${combined}` }] }),
    signal: AbortSignal.timeout(60000),
  });
  if (res.status === 429 && attempt < 5) {
    const body = await res.text().catch(() => '');
    const m = body.match(/retry in ([\d.]+)s/i);
    const wait = m ? Math.ceil(parseFloat(m[1])) : 35;
    console.error(`   (429 — waiting ${Math.min(wait, 65)}s)`);
    await sleep(Math.min(wait, 65) * 1000 + 1500);
    return askBatch(pages, attempt + 1);
  }
  if (!res.ok) return { tips: [], err: `HTTP ${res.status}` };
  const json = await res.json();
  if (json?.usage) { usageCalls++; usageInTok += json.usage.prompt_tokens || 0; usageOutTok += json.usage.completion_tokens || 0; }
  return { tips: parseTips(json?.choices?.[0]?.message?.content ?? '[]') };
}

// --- run ------------------------------------------------------------------
console.log(`Provider: ${PROVIDER} (${CFG.model}) — ${SITES.length} sites, batch ${BATCH}\n`);
console.log('Fetching pages...');
const pages = (await Promise.all(SITES.map(fetchPage))).filter(Boolean);
console.log(`  ${pages.length}/${SITES.length} pages fetched.\n`);

// Only re-extract sites whose page changed since last run (and whose snapshot
// still exists) — unchanged ones keep their snapshot and cost no LLM call.
const cache = loadCache();
const changed = [];
for (const p of pages) {
  p._slug = slugOf(p.site.tipster);
  p._hash = contentHash(p.text);
  const outFile = path.join(OUT_DIR, `real-${p._slug}.json`);
  if (cache[`tips:${p._slug}`] === p._hash && fs.existsSync(outFile)) { console.log(`  · ${p.site.tipster.padEnd(16)} unchanged, skip`); continue; }
  changed.push(p);
}
console.log(`  ${changed.length}/${pages.length} changed -> batching.\n`);

const bySlug = new Map(); // slug -> tips[]
for (let i = 0; i < changed.length; i += BATCH) {
  const batch = changed.slice(i, i + BATCH);
  const labels = batch.map((p) => p.site.tipster).join(', ');
  const { tips, err } = await askBatch(batch);
  if (err) { console.log(`  batch [${labels}] -> ${err}`); }
  else {
    const valid = (Array.isArray(tips) ? tips : []).filter((t) => t?.home && t?.away && VALID.includes(t.market) && t.selection && t.site);
    for (const t of valid) {
      const arr = bySlug.get(t.site) || [];
      arr.push({
        source: `web:${t.site}`, tipster: batch.find((p) => slugOf(p.site.tipster) === t.site)?.site.tipster || t.site,
        homeTeam: String(t.home), awayTeam: String(t.away), league: t.league ? String(t.league) : 'Various',
        kickoff: KICKOFF, market: t.market, selection: String(t.selection).toLowerCase(),
        odds: typeof t.odds === 'number' ? t.odds : null,
        ...(typeof t.line === 'number' ? { line: t.line } : {}),
      });
      bySlug.set(t.site, arr);
    }
    console.log(`  batch [${labels}] -> ${valid.length} tips`);
  }
  if (i + BATCH < changed.length) await sleep(GAP);
}
// Remember what we just extracted so an identical page next run is skipped.
for (const p of changed) cache[`tips:${p._slug}`] = p._hash;
saveCache(cache);

let written = 0, total = 0;
for (const site of SITES) {
  const slug = slugOf(site.tipster);
  const tips = bySlug.get(slug) || [];
  if (tips.length === 0) { console.log(`  · ${site.tipster.padEnd(16)} 0 (kept old snapshot)`); continue; }
  fs.writeFileSync(path.join(OUT_DIR, `real-${slug}.json`), JSON.stringify(tips, null, 2) + '\n');
  written++; total += tips.length;
  console.log(`  ✓ ${site.tipster.padEnd(16)} ${tips.length} tips`);
}
console.log(`\nDone. ${written}/${SITES.length} snapshots refreshed, ${total} tips, for ${KICKOFF.slice(0, 10)}.`);
persistUsage({ [PROVIDER]: { calls: usageCalls, inTok: usageInTok, outTok: usageOutTok } }, { [PROVIDER]: CFG.model });
