# Sports APIs με Free Tier — Έρευνα (Αύγουστος 2026)

Focus: **football + basketball**. Στόχος: πηγές **picks / odds / results** για το the site bot.
Στήλη "Σιγουριά": 🟢 = γνωστό/αξιόπιστο, 🟡 = νεότερο/να επιβεβαιωθεί στο signup.

> ⚠️ Τα free-tier όρια αλλάζουν — επιβεβαίωσέ τα στη σελίδα εγγραφής. Πάρε plan που επιτρέπει **display σε site** (όχι μόνο personal use).

---

## 🎯 PREDICTIONS / TIPS (δίνουν picks — το πιο πολύτιμο για διασταύρωση)

| API | Sport | Free tier | Key; | Link | Σιγ. |
|---|---|---|---|---|---|
| **API-Sports** (έχεις ✅) | ⚽🏀 | 100/μέρα ανά sport | ναι | https://dashboard.api-football.com | 🟢 |
| **Sportmonks Predictions** | ⚽ | free 2 πρωταθλήματα (global = paid) | ναι | https://www.sportmonks.com/football-api/football-predictions-api/ | 🟢 |
| **BSD / Bzzoiro** | ⚽ | ML predictions + odds, 30+ leagues, no card | ναι | https://sports.bzzoiro.com/free-football-api/ | 🟡 |
| **Highlightly** | 🏀 | 100/μέρα, predictions+odds, no card, 340+ leagues (NBA/EuroLeague) | ναι | https://highlightly.net/basketball-api/ | 🟡 |
| **NullBall** | ⚽ | free tier + MCP | ναι | https://nullball.xyz/ | 🟡 |
| **GameForecastAPI** | ⚽ | free tier (odds + AI predictions) | ναι | https://www.gameforecastapi.com/ | 🟡 |
| **Betminer** | ⚽ | free tier | ναι | https://betminer.co.uk/ | 🟡 |
| **OddAlerts** | ⚽ | free tier (value bets/predictions) | ναι | https://www.oddalerts.com/football-data-api | 🟡 |

## 💰 ODDS (value cross-check — validation, όχι "pick")

| API | Sport | Free tier | Key; | Link | Σιγ. |
|---|---|---|---|---|---|
| **The Odds API** ⭐ | ⚽🏀 | free plan, 40+ bookmakers, 70+ sports | ναι | https://the-odds-api.com/ | 🟢 |
| **SportsGameOdds** | ⚽🏀 | 10/λεπτό, 2.500 objects/μήνα, 85+ bookmakers | ναι | https://sportsgameodds.com/ | 🟡 |
| **Odds-API.io** | ⚽🏀 | free forever, 100/ώρα (500/μέρα), 2 bookmakers | ναι | https://odds-api.io/ | 🟡 |
| **OddsPapi** | ⚽🏀 | 250 req αλλά κάθε req = 350+ bookmakers, no card | ναι | https://oddspapi.io/ | 🟡 |

## 📅 FIXTURES / RESULTS / STATS (reference — settlement, cross-check αποτελεσμάτων)

| API | Sport | Free tier | Key; | Link | Σιγ. |
|---|---|---|---|---|---|
| **football-data.org** | ⚽ | 10/λεπτό, ευρωπαϊκά | ναι | https://www.football-data.org/ | 🟢 |
| **BALLDONTLIE** | 🏀 (+20 leagues) | free, no key, ~60/λεπτό, NBA από 1979 | όχι | https://www.balldontlie.io/ | 🟢 |
| **OpenLigaDB** | ⚽ | free, χωρίς key (γερμανικά κυρίως) | όχι | https://www.openligadb.de/ | 🟢 |
| **TheSportsDB** | ⚽🏀+ | free non-commercial· $9/μήνα full | test key | https://www.thesportsdb.com/ | 🟢 |
| **Entity Sports** | ⚽🏀+ | 100/μέρα dev sandbox (historical) | ναι | https://www.entitysport.com/ | 🟡 |
| **iSports API** | ⚽🏀 | free trial, Asia focus + odds | ναι | https://www.isportsapi.com/ | 🟡 |
| **SportsData.io** | 🏀 NBA | free tier (last season) | ναι | https://sportsdata.io/ | 🟢 |

