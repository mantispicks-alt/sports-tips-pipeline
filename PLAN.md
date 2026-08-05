# the site — Business & Build Plan

> Στοχος: affiliate betting/casino tips site, διεθνες (EN, .com), εσοδα **5.000–10.000€/μηνα**.
> Ρεαλιστικο timeline: **6–18 μηνες** σταθερης δουλειας. Το site ειναι το 20% — traffic + trust + κοινοτητα ειναι το 80%.

---

## 1. Τι εχει ηδη χτιστει (αυτο το repo)

Astro + Tailwind + Cloudflare, ολο static (κορυφαιο SEO/ταχυτητα). **38 σελιδες.** Features:
- Homepage (hero με **πραγματικα computed stats**, offers ticker, top tips, model strip, **results snapshot + profit curve**, bonuses, news, newsletter, Telegram CTA)
- `/tips` λιστα + φιλτρο, `/tips/<match>` = **Poisson model (1X2/O-U/BTTS/correct-score probabilities + value badge)** + **odds comparison table** (best highlighted) + author byline
- `/offers` = comparison toplist table + geo note + offer cards (η "σελιδα λεφτων")
- `/bookmakers` + `/bookmakers/<name>` full reviews (rating, bonus, pros/cons, licence)
- `/results` = **transparency engine**: computed win rate, ROI, profit, monthly P/L, καθε settled tip
- `/methodology` = πως δουλευει το model (E-E-A-T)
- `/experts` + `/experts/<name>` = author profiles με credentials (E-E-A-T, YMYL)
- `/news` + 7 αρθρα (SEO μηχανη, internal linking)
- Legal: about, responsible-gambling, privacy, terms
- sitemap.xml, robots.txt, JSON-LD, OG tags, 404

**Differentiators vs blade:** πραγματικη μαθηματικη μηχανη (Poisson `src/lib/poisson.ts`), διαφανη tracked results (`src/lib/results.ts`), odds comparison, named experts, **tip aggregation + verification system**. Οχι "hunches".

### Tip Aggregation System (`/verified-tips` + `/tipsters`, `src/lib/aggregation/`)
Μαζευει public tips απο πολλους tipsters → σκοραρει **reliability** καθε tipster (Wilson win-rate + ROI-shrinkage rating, tiers) → βγαζει **consensus picks** μονο οπου συμφωνουν οι καλυτεροι → **backtest out-of-sample** (train/test split, honest) αποδεικνυει το hit rate.
- **Source-agnostic adapters** (`adapters/`): mock (demo), JSON import (`src/data/raw-tips.json` — ToS-safe manual/opt-in), API-Football stub.
- ⚠️ **Sourcing/νομικα:** τα top sites μπλοκαρουν scraping + το απαγορευουν (ToS/copyright). Καθαροι δρομοι: official APIs, permitted feeds, Telegram Bot API (public), opt-in submissions, partnerships. **Οχι** scraper για site που μπλοκαρει.
- **Live path:** τωρα τρεχει σε build-time σε synthetic data (demo banner). Για live: Cloudflare **Worker (cron) → D1** ingestion/settlement, το site διαβαζει απο D1. Το ιδιο TS engine, χωρις αλλαγη λογικης.

Περιεχομενο = markdown στο `src/content/` (tips, bookmakers, articles, authors). Προσθηκη = 1 αρχειο.
⚠️ Newsletter form + affiliate `affiliateUrl` ειναι placeholders — wire σε provider (Brevo/Resend) + βαλε πραγματικα tracked links.

---

## 2. Μηνιαια κοστη (ρεαλιστικα)

| Στοιχειο | Κοστος | Σημειωση |
|---|---|---|
| Domain .com | ~12€/χρονο | Namecheap/Cloudflare |
| Hosting (Cloudflare Pages) | **0€** | Static, δωρεαν tier αρκει για χρονια |
| Sports data API (API-Football) | 0–30€/μηνα | Free tier στην αρχη, pro οταν σκαλωσεις |
| Email/newsletter (Resend/Brevo) | 0–20€/μηνα | Free tier ~3k emails |
| Analytics (Plausible/GA4) | 0–9€/μηνα | GA4 δωρεαν |
| Design assets (logo, εικονες) | 0–50€ εφαπαξ | ή το φτιαχνουμε εδω |
| **Συνολο startup** | **~30–80€/μηνα** | Πολυ χαμηλο ρισκο |

Προαιρετικα αργοτερα: paid backlinks/PR, ads για boost, VA για content.

---

## 3. Affiliate — απο που ερχονται τα λεφτα

Μοντελα πληρωμης:
- **CPA**: εφαπαξ 50–250€ ανα παικτη που καταθετει (FTD). Διεθνες: συχνα 100–200€.
- **Revshare**: 25–45% των **καθαρων απωλειων** των παικτων σου, **εφ' ορου ζωης**.
- **Hybrid**: μικρο CPA + μικρο revshare (το καλυτερο μακροπροθεσμα).

