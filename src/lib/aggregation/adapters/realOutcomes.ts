// -------------------------------------------------------------------------
// Reads src/data/real-outcomes.json — final scores for real matches, written
// by scripts/settle-real.mjs. Merged into the pipeline's settlement map so
// real picks settle through the exact same code path as the demo ones.
// -------------------------------------------------------------------------
export interface RealOutcome {
  matchKey: string;
  hg: number;
  ag: number;
  settledAt: string;
}

export function realOutcomes(): RealOutcome[] {
  try {
    const mod = import.meta.glob('/src/data/real-outcomes.json', { eager: true }) as Record<
      string,
      { default: RealOutcome[] }
    >;
    const file = Object.values(mod)[0];
    return Array.isArray(file?.default) ? file.default : [];
  } catch {
    return [];
  }
}
