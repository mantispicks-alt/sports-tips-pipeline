// -------------------------------------------------------------------------
// fixtures.mjs — shared helper: fetch real fixtures from API-Sports and
// match extracted (home, away) team names to a real match + real kickoff.
//
// Why: every refresh-*.mjs script was stamping picks with a fake "today
// 00:00" kickoff regardless of what the source actually said. That means we
// couldn't tell a real upcoming pick from a stale/garbled one, and couldn't
// tell how close to kickoff a tip was posted. This fixes both: only tips
// that match a REAL fixture (name-matched, football only for now) survive,
// carrying the fixture's real kickoff time.
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const KEY = env.API_SPORTS_KEY;

const STOPWORDS = /\b(fc|cf|sc|afc|cd|ac|club|the|de|do|dos|da|di|del|la|el|los|las)\b/g;
// Extended-Latin letters NFD can't decompose — fold before the a-z strip so
// "Nordsjælland" matches a fixture's "Nordsjaelland" and "Bodø/Glimt" matches
// "Bodo/Glimt". Without this, matchFixture misses these and the tip loses its
// real kickoff.
function foldLatin(s) {
  return s.replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ø/g, 'o')
    .replace(/ß/g, 'ss').replace(/ð/g, 'd').replace(/þ/g, 'th').replace(/ł/g, 'l');
}
function normalizeName(s) {
  return foldLatin(String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')) // accents + ligatures
    .replace(STOPWORDS, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}
// First significant word only (pre-stopword-strip, just accents+lowercase) —
// used for the alias boost below. "Estudiantes de La Plata" -> "estudiantes".
function firstWord(s) {
  const w = String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+/)?.[0] || '';
  return w;
}

// Cheap similarity: exact / containment / character-overlap ratio, with an
// alias boost when the primary team-name word matches exactly (handles
// "Estudiantes de La Plata" vs "Estudiantes LP" — sources abbreviate the
// city/qualifier suffix wildly, but rarely rename the club's main word).
function bigrams(s) {
  const out = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}
// Sørensen–Dice coefficient on character bigrams — robust to real spelling
// variants across sources ("Brondby" vs "Broendby IF", "J. Utrecht" vs "Jong FC
// Utrecht", "Bodo Glimt" vs "Bodo/Glimt") that the old greedy char-overlap just
// missed at the 0.55 threshold. Order-independent, length-normalized.
function dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a), bag = bigrams(b);
  let m = 0;
  for (const g of A) { const i = bag.indexOf(g); if (i !== -1) { m++; bag.splice(i, 1); } }
  return (2 * m) / (A.length + bigrams(b).length);
}
function similarity(a, b) {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  // Containment (one name is a prefix/substring of the other, e.g. "Silkeborg" ⊂
  // "Silkeborg IF") — but only for names long enough that it isn't a coincidence.
  const shorter = na.length < nb.length ? na : nb;
  if (shorter.length >= 4 && (na.includes(nb) || nb.includes(na))) return 0.9;
  // Primary club-name word matches exactly (handles wild suffix abbreviation).
  const fa = firstWord(a), fb = firstWord(b);
  const aliasBoost = fa.length >= 5 && fa === fb ? 0.8 : 0;
  return Math.max(dice(na, nb), aliasBoost);
}

let _cache = null; // { key, fixtures: [{id, home, away, kickoff}] }

