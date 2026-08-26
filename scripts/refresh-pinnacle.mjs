// -------------------------------------------------------------------------
// refresh-pinnacle.mjs — Pinnacle as a SHARP model source (NO KEY, UNLIMITED).
//
// Pinnacle is the sharpest book on the planet; its de-margined price is the
// closest thing to a match's TRUE probability. This pulls Pinnacle's own public
// web backend (the "Arcadia guest" API used by pinnacle.com itself) — no user
// key, no per-run credit limit, ~22k soccer matchups across ALL leagues incl.
// tiny ones. Two calls total:
//   GET guest.api.arcadia.pinnacle.com/0.1/sports/29/matchups        (fixtures)
//   GET guest.api.arcadia.pinnacle.com/0.1/sports/29/markets/straight (odds)
// join by matchupId; moneyline prices carry designation home/away/draw.
//
// It emits Pinnacle's implied 1X2 favorite per match (like refresh-clubelo, but
// this is the MARKET's estimate, not a model) — the single most reliable signal
// in the consensus pool. source "pinnacle", written to src/data/tips/pinnacle.json.
//
// ⚠️ This is Pinnacle's UNOFFICIAL guest backend (read-only, same data their site
// serves). It uses their public web-client X-API-Key. It can change / be blocked
// without notice, so this is fully offline-safe: any failure writes nothing and
// exits 0 — the licensed The Odds API value engine is untouched and keeps working.
//
//   node scripts/refresh-pinnacle.mjs
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src', 'data', 'tips', 'pinnacle.json');
// Sharp FAIR-PROBABILITY map for the value engine: {matchKey: {home,draw,away fair
// probs + teams/league/kickoff}}. Same de-vigged 1X2 numbers pinnacle.json is built
// from, but ALL three selections kept (pinnacle.json keeps only the favorite). The
// Highlightly value engine (refresh-value-hl.mjs) compares soft-book prices to these.
const FAIR_OUT = path.join(ROOT, 'src', 'data', 'pinnacle-fair.json');
// Steam store — remembers each match's OPENING de-margined favorite probability so
// a later run can tell if Pinnacle's line moved toward it (sharp money = "steam").
const MOVES_FILE = path.join(ROOT, 'src', 'data', 'pinnacle-moves.json');
const env = (() => {
  try {
    return Object.fromEntries(
      fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
    );
  } catch { return {}; }
})();
const MIN_PROB = Number(env.PINNACLE_MIN_PROB || 0.45); // skip toss-ups (no clear favorite)
const MIN_OU = Number(env.PINNACLE_MIN_OU || 0.55);     // O/U 2.5 side must be a real sharp lean
const MIN_BTTS = Number(env.PINNACLE_MIN_BTTS || 0.58); // BTTS side must be a real sharp lean
const STEAM_MIN = Number(env.PINNACLE_STEAM_MIN || 0.03); // fav fair-prob must RISE >=3pts to be "steam"
const DAYS_AHEAD = Number(env.PINNACLE_DAYS_AHEAD || 5);
// Pinnacle's public web-client key (built into pinnacle.com's own frontend, not a
// user account). Overridable via .env if they ever rotate it.
const KEY = env.PINNACLE_GUEST_KEY || 'CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R';
const BASE = 'https://guest.api.arcadia.pinnacle.com/0.1';
const H = { headers: { 'x-api-key': KEY, accept: 'application/json', 'user-agent': 'Mozilla/5.0' } };

const dec = (a) => (a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a)); // American -> decimal

