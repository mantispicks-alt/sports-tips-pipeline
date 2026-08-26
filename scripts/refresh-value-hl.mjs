// -------------------------------------------------------------------------
// refresh-value-hl.mjs — the SHARP VALUE engine, powered by paid Highlightly.
//
// Replaces the dark The Odds API engine (refresh-odds.mjs → odds-value.json).
// Idea (unchanged): a bet is +EV when a soft bookmaker pays MORE than the sharp
// market's fair price. Here the sharp anchor is our FREE Pinnacle guest feed
// (scripts/refresh-pinnacle.mjs → src/data/pinnacle-fair.json, all-3 fair probs),
// and the soft-book prices come from Highlightly's paid odds endpoint (~2 books,
// 1X2). For each match Pinnacle prices, we join Highlightly's odds, and if the
// best book's price beats Pinnacle's fair prob by >= ODDS_VALUE_EDGE we emit a
// value pick (source `odds:value`) into src/data/tips/odds-value.json — the exact
// same shape the old engine wrote, so /value + the consensus pipeline consume it
// unchanged. PURELY ADDITIVE: this touches no tipster/cross-check logic.
//
// Offline-safe + cost-bounded: gated on HIGHLIGHTLY_PAID (never hammers the free
// tier), caps odds calls/run, and on any failure writes nothing (keeps the last
// good odds-value.json). 1X2 only for now (Highlightly's `Full Time Result`).
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const KEY = env.HIGHLIGHTLY_API_KEY;
const PAID = env.HIGHLIGHTLY_PAID === '1';
const FAIR_FILE = path.join(ROOT, 'src', 'data', 'pinnacle-fair.json');
const OUT = path.join(ROOT, 'src', 'data', 'tips', 'odds-value.json');
const BEST_OUT = path.join(ROOT, 'src', 'data', 'best-odds.json');

const EDGE = Number(env.ODDS_VALUE_EDGE) || 0.03; // min +EV vs Pinnacle fair (3%)
const MAX_EDGE = Number(env.ODDS_MAX_EDGE) || 0.30; // CAP: a real edge is small; >30% is a
// data error (stale/wrong book price, a 2-way market read as 3-way, or a mis-joined
// fixture) — the old engine's whole failure mode was fake +100-300% value on longshots.
const MIN_PROB = Number(env.ODDS_MIN_PROB) || 0.30; // skip longshots (fair prob floor)
const MIN_FAV = Number(env.ODDS_MIN_FAVORITE) || 0.42; // skip matches with no clear favorite (bad/illiquid data)
const MAX_ODDS_CALLS = Number(env.HL_VALUE_MAX_CALLS) || 150; // cost cap per run

if (!PAID || !KEY) { console.log('refresh-value-hl: HIGHLIGHTLY_PAID not set — skipping (value engine stays as-is).'); process.exit(0); }

let fair;
try { fair = JSON.parse(fs.readFileSync(FAIR_FILE, 'utf8')); }
catch { console.log('refresh-value-hl: no pinnacle-fair.json yet (run refresh-pinnacle first) — skipping.'); process.exit(0); }
const fairEntries = Object.values(fair).filter((f) => f && Number.isFinite(Date.parse(f.kickoff)) && Date.parse(f.kickoff) > Date.now());
if (!fairEntries.length) { console.log('refresh-value-hl: 0 upcoming Pinnacle-priced matches — nothing to scan.'); process.exit(0); }

// --- name matching (soft): fold + strip to alnum tokens, match on token overlap.
const foldLatin = (s) => s.replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ø/g, 'o').replace(/ß/g, 'ss').replace(/ð/g, 'd').replace(/þ/g, 'th').replace(/ł/g, 'l');
const TYPE = new Set(['fc', 'cf', 'sc', 'afc', 'ac', 'fk', 'sv', 'if', 'bk', 'club', 'cd', 'ca', 'ec', 'sd', 'ud', 'ad', 'de']);
const toks = (s) => new Set(foldLatin(String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !TYPE.has(t)));
function teamMatch(a, b) {
  if (!a.size || !b.size) return false;
  let inter = 0;
  for (const x of a) for (const y of b) { if (x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x)))) { inter++; break; } }
  return inter === Math.min(a.size, b.size) || inter / (a.size + b.size - inter) >= 0.5;
}
const dayOf = (iso) => String(iso).slice(0, 10);

const H = { headers: { 'x-rapidapi-key': KEY }, };
async function hlMatchesForDay(d) {
  const out = [];
  for (let offset = 0; offset < 800; offset += 100) {
    const res = await fetch(`https://soccer.highlightly.net/matches?date=${d}&limit=100&offset=${offset}`, { ...H, signal: AbortSignal.timeout(20000) });
    if (res.status === 429) throw new Error('429 breached daily limit');
    const j = await res.json();
    const arr = j?.data || (Array.isArray(j) ? j : []);
    for (const m of arr) if (m?.id && m?.homeTeam?.name && m?.awayTeam?.name && m?.date) out.push({ id: m.id, home: m.homeTeam.name, away: m.awayTeam.name, day: dayOf(m.date) });
    const total = j?.pagination?.totalCount ?? 0;
    if (!arr.length || offset + 100 >= total) break;
  }
  return out;
}

