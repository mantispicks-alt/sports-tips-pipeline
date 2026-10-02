// generate-news.mjs — daily match-preview articles from today's published picks.
//
// Runs AFTER scripts/generate-tip-content.ts in the pipeline. Reads the fresh
// tip .md files, ranks the strongest free picks, asks the LLM provider chain
// to write a short preview, and emits .md articles into
// src/content/articles/auto-YYYY-MM-DD-<match-slug>-preview.md.
//
// Idempotent: never overwrites an existing auto-article (so we don't rewrite
// a published preview mid-day), skips picks already covered this cycle, and
// hard-caps at MAX_ARTICLES_PER_RUN (default 3) so pipeline cost stays flat.
//
// Chooses the LLM provider the same way refresh-sites does — groq -> gemini
// -> cerebras -> mistral -> openrouter -> openai, overridable via
// LLM_PROVIDERS. All are free-tier friendly except openai.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// Read .env from disk the same way refresh-sites.mjs does. The pipeline
// writes a .env file in the "Write .env from secrets" step before any
// refresh step runs, so the keys are reliably here on disk at this point.
const env = fs.existsSync(path.join(ROOT, '.env'))
  ? Object.fromEntries(
      fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
    )
  : process.env;

const TIPS_DIR = path.join(ROOT, 'src', 'content', 'tips');
const ARTICLES_DIR = path.join(ROOT, 'src', 'content', 'articles');
const MAX_ARTICLES_PER_RUN = Number(env.NEWS_MAX_PER_RUN) || 3;
const WORD_TARGET = 350;

