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
import { fileURLToPath } from 'node:url';

export interface RealOutcome {
  matchKey: string;
  hg: number;
  ag: number;
  settledAt: string;
}

const OUTCOMES_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'data', 'real-outcomes.json',
);

export function realOutcomes(): RealOutcome[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(OUTCOMES_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
