// Reads src/data/llm-usage.json (written by scripts/lib/llm-usage.mjs) and
// turns raw token counts into an estimated USD spend for the /admin dashboard.
// Only paid providers cost anything; the free-tier fallbacks are $0.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface Row { day: string; provider: string; model: string; calls: number; inTok: number; outTok: number; }

// USD per 1,000,000 tokens (input, output). Extend as models/prices change.
const PRICING: Record<string, { in: number; out: number }> = {
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },
  'gpt-4.1': { in: 2, out: 8 },
};
const FREE = /groq|gemini|cerebras|mistral|openrouter|llama/i;

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'llm-usage.json');

function rowCost(r: Row): number {
  if (FREE.test(r.provider) || FREE.test(r.model)) return 0;
  const p = PRICING[r.model] ?? PRICING['gpt-4o-mini']; // default to the cheap OpenAI model
  return (r.inTok / 1e6) * p.in + (r.outTok / 1e6) * p.out;
}

export interface LlmSpend {
  total: number;
  calls: number;
  tokens: number;
  byDay: Array<{ day: string; cost: number; calls: number }>;
  byProvider: Array<{ provider: string; cost: number; calls: number; tokens: number; paid: boolean }>;
}

export function llmSpend(): LlmSpend | null {
  let rows: Row[] = [];
  try { rows = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; }
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const priced = rows.map((r) => ({ ...r, cost: rowCost(r) }));
  const total = priced.reduce((s, r) => s + r.cost, 0);
  const calls = priced.reduce((s, r) => s + (r.calls || 0), 0);
  const tokens = priced.reduce((s, r) => s + (r.inTok || 0) + (r.outTok || 0), 0);

  const dayMap = new Map<string, { cost: number; calls: number }>();
  for (const r of priced) {
    const d = dayMap.get(r.day) ?? { cost: 0, calls: 0 };
    d.cost += r.cost; d.calls += r.calls || 0;
    dayMap.set(r.day, d);
  }
  const byDay = [...dayMap.entries()]
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, 14);

  const provMap = new Map<string, { cost: number; calls: number; tokens: number }>();
  for (const r of priced) {
    const p = provMap.get(r.provider) ?? { cost: 0, calls: 0, tokens: 0 };
    p.cost += r.cost; p.calls += r.calls || 0; p.tokens += (r.inTok || 0) + (r.outTok || 0);
    provMap.set(r.provider, p);
  }
  const byProvider = [...provMap.entries()]
    .map(([provider, v]) => ({ provider, ...v, paid: v.cost > 0 }))
    .sort((a, b) => b.cost - a.cost);

  return { total, calls, tokens, byDay, byProvider };
}
