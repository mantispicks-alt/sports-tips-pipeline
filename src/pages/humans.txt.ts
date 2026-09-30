import type { APIRoute } from 'astro';
import { SITE } from '../config';

export const GET: APIRoute = () => {
  const body = [
    '/* TEAM */',
    `Site: ${SITE.name}`,
    `Contact: ${SITE.email}`,
    '',
    '/* THANKS */',
    'Independent tipsters, sportsbook data providers, open-source libraries.',
    '',
    '/* SITE */',
    'Last updated: rolling',
    'Language: English, Ελληνικά',
    'Standards: HTML5, CSS3, JSON-LD',
    'Frameworks: Astro, Tailwind',
    'Hosting: Cloudflare Pages + Workers',
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
