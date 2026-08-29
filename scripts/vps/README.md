# Run the the site pipeline on a VPS (no GitHub Actions)

This runs the whole pipeline — refresh → settle → generate → build → deploy — on a
cheap always-on server, every 2 hours, completely independent of GitHub. The site
data lives on the VPS disk; each cycle rebuilds and deploys to Cloudflare Pages.

## 0. Get a VPS
- **Hetzner CX22** (~€4/mo) — simplest, reliable. Pick Ubuntu 24.04.
- or **Oracle Cloud Always Free** (€0 forever, ARM VM) — free but a bit more setup.
- 1 vCPU / 2 GB RAM is enough (build peaks ~1.5 GB).

## 1. Base packages (Ubuntu/Debian)
```bash
sudo apt update && sudo apt install -y git curl
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # expect v20.x
```

## 2. Clone the repo
```bash
git clone https://github.com/the-site-alt/the-site-tips-pipeline.git
cd the-site-tips-pipeline
```

## 3. One-time setup
```bash
bash scripts/vps/setup.sh
```
Installs deps + the headless Chromium the scraper needs.

## 4. Secrets — create `.env` in the repo root
Copy every key from your local `.env` (the same values the GitHub secrets hold:
`OPENAI_API_KEY`, `HIGHLIGHTLY_API_KEY`, `HIGHLIGHTLY_PAID=1`, `THE_ODDS_API_KEY`,
`FOOTBALL_DATA_ORG_KEY`, `ODDS_API_IO_KEY`, `BZZOIRO_API_KEY`, `TAVILY_API_KEY`,
`TELEGRAM_*`, etc.). Then add **one extra line** for headless deploys:
```
CLOUDFLARE_API_TOKEN=<token>
```
Create the token: Cloudflare dashboard → **My Profile → API Tokens → Create Token**
→ use the **"Cloudflare Pages: Edit"** template (Account → Cloudflare Pages: Edit).
That is all wrangler needs to deploy without an interactive login.

`.env` is git-ignored and never leaves the VPS.

## 5. Test one full run
```bash
bash scripts/vps/run.sh
```
Watch it refresh → settle → generate → build → deploy. On success it prints
`=== DEPLOYED OK ===` and the site updates. Logs land in `logs/`.

## 6. Schedule it every 2 hours
```bash
crontab -e
```
Add (adjust the path if different):
```
0 */2 * * * cd ~/the-site-tips-pipeline && bash scripts/vps/run.sh >> logs/cron.log 2>&1
```

Done — the VPS now owns the pipeline. GitHub Actions can stay off.

## Notes
- **Code updates:** `run.sh` does `git pull --autostash` each cycle, so when new code
  is pushed to `master` the VPS picks it up automatically while keeping its local data.
- **Keeping the PC/GitHub in the loop:** not needed. The VPS is self-contained. (If you
  ever want GitHub as a data backup, add a `git push` at the end — needs a deploy key.)
- **Cost control:** 2 h is the same cadence as before. Widen to `0 */4 * * *` for fewer
  cycles if you want to trim CPU.
- **Health check:** `tail -f logs/cron.log` or `ls -t logs/` to see the latest run.
