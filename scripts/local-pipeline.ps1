# -------------------------------------------------------------------------
# local-pipeline.ps1 — run the full the site pipeline on THIS machine and deploy
# to Cloudflare, WITHOUT GitHub Actions. Needed while the private repo's free
# Actions minutes are exhausted (and a free fallback in general).
#
# Requires: internet + this PC on. Uses the local .env (API keys) and the
# already-authenticated wrangler login. Any single source failing is offline-safe
# (writes nothing) — the run continues and deploys whatever refreshed.
#
# Run manually:   powershell -ExecutionPolicy Bypass -File scripts\local-pipeline.ps1
# Scheduled:      registered as the "the site Pipeline" task (every 6h).
# -------------------------------------------------------------------------
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot      # scripts\ -> repo root
Set-Location $repo
$log = Join-Path $repo 'local-pipeline.log'
function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" | Tee-Object -FilePath $log -Append }

Log '==== pipeline start ===='

# Fast sharp/model sources (no browser needed).
foreach ($s in 'refresh-pinnacle.mjs','refresh-fdcouk.mjs','refresh-bzzoiro.mjs','refresh-clubelo.mjs','refresh-odds.mjs') {
  Log "refresh: $s"
  node "scripts/$s" *>> $log
}

# Settle finished matches, then turn consensus into published content.
Log 'settle-real'
node scripts/settle-real.mjs *>> $log
Log 'generate-tip-content'
npx tsx scripts/generate-tip-content.ts *>> $log

# Build + deploy to Cloudflare Pages production (main branch).
Log 'build'
npm run build *>> $log
Log 'deploy'
npx wrangler pages deploy dist/ --project-name=the-site-tips --branch=main --commit-dirty=true *>> $log

# Persist the regenerated data back to git (best-effort; never blocks the deploy).
Log 'git commit data'
git add src/data/tips/ src/data/real-outcomes.json src/data/real-history.json src/data/clv.json src/data/pinnacle-moves.json src/data/web-settle-attempts.json src/data/best-odds.json src/content/tips/ 2>> $log
git commit -m "Local pipeline auto-run: refresh + settle + deploy [skip ci]" *>> $log
git pull --rebase --autostash origin master *>> $log
git push origin master *>> $log

Log '==== pipeline done ===='
