// -------------------------------------------------------------------------
// Telegram source adapter — most tipsters post in public channels.
// Disabled by default (returns []) so builds never hit the network. Add a bot
// token + channel list to pull live. Parsing is shared via parseTipText.
//
// Only ingest channels you are permitted to use (public + opt-in).
// -------------------------------------------------------------------------
import type { RawTip } from '../types';
import { parseTipText } from '../parse';

const ENABLED = false;
const BOT_TOKEN = ''; // process.env.TELEGRAM_BOT_TOKEN in a real build/worker
const CHANNELS: string[] = []; // e.g. ['@sharptips', '@valuebets']

/** Parse a single Telegram message into a RawTip (best-effort). */
export function parseTelegramTip(
  text: string,
  tipster: string,
  source: string,
  kickoff?: string,
): RawTip | null {
  return parseTipText(text, { tipster, source, kickoff });
}

export async function telegramSource(): Promise<RawTip[]> {
  if (!ENABLED || !BOT_TOKEN || CHANNELS.length === 0) return [];

  const out: RawTip[] = [];
  for (const channel of CHANNELS) {
    // Real implementation sketch:
    //   const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`);
    //   const { result } = await res.json();
    //   for (const u of result) {
    //     const post = u.channel_post ?? u.message;
    //     if (!post?.text) continue;
    //     const kickoff = new Date(post.date * 1000).toISOString();
    //     const tip = parseTelegramTip(post.text, channel, `telegram:${channel}`, kickoff);
    //     if (tip) out.push(tip);
    //   }
    void channel;
  }
  return out;
}
