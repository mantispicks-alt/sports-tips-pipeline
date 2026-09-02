// ---------------------------------------------------------------------------
// backfill-settled-odds — ONE-TIME historical correction.
//
// Settled picks (won/lost/void) are never regenerated, so any that were published
// with an inflated tipster-source price (a 1.97 favorite quoted at 6.00) still carry
// that fake number in their .md — which inflates the /results win-rate + ROI (ROI is
// computed at render from each pick's `odds:` field). This re-fetches the REAL
// featured-book price from Highlightly's odds HISTORY for every settled pick the site
// shows, maps it to the pick's own selection (orientation-proof, by team NAME), and
// rewrites `odds:` + `bookmaker:` so the public track record is the honest, bettable
// price a follower could actually have taken.
//
// Scope: every settled pick with a single-outcome market (1X2 / O-U 2.5 / BTTS).
// Double Chance is compound (no single price) -> skipped, price left as-is.
// Obscure leagues Highlightly doesn't cover -> no match, price left as-is (honest:
// we can't verify it, so we don't touch it).
//
// DRY by default (prints what it WOULD change). Pass --write to rewrite the .md files.
// Cap odds calls with BACKFILL_MAX_CALLS (default 40 for a safe dry sample).
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TIPS_MD = path.join(ROOT, 'src', 'content', 'tips');
const WRITE = process.argv.includes('--write');
const MAX_CALLS = Number(process.env.BACKFILL_MAX_CALLS) || 40;

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }),
);
const HL = env.HIGHLIGHTLY_API_KEY;
if (!HL) { console.log('no HIGHLIGHTLY_API_KEY — abort'); process.exit(1); }
const HDRS = { 'x-rapidapi-key': HL };

const FEATURED = new Map([
  ['bet365', 'bet365'], ['betsson', 'Betsson'], ['betway', 'Betway'], ['888sport', '888sport'],
  ['novibet', 'Novibet'], ['22bet', '22Bet'], ['20bet', '20Bet'], ['1xbet', '1xBet'],
  ['megapari', 'Megapari'], ['melbet', 'Melbet'], ['betwinner', 'Betwinner'], ['fonbet', 'Fonbet'],
  ['bcgame', 'BC.Game'], ['bc.game', 'BC.Game'], ['stake', 'Stake'], ['stake.com', 'Stake'],
  ['cloudbet', 'Cloudbet'], ['rabona', 'Rabona'], ['meridianbet', 'Meridianbet'],
  ['stoiximan', 'Stoiximan'], ['1win', '1win'], ['pinnacle', 'Pinnacle'],
]);
const BOOK_SLUGS = { '1xBet': '1xbet', Betsson: 'betsson' }; // only where an affiliate page exists
const normB = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const NAME_STOP = new Set(['club', 'team', 'city', 'united', 'real', 'deportivo', 'sporting', 'athletic']);
const toks = (s) => new Set(String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((x) => x.length >= 4 && !NAME_STOP.has(x)));
const teamMatch = (A, B) => { if (!A.size || !B.size) return false; const [s, l] = A.size <= B.size ? [A, B] : [B, A]; let n = 0; for (const t of s) if (l.has(t)) n++; return n >= s.size; };

// map a pick's `pick:` label + `market:` to a wanted HL outcome
function wantOf(pick, market, home, away) {
  const s = String(pick).toLowerCase();
  if (/(or draw|double chance|\b1x\b|\bx2\b|\b12\b)/.test(s)) return null; // compound
  if (/\bunder\b/.test(s)) return { mkt: 'ou', want: 'Under' };
  if (/\bover\b/.test(s)) return { mkt: 'ou', want: 'Over' };
  if (/both teams|btts/.test(s)) return { mkt: 'btts', want: /\bno\b/.test(s) ? 'No' : 'Yes' };
  if (/\bdraw\b/.test(s)) return { mkt: '1x2', want: 'Draw' };
  if (/\bwin\b/.test(s)) {
    const team = s.replace(/\s+win\b.*$/, '').trim();
    const th = toks(home), ta = toks(away), tt = toks(team);
    if (teamMatch(tt, th)) return { mkt: '1x2', want: 'home' };
    if (teamMatch(tt, ta)) return { mkt: '1x2', want: 'away' };
    return null; // can't tell which side
  }
  return null;
}

const dayCache = new Map();
async function matchesOn(date) {
  if (dayCache.has(date)) return dayCache.get(date);
  const out = [];
  for (let off = 0; off < 1500; off += 100) {
    try {
      const r = await fetch(`https://soccer.highlightly.net/matches?date=${date}&limit=100&offset=${off}`, { headers: HDRS, signal: AbortSignal.timeout(20000) });
      const j = await r.json(); const arr = j?.data || [];
      for (const m of arr) out.push({ id: m.id, ht: toks(m.homeTeam?.name), at: toks(m.awayTeam?.name), hn: m.homeTeam?.name, an: m.awayTeam?.name });
      if (arr.length < 100) break;
    } catch { break; }
  }
  dayCache.set(date, out); return out;
}
async function oddsFor(id) {
  try { const r = await fetch(`https://soccer.highlightly.net/odds?matchId=${id}`, { headers: HDRS, signal: AbortSignal.timeout(20000) }); const j = await r.json(); return j?.data?.[0]?.odds || []; } catch { return null; }
}
const bestPrice = (odds, mktRe, valRe) => {
  let best = null;
  for (const bk of odds) {
    if (!mktRe.test(String(bk.market))) continue;
    const bn = FEATURED.get(normB(bk.bookmakerName)); if (!bn) continue;
    for (const v of (bk.values || [])) if (valRe.test(String(v.value)) && (!best || v.odd > best.odds)) best = { odds: v.odd, book: bn };
  }
  return best;
};

