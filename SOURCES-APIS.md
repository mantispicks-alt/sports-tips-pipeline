# Connectable + good tips = structured prediction APIs (football + basketball)

The live RSS test proved free feeds are connectable but **not good** (articles/spam, 0 structured tips).
The real intersection of **connectable AND good** is structured APIs. Two honest caveats:

1. **"Accuracy" claims are marketing, NOT independently audited** (87%, 78%, "85%+" — none verified).
2. So **"good" is decided by OUR engine**, not their promise: connect → engine tracks real ROI → only
   the ones that actually win get `verified` and published. That's your model.

## Football — prediction APIs

| API | Free tier | Gives | Accuracy claim (⚠️ unaudited) | Where |
|--|--|--|--|--|
| **API-Football** (api-sports) | ✅ 100 req/day | predictions **+ results** (settlement) | — | dashboard.api-football.com |
| **Boggio Football Prediction** (RapidAPI) | ✅ | predictions JSON | — | rapidapi.com |
| **Betminer** (RapidAPI) | ⚠️ freemium | predictions, 1,216 comps | — | rapidapi.com |
| **Sports Betting Predictions** (RapidAPI) | ⚠️ | multi-sport picks | "85%+" | rapidapi.com |
| **Sportmonks** | ⚠️ trial | probability/predictions API | — | sportmonks.com |
| **FootballPredictAI** | ⚠️ check | model predictions | 87% (7-day, 6 comps) | footballpredictai.com |
| **Tiki Taka** (tikitaka.gg) | ⚠️ check | 1X2 predictions, 45+ leagues | 78% 1X2 | tikitaka.gg |

## Basketball — mostly DATA APIs → feed OUR model (like our Poisson for football)

| API | Free tier | Gives | Where |
|--|--|--|--|
| **BALLDONTLIE** | ✅ free | NBA stats + odds (no predictions) | balldontlie.io |
| **API-Basketball** (api-sports) | ✅ | stats + odds (same key as API-Football) | api-basketball.com |
| **The Odds API** | ✅ 500/mo | NBA odds | the-odds-api.com |
| **Sports Betting Predictions** (RapidAPI) | ⚠️ | claims basketball picks | rapidapi.com |

> Pure basketball *prediction* APIs are rare — better to pull **basketball stats** (BALLDONTLIE / API-Basketball)
> and generate picks with our own model (extend `poisson.ts` for basketball totals/spreads), same as football.

## The honest count of "connectable + good"

- Football: **~7 prediction APIs** (2-3 with free tier).
- Basketball: **~4 data APIs** → our own model (few real prediction APIs).
- **Not 200. ~10 real ones — and "good" is proven by our ROI engine, not their claims.**

## Best free path for football + basketball (one signup covers both sports)

1. **api-sports** → dashboard.api-football.com → free key → **API-Football + API-Basketball**.
2. (Football extra) **Boggio** free tier on RapidAPI = a 2nd football "tipster".
3. (Basketball) **BALLDONTLIE** free = stats → our model.
4. Engine tracks each one's real ROI → only winners get published.

Adapters ready: `apiFootball.ts`, `rapidApiPredictions.ts`. Add key → I wire + fill mapping.

## Newly audited API options (August 2026)

These are **data/model signals**, not human tipsters.  They can make the consensus
engine much stronger without scraping third-party publishing sites.  A source is
never promoted to the live site simply because it has an API: its predictions are
first settled and scored by our own engine.

