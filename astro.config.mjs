// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// Change `site` to your real domain before deploying (used for sitemap + canonical URLs).
export default defineConfig({
  site: 'https://the-site-tips.pages.dev',
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'el'],
    routing: {
      prefixDefaultLocale: false, // English served at /, Greek at /el/*
    },
  },
  integrations: [sitemap({
    // Skip /admin and any premium/VIP tip pages that ship with noindex — sitemaps
    // are for pages we WANT indexed; if a page has noindex it should not appear.
    filter: (page) => !/\/admin(-|\/|$)/.test(page) && !/\/search(\/|$|\?)/.test(page),
    changefreq: 'daily',
    priority: 0.7,
    lastmod: new Date(),
    i18n: {
      defaultLocale: 'en',
      locales: { en: 'en-GB', el: 'el-CY' },
    },
  })],
  vite: {
    plugins: [tailwindcss()],
  },
});
