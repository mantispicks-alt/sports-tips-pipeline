// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// Change `site` to your real domain before deploying (used for sitemap + canonical URLs).
export default defineConfig({
  site: 'https://the-site-tips.pages.dev',
  integrations: [sitemap({
    // Skip /admin and any premium/VIP tip pages that ship with noindex — sitemaps
    // are for pages we WANT indexed; if a page has noindex it should not appear.
    filter: (page) => !/\/admin(\/|$)/.test(page),
    changefreq: 'daily',
    priority: 0.7,
    lastmod: new Date(),
  })],
  vite: {
    plugins: [tailwindcss()],
  },
});
