// -------------------------------------------------------------------------
// RSS / Atom source adapter — the sanctioned way many prediction sites and
// tipster blogs syndicate their tips. Fetch feed -> parse each item -> RawTip.
//
// Disabled by default (returns []) so builds never hit the network. Add feeds
// to go live. Only use feeds the publisher offers for consumption.
// -------------------------------------------------------------------------
import type { RawTip } from '../types';
import { parseTipText } from '../parse';

// Flip to true to pull live (fetches at build/cron). See SOURCES-TIPSTERS.md for 70+ more feeds.
const ENABLED = false;
// Each feed maps to a "tipster" (the site/author). Starter set of real free-tips feeds:
const FEEDS: { url: string; tipster: string; league?: string }[] = [
  { url: 'https://footballpredictions.com/news/feed/', tipster: 'FootballPredictions' },
  { url: 'https://betting.betfair.com/football/index.xml', tipster: 'Betfair' },
  { url: 'https://solidpredict.com/blog/feed/', tipster: 'Solidpredict' },
  { url: 'https://tips180.com/blog/feed/', tipster: 'Tips180' },
  { url: 'https://blog.confirmbets.com/index.php/feed/', tipster: 'ConfirmBets' },
  { url: 'https://mightytips.com/feed/', tipster: 'MightyTips' },
  { url: 'https://kingspredict.com/blog/feed/', tipster: 'KingsPredict' },
  { url: 'https://soccerprediction.io/feed/', tipster: 'SoccerPrediction' },
  { url: 'https://footballtipster.net/blog/feed/', tipster: 'FootballTipster' },
  { url: 'https://betgurushome.com/feed', tipster: 'BetGurus' },
  { url: 'https://meritpredict.com/blog/feed/', tipster: 'MeritPredict' },
  { url: 'https://solutiontipster.com/feed/', tipster: 'SolutionTipster' },
  { url: 'https://thefootytipster.com/feed/', tipster: 'FootyTipster' },
  { url: 'https://leaguelane.com/category/articles/feed/', tipster: 'LeagueLane' },
  { url: 'https://ppsoccer.com/feed/', tipster: 'PPsoccer' },
];

const strip = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim();

export async function rssSource(): Promise<RawTip[]> {
  if (!ENABLED || FEEDS.length === 0) return [];

  const out: RawTip[] = [];
  for (const feed of FEEDS) {
    try {
      const res = await fetch(feed.url);
      const xml = await res.text();
      const items = xml.split(/<item[>\s]/i).slice(1);
      for (const item of items) {
        const title = strip(item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '');
        const desc = strip(item.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ?? '');
        const pub = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim();
        let kickoff: string | undefined;
        if (pub) {
          const d = new Date(pub);
          if (!Number.isNaN(+d)) kickoff = d.toISOString();
        }
        const tip = parseTipText(`${title} — ${desc}`, {
          tipster: feed.tipster,
          source: `rss:${feed.tipster}`,
          league: feed.league,
          kickoff,
        });
        if (tip) out.push(tip);
      }
    } catch {
      /* skip unreachable feed */
    }
  }
  return out;
}
