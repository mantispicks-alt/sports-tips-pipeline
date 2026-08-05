// -------------------------------------------------------------------------
// json-to-d1sql.mjs — turn a scratch/<file>.json into scratch/<file>.sql
// (escaped INSERTs for D1). No network, no key.
//   node scripts/json-to-d1sql.mjs                 (default ingest.json)
//   node scripts/json-to-d1sql.mjs ingest-oddsapi.json
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INPUT = process.argv[2] || 'ingest.json';
const OUTPUT = INPUT.replace(/\.json$/, '.sql');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'scratch', INPUT), 'utf8'));
const q = (s) => `'${String(s ?? '').replace(/'/g, "''")}'`;

const out = [];

// sources — one row per distinct tip source
for (const s of [...new Set((data.tips || []).map((t) => t.source))]) {
  out.push(`INSERT INTO sources (id, provider, kind, sport, permissions, active) VALUES (${q(s)},${q(s)},'model','football','official-api',1) ON CONFLICT(id) DO NOTHING;`);
}

if (data.fixtures?.length) {
  const rows = data.fixtures
    .map((f) => `(${q(f.id)},${q(f.provider)},${q(f.sport)},${q(f.league)},${q(f.home)},${q(f.away)},${q(f.homeSlug)},${q(f.awaySlug)},${q(f.kickoff)},${q(f.status)})`)
    .join(',\n');
  out.push(`INSERT OR IGNORE INTO fixtures (id,provider,sport,league,home_team,away_team,home_slug,away_slug,kickoff,status) VALUES\n${rows};`);
}

if (data.tips?.length) {
  const rows = data.tips
    .map((t) => {
      const dedupe = `${t.source}|${t.fixtureId}|${t.market}|${t.selection}`;
      const line = typeof t.line === 'number' ? t.line : 'NULL';
      const odds = typeof t.odds === 'number' ? t.odds : 'NULL';
      return `(${q(t.source)},${q(t.fixtureId)},${q(t.sport)},${q(t.home)},${q(t.away)},${q(t.league)},${q(t.kickoff)},${q(t.market)},${q(t.selection)},${line},${odds},${q(dedupe)})`;
    })
    .join(',\n');
  out.push(`INSERT OR IGNORE INTO raw_tips (source_id,fixture_id,sport,home_team,away_team,league,kickoff,market,selection,line,odds,dedupe_key) VALUES\n${rows};`);
}

const finished = (data.fixtures || []).filter((f) => f.homeScore != null && f.awayScore != null);
if (finished.length) {
  const rows = finished
    .map((f) => `(${q(f.id)},${q(f.sport)},${f.homeScore},${f.awayScore},'settled')`)
    .join(',\n');
  out.push(`INSERT OR IGNORE INTO settlements (fixture_id,sport,home_score,away_score,status) VALUES\n${rows};`);
}

fs.writeFileSync(path.join(ROOT, 'scratch', OUTPUT), out.join('\n\n') + '\n');
console.log(`Wrote scratch/${OUTPUT}: ${data.fixtures?.length || 0} fixtures, ${finished.length} settlements, ${data.tips?.length || 0} tips.`);