| Provider | Sport / signal | Free access | Production status |
|--|--|--|--|
| KiqIQ | Football 1X2 probabilities + xG | Public, no key; rate-limited | Connect now; live-predictions only |
| BetGiant | Football predictions, fixtures, live odds | 100 req/day | Connect now; use its supplied key |
| API-Sports | Football + basketball fixtures, stats, odds | 100 req/day per API | Connect now; never resell raw data |
| SportScore | Football + basketball scores, stats, standings | Free forever with attribution | Connect now after attribution is added |
| SportsDataAPI | Football + basketball fixtures, odds, stats | Free plan documented | Test; confirm display licence before production |
| FieldFunded | Football + basketball, odds + settlement | Free tier documented | Test; confirm display licence before production |
| Big Balls Sports Data | Major football leagues + NBA/NCAAB | 1,000 req/day free | Test; confirm display licence before production |
| Broadage | Football + basketball data | Free signup offered | Test; confirm licence and coverage |
| football-data.org | Football fixtures/results/standings | Free, 10 req/min registered | Use as a non-prediction fixture/result cross-check |
| UK Odds API | Football odds | 300 req/month evaluation tier | Test only; paid tier for production |
| odds-api.net | Odds and event data | Plan-dependent | Commercial website use stated; obtain correct plan |
| The Odds API | NBA odds on free tier | 25 req/day | NBA cross-check only on free plan |
| SportsDataIO | NBA/NCAAB historical data | Free exploration tier | Training/backtest, not live global football |

### What this unlocks

1. Use fixtures/results from **two independent providers** so a postponed or
   misnamed match never settles a tip incorrectly.
2. Treat probabilities (KiqIQ, BetGiant, API-Football/RapidAPI models) as
   independent virtual tipsters, each with its own ROI history.
3. Compare bookmaker odds from multiple providers before publishing a value
   flag; cache all responses and stay below every source's request quota.
4. Let human tipsters enter through opt-in Telegram/form feeds.  This is the
   only scalable, no-scraping route to independent human picks.

---

## Verdict on the user's 30-site list (connectability, tested)

| Site | Category | Connect? | Why |
|--|--|--|--|
| **FootyStats** | Data/AI | ✅ **API** (trial→$36/mo) | Official JSON API: O/U, BTTS, results, 200 leagues. **Best from the list.** |
| **Eagle Predict** | Data/AI | ✅ **Done** | Already pulled 11 real tips into the DB |
| Sports Mole | Community | ⚠️ LLM/article | Picks buried in individual preview articles |
| SportsGambler | Community | ⚠️ LLM/page | Per-page extraction |
| Dimers | Data/AI | ⚠️ LLM/subpage | Free picks on sport subpages |
| Understat | Data/AI | ⚠️ gray | xG data, no official API (community scrape) → feed OUR model |
| FBref | Data/AI | ⚠️ gray | Stats, no official API, ToS limits bulk → feed OUR model |
| Betstamp | Data/AI | ⚠️ limited | Odds + verified-bettor tracking, no open pick feed |
| Betting Gods | Marketplace | ❌ paywall | Verified picks = paid product |
| Bet2Invest | Marketplace | ❌ paywall | " |
| Smart Betting Club | Marketplace | ❌ paywall | Reviews/proofing service, paid |
| Tipster Empire | Marketplace | ❌ paywall | " |
| BetFan | Marketplace | ❌ paywall | " |
| PuntHub | Marketplace | ❌ paywall | " |
| BetInfo24 | Marketplace | ❌ paywall | Blog RSS = articles only |
| SportyTrader | Community | ❌ blocked | 403, no API |
| PredictZ | Community | ❌ blocked | Blocks scraping, no API |
| Forebet | Data/AI | ❌ blocked | 403, no API |
| Football Whispers | Community | ⚠️ blog RSS | Articles, low yield |
| Mr Fixits Tips | Community | ⚠️ blog RSS | Articles, low yield |
| Overlyzer | Data/AI | ❌ paid | Subscription |
| Xvalue.ai | Data/AI | ❌ paid | Subscription AI |
| Rithmm | Data/AI | ❌ paid | Subscription AI app |
| RebelBetting | Tool | ❌ paid | Arb/value tool, odds not tips |
| Oddsportal | Tool | ❌ blocked | Blocks hard, odds not tips |
| WinnerOdds | Tool | ❌ paid | Value service |

**Tally of the 30:** ✅ **2 connect cleanly** (FootyStats API, Eagle Predict done) · ⚠️ ~6 need LLM/gray-scraping · ❌ ~22 paywall or blocked.
**Winner: FootyStats API** — structured football data + predictions + results, free trial. Get a trial key → wire it.