// Fetches fixtures for -daysBack..+daysForward-1 around today (football only
// — api-sports basketball uses a different endpoint shape and our coverage
// there is off-season anyway). Includes PAST days so callers can tell "this
// really is an old/settled match" apart from "just not in our free-tier
// coverage" — those need different handling. Cached for the life of the process.
export async function loadFootballFixtures(daysForward = 4, daysBack = 3) {
  const key = `${daysForward}:${daysBack}`;
  if (_cache && _cache.key === key) return _cache.fixtures;
  const fixtures = [];
  const today = new Date();
  const minMs = today.getTime() - daysBack * 86400000;
  const maxMs = today.getTime() + daysForward * 86400000;
  // The free BROAD sources (odds-api.io ~5000 fixtures / 8 days, our market
  // snapshots ~250 leagues, ESPN) cover ~2 weeks out. Use a wide window for them
  // so a value pick further ahead than api-football's tiny free window still
  // inherits a real kickoff and can publish.
  const wideMaxMs = today.getTime() + 14 * 86400000;

  // --- Rate-limit safety + self-healing. Load the persisted pool (committed
  // across runs) up front. The rate-limited NETWORK sources (api-football,
  // odds-api.io) are refreshed at most once every ~3h. odds-api.io's confirmed
  // limit is 100/hour, but a monthly plan cap is unverified — this caps us at
  // ~8 fetches/day (~240/mo), safely under any plausible cap. Between refreshes
  // the cached fixtures (up to 2 weeks ahead) + the always-free market snapshots
  // cover everything, so skipping a network fetch loses nothing.
  const CACHE_FILE = path.join(ROOT, 'src', 'data', 'fixtures-cache.json');
  let cached = { fetchedAt: 0, fixtures: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    cached = Array.isArray(raw)
      ? { fetchedAt: 0, fixtures: raw }
      : { fetchedAt: Date.parse(raw.fetchedAt) || 0, fixtures: raw.fixtures || [] };
  } catch { /* first run / no cache */ }
  const netStale = today.getTime() - cached.fetchedAt > 3 * 3600 * 1000;

  // Source 1: api-football, one call per day. NOTE free accounts get SUSPENDED
  // ("Your account is suspended") — then this yields nothing and, without a
  // fallback, ALL fixture-matching dies → no pick is dateVerified → nothing is
  // publishable → /tips shows only the old settled record. Hence source 2.
  if (netStale && KEY) {
    for (let i = -daysBack; i < daysForward; i++) {
      const d = new Date(today.getTime() + i * 86400000).toISOString().slice(0, 10);
      try {
        const res = await fetch(`https://v3.football.api-sports.io/fixtures?date=${d}`, {
          headers: { 'x-apisports-key': KEY }, signal: AbortSignal.timeout(15000),
        });
        const json = await res.json();
        for (const r of json.response || []) {
          if (!r?.fixture?.id || !r?.teams?.home?.name || !r?.teams?.away?.name) continue;
          fixtures.push({ id: r.fixture.id, home: r.teams.home.name, away: r.teams.away.name, kickoff: r.fixture.date });
        }
      } catch { /* one bad day shouldn't kill the whole match window */ }
    }
  }

  // Source 2: odds-api.io events — ONE call returns ~5000 fixtures across ALL
  // leagues (incl. tiny ones), and its free key works when api-football is
  // suspended. fixtureId is left null (RawTip.fixtureId is numeric + settlement
  // joins by matchKey, not by an odds-api.io id) — we only need the real kickoff
  // so the pick becomes dateVerified.
  const IOKEY = env.ODDS_API_IO_KEY;
  if (netStale && IOKEY) {
    try {
      const res = await fetch(`https://api.odds-api.io/v3/events?sport=football&apiKey=${IOKEY}`, { signal: AbortSignal.timeout(20000) });
      const arr = await res.json();
      if (Array.isArray(arr)) {
        for (const e of arr) {
          const t = Date.parse(e?.date);
          if (!e?.home || !e?.away || !Number.isFinite(t) || t < minMs || t > wideMaxMs) continue;
          fixtures.push({ id: null, home: e.home, away: e.away, kickoff: new Date(t).toISOString() });
        }
      }
    } catch { /* odds-api.io unreachable -> keep whatever api-football gave */ }
  }

  // Source 3: our OWN market snapshots (pinnacle ~250 leagues incl. tiny ones,
  // bzzoiro, fdcouk, odds:value). Already fetched THIS pipeline run — ZERO extra
  // API calls, NO rate limit. Every entry is a dateVerified market pick carrying
  // a REAL kickoff, covering far more leagues than the free api-football tier.
  // This is what lets a tipster's value pick in an obscure league (South Africa,
  // Uzbekistan, Colombia…) inherit a real fixture time and become publishable.
  // Wider window (market lines are posted ~2 weeks out) and deduped by fixture.
  const marketMaxMs = wideMaxMs;
  const seenFx = new Set();
  for (const fname of ['pinnacle.json', 'bzzoiro.json', 'fdcouk.json', 'odds-value.json', 'fdcouk-model.json']) {
    try {
      const arr = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'tips', fname), 'utf8'));
      for (const t of Array.isArray(arr) ? arr : []) {
        const ms = Date.parse(t?.kickoff);
        if (!t?.homeTeam || !t?.awayTeam || !Number.isFinite(ms) || ms < minMs || ms > marketMaxMs) continue;
        const k = `${t.homeTeam}|${t.awayTeam}|${new Date(ms).toISOString().slice(0, 13)}`;
        if (seenFx.has(k)) continue;
        seenFx.add(k);
        fixtures.push({ id: null, home: t.homeTeam, away: t.awayTeam, kickoff: new Date(ms).toISOString() });
      }
    } catch { /* snapshot missing -> skip this source */ }
  }

  // Source 4: Highlightly fixtures (PAID PRO — 7,500/day, 950+ leagues incl. the
  // tiny ones NO free source covers). This is what unblocks the ~4,300 held picks
  // now that api-football is suspended: it hands small-league picks a real kickoff
  // so they become dateVerified and publishable. Gated on HIGHLIGHTLY_PAID so the
  // free 100/day tier is never hammered (same key, plan-only upgrade). One call per
  // forward day, paginated; ~30 calls/run, trivial against 7,500/day.
  const HLKEY = env.HIGHLIGHTLY_API_KEY;
  if (netStale && HLKEY && env.HIGHLIGHTLY_PAID === '1') {
    const hlDays = [];
    for (let i = -daysBack; i <= 12; i++) hlDays.push(new Date(today.getTime() + i * 86400000).toISOString().slice(0, 10));
    let calls = 0; const HL_MAX = 60;
    outer: for (const d of hlDays) {
      for (let offset = 0; offset < 500; offset += 100) {
        if (calls >= HL_MAX) break outer;
        try {
          calls++;
          const res = await fetch(`https://soccer.highlightly.net/matches?date=${d}&limit=100&offset=${offset}`, {
            headers: { 'x-rapidapi-key': HLKEY }, signal: AbortSignal.timeout(20000),
          });
          const j = await res.json();
          const arr = j?.data || (Array.isArray(j) ? j : []);
          for (const m of arr) {
            const ms = Date.parse(m?.date);
            const home = m?.homeTeam?.name, away = m?.awayTeam?.name;
            if (!home || !away || !Number.isFinite(ms) || ms < minMs || ms > wideMaxMs) continue;
            fixtures.push({ id: null, home, away, kickoff: new Date(ms).toISOString() });
          }
          const total = j?.pagination?.totalCount ?? 0;
          if (!arr.length || offset + 100 >= total) break; // last page for this day
        } catch { break; } // this day failed -> next day
      }
    }
  }

  // Backfill from the cached pool (covers any network source skipped this run by
  // the TTL, or momentarily down) and persist the merged pool + fetch time for
  // the next run. Fixtures carry over until they are actually past, so
  // date-verification keeps working with no manual intervention.
  const nowMs = today.getTime();
  const fxKey = (f) => `${normalizeName(f.home)}|${normalizeName(f.away)}|${new Date(f.kickoff).toISOString().slice(0, 13)}`;
  const have = new Set(fixtures.map(fxKey));
  for (const f of cached.fixtures) {
    const t = Date.parse(f?.kickoff);
    if (!f?.home || !f?.away || !Number.isFinite(t) || t < nowMs - 6e5 || t > wideMaxMs) continue;
    const k = fxKey(f);
    if (have.has(k)) continue;
    have.add(k);
    fixtures.push({ id: f.id ?? null, home: f.home, away: f.away, kickoff: new Date(t).toISOString() });
  }
  try {
    const future = fixtures.filter((f) => Date.parse(f.kickoff) > nowMs - 6e5);
    // Only advance fetchedAt when we actually hit the network this run.
    const fetchedAt = new Date(netStale ? Date.now() : cached.fetchedAt || Date.now()).toISOString();
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ fetchedAt, fixtures: future }));
  } catch { /* read-only fs -> skip cache write */ }

  _cache = { key, fixtures };
  return fixtures;
}

// Best-match a (home, away) pair against the fixture list. Both ends must
// clear the threshold (min of the two scores) — prevents a strong home-name
// match pairing with a wrong away team. Returns null if nothing clears it.
const THRESHOLD = 0.55;
export function matchFixture(home, away, fixtures) {
  let best = null, bestScore = 0;
  for (const f of fixtures) {
    const score = Math.min(similarity(home, f.home), similarity(away, f.away));
    if (score > bestScore) { bestScore = score; best = f; }
  }
  return bestScore >= THRESHOLD ? best : null;
}

// True when a matched fixture's kickoff has already passed — i.e. the pick
// refers to a real but STALE/settled match, not a legit "date unconfirmed" one.
export function isStale(fixture) {
  return !!fixture && +new Date(fixture.kickoff) < Date.now();
}
