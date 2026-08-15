// -------------------------------------------------------------------------
// refresh-telegram.mjs — pulls tips from Telegram tipster channels.
//
// Reads recent posts from each channel in src/data/telegram-channels.json
// (via your logged-in user account, GramJS), extracts structured tips with
// the LLM, and writes src/data/tips/tg-<handle>.json (source "tg:<handle>").
// Those snapshots flow into the same pipeline as the web ones.
//
//   node scripts/refresh-telegram.mjs
//
// Requires in .env: TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION
// (run scripts/telegram-login.mjs once to get the session string) plus the
// usual LLM_PROVIDER / GEMINI_API_KEY or GROQ_API_KEY.
// -------------------------------------------------------------------------
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFootballFixtures, matchFixture, isStale } from './lib/fixtures.mjs';
import { loadCache, saveCache, contentHash } from './lib/ingest-cache.mjs';
import { persistUsage } from './lib/llm-usage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'src', 'data', 'tips');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

// --- LLM config (same providers as refresh-tips.mjs) ----------------------
// Providers: 'openai' (PAID -> no 429, best for messy Telegram posts), 'gemini'/'groq' (free -> 429-prone).
const PROVIDER = (env.LLM_PROVIDER || 'groq').toLowerCase();
const KEY = (PROVIDER === 'openai' ? env.OPENAI_API_KEY
  : PROVIDER === 'gemini' ? env.GEMINI_API_KEY
  : env.GROQ_API_KEY) || env.LLM_API_KEY || '';
const CFG = PROVIDER === 'openai'
  ? { endpoint: 'https://api.openai.com/v1/chat/completions', model: env.OPENAI_MODEL || 'gpt-4o-mini', maxTokens: 4000 }
  : PROVIDER === 'gemini'
  ? { endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-flash-latest', maxTokens: 4000 }
  : { endpoint: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', maxTokens: 2000 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// $ per token — only openai is actually billed, free-tier providers cost $0.
const PRICING = { openai: { in: 0.15 / 1e6, out: 0.60 / 1e6 } };
let usageCalls = 0, usageInTok = 0, usageOutTok = 0;

// --- Telegram config ------------------------------------------------------
const apiId = Number(env.TELEGRAM_API_ID);
const apiHash = env.TELEGRAM_API_HASH;
const session = env.TELEGRAM_SESSION;
if (!apiId || !apiHash || !session || session.startsWith('PASTE')) {
  console.error('Missing TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION in .env.');
  console.error('Get api id/hash at https://my.telegram.org, then run: node scripts/telegram-login.mjs');
  process.exit(1);
}

const chFile = path.join(ROOT, 'src', 'data', 'telegram-channels.json');
const CHANNELS = fs.existsSync(chFile) ? JSON.parse(fs.readFileSync(chFile, 'utf8')) : [];
if (!CHANNELS.length) {
  console.error('No channels in src/data/telegram-channels.json — add channel usernames (without @).');
  process.exit(1);
}

const PROMPT = `Extract FOOTBALL (soccer) betting tips from these Telegram posts as a JSON array.
Some posts are TEXT, some are IMAGES (screenshots of bet slips / prediction graphics) — read both.
Each item: {"home":string,"away":string,"league":string,"market":"1X2"|"OU25"|"BTTS"|"DC","selection":string,"odds":number|null}.
selection: 1X2->home|draw|away; OU25->over|under; BTTS->yes|no; DC->1x|12|x2.
TEAM NAMES: output each club's standard English/Latin name — the spelling a results API uses — NOT a local-language or phonetic spelling. Translate/transliterate any foreign script, e.g. Greek "Νόρτζελαντ" -> "Nordsjaelland", "Μπάγερν" -> "Bayern Munich", "Παρί" -> "Paris Saint-Germain". Never emit Greek or Cyrillic letters in a team name.
FOOTBALL ONLY: skip basketball, tennis and any non-football pick (e.g. NBA, EuroLeague, women's basketball). Never force a basketball points total into OU25 — just drop it.
Posts are messy (emoji, promo, multiple languages). Ignore VIP ads / results brags / "click here" teasers with no visible pick.
Only real upcoming FOOTBALL picks with two named teams. Return ONLY the JSON array, no prose.`;
const VALID = ['1X2', 'OU25', 'BTTS', 'DC'];
// Vision (reading bet-slip screenshots) needs an image-capable model — openai/gemini
// support image_url content on the OpenAI-compat endpoint, groq (llama text-only) doesn't.
const VISION_CAPABLE = PROVIDER === 'openai' || PROVIDER === 'gemini';
const IMAGE_LIMIT = 4; // cap per channel: keeps run fast + cheap

function parseTips(raw) {
  const s = String(raw).replace(/```json|```/g, '').trim();
  try { return JSON.parse(s); } catch {
    const o = []; for (const m of s.matchAll(/\{[^{}]*\}/g)) { try { o.push(JSON.parse(m[0])); } catch {} } return o;
  }
}
async function askLLM(text, images = [], attempt = 0) {
  const content = images.length
    ? [{ type: 'text', text: `${PROMPT}\n\nTEXT POSTS:\n${text || '(none)'}` }, ...images.map((url) => ({ type: 'image_url', image_url: { url, detail: 'low' } }))]
    : `${PROMPT}\n\nTEXT POSTS:\n${text}`;
  const res = await fetch(CFG.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: CFG.model, temperature: 0, max_tokens: CFG.maxTokens, messages: [{ role: 'user', content }] }),
    signal: AbortSignal.timeout(60000),
  });
  if (res.status === 429 && attempt < 5) {
    const body = await res.text().catch(() => '');
    const m = body.match(/retry in ([\d.]+)s/i);
    await sleep(Math.min(m ? Math.ceil(parseFloat(m[1])) : 35, 65) * 1000 + 1500);
    return askLLM(text, images, attempt + 1);
  }
  return res;
}

