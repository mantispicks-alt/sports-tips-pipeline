// -------------------------------------------------------------------------
// discover-sources.mjs — report-only. Fetches candidate sites, BATCHES them
// into the LLM (4 per call, so a big list = few calls, no rate-limit storm),
// and prints how many structured tips each yields. Winners get printed as
// ready-to-paste SITES lines for refresh-tips.mjs. Nothing is written.
//
//   node scripts/discover-sources.mjs
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const PROVIDER = (env.LLM_PROVIDER || 'groq').toLowerCase();
const KEY = (PROVIDER === 'openai' ? env.OPENAI_API_KEY : PROVIDER === 'gemini' ? env.GEMINI_API_KEY : env.GROQ_API_KEY) || env.LLM_API_KEY || '';
const CFG = PROVIDER === 'openai'
  ? { endpoint: 'https://api.openai.com/v1/chat/completions', model: env.OPENAI_MODEL || 'gpt-4o-mini', maxTokens: 8000 }
  : PROVIDER === 'gemini'
  ? { endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-flash-latest', maxTokens: 8000 }
  : { endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', maxTokens: 8000 };
const BATCH = 4, SLICE = 5000, GAP = 4000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Candidates NOT already in refresh-tips.mjs and NOT known-dead (403/fetch-fail:
// victorspredict, betshoot, protipster, forebet, tips.gg, betnumbers, fcpredict,
// tipena, betimate). Slug = first host label.
const URLS = [
  // --- round 7 (2026-08-17): RAN — 0 NEW usable sources. mightytips was the only
  //     "winner" but is ALREADY wired (refresh-tips.mjs). The other 7 fetch 200 but
  //     yield 0 structured tips via plain fetch = JS-rendered SPAs (would need
  //     Playwright + likely anti-bot). DON'T re-test these; they're duds-for-fetch:
  //       windrawwin, sportytrader, betstudy, overlyzer, thepunterspage, pautips, soccervista
  //     Conclusion: the free plain-fetch-extractable prediction sites are exhausted.
  //     Any further gain is sharp/value sources (already maxed) or the ROI audit.
  // (list left empty on purpose — re-populate only with genuinely untested candidates)
];
// de-dupe + derive slug
const seen = new Set();
const CANDIDATES = [];
for (const url of URLS) {
  const slug = new URL(url).host.replace(/^www\./, '').split('.')[0];
  if (seen.has(slug)) continue;
  seen.add(slug);
  CANDIDATES.push({ url, slug });
}

const PROMPT = `Below are several football-prediction websites, each after a line "### SITE: <id>".
Extract today's football betting tips from EVERY site as ONE JSON array.
Each item: {"site":"<id>","home":string,"away":string,"league":string,"market":"1X2"|"OU25"|"BTTS"|"DC","selection":string,"odds":number|null}.
"site" MUST be the id from the "### SITE:" line the pick came from.
selection: 1X2->home|draw|away; OU25->over|under; BTTS->yes|no; DC->1x|12|x2.
Only real picks with two named teams. Return ONLY the JSON array, no prose.`;
const VALID = ['1X2', 'OU25', 'BTTS', 'DC'];

function parseTips(raw) {
  const s = String(raw).replace(/```json|```/g, '').trim();
  try { return JSON.parse(s); } catch {
    const o = []; for (const m of s.matchAll(/\{[^{}]*\}/g)) { try { o.push(JSON.parse(m[0])); } catch {} } return o;
  }
}
async function fetchPage(c) {
  try {
    const html = await (await fetch(c.url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(9000) })).text();
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, SLICE);
    return { ...c, text };
  } catch (e) { return { ...c, text: '', err: String(e?.message || e).slice(0, 40) }; }
}
async function askBatch(pages, attempt = 0) {
  const combined = pages.map((p) => `### SITE: ${p.slug}\n${p.text}`).join('\n\n');
  const res = await fetch(CFG.endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: CFG.model, temperature: 0, max_tokens: CFG.maxTokens, messages: [{ role: 'user', content: `${PROMPT}\n\n${combined}` }] }),
    signal: AbortSignal.timeout(60000),
  });
  if (res.status === 429 && attempt < 5) {
    const body = await res.text().catch(() => '');
    const m = body.match(/retry in ([\d.]+)s/i);
    console.error(`   (429 — waiting ${Math.min(m ? Math.ceil(parseFloat(m[1])) : 35, 65)}s)`);
    await sleep(Math.min(m ? Math.ceil(parseFloat(m[1])) : 35, 65) * 1000 + 1500);
    return askBatch(pages, attempt + 1);
  }
  if (!res.ok) return [];
  const json = await res.json();
  return parseTips(json?.choices?.[0]?.message?.content ?? '[]');
}

console.log(`Provider: ${PROVIDER} — testing ${CANDIDATES.length} candidates, batch ${BATCH}\n`);
const pages = await Promise.all(CANDIDATES.map(fetchPage));
const ok = pages.filter((p) => p.text);
console.log(`Fetched: ${ok.length}/${CANDIDATES.length} (rest 403/blocked)\n`);

const count = new Map();
for (let i = 0; i < ok.length; i += BATCH) {
  const batch = ok.slice(i, i + BATCH);
  const slugs = new Set(batch.map((p) => p.slug));
  const tips = await askBatch(batch);
  for (const t of Array.isArray(tips) ? tips : []) {
    if (!t?.home || !t?.away || !VALID.includes(t.market) || !t.selection || !slugs.has(t.site)) continue;
    count.set(t.site, (count.get(t.site) || 0) + 1);
  }
  console.log(`  batch ${i / BATCH + 1}: [${batch.map((p) => p.slug).join(', ')}]`);
  if (i + BATCH < ok.length) await sleep(GAP);
}

const winners = CANDIDATES.filter((c) => (count.get(c.slug) || 0) > 0);
console.log(`\n=== WINNERS (${winners.length}) ===`);
for (const w of winners.sort((a, b) => (count.get(b.slug) || 0) - (count.get(a.slug) || 0))) {
  const name = w.slug.charAt(0).toUpperCase() + w.slug.slice(1);
  console.log(`  { url: '${w.url}', tipster: '${name}' },  // ${count.get(w.slug)} tips`);
}
