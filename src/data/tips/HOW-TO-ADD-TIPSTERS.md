# Adding tipsters

A tipster is added automatically the moment their tips are ingested — the
engine computes their rating and leaderboard position from their record.
(They appear on `/tipsters` once they have **10+ settled** tips.)

## The easy way: drop a JSON file here

Add one file per tipster or source in this folder, e.g. `sharpmike.json`:

```json
[
  {
    "source": "telegram:my-channel",
    "tipster": "SharpMike",
    "homeTeam": "Arsenal",
    "awayTeam": "Chelsea",
    "league": "Premier League",
    "kickoff": "2026-08-15T16:30:00Z",
    "market": "OU25",
    "selection": "over",
    "odds": 1.85,
    "result": "won"
  }
]
```

- `market`: one of `1X2`, `OU25`, `BTTS`, `DC`.
- `selection`: `home|draw|away` (1X2), `over|under` (OU25), `yes|no` (BTTS), `1x|12|x2` (DC).
- `result`: `won|lost|void` for settled tips; **omit** for upcoming (pending) tips.
- Every file in `*.json` here is merged into the pipeline automatically.

## The scalable way: a source adapter

For live/automated ingestion, add an adapter next to
`src/lib/aggregation/adapters/` (see `apiFootball.ts` for the pattern):
fetch → normalise → return `RawTip[]`. Then wire it in `../index.ts`.

Good sources: official data APIs, permitted RSS/feeds, the Telegram Bot API
(public channels), or opt-in tipster submissions. Do **not** scrape sites that
block it or forbid it in their terms.

## Pulling from prediction sites worldwide

Yes — the system can ingest from prediction sites, **through the channels they
allow**. Which adapter to use, best to worst:

| Source type | Adapter | OK? |
| --- | --- | --- |
| Official data/prediction **API** (API-Football, RapidAPI, provider feeds) | `apiFootball.ts` (pattern) | ✅ Clean |
| **RSS/Atom feed** a site publishes | `rss.ts` | ✅ Clean |
| **Telegram** public channel | `telegram.ts` | ✅ Clean |
| Opt-in / partnership / your own JSON | `src/data/tips/*.json` | ✅ Clean |
| **Scraping HTML** of a site that blocks/forbids it (blade, oddspedia, sportytrader…) | — | ❌ Don't |

Each adapter is off by default. To go live: open the adapter, set `ENABLED = true`,
add credentials/feeds, done — it merges into the pipeline automatically. For
automated refresh, run the pipeline from a Cloudflare Worker on a cron and store
results in D1 (see `PLAN.md`).
