import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// A single bookmaker's price for a tip's selection (odds comparison board)
const oddsRow = z.object({
  book: z.string(),
  slug: z.string().optional(), // links to /bookmakers/<slug>
  odds: z.number(),
  payout: z.number().optional(), // book payout % on this market (100 − margin); shown public
  commission: z.number().optional(), // our affiliate rev-share % — ADMIN ONLY, never rendered public
});

// Daily betting predictions / tips -----------------------------------------
const tips = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/tips' }),
  schema: z.object({
    match: z.string(),
    league: z.string(),
    sport: z.enum(['football', 'basketball', 'tennis']).default('football'),
    kickoff: z.coerce.date(),
    market: z.string(),
    pick: z.string(),
    odds: z.number(),
    confidence: z.number().min(1).max(5).default(3),
    bookmaker: z.string().optional(),
    bookmakerSlug: z.string().optional(),
    result: z.enum(['pending', 'won', 'lost', 'void']).default('pending'),
    featured: z.boolean().default(false),
    tier: z.enum(['free', 'premium', 'vip']).default('free'), // gating: who can see the full pick
    author: z.string().optional(), // author slug -> /experts/<slug>

    // --- Odds comparison board (optional) ---
    oddsBoard: z.array(oddsRow).optional(),

    // --- Poisson model inputs (optional; render model when all present) ---
    homeScored: z.number().optional(),
    homeConceded: z.number().optional(),
    awayScored: z.number().optional(),
    awayConceded: z.number().optional(),
    leagueAvg: z.number().optional(),
    // which model outcome the pick maps to, for the value badge:
    valueMarket: z.enum(['home', 'draw', 'away', 'over25', 'under25', 'bttsYes', 'bttsNo']).optional(),

    // --- Basketball model inputs (optional; render when all points present) ---
    homePointsFor: z.number().optional(),
    homePointsAgainst: z.number().optional(),
    awayPointsFor: z.number().optional(),
    awayPointsAgainst: z.number().optional(),
    leagueAvgPoints: z.number().optional(),
    totalLine: z.number().optional(),
    bballValueMarket: z.enum(['homeWin', 'awayWin', 'over', 'under']).optional(),
  }),
});

// SEO news / analysis articles ---------------------------------------------
const articles = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/articles' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    sport: z.string().default('football'),
    date: z.coerce.date(),
    author: z.string().default('editorial'), // author slug
    image: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

// Bookmaker reviews / affiliate offers -------------------------------------
const bookmakers = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/bookmakers' }),
  schema: z.object({
    name: z.string(),
    type: z.enum(['sportsbook', 'casino']).default('sportsbook'), // powers /offers vs /casino
    rating: z.number().min(0).max(5),
    bonus: z.string(),
    bonusCode: z.string().optional(),
    affiliateUrl: z.string(),
    commission: z.number().optional(), // affiliate rev-share % — ADMIN ONLY
    // Geo targeting: which countries this operator accepts. ['ALL'] = accepts
    // (almost) everywhere; otherwise ISO-3166 alpha-2 codes it DOES accept.
    // `restricted` = codes it explicitly blocks (wins over geos).
    geos: z.array(z.string()).default(['ALL']),
    restricted: z.array(z.string()).default([]),
    logoText: z.string().optional(),
    accent: z.string().default('#10b981'),
    pros: z.array(z.string()).default([]),
    cons: z.array(z.string()).default([]),
    payments: z.array(z.string()).default([]),
    features: z.array(z.string()).default([]), // for comparison table
    licence: z.string().optional(), // e.g. "MGA / UKGC"
    licensed: z.boolean().default(true),
    established: z.number().optional(),
    featured: z.boolean().default(false),
    order: z.number().default(99),
  }),
});

// Expert author profiles (E-E-A-T) -----------------------------------------
const authors = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/authors' }),
  schema: z.object({
    name: z.string(),
    role: z.string(),
    credentials: z.array(z.string()).default([]),
    expertise: z.array(z.string()).default([]),
    since: z.number().optional(),
    twitter: z.string().optional(),
    accent: z.string().default('#10b981'),
  }),
});

export const collections = { tips, articles, bookmakers, authors };
