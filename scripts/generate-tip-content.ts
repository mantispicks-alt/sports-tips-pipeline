// -------------------------------------------------------------------------
// Bridges the tip-aggregation pipeline (src/lib/aggregation, fed by the
// GitHub Actions cron -> src/data/tips/*.json + src/data/real-*.json) into
// the actual content the site renders (src/content/tips/*.md).
//
// Before this script, the cron ingested real picks every 2h but nothing ever
// turned them into the markdown files the /tips pages read from — the two
// systems were disconnected. This closes that gap.
//
// Rules (deliberately conservative — see PLAN.md's "no fabricated numbers"
// stance and the trust/compliance research behind the tier system):
//   - Only `publishable` picks (dateVerified fixture + a real numeric odds
//     average) are written. Never invent an odds figure.
//   - Never delete a generated file. Settled results stay on the public
//     record forever ("we never delete our losers" — already the site's own
//     copy). Re-running only creates new files or updates fields in place
//     (mainly `result`, as picks settle) on files it previously generated.
//   - Files are prefixed `auto-` so they never collide with hand-written
//     content and are trivially identifiable/diffable in git.
//   - Tier assignment reflects real data quality, not guesswork: the single
//     highest-confidence pick each day is `free` + featured (so the free
//     tier always has something real to show); cross-checked (3+ independent
//     sources agreeing — `verified`) picks are `vip`; everything else
//     `premium`. As more source adapters come online, `vip` naturally grows.
//
// Run: `npm run generate:tips` (also runs as a step in the GH Actions cron,
// after settle-real.mjs so freshly-settled results are picked up).
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline } from '../src/lib/aggregation/index.js';
import type { ConsensusPick, MarketGroup } from '../src/lib/aggregation/types.js';
import { isReserveOrYouth } from '../src/lib/aggregation/reference.js';
import { matchKey as mkOf } from '../src/lib/aggregation/normalize.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const OUT_DIR = path.join(ROOT, 'src', 'content', 'tips');

// Best-odds / line-shopping — ADDITIVE: only ever UPGRADES the price we display
// on a pick we already publish (from src/data/best-odds.json, The Odds API,
// major-league 1X2). Never changes which picks are selected or published.
const BEST_ODDS: Record<string, Record<string, { odds: number; book: string }>> = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'best-odds.json'), 'utf8')); } catch { return {}; }
})();
const BOOK_NAMES: Record<string, string> = {
  onexbet: '1xBet', unibet_se: 'Unibet', unibet_nl: 'Unibet', unibet_fr: 'Unibet', unibet_it: 'Unibet',
  leovegas_se: 'LeoVegas', betsson: 'Betsson', williamhill: 'William Hill', marathonbet: 'Marathonbet',
  nordicbet: 'NordicBet', codere_it: 'Codere', winamax_fr: 'Winamax', winamax_de: 'Winamax',
  betclic_fr: 'Betclic', coolbet: 'Coolbet', betonlineag: 'BetOnline', betanysports: 'BetAnySports',
};
const BOOK_SLUGS: Record<string, string> = { onexbet: '1xbet', betsson: 'betsson' }; // only where an affiliate page exists
const cleanBook = (k: string): string => BOOK_NAMES[k] ?? String(k).replace(/_[a-z]{2}$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
// Returns the best price + book for a pick, or null if none beats the consensus price.
function bestFor(p: ConsensusPick): { odds: number; book: string; slug?: string } | null {
  const bo = BEST_ODDS[p.matchKey]?.[p.selection];
  if (!bo || typeof bo.odds !== 'number' || bo.odds <= p.avgOdds) return null;
  return { odds: bo.odds, book: cleanBook(bo.book), slug: BOOK_SLUGS[bo.book] };
}

// Closing-line-value store. Tracks each published pick's odds from first publish
// (open) to the last update before kickoff (~the closing line). CLV = did we get
// a better price than the market's close? It's the single most reliable predictor
// of long-term profit — a service that consistently beats the closing line has a
// real edge, independent of short-run win-rate variance. src/data/clv.json.
const CLV_FILE = path.join(ROOT, 'src', 'data', 'clv.json');
const clvStore: Record<string, any> = (() => {
  try { return JSON.parse(fs.readFileSync(CLV_FILE, 'utf8')); } catch { return {}; }
})();

// Sharp value edge — the Pinnacle/Betfair-anchored +EV picks from
// scripts/refresh-odds.mjs (src/data/tips/odds-value.json). Keyed by
// matchKey|selection so we can attach the exact edge % to the pick we publish.
// A pick is "sharp" when the value engine backs the SAME selection we picked.
const VALUE_EDGE: Record<string, { edge: number; fairProb: number }> = (() => {
  const out: Record<string, { edge: number; fairProb: number }> = {};
  try {
    const rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'tips', 'odds-value.json'), 'utf8'));
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r?.homeTeam || !r?.awayTeam || !r?.kickoff || !r?.selection) continue;
      const k = `${mkOf(r.homeTeam, r.awayTeam, r.kickoff, r.sport ?? 'football')}|${r.selection}`;
      const edge = typeof r.edge === 'number' ? r.edge : 0;
      if (!out[k] || edge > out[k].edge) out[k] = { edge, fairProb: r.fairProb ?? 0 };
    }
  } catch { /* no value file — sharp badge simply never fires */ }
  return out;
})();
// Is this pick backed by the sharp value engine? Authoritative signal =
// an `odds:value` backer in the consensus (same match+market+selection);
// the VALUE_EDGE lookup then supplies the exact edge % for display.
function sharpFor(p: ConsensusPick): { edge: number } | null {
  const backed = p.backers?.some((b) => b.source === 'odds:value');
  if (!backed) return null;
  const v = VALUE_EDGE[`${p.matchKey}|${p.selection}`];
  return { edge: v?.edge ?? 0 };
}

