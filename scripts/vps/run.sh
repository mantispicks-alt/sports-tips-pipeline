#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Pipeline — one full cycle, for a VPS (replaces GitHub Actions).
#   refresh sources -> settle -> generate -> build -> deploy to Cloudflare Pages
# Cron target (every 2h). Data files persist on THIS VPS's disk between runs;
# no git commit is needed. Individual refresh steps are best-effort (a hung
# provider never aborts the run) — only build+deploy must succeed to ship.
# The CF Pages project name is read from CF_PAGES_PROJECT_NAME in .env.
# ---------------------------------------------------------------------------
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1                 # repo root
mkdir -p logs
LOG="logs/pipeline-$(date -u +%Y%m%d-%H%M).log"
exec > >(tee -a "$LOG") 2>&1
echo "=== pipeline $(date -u) ==="

# Export .env into the shell: the node scripts read .env themselves, but wrangler
# needs CLOUDFLARE_API_TOKEN from the environment. .env is NEVER committed.
set -a; [ -f .env ] && . ./.env; set +a

# Pull CODE updates while keeping local DATA (autostash). Harmless once you are the
# only updater (GitHub Actions is off). Comment out to pin to the current checkout.
git pull --autostash origin master || echo "  (git pull skipped — staying on current code)"

step() { echo "--- $1 ---"; timeout "${2}" bash -c "$3" || echo "  (step '$1' failed/timed out — continuing)"; }

# --- refresh sources (best-effort, mirrors the CI's continue-on-error) ----------
step refresh-sites    720 "node scripts/refresh-sites.mjs --allow-unofficial"
step refresh-telegram 480 "node scripts/refresh-telegram.mjs"
step refresh-tips     600 "node scripts/refresh-tips.mjs --allow-unofficial"
step refresh-odds     360 "node scripts/refresh-odds.mjs"
step refresh-pinnacle 240 "node scripts/refresh-pinnacle.mjs"
step refresh-value-hl 300 "node scripts/refresh-value-hl.mjs"
step refresh-fdcouk   300 "node scripts/refresh-fdcouk.mjs"
step refresh-bzzoiro  240 "node scripts/refresh-bzzoiro.mjs"

# --- settle + generate ----------------------------------------------------------
step settle           360 "node scripts/settle-real.mjs"
step build-reference  240 "npx tsx scripts/build-reference.ts --no-api"
step generate         360 "npx tsx scripts/generate-tip-content.ts"

# --- build + deploy (MUST succeed to publish) -----------------------------------
echo "--- build ---"
if npm run build; then
  echo "--- deploy ---"
  if [ -z "${CF_PAGES_PROJECT_NAME:-}" ]; then
    echo "!!! CF_PAGES_PROJECT_NAME env var missing — skipping deploy"
  else
    npx wrangler pages deploy dist/ --project-name="$CF_PAGES_PROJECT_NAME" --branch=main --commit-dirty=true \
      && echo "=== DEPLOYED OK $(date -u) ===" \
      || echo "!!! deploy failed — site keeps last good version"
  fi
else
  echo "!!! BUILD FAILED — not deploying (site unchanged)"
  exit 1
fi

# keep only the last ~50 logs
ls -1t logs/pipeline-*.log 2>/dev/null | tail -n +51 | xargs -r rm -f
echo "=== done $(date -u) ==="
