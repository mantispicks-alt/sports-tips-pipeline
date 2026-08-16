// -------------------------------------------------------------------------
// refresh-fdcouk.mjs — football-data.co.uk source (NO API KEY, unlimited, free).
//
// Two INDEPENDENT signals from one free provider, aimed squarely at the SMALL
// leagues where our other model sources are thin and bookmaker lines are softest:
//
//   1) FD Odds  (source "fdcouk", tipster "FD Odds")
//      De-margined bookmaker CONSENSUS from the upcoming-fixtures feeds:
//        - fixtures.csv           -> 1X2 + Over/Under 2.5  (E1/E2/E3/EC, SC2/SC3,
//                                     D2, F2, B1, N1, P1, T1, SP1/SP2 …)
//        - new_league_fixtures.csv-> 1X2                    (Argentina, Brazil,
//                                     Denmark, Finland, Ireland, Japan, Mexico,
//                                     Norway, Poland, Romania, Sweden, USA …)
//      This is the FIRST Over/Under 2.5 MODEL signal we have for small leagues —
//      ClubElo and Pinnacle only emit 1X2. Real decimal odds are attached so ROI
//      + best-odds work.
//
//   2) FD Poisson (source "fdcouk-model", tipster "FD Poisson")
//      A team-strength Poisson built from THIS provider's own season results
//      (current + previous season CSVs, same team-name namespace as the fixtures
//      file -> clean join, no fuzzy). Emits O/U 2.5, BTTS and 1X2 from the model,
//      INDEPENDENT of the odds -> genuine cross-check + a shot at the value the
//      soft small-league lines miss. Only for divisions with season history
//      (the main fixtures.csv codes); the new-league feed stays odds-only.
//
// Offline-safe like refresh-clubelo / refresh-pinnacle: any fetch/parse failure
// writes NOTHING and exits 0 (never wipes a good snapshot). Deterministic — no
// Date.now() in the pick payload beyond the standard kickoff filter.
//
//   node scripts/refresh-fdcouk.mjs            # normal
//   node scripts/refresh-fdcouk.mjs --debug    # dump headers + counts
//
// Output: src/data/tips/fdcouk.json (+ fdcouk-model.json)
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ODDS = path.join(ROOT, 'src', 'data', 'tips', 'fdcouk.json');
const OUT_MODEL = path.join(ROOT, 'src', 'data', 'tips', 'fdcouk-model.json');
const DEBUG = process.argv.includes('--debug');

const env = (() => {
  try {
    return Object.fromEntries(
      fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
    );
  } catch { return {}; }
})();
const DAYS_AHEAD = Number(env.FDCOUK_DAYS_AHEAD || 6);
const MIN_1X2 = Number(env.FDCOUK_MIN_1X2 || 0.50);   // de-margined favorite floor
const MIN_OU = Number(env.FDCOUK_MIN_OU || 0.56);     // over/under side floor
const MIN_MODEL = Number(env.FDCOUK_MIN_MODEL || 0.58); // Poisson pick floor
const BASE = 'https://www.football-data.co.uk';

// --- CSV parse (handles quotes; football-data is comma-separated) -----------
function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    rows.push(out);
  }
  return rows;
}
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };

async function getCsv(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = parseCsv(await res.text());
  if (rows.length < 2) throw new Error('no rows');
  const header = rows[0].map((h) => h.trim());
  const idx = (name) => header.indexOf(name);
  return { header, rows, idx };
}

// DD/MM/YYYY + HH:MM (football-data is UK; treat as UTC — day-grouping/settlement
// only use the date, the +1h drift never crosses a fixture to the wrong day here).
function toISO(dstr, tstr) {
  const m = String(dstr || '').match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (!m) return '';
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  const hm = /^\d{1,2}:\d{2}$/.test(String(tstr || '').trim()) ? String(tstr).trim().padStart(5, '0') : '00:00';
  return `${yyyy}-${m[2]}-${m[1]}T${hm}:00Z`;
}

// de-margin a set of decimal odds -> normalized probabilities (removes overround)
function demargin(...odds) {
  const inv = odds.map((o) => (o ? 1 / o : 0));
  const s = inv.reduce((a, b) => a + b, 0);
  return s > 0 ? inv.map((x) => x / s) : odds.map(() => 0);
}

const now = Date.now();
const horizon = now + DAYS_AHEAD * 864e5;
const inWindow = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) && t >= now - 6 * 3600e3 && t <= horizon; };

