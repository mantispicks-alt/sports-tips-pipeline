// One-shot: rewalk every published .md file and recompute displayed `odds`
// as the MEDIAN of its recorded tipsters (from the `tipsters:` frontmatter
// array). Fixes the fake-high displayed prices that inflated the historical
// ROI feed (arithmetic-mean picked up one rogue tipster's wrong quote —
// e.g. Zulubet 'Arsenal DC X2 @5.16' when the real market was ~1.90).
//
// Safe: leaves `pick`, `result`, `match` and everything else untouched.
// Only rewrites the `odds:` line + the "Average price backed: X" text.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIPS_DIR = path.join(ROOT, 'src', 'content', 'tips');

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

let updated = 0, unchanged = 0, skipped = 0;
for (const f of fs.readdirSync(TIPS_DIR)) {
  if (!f.endsWith('.md')) continue;
  const full = path.join(TIPS_DIR, f);
  const txt = fs.readFileSync(full, 'utf8');
  const nl = txt.includes('\r\n') ? '\r\n' : '\n';
  const t = txt.replace(/\r\n/g, '\n');

  const tipMatch = t.match(/^tipsters:\s*(\[[\s\S]*?\])/m);
  if (!tipMatch) { skipped++; continue; }
  let tipsters;
  try { tipsters = JSON.parse(tipMatch[1]); } catch { skipped++; continue; }
  const odds = tipsters.map((tp) => Number(tp.odds)).filter((o) => Number.isFinite(o) && o > 1);
  if (!odds.length) { skipped++; continue; }

  const med = median(odds);
  const rounded = Math.round(med * 100) / 100;
  const curMatch = t.match(/^odds:\s*([0-9.]+)/m);
  if (!curMatch) { skipped++; continue; }
  const cur = Number(curMatch[1]);
  if (Math.abs(cur - rounded) < 0.01) { unchanged++; continue; }

  let next = t.replace(/^odds:\s*[0-9.]+/m, `odds: ${rounded}`);
  // Body prose: "Average price backed: **X**" → keep in sync.
  next = next.replace(/(\bAverage price backed[^*]*\*\*)[0-9.]+(\*\*)/g, `$1${rounded}$2`);

  fs.writeFileSync(full, next.replace(/\n/g, nl));
  updated++;
}
console.log(`backfill-median-odds: updated ${updated}, unchanged ${unchanged}, skipped ${skipped}`);
