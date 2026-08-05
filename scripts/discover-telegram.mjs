// -------------------------------------------------------------------------
// discover-telegram.mjs — report-only. Fetches the PUBLIC web preview of
// Telegram channels (https://t.me/s/<handle>), checks for posts, and LLM-
// extracts tips. Finds which betting-tip channels are worth ingesting.
//
//   node scripts/discover-telegram.mjs
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const KEY = env.LLM_API_KEY || '';
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Candidate public channels (guessed + from search). t.me/s/ only works if the
// channel is public AND preview is enabled. Non-existent/private -> skip.
const HANDLES = [
  'football_betting_signals', 'betmines', 'freesupertips', 'vitibet',
  'bettingtipster', 'freebettingtips', 'soccer_predictions', 'kingbetsvip',
  'dailyfootballtips', 'sportsbettingtips', 'bettingexpert', 'oddspedia',
  'footballpredictions', 'sure_bet_predictions', 'betting_tips_1x2',
  'freefootballtips', 'tipsterfootball', 'goaloofootball',
];

const PROMPT = `Extract football betting tips from these Telegram posts as a JSON array.
Each item: {"home": string, "away": string, "league": string, "market": "1X2"|"OU25"|"BTTS"|"DC", "selection": string, "odds": number|null}.
selection values: 1X2 -> home|draw|away; OU25 -> over|under; BTTS -> yes|no; DC -> 1x|12|x2.
Only real picks with two named teams. Return ONLY the JSON array, no prose.`;
const VALID = ['1X2', 'OU25', 'BTTS', 'DC'];

function parseTips(raw) {
  const s = raw.replace(/```json|```/g, '').trim();
  try { return JSON.parse(s); } catch {
    const o = []; for (const m of s.matchAll(/\{[^{}]*\}/g)) { try { o.push(JSON.parse(m[0])); } catch {} } return o;
  }
}
async function ask(text, n = 0) {
  const r = await fetch(ENDPOINT, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, temperature: 0, max_tokens: 2000, messages: [{ role: 'user', content: `${PROMPT}\n\nPOSTS:\n${text}` }] }),
    signal: AbortSignal.timeout(30000),
  });
  if (r.status === 429 && n < 3) { await sleep(4000 * (n + 1)); return ask(text, n + 1); }
  return r;
}
async function test(handle) {
  try {
    const html = await (await fetch(`https://t.me/s/${handle}`, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) })).text();
    const posts = (html.match(/tgme_widget_message_text/g) || []).length;
    if (posts === 0) return { handle, n: 0, err: 'no public posts' };
    // keep only message text blocks, strip tags
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').slice(0, 8000);
    const r = await ask(text);
    if (!r.ok) return { handle, n: 0, err: `HTTP ${r.status}`, posts };
    const j = await r.json();
    const tips = parseTips(j?.choices?.[0]?.message?.content ?? '[]').filter((t) => t?.home && t?.away && VALID.includes(t.market) && t.selection);
    return { handle, n: tips.length, posts };
  } catch (e) { return { handle, n: 0, err: String(e).slice(0, 50) }; }
}

console.log(`Testing ${HANDLES.length} Telegram channels (public preview)...\n`);
const winners = [];
for (const h of HANDLES) {
  const r = await test(h);
  if (r.n > 0) { winners.push(h); console.log(`  ✓ ${h.padEnd(26)} ${r.n} tips (${r.posts} posts)`); }
  else console.log(`  ✗ ${h.padEnd(26)} ${r.err || 'no tips'}`);
  await sleep(6000);
}
console.log(`\nWinners (${winners.length}): ${winners.join(', ')}`);
