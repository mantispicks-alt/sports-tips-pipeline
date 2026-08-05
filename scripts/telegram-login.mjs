// -------------------------------------------------------------------------
// telegram-login.mjs — ONE-TIME interactive login. Run this yourself:
//     node scripts/telegram-login.mjs
// It logs into your Telegram account (phone + code) and prints a SESSION
// STRING. Paste that into .env as TELEGRAM_SESSION so the refresh can read
// channels without logging in again.
//
// Needs TELEGRAM_API_ID and TELEGRAM_API_HASH in .env first
// (get them free at https://my.telegram.org -> "API development tools").
//
// The session string grants access to your account — keep it secret, never
// commit it. Use a dedicated Telegram account, not your main one.
// -------------------------------------------------------------------------
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import input from 'input';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const apiId = Number(env.TELEGRAM_API_ID);
const apiHash = env.TELEGRAM_API_HASH;
if (!apiId || !apiHash || apiHash.startsWith('PASTE')) {
  console.error('Set TELEGRAM_API_ID and TELEGRAM_API_HASH in .env first (from https://my.telegram.org).');
  process.exit(1);
}

const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });
await client.start({
  phoneNumber: async () => await input.text('Phone number (e.g. +30697...): '),
  password: async () => await input.text('2FA password (leave blank if none): '),
  phoneCode: async () => await input.text('Login code (Telegram sends it to you): '),
  onError: (err) => console.log('  error:', err?.message || err),
});

console.log('\n✓ Logged in. Copy the line below into .env:\n');
console.log('TELEGRAM_SESSION=' + client.session.save());
console.log('\n(Secret — grants access to your account. Never commit it.)');
await client.disconnect();
process.exit(0);
