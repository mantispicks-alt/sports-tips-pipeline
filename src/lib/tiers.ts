// -------------------------------------------------------------------------
// Membership gating helpers. Kept tiny + framework-agnostic so both the
// static funnel (Phase 1) and the SSR/auth build (Phase 2) share one source
// of truth for "who can see what".
// -------------------------------------------------------------------------
import type { TierId } from '../config';

export const TIER_RANK: Record<TierId, number> = { free: 0, win: 1, premium: 2, vip: 3 };

/** Can a member on `userTier` unlock content gated at `contentTier`? */
export function canView(userTier: TierId, contentTier: TierId): boolean {
  return TIER_RANK[userTier] >= TIER_RANK[contentTier];
}

/**
 * The viewer's current tier.
 * Phase 1: no auth yet → everyone is a logged-out free visitor, so locked
 * picks act as the upgrade funnel. Phase 2 swaps this to read the session
 * (`Astro.locals.user?.tier`) with zero changes to the calling components.
 */
export function currentTier(locals?: { user?: { tier?: TierId } }): TierId {
  return locals?.user?.tier ?? 'free';
}

export const TIER_LABEL: Record<TierId, string> = {
  free: 'Free',
  win: 'WIN',
  premium: 'Premium',
  vip: 'VIP',
};
