// -------------------------------------------------------------------------
// LLM extractor — the "AI that pulls tips" automatically.
//
// For each configured site: fetch the page -> strip to text -> ask an LLM to
// return today's tips as structured JSON -> map to RawTip. This automates what
// a human (or Claude) does by hand: read the page, pull out the pick.
//
// Runs daily from a Cloudflare Worker (cron). Disabled without a key so the
// static build never calls the network / an LLM. Only reads sites that don't
// block the fetch (blocked sites like forebet/oddspedia still can't be read).
//
// Provider shape below = Google Gemini (has a free tier). Swap the request
// body/URL for OpenAI / Anthropic / Cloudflare Workers AI as preferred.
// -------------------------------------------------------------------------
import type { RawTip, MarketGroup } from '../types';

// Reads from .env — never hardcode the key here, never paste it in chat.
// Activate with:  LLM_EXTRACTOR=on  and  LLM_API_KEY=your_new_key  in .env
//
// `import.meta.env` only exists under Vite/Astro (dev/build). Callers outside
// that — e.g. scripts/generate-tip-content.ts running under plain Node/tsx —
// don't have it, so the optional chaining below is required: it makes this
// adapter safely resolve to disabled (no key found) in that context instead
// of throwing, rather than silently reading the wrong source of truth.
const LLM_API_KEY = import.meta.env?.LLM_API_KEY ?? import.meta.env?.GEMINI_API_KEY ?? '';
const ENABLED = (import.meta.env?.LLM_EXTRACTOR ?? '') === 'on' && !!LLM_API_KEY;
// OpenAI-compatible endpoint. Default = Groq (free, no card, no region block).
// Swap endpoint + model for OpenAI / Mistral / OpenRouter — same request shape.
const LLM_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const LLM_MODEL = 'llama-3.3-70b-versatile';

// Candidate sites. The extractor TRIES all of them; blocked/empty ones just
// skip (try/catch), so only the ~1/3 that load with real picks get connected.
// Add as many as you like — a failed fetch is cheap (no LLM call). Each = a tipster.
const SITES: { url: string; tipster: string }[] = [
  // --- confirmed working (already pulled by hand) ---
  { url: 'https://solidpredict.com/', tipster: 'Solidpredict' },
  { url: 'https://kickpredictions.co.ke/', tipster: 'KickPredictions' },
  { url: 'https://eaglepredict.com/', tipster: 'EaglePredict' },
  { url: 'https://meritpredict.com/', tipster: 'MeritPredict' },
  { url: 'https://www.statarea.com/', tipster: 'Statarea' },
  { url: 'https://venasbet.com/', tipster: 'Venasbet' },
  { url: 'https://solopredict.com/', tipster: 'Solopredict' },
  // --- extra candidates (many will skip if they block / show no picks) ---
  { url: 'https://www.soccervista.com/', tipster: 'SoccerVista' },
  { url: 'https://www.windrawwin.com/', tipster: 'WinDrawWin' },
  { url: 'https://confirmbets.com/', tipster: 'ConfirmBets' },
  { url: 'https://betwizad.com/', tipster: 'Betwizad' },
  { url: 'https://kingspredict.com/', tipster: 'KingsPredict' },
  { url: 'https://1960tips.com/', tipster: 'Tips1960' },
  { url: 'https://www.adibet.com/', tipster: 'Adibet' },
  { url: 'https://tips180.com/', tipster: 'Tips180' },
  { url: 'https://soccerprediction.io/', tipster: 'SoccerPrediction' },
  { url: 'https://footballtipster.net/', tipster: 'FootballTipster' },
  { url: 'https://soccerpunt.com/', tipster: 'SoccerPunt' },
  { url: 'https://betagamers.net/', tipster: 'BetaGamers' },
  { url: 'https://suregametoday.com/', tipster: 'SureGameToday' },
  { url: 'https://kcpredict.com/', tipster: 'KCPredict' },
  { url: 'https://legitpredict.com/', tipster: 'LegitPredict' },
  { url: 'https://accuratepredict.com/', tipster: 'AccuratePredict' },
  { url: 'https://www.sportsgambler.com/', tipster: 'SportsGambler' },
  { url: 'https://www.forebet.com/en/football-predictions', tipster: 'Forebet' },
  { url: 'https://www.predictz.com/predictions/', tipster: 'PredictZ' },
  { url: 'https://betensured.com/', tipster: 'Betensured' },
  { url: 'https://www.dimers.com/soccer', tipster: 'Dimers' },
  { url: 'https://footystats.org/predictions/mathematical', tipster: 'FootyStats' },
  { url: 'https://www.sportsmole.co.uk/football/predictions/', tipster: 'SportsMole' },
];

const PROMPT = `Extract today's football betting tips from this page as a JSON array.
Each item: {"home": string, "away": string, "league": string, "market": "1X2"|"OU25"|"BTTS"|"DC", "selection": string, "odds": number|null}.
selection values: 1X2 -> home|draw|away; OU25 -> over|under; BTTS -> yes|no; DC -> 1x|12|x2.
Only real picks with two named teams. Return ONLY the JSON array, no prose.`;

const VALID: MarketGroup[] = ['1X2', 'OU25', 'BTTS', 'DC'];

export async function llmExtractorSource(): Promise<RawTip[]> {
  if (!ENABLED || !LLM_API_KEY) return [];

  const out: RawTip[] = [];
  const today = new Date().toISOString();

  for (const site of SITES) {
    try {
      const page = await (
        await fetch(site.url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) })
      ).text();
      const text = page
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, 12000);

      const res = await fetch(LLM_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${LLM_API_KEY}` },
        body: JSON.stringify({
          model: LLM_MODEL,
          temperature: 0,
          messages: [{ role: 'user', content: `${PROMPT}\n\nPAGE:\n${text}` }],
        }),
        signal: AbortSignal.timeout(20000),
      });
      const json: any = await res.json();
      const raw = json?.choices?.[0]?.message?.content ?? '[]';
      const tips = JSON.parse(raw.replace(/```json|```/g, '').trim());
      if (!Array.isArray(tips)) continue;

      for (const t of tips) {
        if (!t?.home || !t?.away || !VALID.includes(t.market) || !t.selection) continue;
        out.push({
          source: `llm:${site.tipster}`,
          tipster: site.tipster,
          homeTeam: String(t.home),
          awayTeam: String(t.away),
          league: t.league ? String(t.league) : 'Various',
          kickoff: today,
          market: t.market,
          selection: String(t.selection).toLowerCase(),
          odds: typeof t.odds === 'number' ? t.odds : undefined,
        });
      }
    } catch {
      /* site blocked / LLM error — skip */
    }
  }
  return out;
}