// League name for a division code (for display; unknown codes pass through).
const DIV_NAME = {
  E0: 'England Premier League', E1: 'England Championship', E2: 'England League One',
  E3: 'England League Two', EC: 'England National League',
  SC0: 'Scotland Premiership', SC1: 'Scotland Championship', SC2: 'Scotland League One', SC3: 'Scotland League Two',
  D1: 'Germany Bundesliga', D2: 'Germany 2. Bundesliga',
  I1: 'Italy Serie A', I2: 'Italy Serie B',
  SP1: 'Spain La Liga', SP2: 'Spain Segunda',
  F1: 'France Ligue 1', F2: 'France Ligue 2',
  N1: 'Netherlands Eredivisie', B1: 'Belgium Pro League',
  P1: 'Portugal Primeira', T1: 'Turkey Super Lig', G1: 'Greece Super League',
};

// ---------------------------------------------------------------------------
// PART 1 — FD Odds (de-margined bookmaker consensus)
// ---------------------------------------------------------------------------
const oddsTips = [];
const oddsLeagues = new Set();
// remember fixtures per division so the Poisson pass can re-use dates/teams + odds
const fixturesByDiv = new Map(); // div -> [{home,away,kickoff, o1x2:{h,d,a}, ou:{over,under}}]

async function partOdds() {
  // --- main fixtures.csv: 1X2 + O/U 2.5 ---
  try {
    const { header, rows, idx } = await getCsv(`${BASE}/fixtures.csv`);
    if (DEBUG) console.log('fixtures.csv cols:', header.length);
    const iDiv = idx('Div'), iDate = idx('Date'), iTime = idx('Time'), iH = idx('HomeTeam'), iA = idx('AwayTeam');
    // prefer market Avg, fall back to Bet365
    const H = [idx('AvgH'), idx('B365H')], D = [idx('AvgD'), idx('B365D')], A = [idx('AvgA'), idx('B365A')];
    const OV = [idx('Avg>2.5'), idx('B365>2.5')], UN = [idx('Avg<2.5'), idx('B365<2.5')];
    const pick = (row, cols) => { for (const c of cols) if (c >= 0) { const n = num(row[c]); if (n) return n; } return null; };
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const home = (row[iH] || '').trim(), away = (row[iA] || '').trim();
      if (!home || !away) continue;
      const kickoff = toISO(row[iDate], row[iTime]);
      if (!inWindow(kickoff)) continue;
      const div = (row[iDiv] || '').trim();
      const league = DIV_NAME[div] || div || 'football-data';
      const oh = pick(row, H), od = pick(row, D), oa = pick(row, A);
      const rec = { home, away, kickoff, o1x2: null, ou: null };
      if (oh && od && oa) {
        const [ph, pd, pa] = demargin(oh, od, oa);
        rec.o1x2 = { home: oh, draw: od, away: oa };
        const probs = [['home', ph, oh], ['draw', pd, od], ['away', pa, oa]].sort((x, y) => y[1] - x[1]);
        const [sel, p, o] = probs[0];
        if (p >= MIN_1X2) {
          oddsTips.push(mk(home, away, league, kickoff, '1X2', sel, o, p, 'FD Odds', 'fdcouk'));
          oddsLeagues.add(league);
        }
      }
      const oOv = pick(row, OV), oUn = pick(row, UN);
      if (oOv && oUn) {
        const [pOv, pUn] = demargin(oOv, oUn);
        rec.ou = { over: oOv, under: oUn };
        if (pOv >= MIN_OU) oddsTips.push(mk(home, away, league, kickoff, 'OU25', 'over', oOv, pOv, 'FD Odds', 'fdcouk'));
        else if (pUn >= MIN_OU) oddsTips.push(mk(home, away, league, kickoff, 'OU25', 'under', oUn, pUn, 'FD Odds', 'fdcouk'));
        oddsLeagues.add(league);
      }
      if (div) { if (!fixturesByDiv.has(div)) fixturesByDiv.set(div, []); fixturesByDiv.get(div).push(rec); }
    }
  } catch (e) { console.error(`fixtures.csv skipped (${String(e?.message || e)})`); }

  // --- new_league_fixtures.csv: 1X2 only (Country/League labelled) ---
  try {
    const { header, rows, idx } = await getCsv(`${BASE}/new_league_fixtures.csv`);
    if (DEBUG) console.log('new_league cols:', header.length);
    const iCountry = idx('Country'), iLeague = idx('League'), iDate = idx('Date'), iTime = idx('Time'), iH = idx('Home'), iA = idx('Away');
    // prefer Pinnacle (PS) then Avg then B365
    const H = [idx('PSH'), idx('AvgH'), idx('B365H')], D = [idx('PSD'), idx('AvgD'), idx('B365D')], A = [idx('PSA'), idx('AvgA'), idx('B365A')];
    const pick = (row, cols) => { for (const c of cols) if (c >= 0) { const n = num(row[c]); if (n) return n; } return null; };
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const home = (row[iH] || '').trim(), away = (row[iA] || '').trim();
      if (!home || !away) continue;
      const kickoff = toISO(row[iDate], row[iTime]);
      if (!inWindow(kickoff)) continue;
      const league = [(row[iCountry] || '').trim(), (row[iLeague] || '').trim()].filter(Boolean).join(' ') || 'football-data';
      const oh = pick(row, H), od = pick(row, D), oa = pick(row, A);
      if (!(oh && od && oa)) continue;
      const [ph, pd, pa] = demargin(oh, od, oa);
      const probs = [['home', ph, oh], ['draw', pd, od], ['away', pa, oa]].sort((x, y) => y[1] - x[1]);
      const [sel, p, o] = probs[0];
      if (p >= MIN_1X2) { oddsTips.push(mk(home, away, league, kickoff, '1X2', sel, o, p, 'FD Odds', 'fdcouk')); oddsLeagues.add(league); }
    }
  } catch (e) { console.error(`new_league_fixtures.csv skipped (${String(e?.message || e)})`); }
}

