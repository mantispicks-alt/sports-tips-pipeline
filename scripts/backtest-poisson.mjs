// -------------------------------------------------------------------------
// backtest-poisson.mjs — pull REAL results from GitHub (openfootball, no key,
// no ToS) and validate OUR Poisson model out-of-sample.
//
// Per league: sort matches by date, learn team scored/conceded averages on the
// first 60% (TRAIN), then predict the last 40% (TEST) the model never saw, and
// measure 1X2 / Over-Under 2.5 / BTTS hit rate. Honest (no data leakage).
//   node scripts/backtest-poisson.mjs 2023-24
// -------------------------------------------------------------------------
const season = process.argv[2] || '2023-24';
const leagues = ['en.1', 'de.1', 'es.1', 'it.1', 'fr.1'];

const factorial = (n) => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
const poisson = (l, k) => (Math.pow(l, k) * Math.exp(-l)) / factorial(k);
function predict(hs, hc, as, ac, leagueAvg, homeAdv = 1.1, maxGoals = 8) {
  const lh = (hs / leagueAvg) * (ac / leagueAvg) * leagueAvg * homeAdv;
  const la = (as / leagueAvg) * (hc / leagueAvg) * leagueAvg;
  const hp = Array.from({ length: maxGoals + 1 }, (_, k) => poisson(lh, k));
  const ap = Array.from({ length: maxGoals + 1 }, (_, k) => poisson(la, k));
  let home = 0, draw = 0, away = 0, over = 0, btts = 0;
  for (let i = 0; i <= maxGoals; i++) for (let j = 0; j <= maxGoals; j++) {
    const p = hp[i] * ap[j];
    if (i > j) home += p; else if (i === j) draw += p; else away += p;
    if (i + j > 2.5) over += p;
    if (i >= 1 && j >= 1) btts += p;
  }
  return { x2: home >= draw && home >= away ? 'H' : away >= draw ? 'A' : 'D', ou: over >= 0.5 ? 'O' : 'U', btts: btts >= 0.5 ? 'Y' : 'N' };
}

let X2 = [0, 0], OU = [0, 0], BT = [0, 0];
for (const lg of leagues) {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/openfootball/football.json/master/${season}/${lg}.json`);
    if (!r.ok) { console.log(`${lg}: HTTP ${r.status}`); continue; }
    const j = await r.json();
    const played = (j.matches || []).filter((m) => Array.isArray(m.score?.ft)).sort((a, b) => a.date.localeCompare(b.date));
    if (played.length < 50) continue;
    const cut = Math.floor(played.length * 0.6);
    const train = played.slice(0, cut), test = played.slice(cut);

    // team stats from TRAIN
    const st = new Map(); // team -> {gf, ga, n}
    let totGoals = 0, totGames = 0;
    for (const m of train) {
      const [h, a] = m.score.ft; totGoals += h + a; totGames++;
      for (const [t, gf, ga] of [[m.team1, h, a], [m.team2, a, h]]) {
        const s = st.get(t) || { gf: 0, ga: 0, n: 0 }; s.gf += gf; s.ga += ga; s.n++; st.set(t, s);
      }
    }
    const leagueAvg = totGoals / (totGames * 2) || 1.35;
    const avg = (t) => { const s = st.get(t); return s && s.n >= 3 ? { sc: s.gf / s.n, cc: s.ga / s.n } : null; };

    let used = 0;
    for (const m of test) {
      const H = avg(m.team1), A = avg(m.team2);
      if (!H || !A) continue;
      used++;
      const p = predict(H.sc, H.cc, A.sc, A.cc, leagueAvg);
      const [h, a] = m.score.ft;
      const actualX2 = h > a ? 'H' : h < a ? 'A' : 'D';
      const actualOU = h + a > 2.5 ? 'O' : 'U';
      const actualBT = h >= 1 && a >= 1 ? 'Y' : 'N';
      X2[1]++; if (p.x2 === actualX2) X2[0]++;
      OU[1]++; if (p.ou === actualOU) OU[0]++;
      BT[1]++; if (p.btts === actualBT) BT[0]++;
    }
    console.log(`${lg}: ${j.name} — train ${train.length} / test ${used}`);
  } catch (e) { console.log(`${lg}: ERR ${String(e?.message || e).slice(0, 50)}`); }
}
const pctOf = ([w, n]) => (n ? `${((w / n) * 100).toFixed(1)}% (${w}/${n})` : 'n/a');
console.log(`\n=== OUT-OF-SAMPLE hit rate (season ${season}) ===`);
console.log(`1X2:        ${pctOf(X2)}   [random ~33-40% incl. home bias]`);
console.log(`Over/Under: ${pctOf(OU)}   [coin ~50%]`);
console.log(`BTTS:       ${pctOf(BT)}   [coin ~50%]`);
