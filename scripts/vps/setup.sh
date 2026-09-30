#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# One-time VPS setup for the site pipeline. Run ONCE after cloning the repo.
# Assumes Ubuntu/Debian. Installs Node 20+, project deps, and the headless
# browser that refresh-sites needs.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/../.."                            # repo root

echo "==> Node version:"; node -v || { echo "Install Node 20+ first (see README)"; exit 1; }

echo "==> Installing project dependencies (npm ci)..."
npm ci

echo "==> Installing Playwright chromium (+ system deps) for the site scraper..."
npx playwright install --with-deps chromium

mkdir -p logs

echo
echo "Setup complete. Next:"
echo "  1) Create .env in the repo root with ALL your keys (copy from your machine)."
echo "  2) Add ONE extra line to .env:  CLOUDFLARE_API_TOKEN=<token>"
echo "     (Cloudflare dashboard -> My Profile -> API Tokens -> Create ->"
echo "      'Cloudflare Pages: Edit' permission. This lets wrangler deploy headless.)"
echo "  3) Test one run:   bash scripts/vps/run.sh"
echo "  4) Add the cron (every 2h):"
echo "       crontab -e   then add:"
echo "       0 */2 * * * cd $(pwd) && bash scripts/vps/run.sh >> logs/cron.log 2>&1"
