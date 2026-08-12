// -------------------------------------------------------------------------
// refresh-clubelo.mjs — ClubElo model source (NO API KEY).
//
// ClubElo publishes an Elo rating + match forecast for ~every club worldwide,
// including tiny/obscure leagues where bookmaker lines are softest. It is the
// best no-key, all-league MODEL signal we can add — independent of the tipster
// aggregators (which the backtests show are ~market-efficient).
//
// Endpoint (HTTP ONLY — ClubElo serves no HTTPS, so `fetch` must use http://;
// works from a real host / CF Worker / GitHub Action, just not sandboxes that
// block outbound :80):  http://api.clubelo.com/Fixtures  -> CSV of upcoming
// fixtures. The signature columns are `R:x` = probability of the home team
// finishing with goal difference x (x>0 home wins by x, 0 = draw, x<0 away).
//
// This parser is HEADER-DRIVEN + defensive so it survives column reshuffles:
//   layer 1  explicit 1X2 probability columns  -> emit 1X2
//   layer 2  ClubElo `R:x` goal-diff columns   -> sum into 1X2   (normal path)
//   layer 3  only Elo ratings available        -> emit Double-Chance for the fav
// Any failure or unrecognised shape -> writes nothing, exits 0 (offline-safe;
// never wipes a good snapshot). Prints the detected header + mapping so a first
// run's output confirms which layer fired.
//
//   node scripts/refresh-clubelo.mjs            # normal
//   node scripts/refresh-clubelo.mjs --debug    # also dump header + first row
//
// Output: src/data/tips/clubelo.json  (source "clubelo", tipster "ClubElo"),
// picked up by jsonImport -> consensus like every other snapshot.
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src', 'data', 'tips', 'clubelo.json');
const DEBUG = process.argv.includes('--debug');

// Optional env knobs (all have safe defaults; .env not required).
const env = (() => {
  try {
    return Object.fromEntries(
      fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
    );
  } catch { return {}; }
})();
const MIN_PROB = Number(env.CLUBELO_MIN_PROB || 0.40);   // skip toss-ups (quality gate)
const DAYS_AHEAD = Number(env.CLUBELO_DAYS_AHEAD || 4);   // keep near-term fixtures only
const URL = env.CLUBELO_URL || 'http://api.clubelo.com/Fixtures';

// --- tiny CSV parser (ClubElo fields are unquoted + comma-free team names,
//     but tolerate simple double-quoted fields just in case) ---------------
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

const findCol = (header, ...res) => {
  for (const re of res) { const i = header.findIndex((h) => re.test(h.trim())); if (i >= 0) return i; }
  return -1;
};
const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null; };

