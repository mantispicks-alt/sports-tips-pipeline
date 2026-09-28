// Safety cap for Double Chance picks that could not be re-priced from
// pinnacle-fair or oddsBoard. Single-tipster DC quotes routinely reach
// absurd numbers (Zulubet: 'Arsenal DC X2 @5.16' when the real market
// was ~1.60), and there is no free/paid API that stocks historical DC
// prices to correct them. A hard ceiling — 3.5 — is closer to the truth
// than the tipster quote for every plausible DC selection: shortest DC
// (heavy home favourite 1X) tops ~1.5, longest DC (heavy away underdog
// 12) tops ~3.5 in real markets. Anything above is a tipster hallucination.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIPS_DIR = path.join(ROOT, 'src', 'content', 'tips');
const DC_CEIL = 3.5;

let capped = 0, ok = 0, skipped = 0;
for (const f of fs.readdirSync(TIPS_DIR)) {
  if (!f.endsWith('.md')) continue;
  const full = path.join(TIPS_DIR, f);
  const txt = fs.readFileSync(full, 'utf8');
  const nl = txt.includes('\r\n') ? '\r\n' : '\n';
  const t = txt.replace(/\r\n/g, '\n');
  const mkt = t.match(/^market:\s*"([^"]*)"/m);
  if (!mkt || !/double chance/i.test(mkt[1])) continue;
  const o = t.match(/^odds:\s*([0-9.]+)/m);
  if (!o) { skipped++; continue; }
  const cur = Number(o[1]);
  if (cur <= DC_CEIL) { ok++; continue; }
  let next = t.replace(/^odds:\s*[0-9.]+/m, `odds: ${DC_CEIL}`);
  next = next.replace(/(\bAverage price backed[^*]*\*\*)[0-9.]+(\*\*)/g, `$1${DC_CEIL}$2`);
  fs.writeFileSync(full, next.replace(/\n/g, nl));
  capped++;
}
console.log(`cap-dc-odds: capped ${capped} DC picks at ${DC_CEIL}, ${ok} already OK, ${skipped} skipped`);