// --- run ------------------------------------------------------------------
console.log(`Provider: ${PROVIDER} (${CFG.model}) — ${CHANNELS.length} channels\n`);
const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 5 });
await client.connect();

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// Resolve a channels.json entry to a Telegram target.
// String = public @username. Object may carry { username | id | invite }.
// A private `invite` link joins the channel (once) via the logged-in account.
async function resolveTarget(entry) {
  if (typeof entry === 'string') return entry.replace(/^@/, '').trim();
  if (entry.username) return entry.username.replace(/^@/, '').trim();
  // Private channel with no username: a bare id can't be resolved in a fresh
  // process (no cached access_hash), so build the full InputPeerChannel when the
  // access_hash is stored alongside the id.
  if (entry.id && entry.accessHash) {
    const bigInt = (await import('big-integer')).default;
    return new Api.InputPeerChannel({ channelId: bigInt(String(entry.id)), accessHash: bigInt(String(entry.accessHash)) });
  }
  if (entry.id) return entry.id;
  if (entry.invite) {
    const hash = entry.invite.split('+').pop().replace(/\/+$/, '');
    try {
      const upd = await client.invoke(new Api.messages.ImportChatInvite({ hash }));
      return upd.chats?.[0];
    } catch (e) {
      if (/ALREADY_PARTICIPANT/.test(String(e?.message || e))) {
        const info = await client.invoke(new Api.messages.CheckChatInvite({ hash }));
        return info.chat;
      }
      throw e;
    }
  }
  return null;
}

// Telegram calls (unlike the LLM fetch) have no built-in timeout — a network
// blip can hang the whole run silently. Race everything against a hard cap so
// one bad channel can't stall the rest.
function withTimeout(promise, ms, label) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), ms))]);
}

console.log('Loading real fixtures for date-matching (football)...');
const FIXTURES = await loadFootballFixtures(4, 3);
console.log(`  ${FIXTURES.length} fixtures loaded (next 4 days).\n`);

