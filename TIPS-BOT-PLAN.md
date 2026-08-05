# the site Tips Bot — Πλήρες Πλάνο (όλες οι πηγές)

Στόχος: αυτόματο bot που μαζεύει προγνωστικά από **APIs + Telegram + online sites**,
τα ενώνει στη Cloudflare **D1**, βαθμολογεί κάθε πηγή σε πραγματικά αποτελέσματα,
και δημοσιεύει **μόνο** picks που περνούν consensus/quality — χωρίς 429.

## Αρχιτεκτονική (3 λωρίδες → D1 → publish)

```
Lane 1  APIs (API-Sports, Odds)      ─┐
Lane 2  Telegram (opt-in/public)     ─┼──►  D1  ──►  settle + score + consensus  ──►  site
Lane 3  Online sites (scrape)        ─┘
```

- **Cloudflare Worker** = Lane 1 (APIs) + D1 gateway + publish (cron 30′). [έτοιμο]
- **Node ingestion service** (VPS / PC / GitHub Action cron) = Lane 2 + Lane 3 → γράφει στη D1.
  (Ο Worker δεν σηκώνει browser/Playwright — γι' αυτό τα sites τρέχουν σε Node.)
- **GPT (paid)** = extraction κειμένου από sites/telegram → **paid = μηδέν 429**.

---

## Το 429 — μια φορά ξεκάθαρα
Το 429 ΔΕΝ έρχεται από τα sites. Έρχεται από το **free LLM**. Λύσεις:
- **regex/selectors** (χωρίς LLM) → 0×429, αλλά 1 parser/site.
- **paid GPT** → 0×429 σε ό,τι κείμενο, με κόστος ανά χρήση.
- **APIs** → δεν χρειάζονται LLM καθόλου.

---

## PHASES — 1 προς 1

### Phase 0 — Foundation  [ΕΓΩ ✅ έτοιμο]
- D1 schema (`db/schema.sql`), Worker (`worker/`), multi-sport engine, settle/score/publish.

### Phase 1 — API lane (σταθερός κορμός)
1. **[ΕΣΥ]** Άνοιξε δωρεάν **API-Sports** account → πάρε key.
2. **[ΕΣΥ]** Reauth **Cloudflare** connector.
3. **[ΕΓΩ+ΕΣΥ]** commands:
   - `npm i -D wrangler`
   - `npx wrangler d1 create the-site` → βάλε το id στο `wrangler.jsonc`
   - `npx wrangler d1 execute the-site --file db/schema.sql`
   - `npx wrangler secret put API_SPORTS_KEY`
   - `npx wrangler deploy`
→ Bot live: fixtures/results/model predictions. **0×429.**

### Phase 2 — Telegram lane (independent, καθαρό)
1. **[ΕΣΥ]** Φτιάξε **dedicated** Telegram account (όχι προσωπικό — ban-risk).
2. **[ΕΣΥ]** Πάρε **api_id + api_hash** από my.telegram.org.
3. **[ΕΣΥ]** Τρέξε `telegram-login.mjs` μία φορά → session.
4. **[ΕΣΥ]** Δώσε λίστα channels (public ή opt-in).
5. **[ΕΓΩ]** `refresh-telegram.mjs`: reading (0×429) + **regex extract** (χωρίς LLM → 0×429) → D1.
→ Independent tipsters, 0×429, καθαρό ToS.

### Phase 3 — Online sites lane (αυτό που ζητάς)
1. **[ΕΣΥ]** Πάρε **OpenAI (GPT) paid key** — ψηλά όρια → 0×429 στο extraction.
2. **[ΕΓΩ]** Scraper service (Node):
   - static sites → απλό `fetch`
   - JS-heavy sites → **Playwright** (ανοίγει σαν άνθρωπος: real browser, JS, cookies, αργό rate)
   - extraction → **GPT (paid)** για ακατάστατο κείμενο, ή regex όπου γίνεται
   - γράφει στη D1 (μέσω Worker `/api/ingest`)
3. **[ΕΓΩ]** Cron (GitHub Action ή VPS) κάθε 30–60′.
→ Sites online, 0×429.
⚠️ **Έντιμα:** το GPT λύνει ΜΟΝΟ το 429. Μένουν: **ToS ρίσκο**, anti-bot μπλοκ, 1 parser/site, συντήρηση.

### Phase 4 — Publish rules  [ΕΓΩ]
- min **2 ανεξάρτητες** πηγές που συμφωνούν
- promotion source μόνο μετά **30 μέρες ή 100 settled**
- κόψιμο: post-kickoff, duplicates, αντιφατικά, deleted posts
- odds cross-check (The Odds API) για value
- **shadow mode**: νέες πηγές μαζεύουν αλλά δεν δημοσιεύουν μέχρι να αποδείξουν
→ `published_picks`.

### Phase 5 — Live  [auto]
- Bot 24/7: ingest → settle → score → publish μόνο verified.
- Site διαβάζει `published_picks`. Demo banner φεύγει όταν υπάρχει πραγματικό ιστορικό.

---

## Checklist keys/accounts (τι χρειάζεσαι)
- [ ] API-Sports key (δωρεάν) — Phase 1
- [ ] Cloudflare reauth + D1 — Phase 1
- [ ] Telegram dedicated account + api_id/api_hash — Phase 2
- [ ] OpenAI (GPT) paid key — Phase 3 (για sites, 0×429)
- [ ] (προαιρετικά) The Odds API key — Phase 4
- [ ] (προαιρετικά) μικρό VPS ή GitHub repo — για τον scraper cron

## Που τρέχει τι
| Κομμάτι | Που |
|---|---|
| APIs + D1 + publish | Cloudflare Worker (cron 30′) |
| Telegram + sites scraper | Node service (VPS / PC / GitHub Action) |
| GPT extraction | κλήση από τον Node scraper |

## Σειρά που προτείνω
**Phase 1 (API, σταθερό) → Phase 2 (Telegram, καθαρό) → Phase 3 (sites, με GPT).**
Έτσι έχεις λειτουργικό bot γρήγορα, και τα εύθραυστα sites μπαίνουν τελευταία.