// Quality gate — scraped sources carry noise (mislabeled sports, garbled or
// non-latin team names, scraper-placeholder odds/outliers). Publishing that
// erodes exactly the trust the whole product depends on, so filter hard and
// publish a curated set, not everything.
const ODDS_MIN = 1.1;
const ODDS_MAX = 7.5; // a *recommended* single pick above this is almost always noise
const MAX_PER_DAY = 12; // curate — quality over a wall of low-signal picks

function teamOk(name: string): boolean {
  const n = (name ?? '').trim();
  if (n.length < 3 || n.length > 40) return false;
  const latin = (n.match(/[A-Za-z]/g) ?? []).length;
  const nonSpace = n.replace(/\s/g, '').length || 1;
  if (latin / nonSpace < 0.6) return false; // mostly non-latin => leaked script / garbage
  if (/\b(team|league|unknown|tbd|n\.?\/?a\.?|null|undefined)\b/i.test(n)) return false;
  return true;
}

// Fuzzy fixture signature to collapse the same match ingested under slightly
// different spellings (e.g. "KI Klaksvik" vs "Klaksvik"). Not perfect — the
// real fix is the upstream team-alias table — but removes the bulk of dupes.
function longestToken(name: string): string {
  const toks = name.toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 3);
  toks.sort((a, b) => b.length - a.length);
  return (toks[0] ?? name.toLowerCase()).slice(0, 5);
}
// Per-MATCH signature (market deliberately excluded): we publish ONE pick per
// fixture, not the same match once per market. The dedupe below keeps the
// highest-confidence market for each match.
function fixtureSig(p: ConsensusPick): string {
  const day = new Date(p.kickoff).toISOString().slice(0, 10);
  const pair = [longestToken(p.homeTeam), longestToken(p.awayTeam)].sort();
  return `${p.sport}|${day}|${pair.join('|')}`;
}

const MARKET_NAME: Record<MarketGroup, string> = {
  '1X2': 'Match Result',
  OU25: 'Total Goals',
  BTTS: 'Both Teams to Score',
  DC: 'Double Chance',
  ML: 'Moneyline',
  SPREAD: 'Point Spread',
  TOTALS: 'Total Points',
  OTHER: 'Prediction',
};

