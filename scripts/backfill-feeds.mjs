// One-shot: reclassify every pick's `feeds:` array to match its CURRENT
// displayed odds. After the odds backfills (median + oddsBoard + DC cap),
// some picks landed in a different band than the one originally baked into
// their feeds field, e.g. Adelaide City Win got re-priced to 1.57 but still
// carries feeds: ["roi"] (HIGH band ≥3.50) — a mis-classification the ROI
// system's stats then inherit.
//
// Bands (mirror generate-tip-content.ts):
//   WIN     ≤ 1.80 → feeds: ["win"]
//   OVERALL 1.80 < odds < 2.60 → feeds: ["overall"]
//   VALUE   2.60 ≤ odds < 3.50 → feeds: ["overall"] (still "overall" per current logic)
//   HIGH    ≥ 3.50 → feeds: ["roi"]
//
// Reads odds from the .md, computes the correct feed, rewrites the field.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIPS_DIR = path.join(ROOT, 'src', 'content', 'tips');

function feedFor(odds) {
  if (odds <= 1.80) return 'win';
  if (odds >= 3.50) return 'roi';
  return 'overall';
}

let changed = 0, ok = 0, skipped = 0;
for (const f of fs.readdirSync(TIPS_DIR)) {
  if (!f.endsWith('.md')) continue;
  const full = path.join(TIPS_DIR, f);
  const txt = fs.readFileSync(full, 'utf8');
  const nl = txt.includes('\r\n') ? '\r\n' : '\n';
  const t = txt.replace(/\r\n/g, '\n');

  const o = t.match(/^odds:\s*([0-9.]+)/m);
  const fd = t.match(/^feeds:\s*(\[[^\]]*\])/m);
  if (!o || !fd) { skipped++; continue; }
  const odds = Number(o[1]);
  if (!Number.isFinite(odds)) { skipped++; continue; }

  const want = feedFor(odds);
  const cur = fd[1];
  const has = cur.includes(`"${want}"`) || cur.includes(`'${want}'`);
  if (has && cur.replace(/[\s'"[\]]/g, '') === want) { ok++; continue; }

  const next = t.replace(/^feeds:\s*\[[^\]]*\]/m, `feeds: ["${want}"]`);
  if (next === t) { ok++; continue; }
  fs.writeFileSync(full, next.replace(/\n/g, nl));
  changed++;
}
console.log(`backfill-feeds: reclassified ${changed}, ok ${ok}, skipped ${skipped}`);
