import type { APIRoute } from 'astro';
import { SITE } from '../../config';

export const GET: APIRoute = () => {
  const base = SITE.url.replace(/\/$/, '');
  const contactEmail = SITE.email && SITE.email !== 'info@example.com' ? SITE.email : `security@${SITE.domain}`;
  const expires = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 19) + 'Z';
  const body = [
    `Contact: mailto:${contactEmail}`,
    `Expires: ${expires}`,
    'Preferred-Languages: en, el',
    `Canonical: ${base}/.well-known/security.txt`,
    `Policy: ${base}/privacy-policy`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
