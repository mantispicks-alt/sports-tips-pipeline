// -------------------------------------------------------------------------
// Adds OVERALL (2.60-3.49) and ROI (3.50-6.0) band picks for Sep 13-19.
//
// The bot replay so far only surfaced favorites (WIN band). The live bot
// ALSO emits a `valueAlt` — a contrarian second candidate priced 2.60-7.50
// per src/lib/aggregation/consensus.ts. This script replays that leg:
//   * for each fixture, look at the underdog / draw side
//   * treat every bookmaker that gives it odds in the value band as a backer
//   * emit if 5+ books all price it in the same band (proxy for tipster
//     agreement), sorted by consensus strength
//   * top 5 OVERALL and top 5 ROI per day (matches live cadence)
//
// Every emitted file carries `retroSimulated: true`. Existing files are
// never overwritten.
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

const envFile = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
for (const line of envFile.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const KEY = process.env.API_SPORTS_KEY;
if (!KEY) { console.error('No API_SPORTS_KEY'); process.exit(1); }

const HOST = 'v3.football.api-sports.io';
const OUT_DIR = 'src/content/tips';
const [startArg, endArg] = process.argv.slice(2);
if (!startArg || !endArg) { console.error('usage: node scripts/backfill-value-bands.mjs <start> <end>'); process.exit(1); }

const FINISHED = new Set(['FT', 'AET', 'PEN']);
const RATE_DELAY = 250;
const CAP_PER_BAND_PER_DAY = 5;

function slugTeam(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function daysBetween(a, b) {
  const out = [];
  const s = new Date(a), e = new Date(b);
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

async function fetchFixtures(date) {
  const res = await fetch(`https://${HOST}/fixtures?date=${date}`, { headers: { 'x-apisports-key': KEY } });
  if (!res.ok) return [];
  const j = await res.json();
  return (j.response || []).filter((r) => FINISHED.has(r.fixture?.status?.short));
}

async function fetchOdds(fixtureId) {
  try {
    const res = await fetch(`https://${HOST}/odds?fixture=${fixtureId}`, { headers: { 'x-apisports-key': KEY } });
    if (!res.ok) return [];
    const j = await res.json();
    return j.response?.[0]?.bookmakers ?? [];
  } catch { return []; }
}

function bandFor(odds) {
  if (odds >= 2.60 && odds < 3.50) return 'overall';
  if (odds >= 3.50 && odds < 6.0) return 'roi';
  return null;
}

function settle(sel, hg, ag) {
  if (sel === 'home') return hg > ag ? 'won' : 'lost';
  if (sel === 'away') return ag > hg ? 'won' : 'lost';
  if (sel === 'draw') return hg === ag ? 'won' : 'lost';
  return 'void';
}

function md(pick, fixture, date) {
  const home = fixture.teams.home.name;
  const away = fixture.teams.away.name;
  const league = fixture.league?.name ?? 'Unknown';
  const kickoff = fixture.fixture?.date ?? `${date}T15:00:00Z`;
  const hg = fixture.goals?.home ?? 0;
  const ag = fixture.goals?.away ?? 0;
  const result = settle(pick.sel, hg, ag);
  const label = pick.sel === 'draw' ? 'Draw' : `${pick.sel === 'home' ? home : away} Win`;
  const tier = pick.band === 'roi' ? 'vip' : 'premium';
  return `---
match: "${home.replace(/"/g, '\\"')} vs ${away.replace(/"/g, '\\"')}"
league: "${league.replace(/"/g, '\\"')}"
sport: football
kickoff: ${kickoff}
market: "Match Result"
pick: "${label.replace(/"/g, '\\"')}"
odds: ${pick.avgOdds.toFixed(2)}
bookmaker: "Retro-consensus"
confidence: ${pick.confidence}
result: ${result}
tier: ${tier}
featured: false
feeds: ["${pick.band}"]
retroSimulated: true
sharp: true
---

> **Retro-replayed value pick.** Reproduced from api-football Pro historical odds (${pick.backerCount} bookmakers agreed on ${label} in the ${pick.band === 'roi' ? 'high-value' : 'value'} band) during the pipeline downtime 2026-09-13 → 2026-09-19. This is a data signal, not a guarantee. 18+ · gamble responsibly.
`;
}

async function main() {
  const dates = daysBetween(startArg, endArg);
  const bandTotals = { overall: { w: 0, l: 0, v: 0 }, roi: { w: 0, l: 0, v: 0 } };
  let totalWritten = 0;

  for (const date of dates) {
    const fixtures = await fetchFixtures(date);
    console.log(`\n=== ${date} — ${fixtures.length} finished fixtures ===`);
    if (!fixtures.length) continue;

    const candidates = { overall: [], roi: [] };
    for (const f of fixtures) {
      const home = f.teams.home.name, away = f.teams.away.name;
      const slug = `auto-football-${date}-${slugTeam(home)}-${slugTeam(away)}-1x2`;
      // If a WIN-band file already exists for this fixture, still allow a
      // value pick — different band = valid second candidate on the same match.
      const books = await fetchOdds(f.fixture.id);
      await new Promise((r) => setTimeout(r, RATE_DELAY));
      if (!books.length) continue;

      // Look for a value-band consensus. For each side (home/draw/away),
      // count how many books price it in the value band (2.60-3.49 or
      // 3.50-6.0). If 5+ books cluster in the same band, treat as consensus.
      const sideStats = { home: { overall: [], roi: [] }, draw: { overall: [], roi: [] }, away: { overall: [], roi: [] } };
      for (const b of books) {
        const mw = b.bets?.find((x) => x.name === 'Match Winner');
        if (!mw) continue;
        for (const v of mw.values ?? []) {
          const k = v.value?.toLowerCase();
          const o = parseFloat(v.odd);
          if (!Number.isFinite(o)) continue;
          const band = bandFor(o);
          if (!band) continue;
          if (sideStats[k]) sideStats[k][band].push(o);
        }
      }

      // Pick the best value candidate — highest backer count with lowest variance
      let best = null;
      for (const side of ['home', 'draw', 'away']) {
        for (const band of ['overall', 'roi']) {
          const odds = sideStats[side][band];
          if (odds.length < 5) continue;
          const avg = odds.reduce((s, o) => s + o, 0) / odds.length;
          if (!best || odds.length > best.count) {
            best = { sel: side, band, count: odds.length, avgOdds: avg };
          }
        }
      }
      if (!best) continue;

      // Confidence = agreement (%) mixed with book count
      const totalBooks = books.length;
      const agreement = (best.count / totalBooks) * 100;
      const confidence = Math.round(Math.min(100, 40 + best.count * 6 + agreement * 0.3));

      candidates[best.band].push({
        f,
        pick: { sel: best.sel, avgOdds: best.avgOdds, band: best.band, backerCount: best.count, confidence },
      });
    }

    // Sort by confidence desc, cap
    for (const band of ['overall', 'roi']) {
      candidates[band].sort((a, b) => b.pick.confidence - a.pick.confidence);
      const top = candidates[band].slice(0, CAP_PER_BAND_PER_DAY);
      for (const { f, pick } of top) {
        const home = slugTeam(f.teams.home.name), away = slugTeam(f.teams.away.name);
        // Use different suffix so we don't collide with WIN-band 1x2 file for same match
        const filename = `auto-football-${date}-${home}-${away}-${band === 'roi' ? 'roi' : 'val'}.md`;
        const p = path.join(OUT_DIR, filename);
        if (fs.existsSync(p)) continue;
        fs.writeFileSync(p, md(pick, f, date));
        totalWritten++;
        const hg = f.goals?.home ?? 0, ag = f.goals?.away ?? 0;
        const outcome = settle(pick.sel, hg, ag);
        bandTotals[band][outcome === 'won' ? 'w' : outcome === 'lost' ? 'l' : 'v']++;
      }
    }
    console.log(`  ${date} → OVERALL=${Math.min(candidates.overall.length, CAP_PER_BAND_PER_DAY)}, ROI=${Math.min(candidates.roi.length, CAP_PER_BAND_PER_DAY)}`);
  }

  console.log('\n=========================================');
  console.log(`TOTAL: ${totalWritten}`);
  for (const b of ['overall', 'roi']) {
    const t = bandTotals[b];
    const set = t.w + t.l;
    const wr = set ? ((t.w / set) * 100).toFixed(1) : '-';
    console.log(`  ${b.padEnd(8)} W=${t.w} L=${t.l} V=${t.v} WR=${wr}%`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
