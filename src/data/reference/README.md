# Reference data — canonical teams & leagues

These two files are the "database" the pipeline checks scraped picks against,
so we can tell real first-team fixtures apart from reserve/B teams and from
tiny leagues we don't actually cover.

- `leagues.json` — `[{ id, name, country, type, tier }]`
- `teams.json` — `[{ id, name, aliases, league, country }]`

Both ship **empty**. Populate them with real, broad coverage (including lower
divisions and small leagues) from API-Football:

```bash
# needs API_SPORTS_KEY in .dev.vars or the environment
npm run build:reference            # leagues + teams for a default league set
npm run build:reference -- --all   # every league API-Football exposes (slow; respects the free-tier rate limit, resumable)
```

Once populated, the tip generator (`scripts/generate-tip-content.ts`) will only
publish a pick when **both** teams resolve to a known team here — which is how
small-league fixtures get validated instead of blindly trusted.

Until then, the rule-based reserve/youth filter in
`src/lib/aggregation/reference.ts` still runs (it needs no data), so "Team II",
"Porto B", "U21", "Primavera" etc. are already excluded.

The GitHub Actions cron runs `build:reference` before `generate:tips`, so the
DB refreshes automatically once `API_SPORTS_KEY` is set as a repo secret.
