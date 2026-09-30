// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// `site` reads PUBLIC_BRAND_URL from the env at build time (sitemap + canonical
// URLs). Local .env sets the real prod URL; the public repo default is a
// placeholder so no domain lives in tracked source.
export default defineConfig({
  site: process.env.PUBLIC_BRAND_URL ?? 'https://example.pages.dev',
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
