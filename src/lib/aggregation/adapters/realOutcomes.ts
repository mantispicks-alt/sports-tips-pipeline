// -------------------------------------------------------------------------
// Reads src/data/real-outcomes.json — final scores for real matches, written
// by scripts/settle-real.mjs. Merged into the pipeline's settlement map so
// real picks settle through the exact same code path as the demo ones.
//
// Plain Node fs reads (like jsonImport), NOT Vite's import.meta.glob: this
// runs under scripts/generate-tip-content.ts via plain tsx/Node, where
// import.meta.glob does not exist and silently yields nothing — which is
// exactly why settled results never reached the generated tip files.
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

export interface RealOutcome {
  matchKey: string;
  hg: number;
  ag: number;
  settledAt: string;
  // Resolver tag — 'highlightly-fuzzy', 'web-tavily', 'manual-fix-*', etc.; absent
  // for direct API resolvers (api-football, football-data, ESPN, HL exact).
  // Downstream (index.ts) uses this to hold back high-odds settlements from weak
  // sources until a direct resolver corroborates the score.
  via?: string;
}

// process.cwd() (repo root), not import.meta.url — Vite rewrites the latter at
// build time, which broke this read on the built /admin page. All callers run
// from the root.
const OUTCOMES_FILE = path.join(process.cwd(), 'src', 'data', 'real-outcomes.json');

export function realOutcomes(): RealOutcome[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(OUTCOMES_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