// --- gather settled picks -----------------------------------------------------
const files = fs.readdirSync(TIPS_MD).filter((f) => f.endsWith('.md'));
const picks = [];
for (const f of files) {
  const txt = fs.readFileSync(path.join(TIPS_MD, f), 'utf8').replace(/\r\n/g, '\n');
  const fm = txt.match(/^---\n([\s\S]*?)\n---/); if (!fm) continue;
  const g = (k) => (fm[1].match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1] || '').trim().replace(/^"|"$/g, '');
  const result = g('result');
  if (!['won', 'lost', 'void'].includes(result)) continue;
  const [home, away] = String(g('match')).split(/\s+vs\s+/i);
  if (!home || !away) continue;
  const w = wantOf(g('pick'), g('market'), home, away);
  if (!w) continue; // DC / unmappable -> leave alone
  picks.push({ f, home, away, date: g('kickoff').slice(0, 10), pick: g('pick'), odds: parseFloat(g('odds')) || 0, hasBook: !!g('bookmaker'), w });
}
// unique fixtures first (one odds call serves every pick on that fixture)
const byFixture = new Map();
for (const p of picks) { const k = `${p.date}|${p.home}|${p.away}`; (byFixture.get(k) ?? byFixture.set(k, []).get(k)).push(p); }
console.log(`settled single-outcome picks: ${picks.length} across ${byFixture.size} fixtures. Mode: ${WRITE ? 'WRITE' : 'DRY'} (max ${MAX_CALLS} odds calls)`);

let calls = 0, resolved = 0, changed = 0, nomatch = 0;
const edits = new Map(); // file -> {odds, book, slug}
const sample = [];
for (const [, list] of byFixture) {
  if (calls >= MAX_CALLS) break;
  const p0 = list[0];
  const gs = await matchesOn(p0.date);
  const ht = toks(p0.home), at = toks(p0.away);
  const g = gs.find((x) => (teamMatch(ht, x.ht) && teamMatch(at, x.at)) || (teamMatch(ht, x.at) && teamMatch(at, x.ht)));
  if (!g) { nomatch++; continue; }
  calls++;
  const odds = await oddsFor(g.id);
  if (!odds || !odds.length) continue;
  const pickHomeIsHlHome = teamMatch(ht, g.ht);
  for (const p of list) {
    let real = null;
    if (p.w.mkt === '1x2') {
      const side = p.w.want === 'home' ? (pickHomeIsHlHome ? 'Home' : 'Away')
        : p.w.want === 'away' ? (pickHomeIsHlHome ? 'Away' : 'Home') : 'Draw';
      real = bestPrice(odds, /full time result/i, new RegExp(`^${side}$`, 'i'));
    } else if (p.w.mkt === 'ou') {
      real = bestPrice(odds, /^total goals 2\.5$/i, new RegExp(`^${p.w.want}$`, 'i'));
    } else if (p.w.mkt === 'btts') {
      real = bestPrice(odds, /both teams to score/i, new RegExp(`^${p.w.want}$`, 'i'));
    }
    if (!real || typeof real.odds !== 'number' || real.odds < 1.01) continue;
    resolved++;
    const ro = Math.round(real.odds * 100) / 100;
    if (Math.abs(ro - p.odds) >= 0.01 || !p.hasBook) {
      edits.set(p.f, { odds: ro, book: real.book, slug: BOOK_SLUGS[real.book] });
      if (Math.abs(ro - p.odds) >= 0.01) changed++;
      if (sample.length < 25) sample.push(`${p.odds} -> ${ro} @${real.book} | ${p.pick} | ${p.home} v ${p.away}`);
    }
  }
}

console.log(`\nodds calls: ${calls}  |  fixtures no-HL-match: ${nomatch}  |  outcomes resolved: ${resolved}  |  odds changed: ${changed}  |  files to edit: ${edits.size}`);
console.log('--- sample corrections ---');
sample.forEach((x) => console.log('  ' + x));

if (WRITE && edits.size) {
  let wrote = 0;
  for (const [f, e] of edits) {
    const p = path.join(TIPS_MD, f);
    let txt = fs.readFileSync(p, 'utf8');
    const nl = txt.includes('\r\n') ? '\r\n' : '\n';
    let t = txt.replace(/\r\n/g, '\n');
    // strip ANY existing bookmaker / bookmakerSlug lines first (avoid a stale slug
    // pointing at the wrong affiliate), then rewrite odds + insert fresh book lines.
    t = t.split('\n').filter((ln) => !/^(bookmaker|bookmakerSlug):/.test(ln)).join('\n');
    t = t.replace(/^(odds:\s*).*$/m, `$1${e.odds}`);
    t = t.replace(/^(odds:.*)$/m, (m2) => `${m2}\nbookmaker: "${e.book}"${e.slug ? `\nbookmakerSlug: "${e.slug}"` : ''}`);
    fs.writeFileSync(p, t.replace(/\n/g, nl));
    wrote++;
  }
  console.log(`\nWROTE ${wrote} files.`);
} else if (!WRITE) {
  console.log('\nDRY run — no files changed. Re-run with --write (and a higher BACKFILL_MAX_CALLS) to apply.');
}