---

## Προτεινόμενη σειρά να πάρεις (για το bot)

**Άμεσα (δωρεάν, high value):**
1. **The Odds API** — odds fb+basket → value cross-check. https://the-odds-api.com/
2. **Highlightly** — basketball predictions+odds (καλύπτει το κενό basket tips). https://highlightly.net/basketball-api/
3. **BSD/Bzzoiro** — football ML predictions + odds, χωρίς κάρτα. https://sports.bzzoiro.com/free-football-api/

**Δοκίμασε (football prediction APIs = ανεξάρτητες πηγές picks για διασταύρωση):**
4. NullBall, GameForecastAPI, Betminer, OddAlerts — πάρε δωρεάν key, δες ποιο δίνει καθαρά structured picks.

**Reference (settlement/coverage):**
5. football-data.org (⚽), BALLDONTLIE (🏀, no key).

## Γιατί αυτά ξεκλειδώνουν το bot
Κάθε **prediction API** = μία ανεξάρτητη πηγή picks → όταν έχεις **≥2** που συμφωνούν σε ένα ματς → βγαίνει **published pick**. Τα **odds APIs** επιβεβαιώνουν value. Τα **reference APIs** κάνουν settle τα αποτελέσματα.

## Έντιμη σημείωση
Τα 🟡 (BSD, Highlightly, NullBall, GameForecastAPI, Betminer, OddAlerts, Entity, iSports) δεν τα έχω δοκιμάσει σε βάθος — επιβεβαίωσε στο signup: (α) όντως δωρεάν, (β) δίνει structured picks/odds (όχι μόνο HTML), (γ) επιτρέπει display. Τα 🟢 είναι δοκιμασμένα/γνωστά.

---

## Round 2 — κι άλλα prediction / odds APIs

| API | Sport | Δίνει | Free; | Link |
|---|---|---|---|---|
| **1x2.ai** | ⚽ | AI predictions 1X2/BTTS/O-U, 180+ leagues | free members + dev tier | https://www.1x2.ai/ |
| **Foresportia** | ⚽ | JSON: 1X2/DC/DNB/O-U/BTTS/scores/confidence, 44 leagues | beta | https://www.foresportia.com/en/api.html |
| **FootyStats** | ⚽ | JSON: O/U, BTTS, corners, cards, goals | freemium | https://footystats.org/api/ |
| **Boggio Analytics** | ⚽ | prediction API | freemium | https://boggio-analytics.com/fp-api/ |
| **TheStatsAPI** | ⚽ | odds + stats + xG (1X2/AH/O-U/BTTS/DNB) | freemium | https://www.thestatsapi.com/ |
| **Goalserve** | ⚽🏀 | odds + livescore, JSON/XML | free trial | https://www.goalserve.com/ |
| **iSports API** | ⚽🏀 | 2000+ ⚽ / 800+ 🏀 leagues + odds | free trial | https://www.isportsapi.com/ |

## Env vars (μπήκαν στο .env — γέμισε όσα πάρεις)
Predictions: `SPORTMONKS_API_KEY, BZZOIRO_API_KEY, HIGHLIGHTLY_API_KEY, NULLBALL_API_KEY, GAMEFORECAST_API_KEY, BETMINER_API_KEY, ODDALERTS_API_KEY, ONE_X_TWO_AI_KEY, FORESPORTIA_API_KEY, FOOTYSTATS_API_KEY, BOGGIO_API_KEY, THESTATSAPI_KEY`
Odds: `THE_ODDS_API_KEY, SPORTSGAMEODDS_API_KEY, ODDS_API_IO_KEY, ODDSPAPI_KEY, GOALSERVE_API_KEY`
Reference: `FOOTBALL_DATA_ORG_KEY, BALLDONTLIE_API_KEY, THESPORTSDB_KEY, ENTITYSPORT_API_KEY, ISPORTS_API_KEY, SPORTSDATA_IO_KEY`
LLM: `OPENAI_API_KEY`