let written = 0, total = 0, unverified = 0, stale = 0;
const cache = loadCache();
let tgSkipped = 0;
for (const entry of CHANNELS) {
  const label = typeof entry === 'string' ? entry.replace(/^@/, '').trim() : (entry.name || entry.username || 'private');
  // A non-Latin name (e.g. a Greek channel title) slugs to '' -> would write a
  // junk `tg-.json`. Fall back to the entry's username/id so every channel gets
  // a stable distinct filename.
  const key = slug(label) || (typeof entry === 'object' ? slug(String(entry.username || entry.id || '')) : '') || 'channel';
  try {
    const target = await withTimeout(resolveTarget(entry), 20000, 'resolve');
    if (!target) { console.log(`  · ${label.padEnd(24)} unresolved entry`); continue; }
    const messages = await withTimeout(client.getMessages(target, { limit: 40 }), 20000, 'getMessages');
    const text = messages.map((m) => m.message).filter(Boolean).join('\n---\n').slice(0, 8000);
    // Newest post's timestamp — a rough "how fresh is this channel right now"
    // signal. getMessages returns newest-first, m.date is Unix seconds.
    const latestPostAt = messages[0]?.date ? messages[0].date * 1000 : null;

    // If neither the posts nor the newest-post time changed since last run, the
    // channel has nothing new — skip BEFORE downloading images + calling the
    // (vision) LLM, which is the most expensive path per channel.
    const hash = contentHash(text, String(latestPostAt));
    const outFile = path.join(OUT_DIR, `tg-${key}.json`);
    if (cache[`tg:${key}`] === hash && fs.existsSync(outFile)) { tgSkipped++; console.log(`  · ${label.padEnd(24)} unchanged, skip`); continue; }

    // Bet-slip screenshots: download up to IMAGE_LIMIT photos, base64 -> data URI.
    let images = [];
    if (VISION_CAPABLE) {
      const photoMsgs = messages.filter((m) => m.photo).slice(0, IMAGE_LIMIT);
      for (const m of photoMsgs) {
        try {
          // thumb: 1 = second-smallest size (sizes sorted ascending; index 0 is often
          // a too-blurry stripped preview). detail:'low' downsamples to 512x512 on
          // OpenAI's side anyway, so a mid-small thumb is just as readable + faster.
          const buf = await withTimeout(client.downloadMedia(m, { thumb: 1 }), 10000, 'downloadMedia');
          if (buf) images.push(`data:image/jpeg;base64,${Buffer.from(buf).toString('base64')}`);
        } catch { /* skip unreadable/slow media, don't stall the channel */ }
      }
    }

    if (!text && !images.length) { console.log(`  · ${label.padEnd(24)} no readable posts`); continue; }

    const res = await askLLM(text, images);
    if (!res.ok) { console.log(`  ✗ ${label.padEnd(24)} LLM HTTP ${res.status}`); await sleep(4000); continue; }
    cache[`tg:${key}`] = hash; // extracted OK -> skip until posts change
    const json = await res.json();
    if (json?.usage) { usageCalls++; usageInTok += json.usage.prompt_tokens || 0; usageOutTok += json.usage.completion_tokens || 0; }
    const parsed = parseTips(json?.choices?.[0]?.message?.content ?? '[]');
    const candidates = (Array.isArray(parsed) ? parsed : [])
      .filter((t) => t?.home && t?.away && VALID.includes(t.market) && t.selection);

    // Match to a REAL fixture -> real kickoff + dateVerified:true. No match
    // (alias mismatch, or a league our free-tier fixture source doesn't
    // cover) does NOT mean the pick is bad — keep it with a placeholder date
    // + dateVerified:false instead of discarding real signal. When matched +
    // we know the channel's latest post time, log how close to kickoff the
    // signal is — the "1h before the game" case.
    const PLACEHOLDER_KICKOFF = new Date().toISOString().slice(0, 10) + 'T18:00:00Z';
    let tips = [];
    let channelUnverified = 0, channelStale = 0;
    let sharpest = null;
    for (const t of candidates) {
      const f = matchFixture(t.home, t.away, FIXTURES);
      if (f && isStale(f)) { channelStale++; continue; } // real match, but already happened — old signal, drop
      let kickoff = PLACEHOLDER_KICKOFF, dateVerified = false, fixtureId;
      if (f) {
        kickoff = f.kickoff; dateVerified = true; fixtureId = f.id;
        const minsBefore = latestPostAt ? Math.round((+new Date(f.kickoff) - latestPostAt) / 60000) : null;
        if (minsBefore != null && (sharpest == null || minsBefore < sharpest)) sharpest = minsBefore;
      } else channelUnverified++;
      tips.push({
        source: `tg:${key}`, tipster: `TG:${label}`, homeTeam: String(t.home), awayTeam: String(t.away),
        league: t.league ? String(t.league) : 'Various', kickoff, dateVerified, ...(fixtureId ? { fixtureId } : {}), market: t.market,
        selection: String(t.selection).toLowerCase(), odds: typeof t.odds === 'number' ? t.odds : null,
      });
    }
    unverified += channelUnverified;
    stale += channelStale;

    const unvNote = channelUnverified ? `, ${channelUnverified} unverified date` : '';
    const staleNote = channelStale ? `, ${channelStale} stale dropped` : '';
    const sharpNote = sharpest != null && sharpest >= 0 && sharpest <= 180 ? ` ⚡ ${sharpest}min before kickoff` : '';
    if (tips.length === 0) { console.log(`  · ${label.padEnd(24)} 0 tips${staleNote || ' (promo/VIP only?)'}`); }
    else {
      fs.writeFileSync(path.join(OUT_DIR, `tg-${key}.json`), JSON.stringify(tips, null, 2) + '\n');
      written++; total += tips.length;
      console.log(`  ✓ ${label.padEnd(24)} ${tips.length} tips${unvNote}${staleNote}${sharpNote}`);
    }
    await sleep(4500);
  } catch (e) {
    console.log(`  ✗ ${label.padEnd(24)} ${String(e?.message || e).slice(0, 60)}`);
  }
}
await client.disconnect();
saveCache(cache);
console.log(`\nDone. ${written}/${CHANNELS.length} channels, ${total} tips total (${total - unverified} real kickoffs, ${unverified} unverified date but kept, ${stale} stale dropped).`);
const price = PRICING[PROVIDER] || { in: 0, out: 0 };
const cost = usageInTok * price.in + usageOutTok * price.out;
console.log(`  ${PROVIDER}: ${usageCalls} calls, ${usageInTok} in / ${usageOutTok} out tokens${cost > 0 ? ` -> $${cost.toFixed(4)}` : ' (free tier)'}`);
console.log(`Estimated cost this run: $${cost.toFixed(4)}`);
persistUsage({ [PROVIDER]: { calls: usageCalls, inTok: usageInTok, outTok: usageOutTok } }, { [PROVIDER]: CFG.model });
process.exit(0);
