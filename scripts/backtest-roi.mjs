// -------------------------------------------------------------------------
// backtest-roi.mjs — the honest "does it make money?" test.
// Pulls REAL results + Bet365 odds from football-data.co.uk (free), runs OUR
// Poisson out-of-sample, and bets 1u at the real closing odds. Reports flat ROI
// and VALUE-filtered ROI (bet only when model prob > implied prob) — which is
// what the bot actually does. Hit rate ≠ profit; this measures profit.
//   node scripts/backtest-roi.mjs 2526
// -------------------------------------------------------------------------
const season = process.argv[2] || '2526';
const codes = { E0: 'Premier League', D1: 'Bundesliga', SP1: 'La Liga', I1: 'Serie A', F1: 'Ligue 1' };

const factorial = (n) => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
const poisson = (l, k) => (Math.pow(l, k) * Math.exp(-l)) / factorial(k);
function probs(hs, hc, as, ac, la, homeAdv = 1.1, mg = 8) {
  const lh = (hs / la) * (ac / la) * la * homeAdv, law = (as / la) * (hc / la) * la;
  const hp = Array.from({ length: mg + 1 }, (_, k) => poisson(lh, k));
  const ap = Array.from({ length: mg + 1 }, (_, k) => poisson(law, k));
  let H = 0, D = 0, A = 0, O = 0;
  for (let i = 0; i <= mg; i++) for (let j = 0; j <= mg; j++) {
    const p = hp[i] * ap[j];
    if (i > j) H += p; else if (i === j) D += p; else A += p;
    if (i + j > 2.5) O += p;
  }
  return { H, D, A, O, U: 1 - O };
}
const dnum = (d) => { const [dd, mm, yy] = String(d).split('/'); return `${yy}${mm}${dd}`; };

// accumulators: [staked, returned, wins, bets]
const acc = { flatX: [0, 0, 0, 0], valX: [0, 0, 0, 0], flatOU: [0, 0, 0, 0], valOU: [0, 0, 0, 0] };
function bet(a, odds, won) { a[0] += 1; a[1] += won ? odds : 0; a[2] += won ? 1 : 0; a[3] += 1; }

for (const [code, name] of Object.entries(codes)) {
  try {
    const r = await fetch(`https://www.football-data.co.uk/mmz4281/${season}/${code}.csv`);
    if (!r.ok) { console.log(`${code}: HTTP ${r.status}`); continue; }
    const lines = (await r.text()).split(/\r?\n/).filter(Boolean);
    const H = lines[0].split(',');
    const idx = (n) => H.indexOf(n);
    const rows = lines.slice(1).map((l) => l.split(',')).filter((c) => c[idx('FTHG')] !== '' && c[idx('B365H')]);
    rows.sort((a, b) => dnum(a[idx('Date')]).localeCompare(dnum(b[idx('Date')])));
    const cut = Math.floor(rows.length * 0.6), train = rows.slice(0, cut), test = rows.slice(cut);

    const st = new Map(); let tg = 0, tn = 0;
    for (const c of train) {
      const h = +c[idx('FTHG')], a = +c[idx('FTAG')]; tg += h + a; tn++;
      for (const [t, gf, ga] of [[c[idx('HomeTeam')], h, a], [c[idx('AwayTeam')], a, h]]) {
        const s = st.get(t) || { gf: 0, ga: 0, n: 0 }; s.gf += gf; s.ga += ga; s.n++; st.set(t, s);
      }
    }
    const la = tg / (tn * 2) || 1.35;
    const avg = (t) => { const s = st.get(t); return s && s.n >= 3 ? { sc: s.gf / s.n, cc: s.ga / s.n } : null; };

    for (const c of test) {
      const ht = avg(c[idx('HomeTeam')]), at = avg(c[idx('AwayTeam')]);
      if (!ht || !at) continue;
      const p = probs(ht.sc, ht.cc, at.sc, at.cc, la);
      const fh = +c[idx('FTHG')], fa = +c[idx('FTAG')];
      // 1X2
      const pick = p.H >= p.D && p.H >= p.A ? 'H' : p.A >= p.D ? 'A' : 'D';
      const oddX = +c[idx('B365' + pick)]; const probX = p[pick];
      const actualX = fh > fa ? 'H' : fh < fa ? 'A' : 'D';
      if (oddX > 1) { bet(acc.flatX, oddX, pick === actualX); if (probX > 1 / oddX) bet(acc.valX, oddX, pick === actualX); }
      // OU 2.5
      const ouPick = p.O >= p.U ? 'O' : 'U';
      const oddOU = +c[idx(ouPick === 'O' ? 'B365>2.5' : 'B365<2.5')]; const probOU = ouPick === 'O' ? p.O : p.U;
      const actualOU = fh + fa > 2.5 ? 'O' : 'U';
      if (oddOU > 1) { bet(acc.flatOU, oddOU, ouPick === actualOU); if (probOU > 1 / oddOU) bet(acc.valOU, oddOU, ouPick === actualOU); }
    }
    console.log(`${code} (${name}): test ${test.length}`);
  } catch (e) { console.log(`${code}: ERR ${String(e?.message || e).slice(0, 50)}`); }
}
const rep = (label, a) => {
  const [s, ret, w, n] = a; const roi = s ? ((ret - s) / s) * 100 : 0; const hit = n ? (w / n) * 100 : 0;
  console.log(`  ${label.padEnd(22)} bets ${String(n).padStart(4)}  hit ${hit.toFixed(1)}%  ROI ${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%  (profit ${(ret - s).toFixed(1)}u)`);
};
console.log(`\n=== ROI backtest, season ${season}, out-of-sample, 1u flat ===`);
rep('1X2 flat (all picks)', acc.flatX);
rep('1X2 VALUE only', acc.valX);
rep('O/U 2.5 flat', acc.flatOU);
rep('O/U 2.5 VALUE only', acc.valOU);
console.log('\nValue = bet only when model prob > bookmaker implied prob. ROI>0 = profitable.');
