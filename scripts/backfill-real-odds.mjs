// One-shot: rewrite displayed `odds` in every .md using this priority:
//   1) oddsBoard median (real market prices from featured bookmakers), else
//   2) tipster median but with OUTLIER-REJECT (drop any odds > 3× the market
//      median of the remaining set — protects against a tipster typing 108
//      for an O2.5 market whose real price is ~1.5).
// Keeps everything else in the file untouched.
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

// Reject any odds > 3× (or < 1/3×) the MEDIAN of the OTHER odds. Handles the
// single-outlier case (n=2 with one absurd number never both diverging the
// same direction). Skips when list is too short to have context.
function rejectOutliers(nums) {
  if (nums.length < 2) return nums;
  const sorted = [...nums].sort((a, b) => a - b);
  const m = median(sorted);
  return sorted.filter((n) => n <= m * 3 && n >= m / 3);
}

let updated = 0, unchanged = 0, skipped = 0;
for (const f of fs.readdirSync(TIPS_DIR)) {
  if (!f.endsWith('.md')) continue;
  const full = path.join(TIPS_DIR, f);
  const txt = fs.readFileSync(full, 'utf8');
  const nl = txt.includes('\r\n') ? '\r\n' : '\n';
  const t = txt.replace(/\r\n/g, '\n');

  // Prefer oddsBoard (real market)
  const obMatch = t.match(/^oddsBoard:\s*(\[[\s\S]*?\])/m);
  let real = null;
  if (obMatch) {
    try {
      const board = JSON.parse(obMatch[1]);
      const prices = board.map((b) => Number(b.odds)).filter((o) => Number.isFinite(o) && o > 1 && o < 30);
      if (prices.length) real = median(prices);
    } catch {}
  }

  // Fall back to tipster median with outlier rejection
  if (real == null) {
    const tipMatch = t.match(/^tipsters:\s*(\[[\s\S]*?\])/m);
    if (!tipMatch) { skipped++; continue; }
    try {
      const tipsters = JSON.parse(tipMatch[1]);
      const raw = tipsters.map((tp) => Number(tp.odds)).filter((o) => Number.isFinite(o) && o > 1);
      if (!raw.length) { skipped++; continue; }
      const clean = rejectOutliers(raw);
      real = median(clean);
    } catch { skipped++; continue; }
  }
  if (real == null) { skipped++; continue; }

  const rounded = Math.round(real * 100) / 100;
  const curMatch = t.match(/^odds:\s*([0-9.]+)/m);
  if (!curMatch) { skipped++; continue; }
  const cur = Number(curMatch[1]);
  if (Math.abs(cur - rounded) < 0.01) { unchanged++; continue; }

  let next = t.replace(/^odds:\s*[0-9.]+/m, `odds: ${rounded}`);
  next = next.replace(/(\bAverage price backed[^*]*\*\*)[0-9.]+(\*\*)/g, `$1${rounded}$2`);
  fs.writeFileSync(full, next.replace(/\n/g, nl));
  updated++;
}
console.log(`backfill-real-odds: updated ${updated}, unchanged ${unchanged}, skipped ${skipped}`);