### Affiliate networks/programs να γραφτεις (διεθνες):
- **Betway Partners, Kindred Affiliates (Unibet), bet365 Affiliates, LeoVegas, 888 Affiliates, Betsson Group**
- Networks: **Income Access, MyAffiliates, NetRefer** (πολλα brands μαζι)
- Casino: **AskGamblers / Casino affiliate programs, Videoslots, LeoVegas Casino**

> ⚠️ Καθε bookmaker στο `src/content/bookmakers/` εχει placeholder `affiliateUrl` (example.com). Βαλε τα **πραγματικα tracked links** αφου εγκριθεις. Και **μονο licensed operators** για την αγορα-στοχο.

### Checklist εγγραφης:
- [ ] Στησε site + 15+ αρθρα (τα programs θελουν να δουν ενεργο site πριν εγκρινουν)
- [ ] Γραψου σε 3–5 affiliate programs
- [ ] Παρε tracked links + banners
- [ ] Αντικατεστησε τα placeholder `affiliateUrl`
- [ ] Setup click tracking (ποιο link → ποσα clicks)

---

## 4. Compliance (MUST — αλλιως μπλοκο/προστιμα)

- **Μονο licensed operators** για καθε αγορα. (Ελλαδα = ΕΕΕΠ. UK = UKGC. Malta = MGA.)
- **18+/21+** + responsible gambling disclaimer σε καθε προσφορα (ηδη μπαινει παντου).
- Links προς bookmaker: `rel="sponsored nofollow"` (ηδη μπαινει).
- GDPR: cookie consent + πραγματικη privacy policy (τωρα placeholder — θελει δικηγορο).
- Οχι στοχευση ανηλικων, οχι υπερβολικες υποσχεσεις κερδων.

---

## 5. SEO / Content — η μηχανη traffic

Το organic traffic = 80% της επιτυχιας. Στοχευσε **buyer-intent keywords**:
- "[bookmaker] review", "[bookmaker] bonus code", "best free bets 2026"
- "[match] prediction", "[league] tips today", "how to bet on X"

Ρυθμος: **2–3 αρθρα/βδομαδα** + καθημερινα tips. Σε 6 μηνες = 80–120 σελιδες = Google σε παιρνει σοβαρα.

3 τυποι σελιδων:
1. **Money pages** (bookmaker reviews, offers) → conversion
2. **Traffic pages** (guides, previews, "prediction") → organic
3. **Trust pages** (results tracking) → πειθω

---

## 6. Funnel — πως γινεται το click → λεφτα

```
SEO αρθρο / tip  →  Telegram (free)  →  καθημερινα tips + offers  →  affiliate εγγραφη
                 →  Newsletter        →  επαναλαμβανομενο touch
```
Το Telegram ειναι το κλειδι (οπως το blade): χτιζεις κοινοτητα, ξαναπουλας στους ιδιους. 1000 loyal > 50.000 τυχαιοι.

---

## 7. Revenue math (πως φτανεις 7.500€/μηνα)

- **CPA @120€** → ~60 FTD/μηνα. Απο ~30–60 clicks/FTD → χρειαζεσαι δυνατο traffic ή engaged Telegram.
- **Revshare** → ~200 ενεργοι παικτες × 150€ καθαρη απωλεια × 35% = 10.500€/μηνα (χτιζεται σε 1+ χρονο, μετα ειναι σχεδον παθητικο).
- Ρεαλιστικα: **hybrid** — CPA για cashflow τωρα, revshare για το compounding.

Milestones:
- Μηνας 1–2: site live, 20 αρθρα, 3 affiliate approvals, πρωτα clicks
- Μηνας 3–4: 1.000+ επισκεπτες/μηνα, πρωτες εγγραφες, ~200–800€
- Μηνας 6: 5.000+/μηνα, Telegram 500+, ~1.000–2.500€
- Μηνας 12: 20k+/μηνα, revshare base χτιζεται, **στοχος 5.000€+**

---

## 8. Roadmap

**Φαση 1 (τωρα → βδ 4):** brand/domain, deploy Cloudflare, 15–20 αρθρα, affiliate εγγραφες, analytics.
**Φαση 2 (μηνας 2–3):** API-Football integration (auto fixtures/live scores), Telegram bot (auto-post tips), 30+ αρθρα.
**Φαση 3 (μηνας 3–6):** content μηχανη full throttle, backlinks/social, results tracking automation.
**Φαση 4 (6+):** VIP/subscription (Stripe), mobile app (optional), scale + β' αγορα.

---

## 9. Επομενα βηματα (immediate)

1. **Ονομα + domain** — να μεινει "the site" ή αλλο; (αλλαζει σε `src/config.ts`)
2. **Deploy** — ξανασυνδεσε Cloudflare connector → push σε Cloudflare Pages
3. **Affiliate** — διαλεξε 3–5 programs, γραψου
4. **Content** — 15 αρθρα seed (μπορω να τα γραψω)
5. **Data API** — API-Football key για live fixtures/scores
6. **Telegram** — φτιαξε καναλι + bot

> Πες μου ποιο θες πρωτο και το κανουμε.
