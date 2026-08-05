# Connectable prediction sources (global)

> The engine already ranks every connected source by **realised ROI** and only
> lets high-ROI ones into the verified picks. The job is connecting *real*
> sources we're allowed to use. You can't legally "vacuum every high-ROI tipster
> on earth" — the good human tipsters are a paid product. Here's what's real.

## Verdict table

| Source | What it gives | Access | Redistribution / ToS | Connect? |
| --- | --- | --- | --- | --- |
| **API-Football** (predictions + fixtures + **results**) | Model predictions + results for auto-settlement | Official API, free tier + paid | Power a product; don't resell raw | ✅ Best first — also settles our ROI |
| **Betminer** (RapidAPI) | Algo predictions, 1,216 competitions | RapidAPI key, paid tiers | Use in products; can't resell raw responses | ✅ |
| **Boggio Football Prediction API** (RapidAPI) | Algo predictions (JSON) | RapidAPI key, subscription | Standard SaaS | ✅ |
| **Sports Betting Predictions** (RapidAPI) | "85%+" claims, multi-sport | RapidAPI key | Standard SaaS | ⚠️ Connect but verify claims with our own tracking |
| **Tipstrr** (owns **Pyckio**) | **Real verified human tipsters + ROI** | Subscription marketplace, no open pull API | Picks are their paid product — no free ingest/redistribution | ❌ Ingest — partner/subscribe only |
| **OLBG** | Human tipster ROI + leaderboards | Website only, no public API | Scraping forbidden | ❌ |
| **blade / oddspedia / sportytrader** | Tips/odds | — | Block + forbid scraping | ❌ |

## The honest strategy for "high-ROI tipsters"

1. **Connect the model APIs** (API-Football + Betminer + Boggio) as tipsters. They're
   legal, global, and cheap. Our engine tracks each one's ROI and surfaces the winners.
2. **Auto-settle with results** (API-Football results endpoint) so ROI is *real*, not claimed.
3. **Recruit your own tipsters (opt-in)** — they post via Telegram / a form / JSON, and
   our engine verifies their ROI over time. This is how you legitimately build a stable of
   proven high-ROI tipsters you actually own.
4. For paid human platforms (Tipstrr), **subscribe/partner** only where redistribution is allowed.

## To connect (what I need)

- **API-Football:** a free API key → I wire the adapter (`apiFootball.ts`) + results settlement.
- **RapidAPI (Betminer/Boggio):** one RapidAPI key → I fill the mapping in `rapidApiPredictions.ts`.
- Then flip `ENABLED = true`, and for continuous refresh run the pipeline from a Cloudflare
  Worker (cron) → D1 (see `PLAN.md`).

## Sources

- [Tipstrr / Pyckio](https://tipstrr.com/) · [Tipster platforms compared](https://www.bettoredge.com/post/tipster-platforms-comparison)
- [API-Football predictions](https://www.api-football.com/news/post/predictions)
- [Betminer](https://betminer.co.uk/) · [Boggio Football Prediction API](https://boggio-analytics.com/fp-api/)
- [RapidAPI football prediction search](https://rapidapi.com/search/football+prediction)