function mk(home, away, league, kickoff, market, selection, odds, prob, tipster, source) {
  return {
    source, tipster, homeTeam: home, awayTeam: away, league, kickoff,
    dateVerified: true, market, selection,
    odds: odds ?? null, sport: 'football',
    confidence: Math.round((prob ?? 0) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// PART 2 — FD Poisson (team-strength model from season history)
// ---------------------------------------------------------------------------
const modelTips = [];
const modelLeagues = new Set();
const SEASONS = ['2627', '2526']; // current + previous
const fact = [1, 1, 2, 6, 24, 120, 720, 5040];
const pois = (k, l) => (Math.exp(-l) * Math.pow(l, k)) / fact[k];

async function buildDivModel(div) {
  // gather matches across seasons
  const rowsAll = [];
  for (const s of SEASONS) {
    try {
      const { rows, idx } = await getCsv(`${BASE}/mmz4281/${s}/${div}.csv`);
      const iH = idx('HomeTeam'), iA = idx('AwayTeam'), iHG = idx('FTHG'), iAG = idx('FTAG');
      if (iH < 0 || iHG < 0) continue;
      for (let r = 1; r < rows.length; r++) {
        const home = (rows[r][iH] || '').trim(), away = (rows[r][iA] || '').trim();
        const hg = num(rows[r][iHG]) === null ? parseInt(rows[r][iHG], 10) : parseInt(rows[r][iHG], 10);
        const ag = parseInt(rows[r][iAG], 10);
        if (!home || !away || !Number.isFinite(hg) || !Number.isFinite(ag)) continue;
        rowsAll.push({ home, away, hg, ag });
      }
    } catch { /* season may not exist yet — ignore */ }
  }
  if (rowsAll.length < 40) return null; // too little history for stable strengths

  const homeAvg = rowsAll.reduce((s, m) => s + m.hg, 0) / rowsAll.length;
  const awayAvg = rowsAll.reduce((s, m) => s + m.ag, 0) / rowsAll.length;
  const lgAvg = (homeAvg + awayAvg) / 2 || 1;
  const gf = new Map(), ga = new Map(), gp = new Map();
  const bump = (t, f, a) => { gf.set(t, (gf.get(t) || 0) + f); ga.set(t, (ga.get(t) || 0) + a); gp.set(t, (gp.get(t) || 0) + 1); };
  for (const m of rowsAll) { bump(m.home, m.hg, m.ag); bump(m.away, m.ag, m.hg); }
  // combined attack/defense multipliers (stable with limited data), shrunk toward
  // 1.0 by adding league-average pseudo-games so a 3-game team isn't extreme.
  const K = 4; // pseudo-games of prior
  const atk = (t) => ((gf.get(t) || 0) + K * lgAvg) / ((gp.get(t) || 0) + K) / lgAvg;
  const def = (t) => ((ga.get(t) || 0) + K * lgAvg) / ((gp.get(t) || 0) + K) / lgAvg;
  const known = (t) => gp.has(t);
  return { homeAvg, awayAvg, atk, def, known, n: rowsAll.length };
}

async function partPoisson() {
  for (const [div, fixtures] of fixturesByDiv) {
    if (!fixtures.length) continue;
    let model; try { model = await buildDivModel(div); } catch { model = null; }
    if (!model) continue;
    const league = DIV_NAME[div] || div;
    for (const fx of fixtures) {
      if (!model.known(fx.home) || !model.known(fx.away)) continue; // no strength -> skip
      const lh = Math.max(0.2, Math.min(4, model.homeAvg * model.atk(fx.home) * model.def(fx.away)));
      const la = Math.max(0.2, Math.min(4, model.awayAvg * model.atk(fx.away) * model.def(fx.home)));
      // score matrix 0..7
      let pHome = 0, pDraw = 0, pAway = 0, pOver = 0, pBttsYes = 0;
      const pH0 = pois(0, lh), pA0 = pois(0, la);
      pBttsYes = (1 - pH0) * (1 - pA0);
      for (let i = 0; i <= 7; i++) for (let j = 0; j <= 7; j++) {
        const p = pois(i, lh) * pois(j, la);
        if (i > j) pHome += p; else if (i === j) pDraw += p; else pAway += p;
        if (i + j > 2.5) pOver += p;
      }
      // O/U 2.5
      if (pOver >= MIN_MODEL) modelTips.push(mkModel(fx, league, 'OU25', 'over', pOver));
      else if ((1 - pOver) >= MIN_MODEL) modelTips.push(mkModel(fx, league, 'OU25', 'under', 1 - pOver));
      // BTTS
      if (pBttsYes >= MIN_MODEL) modelTips.push(mkModel(fx, league, 'BTTS', 'yes', pBttsYes));
      else if ((1 - pBttsYes) >= MIN_MODEL) modelTips.push(mkModel(fx, league, 'BTTS', 'no', 1 - pBttsYes));
      // 1X2 favorite
      const win = [['home', pHome], ['draw', pDraw], ['away', pAway]].sort((a, b) => b[1] - a[1])[0];
      if (win[1] >= MIN_1X2) modelTips.push(mkModel(fx, league, '1X2', win[0], win[1]));
      modelLeagues.add(league);
    }
  }
}

// attach the market odds for the same selection when the fixture carried them,
// so model picks that agree with the book still get a real price for ROI/best-odds.
function mkModel(fx, league, market, selection, prob) {
  let odds = null;
  if (market === '1X2' && fx.o1x2) odds = fx.o1x2[selection] ?? null;
  else if (market === 'OU25' && fx.ou) odds = selection === 'over' ? fx.ou.over : fx.ou.under;
  return {
    source: 'fdcouk-model', tipster: 'FD Poisson',
    homeTeam: fx.home, awayTeam: fx.away, league, kickoff: fx.kickoff,
    dateVerified: true, market, selection,
    odds, sport: 'football',
    confidence: Math.round(prob * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
async function main() {
  try { await partOdds(); } catch (e) { console.error('partOdds fatal', e?.message); }
  try { await partPoisson(); } catch (e) { console.error('partPoisson fatal', e?.message); }

  if (oddsTips.length) {
    fs.writeFileSync(OUT_ODDS, JSON.stringify(oddsTips, null, 2));
    console.log(`FD Odds   : wrote ${oddsTips.length} picks / ${oddsLeagues.size} leagues -> ${path.relative(ROOT, OUT_ODDS)}`);
    console.log(`  leagues: ${[...oddsLeagues].slice(0, 14).join(' | ')}${oddsLeagues.size > 14 ? ' …' : ''}`);
  } else {
    console.error('FD Odds   : 0 picks (unreachable or empty) — snapshot NOT overwritten (offline-safe).');
  }
  if (modelTips.length) {
    fs.writeFileSync(OUT_MODEL, JSON.stringify(modelTips, null, 2));
    console.log(`FD Poisson: wrote ${modelTips.length} picks / ${modelLeagues.size} leagues -> ${path.relative(ROOT, OUT_MODEL)}`);
    const byMkt = modelTips.reduce((a, t) => { a[t.market] = (a[t.market] || 0) + 1; return a; }, {});
    console.log(`  markets: ${Object.entries(byMkt).map(([k, v]) => `${k}:${v}`).join('  ')}`);
  } else {
    console.error('FD Poisson: 0 picks (no season history reachable) — snapshot NOT overwritten.');
  }
}

main();