function slugFor(p: ConsensusPick): string {
  // matchKey alone collides when the same match has picks in multiple
  // markets (e.g. 1X2 AND BTTS) — market must be part of the filename or the
  // second write silently clobbers the first.
  return (
    'auto-' +
    `${p.matchKey}-${p.market}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  );
}

function starsFromConfidence(confidence: number): number {
  return Math.max(1, Math.min(5, Math.round(confidence / 20)));
}

function yamlStr(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function frontmatterFor(p: ConsensusPick, tier: 'free' | 'premium' | 'vip', featured: boolean, sharp: { edge: number } | null): string {
  const match = `${p.homeTeam} vs ${p.awayTeam}`;
  const best = bestFor(p); // line-shopping upgrade, or null
  const lines = [
    '---',
    `match: ${yamlStr(match)}`,
    `league: ${yamlStr(p.league || 'Various')}`,
    `sport: ${p.sport ?? 'football'}`,
    `kickoff: ${new Date(p.kickoff).toISOString()}`,
    `market: ${yamlStr(MARKET_NAME[p.market] ?? 'Prediction')}`,
    `pick: ${yamlStr(p.label)}`,
    `odds: ${best ? best.odds : p.avgOdds}`,
    ...(best ? [`bookmaker: ${yamlStr(best.book)}`] : []),
    ...(best?.slug ? [`bookmakerSlug: ${yamlStr(best.slug)}`] : []),
    `confidence: ${starsFromConfidence(p.confidence)}`,
    `result: ${p.result === 'pending' ? 'pending' : p.result}`,
    `tier: ${tier}`,
    `featured: ${featured}`,
    // value signals — power the "SHARP VALUE" badge + cross-check depth line
    `sharp: ${sharp ? 'true' : 'false'}`,
    ...(sharp && sharp.edge > 0 ? [`edge: ${Math.round(sharp.edge * 10) / 10}`] : []),
    ...(typeof p.valueEdge === 'number' ? [`valueEdge: ${p.valueEdge}`] : []),
    `sources: ${p.backerCount}`,
    '---',
  ];
  return lines.join('\n') + '\n';
}

function bodyFor(p: ConsensusPick): string {
  const sourceWord = p.backerCount === 1 ? 'source' : 'independent sources';
  const lines = [
    `> **Automated consensus pick.** Generated by our tip-aggregation pipeline from ${p.backerCount} ${sourceWord} — not written by a human editor. This is a data signal, not a guarantee.`,
    '',
    `Average price backed: **${p.avgOdds.toFixed(2)}**. ${p.consensusPct}% of tipsters tracking this match agree on this selection.` +
      (p.verified ? ' This pick passed our cross-check bar (3+ independent sources agreeing).' : ''),
  ];
  if (!p.dateVerified) {
    lines.push('', '_Kickoff time is as reported by the source and not yet cross-checked against an official fixture list — confirm before betting._');
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const output = await runPipeline();

  const NOW = Date.now();
  const SKEW = 10 * 60 * 1000; // only pre-match: allow 10min clock skew, nothing already kicked off
  const FUTURE_CAP = 21 * 24 * 60 * 60 * 1000; // 3 weeks out — reject absurd placeholder dates

  // --- Date-honest gate. The load-bearing rule: we only publish a pick whose
  // KICKOFF we can actually stand behind. `dateVerified` means the pick was
  // matched to a real api-football fixture, so its kickoff is a cross-checked
  // real date/time — that's the only way to know a match is UPCOMING and not
  // one that already happened. Picks we can't date-verify (small leagues
  // outside api-football's coverage) are HELD, not published — showing a tip
  // for a finished match, or with a made-up time, is the fastest way to look
  // like a scam. Those come online once an odds/fixtures feed covers them
  // (THE_ODDS_API_KEY -> scripts/ingest-oddsapi.mjs, or a paid api tier).
  const clean = output.publishable.filter((p) => {
    const t = new Date(p.kickoff).getTime();
    return (
      p.dateVerified === true &&
      Number.isFinite(t) &&
      t > NOW - SKEW && // pre-match only — nothing already kicked off
      t < NOW + FUTURE_CAP && // not an absurd far-future placeholder
      p.avgOdds >= ODDS_MIN &&
      p.avgOdds <= ODDS_MAX &&
      teamOk(p.homeTeam) &&
      teamOk(p.awayTeam) &&
      !isReserveOrYouth(p.homeTeam) &&
      !isReserveOrYouth(p.awayTeam)
    );
  });

  // --- Dedupe near-identical fixtures, keep the highest-confidence one.
  const bySig = new Map<string, ConsensusPick>();
  for (const p of clean) {
    const sig = fixtureSig(p);
    const prev = bySig.get(sig);
    if (!prev || p.confidence > prev.confidence) bySig.set(sig, p);
  }
  const deduped = [...bySig.values()];

  const held = output.publishable.filter((p) => p.dateVerified !== true).length;
  console.log(
    `date-honest gate: ${output.publishable.length} publishable -> ${clean.length} with a verified upcoming kickoff -> ${deduped.length} after dedupe ` +
      `(held ${held} picks we can't date-verify)`,
  );

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Rank within each calendar day (UTC) by confidence, then cap — curate.
  const byDay = new Map<string, ConsensusPick[]>();
  for (const p of deduped) {
    const day = new Date(p.kickoff).toISOString().slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(p);
    byDay.set(day, list);
  }
  for (const [day, list] of byDay) {
    list.sort((a, b) => b.confidence - a.confidence);
    byDay.set(day, list.slice(0, MAX_PER_DAY));
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  const clvUpserts: { p: ConsensusPick; odds: number }[] = [];
  for (const list of byDay.values()) {
    let freeGiven = false;
    list.forEach((p) => {
      const sharp = sharpFor(p); // backed by the Pinnacle/Betfair value engine
      // Track the price a follower actually gets (best-odds upgrade, else consensus).
      clvUpserts.push({ p, odds: bestFor(p)?.odds ?? p.avgOdds });
      // All published picks here are date-verified. One free/featured pick per
      // day (the public face — kept as the top-CONFIDENCE pick to protect the
      // headline win rate). A pick earns VIP if 3+ independent sources agree
      // (`verified`) OR the sharp value engine backs it (genuine +EV is a
      // quality signal in its own right); the rest are Premium (locked).
      let tier: 'free' | 'premium' | 'vip';
      let featured = false;
      if (!freeGiven) {
        tier = 'free';
        featured = true;
        freeGiven = true;
      } else if (p.verified || sharp) {
        tier = 'vip';
      } else {
        tier = 'premium';
      }
      const slug = slugFor(p);
      const file = path.join(OUT_DIR, `${slug}.md`);
      const next = frontmatterFor(p, tier, featured, sharp) + '\n' + bodyFor(p);

      const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (prev === next) {
        unchanged++;
        return;
      }
      if (dryRun) {
        console.log(`${prev === null ? '[new]' : '[update]'} ${slug} — ${p.label} @ ${p.avgOdds} (${tier})`);
      } else {
        fs.writeFileSync(file, next);
      }
      if (prev === null) created++;
      else updated++;
    });
  }

  // --- Settle pass. The publish gate above writes only UPCOMING picks, so a
  // file would otherwise stay `result: pending` forever once its match kicked
  // off. Re-open every already-generated file whose match has now settled
  // (result known in this run's publishable set) and update just that field —
  // this is what turns the site's picks into a real won/lost track record.
  let settledFiles = 0;
  for (const p of output.publishable) {
    if (!p.result || p.result === 'pending') continue;
    const file = path.join(OUT_DIR, `${slugFor(p)}.md`);
    if (!fs.existsSync(file)) continue;
    const cur = fs.readFileSync(file, 'utf8');
    const updatedFile = cur.replace(/^result:.*$/m, `result: ${p.result}`);
    if (updatedFile === cur) continue;
    if (!dryRun) fs.writeFileSync(file, updatedFile);
    settledFiles++;
  }

  // --- CLV pass. Upsert every published pick into the closing-line store: first
  // sighting fixes the OPEN price; each later run before kickoff refreshes the
  // CLOSE price (the last pre-kickoff value ≈ the closing line). Frozen once the
  // match kicks off. This is what lets /results prove we beat the market's close.
  if (!dryRun) {
    const nowIso = new Date(NOW).toISOString();
    for (const { p, odds } of clvUpserts) {
      if (!(odds > 1)) continue;
      const key = `${p.matchKey}|${p.market}|${p.selection}`;
      const ko = new Date(p.kickoff).getTime();
      const e = clvStore[key];
      if (!e) {
        clvStore[key] = {
          match: `${p.homeTeam} vs ${p.awayTeam}`, league: p.league || 'Various',
          kickoff: new Date(p.kickoff).toISOString(), market: p.market, selection: p.selection,
          openOdds: odds, openAt: nowIso, closeOdds: odds, closeAt: nowIso,
        };
      } else if (ko > NOW) {
        e.closeOdds = odds; e.closeAt = nowIso; // still pre-match — refresh the close
      }
    }
    // Stamp results (from the full publishable set, which carries settled outcomes).
    for (const p of output.publishable) {
      if (!p.result || p.result === 'pending') continue;
      const key = `${p.matchKey}|${p.market}|${p.selection}`;
      if (clvStore[key]) clvStore[key].result = p.result;
    }
    // Prune entries more than 45 days past kickoff so the file can't grow forever.
    const CUTOFF = NOW - 45 * 24 * 60 * 60 * 1000;
    for (const [k, e] of Object.entries(clvStore)) {
      if (new Date((e as any).kickoff).getTime() < CUTOFF) delete clvStore[k];
    }
    fs.writeFileSync(CLV_FILE, JSON.stringify(clvStore, null, 2));
    const closed = Object.values(clvStore).filter((e: any) => new Date(e.kickoff).getTime() < NOW && e.openOdds > 1 && e.closeOdds > 1);
    const clvs = closed.map((e: any) => e.openOdds / e.closeOdds - 1);
    const beat = clvs.filter((x) => x > 0).length;
    const avg = clvs.length ? clvs.reduce((a: number, b: number) => a + b, 0) / clvs.length : 0;
    console.log(`CLV: ${Object.keys(clvStore).length} tracked, ${closed.length} closed — beat close ${clvs.length ? Math.round((beat / clvs.length) * 100) : 0}%, avg CLV ${(avg * 100).toFixed(2)}%`);
  }

  const published = [...byDay.values()].reduce((n, l) => n + l.length, 0);
  console.log(
    `generate-tip-content: ${published} published -> ${created} created, ${updated} updated, ${unchanged} unchanged; ${settledFiles} settled` +
      (dryRun ? ' (dry run, nothing written)' : ''),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
