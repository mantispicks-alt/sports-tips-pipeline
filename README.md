# the site 🎯

Fast, SEO-first betting **predictions + bookmaker affiliate** site. Astro + Tailwind, deploys static to Cloudflare Pages.

See **[PLAN.md](./PLAN.md)** for the full business/monetization plan.

## Dev

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # -> dist/
npm run preview
```

## Rename the brand

Everything reads from **`src/config.ts`** — change `name`, `domain`, `telegram`, `minAge`, socials there.
Change the canonical domain in **`astro.config.mjs`** (`site:`) before deploying.

## Add content (no code)

Just drop a markdown file in the right folder:

- **Prediction** → `src/content/tips/<slug>.md`
  - Add `homeScored/homeConceded/awayScored/awayConceded/leagueAvg` to show the **Poisson model**.
  - Add an `oddsBoard` array to show the **odds comparison** table.
  - Set `result: won|lost|void` and it feeds the **/results** stats automatically.
- **Bookmaker/offer** → `src/content/bookmakers/<slug>.md` — ⚠️ set the real `affiliateUrl`
- **Article** → `src/content/articles/<slug>.md`
- **Expert** → `src/content/authors/<slug>.md` (referenced by `author:` in tips/articles)
- **Tracked tipster** (for `/verified-tips` + `/tipsters`) → drop a JSON file in
  `src/data/tips/*.json` — one per tipster/source. A tipster is added automatically once
  their tips are ingested (shows on the leaderboard at 10+ settled). See
  `src/data/tips/HOW-TO-ADD-TIPSTERS.md`.

Frontmatter fields are defined (and validated) in `src/content.config.ts`.

## Key logic

- `src/lib/poisson.ts` — expected-goals + Poisson model (1X2, O/U, BTTS, correct score, value).
- `src/lib/results.ts` — turns settled tips into win rate / ROI / profit for `/results`.

⚠️ The newsletter form in `src/components/Newsletter.astro` is a stub — wire its `action` to a
provider (Brevo / Mailchimp / Resend) before launch.

> ⚠️ Sample bookmakers use placeholder `affiliateUrl` (`example.com`). Replace with your real tracked
> affiliate links and only feature **licensed** operators for your target market.

## Deploy to Cloudflare Pages

1. Push this repo to GitHub.
2. Cloudflare dashboard → Pages → Connect to Git.
3. Build command: `npm run build` · Output dir: `dist` · Framework preset: Astro.
4. Add your custom domain.

(CLI alternative: `npx wrangler pages deploy dist`.)

## Structure

```
src/
  config.ts            # brand + nav (edit me)
  content.config.ts    # collection schemas
  content/{tips,bookmakers,articles}/
  layouts/Base.astro   # SEO head, header, footer
  components/           # TipCard, OfferCard, ArticleCard, Header, Footer, Stars
  pages/                # routes
```

## Next up (see PLAN.md)

Live scores via API-Football · Telegram auto-posting · newsletter capture · results tracking.
