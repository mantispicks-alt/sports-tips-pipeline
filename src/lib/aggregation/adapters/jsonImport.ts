// -------------------------------------------------------------------------
// Manual / opt-in source. Three ways to feed tips in:
//   1. Drop one JSON file per tipster/source into `src/data/tips/*.json`
//   2. (legacy) a single `src/data/raw-tips.json`
//   3. `src/data/real-history.json` — REAL settled results, written by
//      scripts/settle-real.mjs. Entries already carry `result` (won/lost),
//      so they feed the real (non-demo) track record directly.
// Each file is an array of RawTip objects. Nothing there? No-op.
// This is the clean, ToS-safe way to add tipsters you have the right to use.
// See `src/data/raw-tips.example.json` for the shape.
// -------------------------------------------------------------------------
import type { RawTip } from '../types';

export function jsonImport(): RawTip[] {
  const all: RawTip[] = [];
  try {
    const folder = import.meta.glob('/src/data/tips/*.json', { eager: true }) as Record<
      string,
      { default: RawTip[] }
    >;
    const legacy = import.meta.glob('/src/data/raw-tips.json', { eager: true }) as Record<
      string,
      { default: RawTip[] }
    >;
    const realHistory = import.meta.glob('/src/data/real-history.json', { eager: true }) as Record<
      string,
      { default: RawTip[] }
    >;
    for (const mod of [...Object.values(folder), ...Object.values(legacy), ...Object.values(realHistory)]) {
      if (Array.isArray(mod?.default)) all.push(...mod.default);
    }
  } catch {
    /* no files present — fine */
  }
  return all;
}