// --- Provider chain (mirrors refresh-sites.mjs) ---------------------------
const CF_ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID || '';
const CF_AI_TOKEN = env.CF_AI_TOKEN || env.CLOUDFLARE_API_TOKEN;
const ALL_PROVIDERS = {
  'workers-ai': {
    endpoint: `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/v1/chat/completions`,
    model: env.CF_AI_MODEL || '@cf/mistral/mistral-7b-instruct-v0.1',
    key: CF_AI_TOKEN,
  },
  groq: { endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', key: env.GROQ_API_KEY },
  gemini: { endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-flash-latest', key: env.GEMINI_API_KEY },
  cerebras: { endpoint: 'https://api.cerebras.ai/v1/chat/completions', model: env.CEREBRAS_MODEL || 'llama-3.3-70b', key: env.CEREBRAS_API_KEY },
  mistral: { endpoint: 'https://api.mistral.ai/v1/chat/completions', model: env.MISTRAL_MODEL || 'mistral-small-latest', key: env.MISTRAL_API_KEY },
  openrouter: { endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free', key: env.OPENROUTER_API_KEY },
  openai: { endpoint: 'https://api.openai.com/v1/chat/completions', model: env.OPENAI_MODEL || 'gpt-4o-mini', key: env.OPENAI_API_KEY },
};
const ORDER = (env.LLM_PROVIDERS || env.LLM_PROVIDER || 'groq,gemini,cerebras,mistral,openrouter,openai')
  .toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
const CHAIN = ORDER.map((name) => ({ name, ...ALL_PROVIDERS[name] })).filter((p) => p && p.endpoint && p.key);

if (!CHAIN.length) {
  console.log('generate-news: no LLM provider key configured — skipping (set GROQ_API_KEY or similar).');
  process.exit(0);
}

async function callLLM(prompt) {
  for (const p of CHAIN) {
    try {
      const res = await fetch(p.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${p.key}` },
        body: JSON.stringify({
          model: p.model,
          temperature: 0.3,
          max_tokens: 900,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) {
        console.log(`  (${p.name} HTTP ${res.status}, trying next)`);
        continue;
      }
      const body = await res.json();
      const content = body?.choices?.[0]?.message?.content;
      if (content && content.trim().length > 100) return { content, provider: p.name };
    } catch (e) {
      console.log(`  (${p.name} threw ${e.message?.slice(0, 60)}, trying next)`);
    }
  }
  return null;
}

// --- Load today's publishable tips ----------------------------------------
function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const [, k, raw] = kv;
    const v = raw.trim();
    if (v.startsWith('[')) { try { data[k] = JSON.parse(v); } catch { data[k] = v; } }
    else if (v.startsWith('"') && v.endsWith('"')) data[k] = v.slice(1, -1);
    else if (/^-?\d+(\.\d+)?$/.test(v)) data[k] = Number(v);
    else if (v === 'true') data[k] = true;
    else if (v === 'false') data[k] = false;
    else data[k] = v;
  }
  return data;
}

function slugify(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function loadCandidates() {
  if (!fs.existsSync(TIPS_DIR)) return [];
  const now = Date.now();
  const horizon = now + 48 * 3600 * 1000; // today + next ~2 days
  const out = [];
  for (const file of fs.readdirSync(TIPS_DIR)) {
    if (!file.startsWith('auto-') || !file.endsWith('.md')) continue;
    const text = fs.readFileSync(path.join(TIPS_DIR, file), 'utf8');
    const fm = parseFrontmatter(text);
    if (!fm || !fm.kickoff || !fm.match || fm.tier !== 'free' || fm.result !== 'pending') continue;
    const kt = Date.parse(fm.kickoff);
    if (!Number.isFinite(kt) || kt < now || kt > horizon) continue;
    const confidence = Number(fm.confidence) || 3;
    const sharp = fm.sharp === true;
    const boardCount = Array.isArray(fm.oddsBoard) ? fm.oddsBoard.length : 0;
    out.push({ file, fm, kt, confidence, sharp, boardCount });
  }
  // Prefer high confidence + sharp + wide market coverage.
  out.sort((a, b) =>
    (b.confidence - a.confidence) ||
    (Number(b.sharp) - Number(a.sharp)) ||
    (b.boardCount - a.boardCount) ||
    (a.kt - b.kt),
  );
  return out;
}

// --- Prompt + render ------------------------------------------------------
function buildPrompt(pick) {
  const { fm } = pick;
  const [home = '', away = ''] = String(fm.match).split(/\s+vs\s+/i);
  const impliedPct = fm.odds > 1 ? Math.round((1 / fm.odds) * 100) : 0;
  const kickoff = new Date(fm.kickoff).toUTCString();
  const boardSummary = Array.isArray(fm.oddsBoard)
    ? fm.oddsBoard.slice(0, 5).map((r) => `${r.book} ${Number(r.odds).toFixed(2)}`).join(' · ')
    : '';
  return `You are a professional football analyst writing a short match-preview article for a betting-tips website.

Match: ${home.trim()} vs ${away.trim()}
League: ${fm.league}
Kickoff: ${kickoff}
Our pick: ${fm.pick} on the ${fm.market} market at ${fm.odds} (implied ${impliedPct}%).
Confidence: ${fm.confidence}/5
${fm.sharp ? 'Flagged by our sharp-value engine (positive EV vs market-fair line).' : ''}
Odds across licensed books: ${boardSummary || '(not published)'}

Write a preview article of about ${WORD_TARGET} words. Rules:
- Keep the voice confident but honest. No hype, no guarantees.
- Do NOT invent injuries, lineups, head-to-head stats, standings or any factual claim you cannot derive from the data above.
- You may discuss form in general terms ("home side has been scoring freely"), the market view ("the price implies X% chance"), and the pick's reasoning.
- Mention our pick naturally within the body (do not just restate it).
- Encourage the reader to compare odds across the listed books before placing the bet.
- Add a closing line about responsible gambling (18+).
- Use at least two level-2 headings (## Something) to break the piece up.

Output ONLY the article body in Markdown. No frontmatter, no title line, no preamble, no "Here is the article" wrapper. Start directly with the opening paragraph.`;
}

function yamlStr(s) {
  return `"${String(s).replace(/"/g, '\\"')}"`;
}

function articleFilename(pick) {
  const d = new Date(pick.fm.kickoff);
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const matchSlug = slugify(pick.fm.match.replace(/\s+vs\s+/i, '-vs-'));
  return `auto-${date}-${matchSlug}-preview.md`;
}

function writeArticle(pick, body, provider) {
  const d = new Date(pick.fm.kickoff);
  const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const [home = '', away = ''] = String(pick.fm.match).split(/\s+vs\s+/i);
  const title = `${home.trim()} vs ${away.trim()} Preview: Prediction, Odds & Best Value`;
  const description = `Full ${pick.fm.league} match preview for ${home.trim()} vs ${away.trim()}. Our pick, implied probability, and the top prices across licensed books.`;
  const frontmatter = [
    '---',
    `title: ${yamlStr(title)}`,
    `description: ${yamlStr(description)}`,
    `sport: ${yamlStr(pick.fm.sport || 'football')}`,
    `date: ${dateStr}`,
    `author: ${yamlStr('editorial')}`,
    '---',
    '',
    body.trim(),
    '',
    `> _Our pick: **${pick.fm.pick}** on **${pick.fm.market}** at ${Number(pick.fm.odds).toFixed(2)}. Compare the live book prices on the [match page](/tips/${pick.file.replace(/\.md$/, '')}) before placing the bet. 18+ · gamble responsibly._`,
    '',
    `_Preview generated ${new Date().toISOString().slice(0, 10)} — provider: ${provider}._`,
    '',
  ].join('\n');
  if (!fs.existsSync(ARTICLES_DIR)) fs.mkdirSync(ARTICLES_DIR, { recursive: true });
  const outFile = path.join(ARTICLES_DIR, articleFilename(pick));
  fs.writeFileSync(outFile, frontmatter);
  return outFile;
}

// --- Main ------------------------------------------------------------------
(async () => {
  const candidates = loadCandidates();
  if (!candidates.length) {
    console.log('generate-news: no eligible picks (free + pending + upcoming within 48h).');
    return;
  }
  console.log(`generate-news: ${candidates.length} candidate picks, max ${MAX_ARTICLES_PER_RUN} articles. Provider chain: ${CHAIN.map((p) => p.name).join(' -> ')}`);

  let wrote = 0;
  for (const pick of candidates) {
    if (wrote >= MAX_ARTICLES_PER_RUN) break;
    const outFile = path.join(ARTICLES_DIR, articleFilename(pick));
    if (fs.existsSync(outFile)) {
      console.log(`  · ${pick.fm.match} — already has an article, skip`);
      continue;
    }
    const result = await callLLM(buildPrompt(pick));
    if (!result) {
      console.log(`  ✗ ${pick.fm.match} — all providers failed`);
      continue;
    }
    const path_ = writeArticle(pick, result.content, result.provider);
    console.log(`  ✓ ${pick.fm.match} → ${path.basename(path_)} (via ${result.provider})`);
    wrote++;
  }
  console.log(`generate-news: wrote ${wrote} article(s).`);
})().catch((e) => {
  console.error('generate-news FAILED:', e);
  process.exit(1);
});