async function main() {
  // 1) Load Highlightly fixtures for every day Pinnacle has a match, index by day.
  const days = [...new Set(fairEntries.map((f) => dayOf(f.kickoff)))].sort();
  const hlByDay = new Map();
  try {
    for (const d of days) hlByDay.set(d, await hlMatchesForDay(d));
  } catch (e) { console.log(`refresh-value-hl: Highlightly matches fetch failed (${String(e.message).slice(0, 40)}) — kept existing odds-value.json.`); process.exit(0); }

  // 2) Join each Pinnacle-fair match to a Highlightly matchId (same day + both teams).
  const joined = [];
  for (const f of fairEntries) {
    const cand = hlByDay.get(dayOf(f.kickoff)) || [];
    const fh = toks(f.homeTeam), fa = toks(f.awayTeam);
    const hit = cand.find((c) => teamMatch(fh, toks(c.home)) && teamMatch(fa, toks(c.away)));
    if (hit) joined.push({ fair: f, id: hit.id });
  }
  if (!joined.length) { console.log('refresh-value-hl: 0 matches joined Pinnacle↔Highlightly — nothing to price.'); process.exit(0); }

  // 3) Pull odds per joined match (cost-capped), compute best book price per 1X2 selection.
  const picks = [];
  const bestOdds = {};
  const SELMAP = { Home: 'home', Draw: 'draw', Away: 'away' };
  let calls = 0, scanned = 0;
  for (const j of joined) {
    if (calls >= MAX_ODDS_CALLS) break;
    calls++;
    let odds;
    try {
      const res = await fetch(`https://soccer.highlightly.net/odds?matchId=${j.id}`, { ...H, signal: AbortSignal.timeout(15000) });
      if (res.status === 429) { console.log('refresh-value-hl: hit 429 mid-run — stopping, keeping what we have.'); break; }
      const jj = await res.json();
      odds = jj?.data?.[0]?.odds;
    } catch { continue; }
    if (!Array.isArray(odds)) continue;
    scanned++;
    // best bookmaker decimal per selection from the Full Time Result market
    const best = {}; // home|draw|away -> {price, book}
    for (const o of odds) {
      if (o?.market !== 'Full Time Result' || !Array.isArray(o.values)) continue;
      for (const v of o.values) {
        const sel = SELMAP[v?.value]; const price = Number(v?.odd);
        if (!sel || !(price > 1.01)) continue;
        if (!best[sel] || price > best[sel].price) best[sel] = { price, book: o.bookmakerName || '' };
      }
    }
    const f = j.fair;
    const mk = `${dayOf(f.kickoff)}|${f.homeTeam}|${f.awayTeam}`.toLowerCase();
    for (const sel of ['home', 'draw', 'away']) if (best[sel]) (bestOdds[mk] ??= {})[sel] = { odds: Math.round(best[sel].price * 100) / 100, book: best[sel].book };
    // clear-favorite guard: skip illiquid/uniform markets that manufacture fake value
    const maxFair = Math.max(f.home ?? 0, f.draw ?? 0, f.away ?? 0);
    if (maxFair < MIN_FAV) continue;
    for (const sel of ['home', 'draw', 'away']) {
      const fp = f[sel]; const b = best[sel];
      if (!b || !(fp >= MIN_PROB)) continue;
      const edge = b.price * fp - 1; // +EV: best book price beats the sharp fair prob
      if (edge >= EDGE && edge <= MAX_EDGE) {
        picks.push({
          source: 'odds:value', tipster: 'Sharp Value (Pinnacle-anchored)',
          homeTeam: f.homeTeam, awayTeam: f.awayTeam, league: f.league,
          kickoff: f.kickoff, sport: 'football', dateVerified: true,
          market: '1X2', selection: sel, odds: Math.round(b.price * 100) / 100,
          bookmaker: b.book, fairProb: Math.round(fp * 1000) / 10, edge: Math.round(edge * 1000) / 10,
        });
      }
    }
  }

  // 4) Guard: only overwrite when we actually priced matches this run.
  if (!scanned) { console.log('refresh-value-hl: 0 matches priced (all odds calls failed) — kept existing odds-value.json + best-odds.json.'); process.exit(0); }
  picks.sort((a, b) => b.edge - a.edge);
  fs.writeFileSync(OUT, JSON.stringify(picks, null, 2) + '\n');
  fs.writeFileSync(BEST_OUT, JSON.stringify(bestOdds, null, 2) + '\n');
  console.log(`refresh-value-hl: joined ${joined.length}, priced ${scanned} (${calls} odds calls), found ${picks.length} value picks (edge >= ${(EDGE * 100).toFixed(0)}%). Best-odds for ${Object.keys(bestOdds).length} matches.`);
  console.log(`  top: ${picks.slice(0, 5).map((p) => `${p.homeTeam} v ${p.awayTeam} [${p.selection} @${p.odds} ${p.bookmaker} +${p.edge}%]`).join('  //  ') || '(none — market efficient)'}`);
}

main();
