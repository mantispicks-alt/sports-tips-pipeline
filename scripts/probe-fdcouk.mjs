// Probe football-data.co.uk CSV (results + bookmaker odds, free).
// Codes: E0=EPL, D1=Bundesliga, SP1=La Liga, I1=Serie A, F1=Ligue1. Season 2526=2025-26.
for (const season of ['2627', '2526']) {
  const url = `https://www.football-data.co.uk/mmz4281/${season}/E0.csv`;
  try {
    const r = await fetch(url);
    if (!r.ok) { console.log(`${season} E0: HTTP ${r.status}`); continue; }
    const txt = await r.text();
    const lines = txt.split(/\r?\n/).filter(Boolean);
    const header = lines[0].split(',');
    const oddCols = header.filter((h) => /^(B365|Avg|Max)(H|D|A)$/.test(h) || /Over|Under|BTTS|>2.5|<2.5/i.test(h));
    console.log(`\n### ${season} E0: ${lines.length - 1} rows`);
    console.log(`  key cols: ${header.filter((h) => ['Date', 'HomeTeam', 'AwayTeam', 'FTHG', 'FTAG', 'FTR'].includes(h)).join(', ')}`);
    console.log(`  odds cols (sample): ${oddCols.slice(0, 12).join(', ')}`);
    if (lines[1]) {
      const row = Object.fromEntries(header.map((h, i) => [h, lines[1].split(',')[i]]));
      console.log(`  row1: ${row.Date} ${row.HomeTeam} ${row.FTHG}-${row.FTAG} ${row.AwayTeam} | B365 ${row.B365H}/${row.B365D}/${row.B365A}`);
    }
  } catch (e) { console.log(`${season}: ERR ${String(e?.message || e).slice(0, 50)}`); }
}
