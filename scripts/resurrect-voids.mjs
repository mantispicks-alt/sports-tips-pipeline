// One-shot: reset RECENT (last 30 days) voided picks back to pending so the
// improved settlement path (matchKey fallback + ±3d postpone window + paid
// api-football Pro 30d window) gets another chance to find real results.
// Old voids that were correct (cancelled/postponed/never-happened fixtures)
// will just re-void after 14 days if no result surfaces.
//
// Safe: never touches WON/LOST picks. Only VOID within the 30-day window.
// Never re-voids: after this reset, the normal void sweep decides.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIPS_DIR = path.join(ROOT, 'src', 'content', 'tips');
const NOW = Date.now();
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

let reset = 0, keptOld = 0, keptFuture = 0;
const files = fs.readdirSync(TIPS_DIR).filter((f) => f.endsWith('.md'));
for (const f of files) {
  const full = path.join(TIPS_DIR, f);
  const txt = fs.readFileSync(full, 'utf8');
  const result = (txt.match(/^result:\s*(.*)$/m)?.[1] || '').trim();
  if (result !== 'void') continue;
  const ko = Date.parse((txt.match(/^kickoff:\s*(.*)$/m)?.[1] || '').trim());
  if (!Number.isFinite(ko)) continue;
  const age = NOW - ko;
  if (age > WINDOW_MS) { keptOld++; continue; } // >30d old — skip
  if (age < 0) { keptFuture++; continue; } // shouldn't happen (future void) — skip
  fs.writeFileSync(full, txt.replace(/^result:\s*void\s*$/m, 'result: pending'));
  reset++;
}
console.log(`Resurrected ${reset} voids -> pending. Kept ${keptOld} old-void (>30d) + ${keptFuture} future.`);
