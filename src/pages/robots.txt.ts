import type { APIRoute } from 'astro';
import { SITE } from '../config';

export const GET: APIRoute = () => {
  const base = SITE.url.replace(/\/$/, '');
  const body = [
    'User-agent: *',
    'Allow: /',
    '',
    '# no admin/preview surfaces are indexed',
    'Disallow: /admin',
    'Disallow: /search',
    '',
    `Sitemap: ${base}/sitemap-index.xml`,
    `Sitemap: ${base}/news-sitemap.xml`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
