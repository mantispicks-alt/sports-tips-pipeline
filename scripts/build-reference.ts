// -------------------------------------------------------------------------
// Builds the canonical teams/leagues reference the pipeline validates picks
// against: src/data/reference/{teams,leagues}.json.
//
// TWO sources, so small leagues get covered too:
//
//  1. HARVEST (always, free, no key) — scans every scraped tip in
//     src/data/tips/*.json + real-history.json and keeps any team that either
//     (a) is mentioned by 2+ INDEPENDENT sources, or (b) was matched to a real
//     api-football fixture (dateVerified). Cross-source agreement is a real
//     validation that needs no external DB, and it covers exactly the small
//     leagues our tipsters actually post — which API-Football's free tier
//     doesn't. Spelling variants are collected as aliases.
//
//  2. API-FOOTBALL (optional, needs API_SPORTS_KEY) — augments with canonical
//     names + full league list, including lower divisions. Rate-limited +
//     resumable; skip with --no-api.
//
//   npm run build:reference                 # harvest (+ api if key present)
//   npm run build:reference -- --no-api      # harvest only
//   npm run build:reference -- --min-sources=1
//
// Never deletes: merges into whatever is already there.
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugTeam } from '../src/lib/aggregation/normalize.js';
import type { RawTip } from '../src/lib/aggregation/types.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const DATA_DIR = path.join(ROOT, 'src', 'data');
const REF_DIR = path.join(DATA_DIR, 'reference');
const TEAMS_FILE = path.join(REF_DIR, 'teams.json');
const LEAGUES_FILE = path.join(REF_DIR, 'leagues.json');
const BASE = 'https://v3.football.api-sports.io';

interface RefTeam {
  id?: number;
  name: string;
  aliases?: string[];
  league?: string;
  country?: string;
  sport?: string;
  sources?: number; // how many independent scraped sources mentioned it (harvest)
}

const readArr = <T>(f: string): T[] => {
  try {
    const p = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
};

function readKey(): string {
  if (process.env.API_SPORTS_KEY) return process.env.API_SPORTS_KEY;
  try {
    const m = fs.readFileSync(path.join(ROOT, '.dev.vars'), 'utf8').match(/^API_SPORTS_KEY=(.+)$/m);
    if (m?.[1]?.trim()) return m[1].trim();
  } catch {}
  return '';
}

// ---- 1. Harvest from our own scraped data ---------------------------------
function harvest(minSources: number): Map<string, RefTeam> {
  const tips: RawTip[] = [];
  const tipsDir = path.join(DATA_DIR, 'tips');
  try {
    for (const f of fs.readdirSync(tipsDir)) if (f.endsWith('.json')) tips.push(...readArr<RawTip>(path.join(tipsDir, f)));
  } catch {}
  tips.push(...readArr<RawTip>(path.join(DATA_DIR, 'real-history.json')));

  // slug -> { variants(raw -> count), sources, dateVerified, sport }
  const acc = new Map<string, { variants: Map<string, number>; sources: Set<string>; dv: boolean; sport?: string }>();
  const note = (name: string, source: string, dv: boolean, sport?: string) => {
    if (!name) return;
    const key = slugTeam(name);
    if (!key) return;
    let e = acc.get(key);
    if (!e) acc.set(key, (e = { variants: new Map(), sources: new Set(), dv: false, sport }));
    e.variants.set(name, (e.variants.get(name) ?? 0) + 1);
    e.sources.add(source);
    if (dv) e.dv = true;
  };
  for (const t of tips) {
    note(t.homeTeam, t.source, t.dateVerified === true, t.sport);
    note(t.awayTeam, t.source, t.dateVerified === true, t.sport);
  }

  const out = new Map<string, RefTeam>();
  for (const [key, e] of acc) {
    // Keep only teams we can stand behind: cross-source agreement OR api-matched.
    if (e.sources.size < minSources && !e.dv) continue;
    const variants = [...e.variants.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    out.set(key, {
      name: variants[0],
      aliases: variants.slice(1),
      sport: e.sport,
      sources: e.sources.size,
    });
  }
  return out;
}

// ---- 2. API-Football augmentation (optional) ------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function apiGet(key: string, q: string): Promise<any[]> {
  const res = await fetch(BASE + q, { headers: { 'x-apisports-key': key } });
  if (res.status === 429) throw Object.assign(new Error('rate-limited'), { rateLimited: true });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${q}`);
  return (await res.json()).response ?? [];
}

async function main() {
  const args = process.argv.slice(2);
  const noApi = args.includes('--no-api');
  const minSources = Number(args.find((a) => a.startsWith('--min-sources='))?.split('=')[1]) || 2;
  fs.mkdirSync(REF_DIR, { recursive: true });

  // merge target starts from existing (never delete)
  const teams = new Map<string, RefTeam>();
  for (const t of readArr<RefTeam>(TEAMS_FILE)) teams.set(slugTeam(t.name), t);

  const harvested = harvest(minSources);
  for (const [key, t] of harvested) {
    const prev = teams.get(key);
    if (prev) prev.aliases = [...new Set([...(prev.aliases ?? []), ...(t.aliases ?? [])])];
    else teams.set(key, t);
  }
  console.log(`Harvest: ${harvested.size} teams from scraped data (>=${minSources} sources or api-matched).`);

  const key = readKey();
  if (!noApi && key) {
    try {
      console.log('API-Football: fetching leagues...');
      const rawLeagues = await apiGet(key, '/leagues');
      const leagues = rawLeagues.map((r: any) => ({ id: r.league?.id, name: r.league?.name, type: r.league?.type, country: r.country?.name }));
      fs.writeFileSync(LEAGUES_FILE, JSON.stringify(leagues, null, 2) + '\n');
      console.log(`  wrote ${leagues.length} leagues`);
      const season = new Date().getUTCFullYear();
      // Teams for the leagues we actually have picks in would need mapping;
      // for a first pass, top European leagues. Extend with --all later.
      const ids = [39, 140, 135, 78, 61, 88, 94, 203, 197, 144, 179, 235, 71, 128];
      for (const id of ids) {
        try {
          for (const r of await apiGet(key, `/teams?league=${id}&season=${season}`)) {
            const t = r.team;
            if (t?.name) teams.set(slugTeam(t.name), { id: t.id, name: t.name, country: t.country, sport: 'football' });
          }
          await sleep(7000);
        } catch (e: any) {
          if (e.rateLimited) { console.warn('  rate-limited — keeping progress'); break; }
          throw e;
        }
      }
    } catch (e) {
      console.warn('API-Football step failed (keeping harvested data):', (e as Error).message);
    }
  } else if (!key) {
    console.log('No API_SPORTS_KEY — harvest only (still fully functional).');
    if (!fs.existsSync(LEAGUES_FILE)) fs.writeFileSync(LEAGUES_FILE, '[]\n');
  }

  const teamsOut = [...teams.values()];
  fs.writeFileSync(TEAMS_FILE, JSON.stringify(teamsOut, null, 2) + '\n');
  console.log(`Done. teams.json now has ${teamsOut.length} teams.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
