// -------------------------------------------------------------------------
// Manual / opt-in source. Three ways to feed tips in:
//   1. Drop one JSON file per tipster/source into `src/data/tips/*.json`
//   2. (legacy) a single `src/data/raw-tips.json`
//   3. `src/data/real-history.json` — REAL settled results, written by
//      scripts/settle-real.mjs. Entries already carry `result` (won/lost),
//      so they feed the real (non-demo) track record directly.
// Each file is an array of RawTip objects. Nothing there? No-op.
// This is the clean, ToS-safe way to add tipsters you have the right to use.
// See `src/data/raw-tips.example.json` for the shape.
//
// Plain Node fs reads (not Vite's import.meta.glob): this adapter must also
// run under scripts/generate-tip-content.ts via plain tsx/Node, where
// import.meta.glob does not exist. fs works identically in both contexts.
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import type { RawTip } from '../types';
import { canonicalizePick } from '../normalize';

// Resolve from the project root (process.cwd()), NOT import.meta.url: every
// caller (tsx scripts, `astro build`, `astro dev`) runs from the repo root, and
// Vite rewrites import.meta.url to the bundled location at build time — which
// silently broke the /admin page's data read in production.
const DATA_DIR = path.join(process.cwd(), 'src', 'data');

function readJsonArray(file: string): RawTip[] {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err: any) {
    if (err?.code !== 'ENOENT') console.warn(`jsonImport: skipping ${file} (${err?.message ?? err})`);
    return [];
  }
}

export function jsonImport(): RawTip[] {
  const all: RawTip[] = [];

  const tipsDir = path.join(DATA_DIR, 'tips');
  try {
    for (const name of fs.readdirSync(tipsDir)) {
      if (name.endsWith('.json')) all.push(...readJsonArray(path.join(tipsDir, name)));
    }
  } catch (err: any) {
    if (err?.code !== 'ENOENT') console.warn(`jsonImport: skipping ${tipsDir} (${err?.message ?? err})`);
  }

  all.push(...readJsonArray(path.join(DATA_DIR, 'raw-tips.json')));
  all.push(...readJsonArray(path.join(DATA_DIR, 'real-history.json')));

  // Read every pick EXACTLY as its source meant it: canonicalizePick fixes the
  // market too (a Draw-No-Bet / plain draw / away-win mislabelled "DC" becomes the
  // real market), carries the O/U line, and DROPS anything we cannot settle from
  // the final score (handicap, HT/FT, corners, correct-score…) instead of guessing
  // a wrong bet. Basketball keeps its own already-canonical markets untouched.
  // A team NAME carrying a market tag in parentheses — "FC Andorra (Bookings)",
  // "Lens (Corners)" — is a corrupted extraction where a cards/corners market leaked
  // into the team name. The fixture never matches a real result and the market is one
  // we don't settle anyway → drop it (and it stops polluting the board going forward).
  const NAME_MARKET_TAG = /\((bookings?|corners?|cards?|shots?|fouls?|offsides?|throw[\s-]?ins?|half|1st|2nd)\)/i;
  const out: RawTip[] = [];
  for (const t of all) {
    if ((t.sport ?? 'football') !== 'football') { out.push(t); continue; }
    if (NAME_MARKET_TAG.test(String(t.homeTeam)) || NAME_MARKET_TAG.test(String(t.awayTeam))) continue;
    const c = canonicalizePick(t.market, t.selection, t.homeTeam, t.awayTeam, t.line);
    if (!c) continue; // unreadable / unsupported market → drop, never misread
    t.market = c.market;
    t.selection = c.selection;
    if (typeof c.line === 'number') t.line = c.line;
    out.push(t);
  }
  return out;
}
