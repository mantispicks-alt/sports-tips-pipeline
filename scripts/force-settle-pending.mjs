import fs from 'node:fs';
import path from 'node:path';

const DIR = 'src/content/tips';
const out = JSON.parse(fs.readFileSync('src/data/real-outcomes.json', 'utf8'));

const byDate = {};
for (const o of out) {
  const m = o.matchKey.match(/^football\|(\d{4}-\d{2}-\d{2})\|(.+)\|(.+)$/);
  if (!m) continue;
  const [, date, home, away] = m;
  (byDate[date] ??= []).push({ home, away, hg: o.hg, ag: o.ag });
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const contains = (a, b) => a.includes(b) || b.includes(a);
const aliases = { 'sp-lisbon': 'sporting-cp', 'sporting-lisbon': 'sporting-cp' };

function tryMatch(tipHome, tipAway, tipDate) {
  const th = slug(tipHome), ta = slug(tipAway);
  const dates = [tipDate];
  const d = new Date(tipDate);
  dates.push(new Date(d.getTime() - 86400000).toISOString().slice(0, 10));
  dates.push(new Date(d.getTime() + 86400000).toISOString().slice(0, 10));
  for (const dd of dates) {
    const list = byDate[dd] || [];
    for (const o of list) {
      if ((o.home === th || aliases[th] === o.home || contains(o.home, th)) &&
          (o.away === ta || aliases[ta] === o.away || contains(o.away, ta))) {
        return { hg: o.hg, ag: o.ag };
      }
      if ((o.away === th || aliases[th] === o.away || contains(o.away, th)) &&
          (o.home === ta || aliases[ta] === o.home || contains(o.home, ta))) {
        return { hg: o.ag, ag: o.hg };
      }
    }
  }
  return null;
}

// Local settle implementation — matches src/lib/aggregation/normalize.ts
function settle(market, selection, hg, ag, line) {
  const s = String(selection || '').toLowerCase();
  switch (market) {
    case '1X2': {
      if (s === 'home') return hg > ag ? 'won' : 'lost';
      if (s === 'away') return ag > hg ? 'won' : 'lost';
      if (s === 'draw') return hg === ag ? 'won' : 'lost';
      return 'void';
    }
    case 'OU25': {
      const L = Number.isFinite(line) ? line : 2.5;
      const tot = hg + ag;
      if (tot === L) return 'void';
      if (s === 'over') return tot > L ? 'won' : 'lost';
      if (s === 'under') return tot < L ? 'won' : 'lost';
      return 'void';
    }
    case 'BTTS': {
      const both = hg > 0 && ag > 0;
      if (s === 'yes') return both ? 'won' : 'lost';
      if (s === 'no') return both ? 'lost' : 'won';
      return 'void';
    }
    case 'DC': {
      if (s === 'homedraw' || s === '1x') return hg >= ag ? 'won' : 'lost';
      if (s === 'drawaway' || s === 'x2') return ag >= hg ? 'won' : 'lost';
      if (s === 'homeaway' || s === '12') return hg !== ag ? 'won' : 'lost';
      return 'void';
    }
    default: return 'void';
  }
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.md'));
let updated = 0;
for (const f of files) {
  const p = path.join(DIR, f);
  const raw = fs.readFileSync(p, 'utf8');
  const res = (raw.match(/^result:\s*(.*)$/m)?.[1] || '').trim();
  if (res !== 'pending') continue;
  const match = (raw.match(/^match:\s*['"](.+)['"]$/m)?.[1] || '').trim();
  const ko = (raw.match(/^kickoff:\s*(.*)$/m)?.[1] || '').trim();
  const marketRaw = (raw.match(/^market:\s*['"](.+)['"]$/m)?.[1] || '').trim();
  const selRaw = (raw.match(/^pick:\s*['"](.+)['"]$/m)?.[1] || '').trim();
  const lineRaw = raw.match(/^line:\s*([0-9.]+)$/m)?.[1];
  const line = lineRaw ? parseFloat(lineRaw) : undefined;

  const parts = match.split(/\s+vs\.?\s+/i);
  const [th, ta] = parts;
  if (!th || !ta) continue;

  const r = tryMatch(th, ta, ko.slice(0, 10));
  if (!r) continue;

  const mLower = marketRaw.toLowerCase();
  let mkt;
  if (mLower.includes('match result')) mkt = '1X2';
  else if (mLower.includes('over/under') || mLower.includes('total goals') || mLower.includes('over ') || mLower.includes('under ')) mkt = 'OU25';
  else if (mLower.includes('both teams')) mkt = 'BTTS';
  else if (mLower.includes('double chance')) mkt = 'DC';
  else mkt = '1X2';

  let sel = selRaw.toLowerCase();
  const thLow = th.toLowerCase(), taLow = ta.toLowerCase();
  if (mkt === '1X2') {
    if (sel.includes('draw') || sel === 'x') sel = 'draw';
    else if (sel.includes(thLow) || sel.includes('home')) sel = 'home';
    else if (sel.includes(taLow) || sel.includes('away')) sel = 'away';
  } else if (mkt === 'OU25') {
    sel = sel.includes('under') ? 'under' : 'over';
  } else if (mkt === 'BTTS') {
    sel = sel.includes('no') ? 'no' : 'yes';
  } else if (mkt === 'DC') {
    if (sel.includes('1x')) sel = '1X';
    else if (sel.includes('x2')) sel = 'X2';
    else if (sel.includes('12')) sel = '12';
    else sel = '1X';
  }

  const outcome = settle(mkt, sel, r.hg, r.ag, line);
  if (!outcome || outcome === 'pending') continue;

  const newRaw = raw.replace(/^result:.*$/m, 'result: ' + outcome);
  fs.writeFileSync(p, newRaw);
  console.log('  →', match, '(' + ko.slice(0, 10) + ')', mkt, sel, 'from', r.hg + '-' + r.ag, '→', outcome);
  updated++;
}
console.log('---updated:', updated);
