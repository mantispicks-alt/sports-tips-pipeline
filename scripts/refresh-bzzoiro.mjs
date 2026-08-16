// -------------------------------------------------------------------------
// refresh-bzzoiro.mjs — BSD (Bzzoiro Sports Data) as a MARKET source.
//
// BSD's /api/events/ carries de-vigged market-consensus odds for 1X2, Over/Under
// 2.5 AND Both-Teams-To-Score across ~48 upcoming leagues — free, NO rate limits
// (needs the free BZZOIRO_API_KEY, already in .env/secrets). Its standout value
// is REAL BTTS market prices (`odds_btts_yes/no`): previously BTTS was only the
// FD Poisson approximation, so this is our first market-priced BTTS signal on a
// broad set of leagues. 1X2 + O/U add cross-check breadth alongside Pinnacle.
//
// De-margin each market -> emit the leaning selection with the real decimal odds.
// Offline-safe like the other model sources: any failure writes nothing, exit 0.
//
//   node scripts/refresh-bzzoiro.mjs            # normal
//   node scripts/refresh-bzzoiro.mjs --debug    # counts + sample
//
// Output: src/data/tips/bzzoiro.json (source "bzzoiro", tipster "BSD Market")
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src', 'data', 'tips', 'bzzoiro.json');
const DEBUG = process.argv.includes('--debug');

const env = (() => {
  try {
    return Object.fromEntries(
      fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
    );
  } catch { return {}; }
})();
const KEY = process.env.BZZOIRO_API_KEY || env.BZZOIRO_API_KEY || '';
const DAYS_AHEAD = Number(env.BZZOIRO_DAYS_AHEAD || 6);
const MIN_1X2 = Number(env.BZZOIRO_MIN_1X2 || 0.50);
const MIN_OU = Number(env.BZZOIRO_MIN_OU || 0.56);
const MIN_BTTS = Number(env.BZZOIRO_MIN_BTTS || 0.56);
const MAX_PAGES = Number(env.BZZOIRO_MAX_PAGES || 8);
const BASE = 'https://sports.bzzoiro.com/api/events/?limit=100';

const now = Date.now();
const horizon = now + DAYS_AHEAD * 864e5;
// de-margin a 2- or 3-way market into normalized probabilities
function demargin(odds) {
  const inv = odds.map((o) => (o > 1 ? 1 / o : 0));
  const s = inv.reduce((a, b) => a + b, 0);
  return s > 0 ? inv.map((x) => x / s) : odds.map(() => 0);
}

async function main() {
  if (!KEY) { console.error('No BZZOIRO_API_KEY — nothing written (offline-safe).'); process.exit(0); }
  let events = [];
  try {
    let url = BASE, pages = 0;
    while (url && pages < MAX_PAGES) {
      const r = await fetch(url, { headers: { Authorization: `Token ${KEY}` }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      events.push(...(j.results || []));
      url = j.next; pages++;
    }
  } catch (e) {
    console.error(`BSD unreachable (${String(e?.message || e)}). Nothing written (offline-safe).`);
    process.exit(0);
  }
  if (!events.length) { console.error('BSD returned 0 events. Snapshot NOT overwritten.'); process.exit(0); }

  const tips = [];
  const leagues = new Set();
  let n1x2 = 0, nou = 0, nbtts = 0;
  const DEAD = new Set(['finished', 'cancelled', 'postponed', 'canceled', 'abandoned', 'suspended']);
  for (const e of events) {
    if (DEAD.has(String(e.status || '').toLowerCase())) continue;
    const t = Date.parse(e.event_date);
    if (!Number.isFinite(t) || t < now - 6 * 3600e3 || t > horizon) continue; // upcoming window
    const home = e.home_team, away = e.away_team;
    if (!home || !away) continue;
    const league = e.league?.name || 'BSD';
    const kickoff = new Date(t).toISOString();
    const base = { source: 'bzzoiro', tipster: 'BSD Market', homeTeam: home, awayTeam: away, league, kickoff, dateVerified: true, sport: 'football' };

    // 1X2
    if (e.odds_home > 1 && e.odds_away > 1) {
      const oh = e.odds_home, od = e.odds_draw > 1 ? e.odds_draw : 0, oa = e.odds_away;
      const [ph, pd, pa] = od ? demargin([oh, od, oa]) : (() => { const [a, b] = demargin([oh, oa]); return [a, 0, b]; })();
      const probs = [['home', ph, oh], ['draw', pd, od], ['away', pa, oa]].filter((x) => x[2] > 1).sort((a, b) => b[1] - a[1]);
      if (probs[0] && probs[0][1] >= MIN_1X2) {
        tips.push({ ...base, market: '1X2', selection: probs[0][0], odds: Math.round(probs[0][2] * 100) / 100, confidence: Math.round(probs[0][1] * 100) / 100 });
        leagues.add(league); n1x2++;
      }
    }
    // O/U 2.5
    if (e.odds_over_25 > 1 && e.odds_under_25 > 1) {
      const [pOv, pUn] = demargin([e.odds_over_25, e.odds_under_25]);
      const sel = pOv >= pUn ? 'over' : 'under';
      const prob = Math.max(pOv, pUn);
      if (prob >= MIN_OU) {
        tips.push({ ...base, market: 'OU25', selection: sel, odds: Math.round((sel === 'over' ? e.odds_over_25 : e.odds_under_25) * 100) / 100, confidence: Math.round(prob * 100) / 100 });
        leagues.add(league); nou++;
      }
    }
    // BTTS (real market price — the standout signal)
    if (e.odds_btts_yes > 1 && e.odds_btts_no > 1) {
      const [pYes, pNo] = demargin([e.odds_btts_yes, e.odds_btts_no]);
      const sel = pYes >= pNo ? 'yes' : 'no';
      const prob = Math.max(pYes, pNo);
      if (prob >= MIN_BTTS) {
        tips.push({ ...base, market: 'BTTS', selection: sel, odds: Math.round((sel === 'yes' ? e.odds_btts_yes : e.odds_btts_no) * 100) / 100, confidence: Math.round(prob * 100) / 100 });
        leagues.add(league); nbtts++;
      }
    }
  }

  if (!tips.length) { console.error('BSD: 0 picks passed the thresholds / window. Snapshot NOT overwritten.'); process.exit(0); }
  fs.writeFileSync(OUT, JSON.stringify(tips, null, 2));
  console.log(`BSD: ${events.length} events -> wrote ${tips.length} picks (${n1x2} 1X2 + ${nou} O/U + ${nbtts} BTTS, ${leagues.size} leagues) -> ${path.relative(ROOT, OUT)}`);
  if (DEBUG) console.log(`  sample: ${tips.slice(0, 4).map((t) => `${t.homeTeam} v ${t.awayTeam} [${t.market}:${t.selection} @${t.odds}]`).join('  //  ')}`);
}

main();
