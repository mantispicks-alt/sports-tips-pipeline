# Tipster sources — deep research (200+)

Your model: **ingest into the DB → engine verifies which win → only proven winners get published.**
That's sound. But *how you acquire* still matters. Legend:

- ✅ **RSS** — site publishes a feed → lawful to ingest via `rss.ts` (no key). **Connect now.**
- 🔑 **API** — structured API, needs a key. Connect now.
- 🔧 **No native feed** — would need a feed-generator/middleman or scraping → skip unless they add a feed.
- 💰 **Platform** — many tipsters, some free daily, but picks are their product → **ingest = ToS/partnership only**, list for awareness.
- ❌ **Blocked** — blocks + forbids scraping. Do not ingest.

> ⚠️ **LIVE TEST RESULT (2026):** 20 football feeds → 13 reachable, 145 items, **0 structured tips parsed.**
> The feeds are match previews/news (the actual pick is buried in the article body), or casino spam, or
> foreign-language. **Free RSS ≠ auto tips.** For structured **football + basketball** tips use the **APIs**
> (API-Football + API-Basketball, one api-sports key) or an LLM article-extractor. The RSS adapter is left OFF.

> Reality: ~**146 are ✅ RSS you can wire today** (71 football/soccer + 57 general/sports betting + 17 horse racing + 1), plus 4 APIs. The big multi-tipster platforms (Tipstrr, OLBG, Blogabet…) are 💰 — you can't legally vacuum them. Quality varies wildly, but that's fine: the engine tracks each source's real ROI (needs a **results feed**, e.g. API-Football, to settle) and only surfaces winners.

---

## A. ✅ Connect now — RSS feeds (no key)

