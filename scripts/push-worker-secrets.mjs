// One-off: push the Worker's required secrets from .env into Cloudflare via
// `wrangler secret put`, piped through stdin so the values never appear in
// any visible command text. Run once (or whenever a key rotates):
//   node scripts/push-worker-secrets.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const NEEDED = ['API_SPORTS_KEY', 'THE_ODDS_API_KEY', 'BZZOIRO_API_KEY', 'FORESPORTIA_API_KEY'];

function putSecret(name, value) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['wrangler', 'secret', 'put', name], {
      cwd: ROOT, stdio: ['pipe', 'inherit', 'inherit'], shell: true,
    });
    child.stdin.write(value);
    child.stdin.end();
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  });
}

for (const name of NEEDED) {
  const value = env[name];
  if (!value) { console.log(`skip ${name} — empty in .env`); continue; }
  console.log(`\n== ${name} ==`);
  await putSecret(name, value);
}
console.log('\nDone.');
