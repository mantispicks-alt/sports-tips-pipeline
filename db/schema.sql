-- =========================================================================
-- the site — automated tips ingestion (Cloudflare D1 / SQLite)
--
-- Apply:   wrangler d1 execute the-site --file db/schema.sql        (local)
--          wrangler d1 execute the-site --remote --file db/schema.sql
--
-- Sport-aware. "signal sources" (predictions/tipsters -> raw_tips) are kept
-- separate from "reference data" (fixtures + settlements) so ROI is settled
-- against canonical results, never a source's own claim. FKs are documented in
-- comments (not enforced) because the pipeline fills tables in stages.
-- =========================================================================

-- --- sources -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sources (
  id            TEXT PRIMARY KEY,              -- 'api-sports', 'ind:betshoot', 'tg:sharpmoney'
  provider      TEXT NOT NULL,
  kind          TEXT NOT NULL,                 -- 'model' | 'human' | 'reference'
  sport         TEXT,
  permissions   TEXT NOT NULL DEFAULT 'unknown',
  active        INTEGER NOT NULL DEFAULT 0,
  daily_limit   INTEGER,
  rate_per_min  INTEGER,
  attribution   TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --- fixtures (canonical reference identity) -----------------------------
CREATE TABLE IF NOT EXISTS fixtures (
  id            TEXT PRIMARY KEY,              -- 'apisports:fb:12345'
  provider      TEXT NOT NULL,
  sport         TEXT NOT NULL,
  league        TEXT,
  home_team     TEXT NOT NULL,
  away_team     TEXT NOT NULL,
  home_slug     TEXT NOT NULL,
  away_slug     TEXT NOT NULL,
  kickoff       TEXT NOT NULL,                 -- ISO datetime (UTC)
  status        TEXT NOT NULL DEFAULT 'scheduled',
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fixtures_kickoff ON fixtures (kickoff);
CREATE INDEX IF NOT EXISTS idx_fixtures_match   ON fixtures (sport, home_slug, away_slug, kickoff);

-- --- raw_tips (every ingested signal) ------------------------------------
CREATE TABLE IF NOT EXISTS raw_tips (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id     TEXT NOT NULL,                 -- logical FK -> sources(id)
  fixture_id    TEXT,                          -- logical FK -> fixtures(id); NULL until matched
  sport         TEXT NOT NULL,
  home_team     TEXT NOT NULL,
  away_team     TEXT NOT NULL,
  league        TEXT,
  kickoff       TEXT,
  market        TEXT NOT NULL,                 -- '1X2','OU25','BTTS','DC','ML','SPREAD','TOTALS'
  selection     TEXT NOT NULL,
  line          REAL,
  odds          REAL,
  result        TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'won'|'lost'|'void'
  raw_payload   TEXT,
  posted_at     TEXT NOT NULL DEFAULT (datetime('now')),
  dedupe_key    TEXT NOT NULL,
  UNIQUE (dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_raw_tips_fixture ON raw_tips (fixture_id);
CREATE INDEX IF NOT EXISTS idx_raw_tips_source  ON raw_tips (source_id);
CREATE INDEX IF NOT EXISTS idx_raw_tips_result  ON raw_tips (result);

-- --- settlements (final result per fixture) ------------------------------
CREATE TABLE IF NOT EXISTS settlements (
  fixture_id    TEXT PRIMARY KEY,              -- logical FK -> fixtures(id)
  sport         TEXT NOT NULL,
  home_score    INTEGER,
  away_score    INTEGER,
  status        TEXT NOT NULL DEFAULT 'settled',
  settled_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --- source_performance (rolling reliability per source) -----------------
CREATE TABLE IF NOT EXISTS source_performance (
  source_id     TEXT PRIMARY KEY,              -- `${source}:${tipster}`
  settled       INTEGER NOT NULL DEFAULT 0,
  won           INTEGER NOT NULL DEFAULT 0,
  lost          INTEGER NOT NULL DEFAULT 0,
  voided        INTEGER NOT NULL DEFAULT 0,
  win_rate      REAL NOT NULL DEFAULT 0,
  roi           REAL NOT NULL DEFAULT 0,
  rating        REAL NOT NULL DEFAULT 0,
  first_seen    TEXT,
  promoted      INTEGER NOT NULL DEFAULT 0,    -- eligible to influence published picks
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --- published_picks (what the site reads) -------------------------------
CREATE TABLE IF NOT EXISTS published_picks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  fixture_id    TEXT NOT NULL,                 -- logical FK -> fixtures(id)
  sport         TEXT NOT NULL,
  market        TEXT NOT NULL,
  selection     TEXT NOT NULL,
  line          REAL,
  label         TEXT NOT NULL,
  backer_count  INTEGER NOT NULL,
  consensus_pct REAL NOT NULL,
  avg_odds      REAL,
  confidence    REAL NOT NULL,
  result        TEXT NOT NULL DEFAULT 'pending',
  published_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (fixture_id, market, selection)
);
CREATE INDEX IF NOT EXISTS idx_published_result ON published_picks (result);
