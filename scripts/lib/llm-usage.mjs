// -------------------------------------------------------------------------
// Persist per-run LLM token usage into src/data/llm-usage.json so the /admin
// dashboard can show spend over time. The refresh-* scripts already track
// tokens per run in memory and log a cost to the console; this just makes that
// survive the run, aggregated by day + provider. Never throws — usage
// accounting must never break ingestion.
// -------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'src', 'data', 'llm-usage.json',
);

// usage: { [provider]: { calls, inTok, outTok } }. models: optional { [provider]: modelName }.
export function persistUsage(usage, models = {}) {
  try {
    if (!usage || typeof usage !== 'object') return;
    const day = new Date().toISOString().slice(0, 10);
    let data = [];
    try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
    if (!Array.isArray(data)) data = [];
    for (const [provider, s] of Object.entries(usage)) {
      if (!s || (!s.calls && !s.inTok && !s.outTok)) continue;
      let row = data.find((r) => r.day === day && r.provider === provider);
      if (!row) { row = { day, provider, model: models[provider] || '', calls: 0, inTok: 0, outTok: 0 }; data.push(row); }
      row.calls += s.calls || 0;
      row.inTok += s.inTok || 0;
      row.outTok += s.outTok || 0;
      if (!row.model && models[provider]) row.model = models[provider];
    }
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
  } catch {
    // swallow — never break the caller
  }
}
