/**
 * `turn watch`'s two default timings — a leaf of their own so `./watchLock.ts` can floor its stale window
 * on them without importing the verb that imports it.
 */

/** How often the card is rewritten when the caller names no interval. */
export const DEFAULT_WATCH_INTERVAL_SECONDS = 90;

/** How long the ticker runs before stopping itself, when the caller names no bound — two hours, the lease. */
export const DEFAULT_WATCH_MAX_SECONDS = 7200;