| # | Site | RSS feed |
|--|--|--|
| 1 | Confirm Bets | blog.confirmbets.com/index.php/feed/ |
| 2 | Soccer Platform | soccerplatform.me/feed/ |
| 3 | Matchplug | matchplug.com/blog/feed/ |
| 4 | Mighty Tips | mightytips.com/feed/ |
| 5 | Suregametoday | suregametoday.com/feeds/posts/default |
| 6 | Betgenuine | betgenuine.com/blog/feed/ |
| 7 | BetaGamers | betagamers.net/blog/feed/ |
| 8 | BrokerStorm | brokerstorm.com/feed/ |
| 9 | Betgaranteed | betgaranteed.com/blog/feed/ |
| 10 | Solid Win | solidwin.blogspot.com/feeds/posts/default |
| 11 | SoccerPunt | soccerpunt.com/feed/ |
| 12 | SoccerDino | soccerdino.com/news-feed |
| 13 | Merit Predict | meritpredict.com/blog/feed/ |
| 14 | Betwizad | betwizad.com/blog/feed/ |
| 15 | Football Whispers | footballwhispers.com/feed/ |
| 16 | BetMGM Soccer | sports.betmgm.com/en/blog/sport/soccer/feed/ |
| 17 | Kings Predict | kingspredict.com/blog/feed/ |
| 18 | 7bet | 7bet.co.uk/blog/feed/ |
| 19 | Action Network (Soccer) | actionnetwork.com/soccer/feed |
| 20 | PerformanceOdds | performanceodds.com/feed/ |
| 21 | Cappers Picks | capperspicks.com/feed/ |
| 22 | Solidpredict | solidpredict.com/blog/feed/ |
| 23 | Sport X Tipster | sportxtipster.com/blog/feed/ |
| 24 | FootballTipster.net | footballtipster.net/blog/feed/ |
| 25 | Betfair (Football) | betting.betfair.com/football/index.xml |
| 26 | Bet Gurus | betgurushome.com/feed |
| 27 | 20Bet (Soccer) | blog.20bet.com/news/soccer/feed |
| 28 | Main-Bet | main-bet.com/rss.xml |
| 29 | Nowscore | nowscore.co/feed/ |
| 30 | Soccerpet | blog.soccerpet.com/index.php/feed/ |
| 31 | PPsoccer | ppsoccer.com/feed/ |
| 32 | LeagueLane | leaguelane.com/category/articles/feed/ |
| 33 | Smart Betting Stats | smartbettingstats.com/smartbetting/feed/ |
| 34 | Soccer Prediction (io) | soccerprediction.io/feed/ |
| 35 | The Sports Geek | thesportsgeek.com/feed/ |
| 36 | Paddy Power (Football) | news.paddypower.com/football/feed/ |
| 37 | SBD (College FB) | sportsbettingdime.com/news/college-football/feed/ |
| 38 | MrFixitsTips | mrfixitstips.co.uk/feed/ |
| 39 | Solution Tipster | solutiontipster.com/feed/ |
| 40 | Colossus Bets | colossusbets.com/blog/feed/ |
| 41 | The Footy Tipster | thefootytipster.com/feed/ |
| 42 | Thatsagoal | thatsagoal.com/feed |
| 43 | Punter2Pro (Football) | punter2pro.com/category/general-miscellaneous/football/feed/ |
| 44 | Before You Bet | beforeyoubet.com.au/taxonomy/term/13/all/feed |
| 45 | Check Down Sports | checkdownsports.net/category/ncaafb/feed/ |
| 46 | Soccerbase | soccerbase.com/rss/blogfeed.sd?blogger=billy-bunter |
| 47 | VSiN | vsin.com/feed/ |
| 48 | Cole's Gameday | gamedaycole.com/feed/ |
| 49 | BetMGM (NFL) | sports.betmgm.com/en/blog/league/nfl/feed/ |
| 50 | William Hill (Football) | news.williamhill.com/football/feed/ |
| 51 | clubgowi | clubgowi.com/rss.xml |
| 52 | Soccerwidow | soccerwidow.com/category/football-gambling/feed/ |
| 53 | Football Gambler | footballgambler.co.uk/feed/ |
| 54 | Bet Experts (Football) | bet-experts.com/picks/football/feed |
| 55 | Oddsmagnet | blog.oddsmagnet.com/feed/ |
| 56 | Tips180 | tips180.com/blog/feed/ |
| 57 | Sporting Life | sportinglife.com/feed |
| 58 | National Football Post | nationalfootballpost.com/feed/ |
| 59 | FootballPredictions.com | footballpredictions.com/news/feed/ |
| 60 | ESPN FC (Betting) | espnfc.com/blog/betting-blog/102/rss |
| 61 | G-Bets (Soccer) | blog.gbets.co.za/category/soccer/feed/ |
| 62 | Aus Sports Betting | aussportsbetting.com/category/football/feed/ |
| 63 | The Bad Man Tipster | badmantipster.com/feed/ |
| 64 | Baste Sportive | baste-sportive.com/feed/ |
| 65 | Betting Tools | bettingtools.co.uk/blog/category/football/feed/ |
| 66 | Betinfo24 | betinfo24.co.uk/category/football-tips/feed/ |
| 67 | 188BET (Football) | blog.188bet.co.uk/category/sports/football/feed/ |
| 68 | WhaleBets | whalebets.com/feed/ |
| 69 | Matchbook Insights | insights.matchbook.com/category/betting-previews/football-tips/feed |
| 70 | Betway Insider | blog.betway.com/football/feed |
| 71 | talkSPORT (Football) | talksport.com/topic/football-betting/feed |

### A2. ✅ More RSS — general/sports betting & tipster feeds

