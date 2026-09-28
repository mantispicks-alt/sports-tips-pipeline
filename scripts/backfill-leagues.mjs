// One-shot: rewrite every published .md's `league:` field through the shared
// canonicalLeague() alias map. Tipsters use every shorthand ("ENP",
// "England Championship" for a Premier team, "IT1", "Ger2"…); the site
// looks unprofessional when the same competition shows up under three
// different names. Keeps the original when no alias is known.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalLeague } from '../src/lib/aggregation/normalize.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIPS_DIR = path.join(ROOT, 'src', 'content', 'tips');

let updated = 0, unchanged = 0, skipped = 0;
for (const f of fs.readdirSync(TIPS_DIR)) {
  if (!f.endsWith('.md')) continue;
  const full = path.join(TIPS_DIR, f);
  const txt = fs.readFileSync(full, 'utf8');
  const nl = txt.includes('\r\n') ? '\r\n' : '\n';
  const t = txt.replace(/\r\n/g, '\n');

  const m = t.match(/^league:\s*"([^"]*)"/m);
  if (!m) { skipped++; continue; }
  const before = m[1];
  const after = canonicalLeague(before);
  if (after === before) { unchanged++; continue; }
  const next = t.replace(/^league:\s*"[^"]*"/m, `league: "${after}"`);
  fs.writeFileSync(full, next.replace(/\n/g, nl));
  updated++;
}
console.log(`backfill-leagues: updated ${updated}, unchanged ${unchanged}, skipped ${skipped}`);
