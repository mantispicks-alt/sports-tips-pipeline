// One-shot: for Double Chance picks that STILL have inflated tipster odds
// (no oddsBoard coverage — Highlightly doesn't stock DC prices), compute
// the DC odds from Pinnacle's fair 1X2 probabilities (pinnacle-fair.json).
//
// DC 1X = 1 / (home_prob + draw_prob)
// DC 12 = 1 / (home_prob + away_prob)
// DC X2 = 1 / (away_prob + draw_prob)
//
// Adds ~5% margin so the displayed odds match what a real bookmaker would
// price the DC at (fair probs are de-vigged; real market applies a margin).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIPS_DIR = path.join(ROOT, 'src', 'content', 'tips');
const FAIR_FILE = path.join(ROOT, 'src', 'data', 'pinnacle-fair.json');

if (!fs.existsSync(FAIR_FILE)) { console.log('no pinnacle-fair.json'); process.exit(0); }
const fair = JSON.parse(fs.readFileSync(FAIR_FILE, 'utf8'));

// pinnacle-fair keys: "YYYY-MM-DD|home_slug|away_slug" (slugs LOWERCASED, unsorted).
// Build a lookup by same-day pair (either orientation).
function keyFor(day, home, away) {
  const s = (x) => String(x).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(fc|cf|afc|sc|ac|cd|ca|sk|fk|nk)\b/gi, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  return { a: `${day}|${s(home)}|${s(away)}`, b: `${day}|${s(away)}|${s(home)}` };
}
function findFair(day, home, away) {
  const { a, b } = keyFor(day, home, away);
  // exact then token-overlap fallback
  if (fair[a]) return { fair: fair[a], swapped: false };
  if (fair[b]) return { fair: fair[b], swapped: true };
  const hs = a.split('|')[1], as = a.split('|')[2];
  for (const [k, v] of Object.entries(fair)) {
    const [d, kh, ka] = k.split('|');
    if (d !== day) continue;
    if ((kh.includes(hs) || hs.includes(kh)) && (ka.includes(as) || as.includes(ka))) return { fair: v, swapped: false };
    if ((kh.includes(as) || as.includes(kh)) && (ka.includes(hs) || hs.includes(ka))) return { fair: v, swapped: true };
  }
  return null;
}

const MARGIN = 0.05; // 5% bookmaker margin on the derived DC price
function decimalFromProbs(pHome, pDraw, pAway, selection, swapped) {
  const h = swapped ? pAway : pHome;
  const a = swapped ? pHome : pAway;
  const d = pDraw;
  let p;
  const sel = String(selection).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (sel === '1x' || sel.includes('homedraw')) p = h + d;
  else if (sel === '12' || sel.includes('nodraw')) p = h + a;
  else if (sel === 'x2' || sel.includes('drawaway')) p = a + d;
  else return null;
  return 1 / (p * (1 + MARGIN)); // add margin so it matches real bookmaker DC price
}

// Extract selection code (1x/12/x2) from a "Double Chance 1X" / "1X" / etc. pick label.
function selCode(pick) {
  const s = String(pick).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (s.includes('1x') && !s.includes('12')) return '1x';
  if (s.includes('x2')) return 'x2';
  if (s.includes('12')) return '12';
  return null;
}

let updated = 0, noFair = 0, skipped = 0;
for (const f of fs.readdirSync(TIPS_DIR)) {
  if (!f.endsWith('.md')) continue;
  const full = path.join(TIPS_DIR, f);
  const txt = fs.readFileSync(full, 'utf8');
  const nl = txt.includes('\r\n') ? '\r\n' : '\n';
  const t = txt.replace(/\r\n/g, '\n');

  const mkt = t.match(/^market:\s*"([^"]*)"/m);
  if (!mkt || !/double chance/i.test(mkt[1])) continue;
  const pk = t.match(/^pick:\s*"([^"]*)"/m);
  const m = t.match(/^match:\s*"([^"]*)"/m);
  const ko = t.match(/^kickoff:\s*(.*)$/m);
  const o = t.match(/^odds:\s*([0-9.]+)/m);
  if (!(pk && m && ko && o)) { skipped++; continue; }
  const [home, away] = m[1].split(/\s+vs\s+/i);
  if (!home || !away) { skipped++; continue; }
  const day = String(ko[1]).trim().slice(0, 10);
  const sel = selCode(pk[1]);
  if (!sel) { skipped++; continue; }
  const hit = findFair(day, home, away);
  if (!hit) { noFair++; continue; }
  const dec = decimalFromProbs(hit.fair.home, hit.fair.draw, hit.fair.away, sel, hit.swapped);
  if (!dec || !Number.isFinite(dec) || dec < 1.05) { skipped++; continue; }
  const rounded = Math.round(dec * 100) / 100;
  const cur = Number(o[1]);
  if (Math.abs(cur - rounded) < 0.05) continue;

  let next = t.replace(/^odds:\s*[0-9.]+/m, `odds: ${rounded}`);
  next = next.replace(/(\bAverage price backed[^*]*\*\*)[0-9.]+(\*\*)/g, `$1${rounded}$2`);
  fs.writeFileSync(full, next.replace(/\n/g, nl));
  updated++;
}
console.log(`backfill-dc-odds: updated ${updated}, no-fair ${noFair}, skipped ${skipped}`);