Betfair (main) `betting.betfair.com/index.xml` · Odds Shark `oddsshark.com/rss.xml` ·
Betting Gods `bettinggods.com/feed/` · OddsMonkey `oddsmonkey.com/blog/feed/` ·
Sports Betting Dime `sportsbettingdime.com/feed/` · Betfair Cricket `betting.betfair.com/cricket/index.xml` ·
CapperTek `cappertek.com/rss.xml` · Punter2Pro (main) `punter2pro.com/feed/` ·
Smart Sports Trader `smartsportstrader.com/feed/` · Green All Over `green-all-over.blogspot.com/feeds/posts/default?alt=rss` ·
Wannamakeabet `blog.wannamakeabet.com/feed/` · Bettingsports `bettingsports.com/feed` ·
NetBet `netbet.co.uk/blog/feed/` · Xbet `xbet.ag/feed/` · Elite Sports NY `elitesportsny.com/feed/` ·
ATS.io `ats.io/feed/` · NY Post SB `nypost.com/tag/sports-betting/feed/` ·
Boss of Betting `bossofbetting.com/feed` · Remix Sports `remixsportsmedia.com/blog-feed.xml` ·
Sports Gambling Podcast `sportsgamblingpodcast.com/feed/` · DraftKings Network `dknetwork.draftkings.com/feed/` ·
Bodog `bodog.com/feed.xml` · Fast Break Bets `fastbreakbets.com/feed/` · Team Profit `teamprofit.com/matched-betting-blog/feed` ·
100PercentWinningTips `100percentwinningtips.com/feed` · Rescuebet `rescuebet.blog/feed/` ·
Alphasports Tech `alphasportstech.com/insights/feed/` · Sports Insights `sportsinsights.com/feed` ·
The Sure Bettor `thesurebettor.com/blog/feed/` · BET BLOG `betblog.com/previews/rss` ·
Advantaged Life `advantagedlife.co.uk/feed/` · JustBetting `justbetting.com.au/feed/` ·
Daily25 `daily25.com/feed/` · The Arb Academy `thearbacademy.com/feed/` ·
Profit Sports Betting `profitsportsbetting.com/feed/` · Best Sports Betting `bestsportsbetting.co.za/feed/` ·
NY Bet `ny.bet/feed/` · Betway Blog `blog.betway.com/rss` · MatchedBets `matchedbets.com/blog/feed/` ·
Odd$mith `oddsmith.net/blog/feed` · Sports Handle `sportshandle.com/feed/` · Betting Plus `bettingplus.net/feed/` ·
Betsperts `betsperts.com/feed/` · 888sport `blog.betbright.com/feed` · SportsGrid `sportsgrid.com/feed` ·
Betfred `blog.betfred.com/feed/` · Church of Betting `churchofbetting.com/feed/` · Superbetting `superbetting.com/news/feed/` ·
Mark Jarvis `guide.mjsports.bet/feed/` · Zensports `zensports.com/blog/feed/` · BetCraft `betcraft.co/feed` ·
The Bet Adviser `thebetadviser.co.uk/feed/` · Betting Boss `bettingboss.com/feed/` · Betting Blogger `bettingblogger.com/feed/` ·
Mansion `blog.mansion.com/feed/` · NYC Sports Nation `nycsportsnation.com/category/more-nyc/sports-betting/feed/` ·
Betensured `betensured.com/blog/feed/`
*(~57 — mix of tipster picks + matched-betting/news/podcasts. The pure-tips ones parse best.)*

### A3. ✅ More RSS — horse racing tipsters

Just Horse Racing `justhorseracing.com.au/feed` · US Racing News `usracing.com/feed` ·
Matched Betting (Racing) `matchedbettingblog.com/horse-racing/feed/` · Past The Wire `pastthewire.com/feed/` ·
Marten Julian `martenjulian.com/blogs/feed/` · Horse4course Racetips `horse4course-racetips.com/horse-racing-tips.xml` ·
Get Your Tips Out `getyourtipsout.co.uk/feed/` · The Race Advisor `raceadvisor.co.uk/blog/feed/` ·
JPW Racing Tipster `jpwracingtipster.com/feed/` · Mull It Over `mully1.wordpress.com/feed/` ·
Paddy Power (Racing) `news.paddypower.com/horse-racing/feed/` · Mansion (Racing) `mansionbet.com/blog/sports/horse-racing/feed/` ·
Horse Racing Scoop `horseracingscoop.com/blog/feed/` · Lady and The Track `ladyandthetrack.com/feed` ·
Geegeez `geegeez.co.uk/horse-racing-blog/` · Betfair (Racing) `betting.betfair.com/horse-racing/index.xml` ·
WinningPonies `feeds.feedburner.com/winningponies`
*(~17)*

## B. 🔧 Tips sites without a native feed (add a feed-gen, or skip)

Betensured · BETBLOG · AccuratePredict · Legitpredict · SoccerVital · Dailysports.net ·
Bethillszone · 1960Tips · TonyBet blog · RotoWire (Soccer) · Novibet blog · SoccerTipsters ·
MyBetOracle · KCPredict · Matchstat · Jeotips · TopFootballBettingSites · ODDSLOT ·
SoccerNews · Tournamentsoccer · Goals Guru · Pitch Invasion · Online Betting News
*(~23 — no reliable RSS; would need rss.app-style generation, and only where their terms allow.)*

## C. 💰 Tipster platforms — many tipsters, some free daily (partnership/ToS only)

