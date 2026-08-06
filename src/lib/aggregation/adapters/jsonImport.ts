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
//
// Plain Node fs reads (not Vite's import.meta.glob): this adapter must also
// run under scripts/generate-tip-content.ts via plain tsx/Node, where
// import.meta.glob does not exist. fs works identically in both contexts.
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RawTip } from '../types';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');

function readJsonArray(file: string): RawTip[] {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err: any) {
    if (err?.code !== 'ENOENT') console.warn(`jsonImport: skipping ${file} (${err?.message ?? err})`);
    return [];
  }
}

export function jsonImport(): RawTip[] {
  const all: RawTip[] = [];

  const tipsDir = path.join(DATA_DIR, 'tips');
  try {
    for (const name of fs.readdirSync(tipsDir)) {
      if (name.endsWith('.json')) all.push(...readJsonArray(path.join(tipsDir, name)));
    }
  } catch (err: any) {
    if (err?.code !== 'ENOENT') console.warn(`jsonImport: skipping ${tipsDir} (${err?.message ?? err})`);
  }

  all.push(...readJsonArray(path.join(DATA_DIR, 'raw-tips.json')));
  all.push(...readJsonArray(path.join(DATA_DIR, 'real-history.json')));

  return all;
}