async function main() {
  let matchups, markets;
  try {
    [matchups, markets] = await Promise.all([
      fetch(`${BASE}/sports/29/matchups`, { ...H, signal: AbortSignal.timeout(25000) }).then((r) => r.json()),
      fetch(`${BASE}/sports/29/markets/straight`, { ...H, signal: AbortSignal.timeout(25000) }).then((r) => r.json()),
    ]);
  } catch (e) {
    console.error(`Pinnacle guest API unreachable (${String(e?.message || e)}). Nothing written (offline-safe).`);
    process.exit(0);
  }
  if (!Array.isArray(matchups) || !Array.isArray(markets)) {
    console.error('Pinnacle guest API returned an unexpected shape. Nothing written.');
    process.exit(0);
  }

  const now = Date.now();
  const horizon = now + DAYS_AHEAD * 864e5;

  // matchupId -> {home, away, league, kickoff}
  const games = new Map();
  for (const m of matchups) {
    if (m?.type !== 'matchup' || !Array.isArray(m.participants)) continue;
    const home = m.participants.find((p) => p.alignment === 'home')?.name;
    const away = m.participants.find((p) => p.alignment === 'away')?.name;
    if (!home || !away || !m.startTime) continue;
    const t = Date.parse(m.startTime);
    if (!Number.isFinite(t) || t < now || t > horizon) continue; // upcoming only
    const league = (m.league?.name || m.league?.group || 'Pinnacle').toString();
    games.set(m.id, { home, away, league, kickoff: new Date(t).toISOString() });
  }

  // matchupId -> {home, away, draw} decimal, from the full-match moneyline
  const odds = new Map();
  for (const mk of markets) {
    if (mk?.type !== 'moneyline' || mk.period !== 0 || !Array.isArray(mk.prices)) continue;
    if (!games.has(mk.matchupId)) continue;
    const o = {};
    for (const p of mk.prices) if (p?.designation && typeof p.price === 'number') o[p.designation] = dec(p.price);
    if (o.home && o.away) odds.set(mk.matchupId, o); // draw optional (some comps are 2-way)
  }

  // matchupId -> {over, under} decimal at the 2.5 goals line. The straight
  // markets carry full-match Over/Under (type 'total', period 0) at many lines;
  // we anchor on the fixed 2.5 line (our OU25 market). Crucially we accept BOTH
  // the main and ALTERNATE 2.5 lines: when 2.5 is Pinnacle's balanced main line
  // the price is ~50/50 (no signal, correctly filtered by MIN_OU below), but for
  // high/low-scoring games 2.5 is an alternate line priced lopsided — that's the
  // sharp lean worth publishing. Pinnacle's goals read for ALL leagues, free.
  const totals = new Map();
  for (const mk of markets) {
    if (mk?.type !== 'total' || mk.period !== 0 || !Array.isArray(mk.prices)) continue;
    if (!games.has(mk.matchupId)) continue;
    const t = {};
    for (const p of mk.prices) {
      if (p?.designation && typeof p.price === 'number' && Number(p.points) === 2.5) t[p.designation] = dec(p.price);
    }
    if (t.over && t.under) totals.set(mk.matchupId, t); // one 2.5 line per match
  }

  // matchupId -> {home:{over,under}, away:{over,under}} at the 0.5 TEAM total —
  // i.e. Pinnacle's price on each team scoring at least once. P(team scores) =
  // de-margined P(over 0.5); BTTS-yes = P(home scores) × P(away scores). The
  // first SHARP Both-Teams-To-Score signal (previously only the FD Poisson model).
  const teamTot = new Map();
  for (const mk of markets) {
    if (mk?.type !== 'team_total' || mk.period !== 0 || !Array.isArray(mk.prices)) continue;
    if (!games.has(mk.matchupId)) continue;
    const side = mk.side === 'home' ? 'home' : mk.side === 'away' ? 'away' : null;
    if (!side) continue;
    const p = {};
    for (const q of mk.prices) if (q?.designation && typeof q.price === 'number' && Number(q.points) === 0.5) p[q.designation] = dec(q.price);
    if (!(p.over && p.under)) continue;
    const e = teamTot.get(mk.matchupId) || {};
    e[side] = p; // last 0.5 line for this side wins (main + alternate are ~equal at 0.5)
    teamTot.set(mk.matchupId, e);
  }

  // Steam store: matchKey -> { sel, open, last, openAt, lastAt }. Persisted so the
  // OPENING favorite prob survives across the 2h runs. Offline-safe read.
  const moves = (() => { try { return JSON.parse(fs.readFileSync(MOVES_FILE, 'utf8')); } catch { return {}; } })();
  const nowIso = new Date().toISOString();
  const mkKey = (g) => `${String(g.kickoff).slice(0, 10)}|${g.home}|${g.away}`.toLowerCase();

  const tips = [];
  const fairMap = {}; // matchKey -> {home,draw,away fair probs + meta} for the value engine
  const leagues = new Set();
  const base = (g) => ({
    source: 'pinnacle', tipster: 'Pinnacle (sharp)',
    homeTeam: g.home, awayTeam: g.away, league: g.league,
    // Pinnacle's startTime IS a confirmed real kickoff (Pinnacle is itself a
    // fixture source), and we carry its real de-margined price — so these are
    // publishable: real upcoming match, real date, real odds.
    kickoff: g.kickoff, dateVerified: true, sport: 'football',
  });
  let n1x2 = 0, nou = 0, nbtts = 0, nsteam = 0;
  for (const [id, g] of games) {
    // --- 1X2 favorite (de-margined moneyline) ---
    const o = odds.get(id);
    if (o) {
      const inv = { home: 1 / o.home, away: 1 / o.away, ...(o.draw ? { draw: 1 / o.draw } : {}) };
      const s = Object.values(inv).reduce((a, b) => a + b, 0) || 1;
      const fair = Object.fromEntries(Object.entries(inv).map(([k, v]) => [k, v / s])); // de-margined
      // Keep ALL three fair probs for the value engine (not just the favorite below).
      fairMap[mkKey(g)] = {
        homeTeam: g.home, awayTeam: g.away, league: g.league, kickoff: g.kickoff,
        home: fair.home ?? null, draw: fair.draw ?? null, away: fair.away ?? null,
      };
      let sel = 'home', prob = 0;
      for (const [k, v] of Object.entries(fair)) if (v > prob) { prob = v; sel = k; }
      if (prob >= MIN_PROB) {
        tips.push({ ...base(g), market: '1X2', selection: sel, odds: Math.round(o[sel] * 100) / 100, confidence: Math.round(prob * 100) / 100 });
        leagues.add(g.league); n1x2++;
      }
      // --- STEAM: did the line move TOWARD the favorite since it opened? ---
      const key = mkKey(g);
      const prev = moves[key];
      if (!prev || prev.sel !== sel) {
        moves[key] = { sel, open: prob, last: prob, openAt: nowIso, lastAt: nowIso };
      } else {
        moves[key] = { ...prev, last: prob, lastAt: nowIso };
        // fair prob RISING = odds shortening on the favorite = sharp money in.
        if (prob - prev.open >= STEAM_MIN && prob >= MIN_PROB) {
          tips.push({
            ...base(g), source: 'pinnacle-steam', tipster: 'Pinnacle Steam',
            market: '1X2', selection: sel, odds: o[sel] ? Math.round(o[sel] * 100) / 100 : null,
            // confidence carries the CURRENT fair prob; the move itself is the signal.
            confidence: Math.round(prob * 100) / 100,
          });
          leagues.add(g.league); nsteam++;
        }
      }
    }
    // --- Over/Under 2.5 (de-margined total at the main 2.5 line) — Pinnacle's
    // sharp goals read, the first broad-coverage sharp O/U signal we have ---
    const t = totals.get(id);
    if (t) {
      const io = 1 / t.over, iu = 1 / t.under; const s = io + iu || 1;
      const pOver = io / s;
      const sel = pOver >= 0.5 ? 'over' : 'under';
      const prob = Math.max(pOver, 1 - pOver);
      if (prob >= MIN_OU) {
        tips.push({ ...base(g), market: 'OU25', selection: sel, odds: Math.round((sel === 'over' ? t.over : t.under) * 100) / 100, confidence: Math.round(prob * 100) / 100 });
        leagues.add(g.league); nou++;
      }
    }
    // --- BTTS (from the 0.5 team totals) — sharp Both-Teams-To-Score ---
    const tt = teamTot.get(id);
    if (tt && tt.home && tt.away) {
      const pHome = (1 / tt.home.over) / (1 / tt.home.over + 1 / tt.home.under); // P(home scores >=1)
      const pAway = (1 / tt.away.over) / (1 / tt.away.over + 1 / tt.away.under); // P(away scores >=1)
      const yes = pHome * pAway; // independence approximation (the standard BTTS proxy)
      const sel = yes >= 0.5 ? 'yes' : 'no';
      const prob = Math.max(yes, 1 - yes);
      if (prob >= MIN_BTTS) {
        // no direct BTTS price in the straight feed -> leave odds null (model-style signal)
        tips.push({ ...base(g), market: 'BTTS', selection: sel, odds: null, confidence: Math.round(prob * 100) / 100 });
        leagues.add(g.league); nbtts++;
      }
    }
  }

  // Persist the steam store: keep only matches still ahead of us (prune anything
  // whose kickoff has passed) so the file can't grow without bound.
  const cutoff = now - 12 * 3600e3;
  const kept = {};
  for (const [k, v] of Object.entries(moves)) {
    const day = Date.parse(String(k.split('|')[0]) + 'T00:00:00Z');
    if (Number.isFinite(day) && day >= cutoff) kept[k] = v;
  }
  try { fs.writeFileSync(MOVES_FILE, JSON.stringify(kept, null, 2)); } catch { /* non-fatal */ }

  if (!tips.length) { console.error('Pinnacle: 0 picks passed the probability floor / date window. Snapshot NOT overwritten.'); process.exit(0); }
  fs.writeFileSync(OUT, JSON.stringify(tips, null, 2));
  try { fs.writeFileSync(FAIR_OUT, JSON.stringify(fairMap, null, 2)); console.log(`  fair-prob map: ${Object.keys(fairMap).length} matches -> ${path.relative(ROOT, FAIR_OUT)}`); } catch { /* non-fatal */ }
  console.log(`Pinnacle: ${games.size} upcoming matchups, ${odds.size} moneyline + ${totals.size} O/U-2.5 + ${teamTot.size} team-total priced -> wrote ${tips.length} picks (${n1x2} 1X2 + ${nou} O/U + ${nbtts} BTTS + ${nsteam} STEAM, ${leagues.size} leagues) -> ${path.relative(ROOT, OUT)}`);
  console.log(`  sample: ${tips.slice(0, 3).map((t) => `${t.homeTeam} v ${t.awayTeam} [${t.market}:${t.selection} ${t.confidence}]`).join('  //  ')}`);
}

main();