async function main() {
  let text;
  try {
    const res = await fetch(URL, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (e) {
    console.error(`ClubElo unreachable (${String(e?.message || e)}). Nothing written (offline-safe).`);
    console.error('If this is a sandbox, run it from your machine — ClubElo is HTTP-only and blocked here.');
    process.exit(0);
  }

  const rows = parseCsv(text);
  if (rows.length < 2) { console.error('ClubElo returned no rows. Nothing written.'); process.exit(0); }
  const header = rows[0];
  if (DEBUG) { console.log('HEADER:', header.join(',')); console.log('ROW1  :', rows[1].join(',')); }

  const iDate = findCol(header, /^date$/i, /date/i);
  const iCountry = findCol(header, /^country$/i, /country|league/i);
  const iHome = findCol(header, /^home$/i, /home team|^home$|hometeam/i);
  const iAway = findCol(header, /^away$/i, /away team|^away$|awayteam/i);

  // layer 1: explicit 1X2 probability columns
  const iPH = findCol(header, /prob.*home|home.*prob|^ph$|^p_?home$|^1$/i);
  const iPD = findCol(header, /prob.*draw|draw.*prob|^pd$|^p_?draw$|^x$/i);
  const iPA = findCol(header, /prob.*away|away.*prob|^pa$|^p_?away$|^2$/i);

  // layer 2: ClubElo GD=n goal-difference probability columns (its real schema).
  //   GD=0 -> draw ; GD=n>0 / GD>5 -> home wins by n ; GD=-n / GD<-5 -> away.
  //   (the R:h-a columns are exact scorelines — deliberately ignored.)
  const gdCols = header.map((h, i) => {
    const m = h.trim().match(/^GD\s*([<>=])\s*(-?\d+)$/i);
    if (!m) return { i, cls: null };
    const op = m[1], val = parseInt(m[2], 10);
    const cls = op === '<' ? 'A' : op === '>' ? 'H' : val > 0 ? 'H' : val < 0 ? 'A' : 'D';
    return { i, cls };
  }).filter((c) => c.cls);

  // layer 3: Elo columns (fallback -> Double-Chance for favorite)
  const iEloH = findCol(header, /elo.*home|home.*elo|^elohome$/i);
  const iEloA = findCol(header, /elo.*away|away.*elo|^eloaway$/i);

  const layer = (iPH >= 0 && iPA >= 0) ? 1 : gdCols.length ? 2 : (iEloH >= 0 && iEloA >= 0) ? 3 : 0;
  console.log(`ClubElo: ${rows.length - 1} fixtures. team cols home=${iHome} away=${iAway}. probability layer=${layer} ${layer === 0 ? '(UNRECOGNISED — nothing written)' : ''}`);
  if (iHome < 0 || iAway < 0 || layer === 0) {
    console.error('Could not locate team or probability columns. Header was:');
    console.error('  ' + header.join(','));
    console.error('Paste that line back and I will fix the mapping. Nothing written (offline-safe).');
    process.exit(0);
  }

  const now = Date.now();
  const horizon = now + DAYS_AHEAD * 864e5;
  const tips = [];
  const leagues = new Set();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const home = (row[iHome] || '').trim();
    const away = (row[iAway] || '').trim();
    if (!home || !away) continue;

    const dateStr = iDate >= 0 ? (row[iDate] || '').trim() : '';
    const kickoff = /^\d{4}-\d{2}-\d{2}/.test(dateStr) ? `${dateStr.slice(0, 10)}T00:00:00Z` : '';
    if (kickoff) { const t = Date.parse(kickoff); if (Number.isFinite(t) && (t < now - 864e5 || t > horizon)) continue; }
    const league = iCountry >= 0 ? (row[iCountry] || 'ClubElo').trim() : 'ClubElo';

    let market = '1X2', selection = '', prob = 0;

    if (layer === 1) {
      const ph = num(row[iPH]) ?? 0, pd = iPD >= 0 ? (num(row[iPD]) ?? 0) : 0, pa = num(row[iPA]) ?? 0;
      const s = ph + pd + pa || 1; const H = ph / s, D = pd / s, A = pa / s;
      prob = Math.max(H, D, A); selection = prob === H ? 'home' : prob === A ? 'away' : 'draw';
    } else if (layer === 2) {
      let H = 0, D = 0, A = 0;
      for (const c of gdCols) { const p = num(row[c.i]) ?? 0; if (c.cls === 'H') H += p; else if (c.cls === 'A') A += p; else D += p; }
      const s = H + D + A || 1; H /= s; D /= s; A /= s;
      prob = Math.max(H, D, A); selection = prob === H ? 'home' : prob === A ? 'away' : 'draw';
    } else {
      // layer 3: Elo -> logistic win-expectancy (home adv +65), emit Double-Chance for fav
      const eh = num(row[iEloH]), ea = num(row[iEloA]);
      if (eh === null || ea === null) continue;
      const exp = 1 / (1 + Math.pow(10, -((eh + 65 - ea) / 400))); // home win-or-half-draw expectancy
      market = 'DC';
      if (exp >= 0.5) { selection = '1x'; prob = exp; } else { selection = 'x2'; prob = 1 - exp; }
    }

    if (!selection || prob < MIN_PROB) continue;
    tips.push({
      source: 'clubelo', tipster: 'ClubElo',
      homeTeam: home, awayTeam: away, league,
      kickoff: kickoff || new Date(now).toISOString(),
      dateVerified: false,
      market, selection,
      odds: null, sport: 'football',
      confidence: Math.round(prob * 100) / 100,
    });
    leagues.add(league);
  }

  if (!tips.length) {
    console.error(`ClubElo: 0 picks passed the ${MIN_PROB} probability floor / date window. Snapshot NOT overwritten.`);
    process.exit(0);
  }

  fs.writeFileSync(OUT, JSON.stringify(tips, null, 2));
  console.log(`ClubElo: wrote ${tips.length} picks -> ${path.relative(ROOT, OUT)}`);
  console.log(`  leagues (${leagues.size}): ${[...leagues].slice(0, 12).join(' | ')}${leagues.size > 12 ? ' …' : ''}`);
  console.log(`  sample: ${tips.slice(0, 3).map((t) => `${t.homeTeam} v ${t.awayTeam} [${t.market}:${t.selection} ${t.confidence}]`).join('  //  ')}`);
}

main();
