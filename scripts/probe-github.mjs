// Probe openfootball/football.json raw files for the current season.
const season = process.argv[2] || '2026-27';
const leagues = ['en.1', 'de.1', 'es.1', 'it.1', 'fr.1'];
for (const lg of leagues) {
  const url = `https://raw.githubusercontent.com/openfootball/football.json/master/${season}/${lg}.json`;
  try {
    const r = await fetch(url);
    if (!r.ok) { console.log(`${lg}: HTTP ${r.status}`); continue; }
    const j = await r.json();
    const matches = j.matches || [];
    const played = matches.filter((m) => Array.isArray(m.score?.ft));
    console.log(`${lg}: "${j.name}" — ${matches.length} matches, ${played.length} played`);
    console.log(`   sample: ${JSON.stringify(matches[0])}`);
  } catch (e) { console.log(`${lg}: ERR ${String(e?.message || e).slice(0, 50)}`); }
}