| Platform | Note |
|--|--|
| OLBG | Free community tips, 22 sports — no public pull API, scraping forbidden |
| Tipstrr (owns Pyckio) | Verified premium tipsters + free daily email — paid product |
| Blogabet | Thousands of tipsters, free + premium — ToS-gated |
| ProTipster | Hundreds of free tips + verified leaderboard — no open ingest API |
| Tipsto | Hundreds of free picks daily — no open ingest API |
| Typersi | Free tips + tipster rankings — check terms |
| TIPR | Tipping marketplace — paid |
*(List for awareness. You can't legally ingest these wholesale — subscribe/partner if you want their data.)*

## C2. Regional free-daily sites (mostly Africa/Asia — high volume)

Victorspredict · DailyPredictz · KickPredictions · betting-tips.africa · StakeGains ·
EaglePredict · Vitibet · 9jabetking · Adibet · Dailysports
*(Check each for an RSS feed; where present → Group A treatment.)*

## D. 🔑 Prediction APIs (structured, need a key)

| API | Gives | Note |
|--|--|--|
| API-Football | Model predictions **+ results** | Free tier — **best first**, settles ROI |
| Betminer (RapidAPI) | Algo predictions, 1,216 comps | Paid tiers |
| Boggio Football Prediction (RapidAPI) | Algo predictions JSON | Free tier |
| Sports Betting Predictions (RapidAPI) | Multi-sport "85%" claims | Verify with our tracking |

## E. ❌ Do NOT scrape (block + forbid)

forebet.com · oddspedia.com · blade.bet · sportytrader.com · predictz.com · windrawwin.com
*(No lawful ingest. Oddspedia offers an official **odds** widget feed — odds only, not tips.)*

## F. 🌍 New international discovery candidates (research 2026)

These are useful pools for finding independent football and basketball tipsters. They are **not**
automatically approved as data feeds: add a source only through a public feed, an official API, an
opt-in agreement, or a commercial partnership. Each tipster must still pass the site's own tracked
sample and ROI rules.

| Platform | Coverage | Why it belongs in discovery | Ingest status |
|--|--|--|--|
| Tips.GG | Global football + basketball | Publishes multi-source ROI/odds/volume rankings | Partnership / verify terms |
| bettingexpert | Football + basketball | Community tipsters, yield/profit stats by competition | Partnership / verify terms |
| Tipstrr | Mainly football, growing multi-sport | Individual tipsters with transparent ROI, odds and pick volume | Paid platform / partnership |
| StakeHunters | Football + basketball | Tipster profiles with yield, profit and performance history | Partnership / verify terms |
| Tomodds | Multi-sport | Pick history, live odds, ROI and CLV metrics | Partnership / verify terms |
| The Tipster Edge | Football + basketball | Public automated settlement and sport-level stats | Ask for feed / permission |
| BetRollover | Football + basketball | Settled pick history, win rate and ROI per seller | Partnership / verify terms |
| TipTrust | Football + multi-sport | Verified-stat marketplace | Partnership / verify terms |
| Tipsters Lobby | Football + multi-sport | Tracks tipsters whose picks are distributed on Telegram | Partnership / verify terms |
| Only Tipsters | Multi-sport | Settled-record table includes market, odds and result | Partnership / verify terms |
| BetVize | Football + multi-sport | Immutable-pick claims and public ROI comparisons | Partnership / verify terms |
| Tipsterline | Multi-sport | Automatically calculated ROI, win rate and yield | Partnership / verify terms |
| Tipstimate | Italy / European football | Public ROI, win rate and full history | Partnership / verify terms |
| Tipsters.me | Brazil / football | Public immutable performance register | Partnership / verify terms |
| Tipsters League | France / multi-sport | Certified statistics and objective rankings | Partnership / verify terms |

### F1. Independent model cross-checks (not human tipsters)

KiqIQ · Sportmonks · footballdata.io · Beticious · AIBETTINGTIPS.
Use these only as separate statistical signals. They must never be presented as independent human
consensus, and they do not bypass the minimum-source / historical-performance filter.

---

## How to wire

1. Put any Group A feed URLs into the `FEEDS` array in `src/lib/aggregation/adapters/rss.ts`,
   set `ENABLED = true`. They flow into the DB/pipeline automatically.
2. Add an **API-Football** key so results settle → ROI becomes real → only winners get `verified`.
3. For continuous daily refresh, run the pipeline from a Cloudflare Worker (cron) → D1 (see `PLAN.md`).

**Honest caveat:** many RSS items are prose/previews, so auto-parse yield varies. Connect many, let
the engine's ROI filter do the sorting — garbage sinks, winners rise. That IS your model.
