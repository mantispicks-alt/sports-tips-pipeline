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
function similarity(a, b) {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const fa = firstWord(a), fb = firstWord(b);
  const aliasBoost = fa.length >= 5 && fa === fb ? 0.75 : 0;
  const shorter = na.length < nb.length ? na : nb;
  const longer = na.length < nb.length ? nb : na;
  let charScore = 0;
  if (shorter.length) {
    let matches = 0;
    const longerChars = longer.split('');
    for (const ch of shorter) {
      const idx = longerChars.indexOf(ch);
      if (idx !== -1) { matches++; longerChars.splice(idx, 1); }
    }
    charScore = (matches / longer.length) * 0.6; // capped — weak fallback signal only
  }
  return Math.max(charScore, aliasBoost);
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

  // Source 1: api-football, one call per day. NOTE free accounts get SUSPENDED
  // ("Your account is suspended") — then this yields nothing and, without a
  // fallback, ALL fixture-matching dies → no pick is dateVerified → nothing is
  // publishable → /tips shows only the old settled record. Hence source 2.
  if (KEY) {
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
  if (IOKEY) {
    try {
      const res = await fetch(`https://api.odds-api.io/v3/events?sport=football&apiKey=${IOKEY}`, { signal: AbortSignal.timeout(20000) });
      const arr = await res.json();
      if (Array.isArray(arr)) {
        for (const e of arr) {
          const t = Date.parse(e?.date);
          if (!e?.home || !e?.away || !Number.isFinite(t) || t < minMs || t > maxMs) continue;
          fixtures.push({ id: null, home: e.home, away: e.away, kickoff: new Date(t).toISOString() });
        }
      }
    } catch { /* odds-api.io unreachable -> keep whatever api-football gave */ }
  }

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
