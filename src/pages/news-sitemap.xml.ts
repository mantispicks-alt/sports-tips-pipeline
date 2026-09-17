import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { SITE } from '../config';

// Google News sitemap — only articles published in the last 48 hours are
// eligible per Google's spec, but publishing the full list is harmless and
// documents which articles exist for other crawlers.
export const GET: APIRoute = async () => {
  const articles = (await getCollection('articles'))
    .filter((a) => !a.data.draft)
    .sort((a, b) => +b.data.date - +a.data.date);

  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const items = articles
    .map((a) => {
      const url = new URL(`/news/${a.id}`, SITE.url).href;
      return `  <url>
    <loc>${escape(url)}</loc>
    <news:news>
      <news:publication>
        <news:name>${escape(SITE.name)}</news:name>
        <news:language>${SITE.locale}</news:language>
      </news:publication>
      <news:publication_date>${new Date(a.data.date).toISOString()}</news:publication_date>
      <news:title>${escape(a.data.title)}</news:title>
    </news:news>
  </url>`;
    })
    .join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${items}
</urlset>
`;

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
