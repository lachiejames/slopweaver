/**
 * The DEFERRED half of the coverage debt, swept across every atlas and ordered the way the owner ruled.
 *
 * ## Why this exists beside the exclusion register
 *
 * The coverage gate refuses three shapes (`docs/atlas-intent/09-volume.md`): an exclusion on the `not-fetched`
 * ground, a `shape-index` claim on an `unmeasured` volume basis, and **a kind whose coverage cell is still
 * `deferred`**. {@link ./backlog} registers the first two — they are declared in a descriptor, so a sweep of
 * them needs no store at all. The third had no cross-atlas register: `slopweaver atlas <platform> coverage`
 * names one atlas's deferred cells and exits 3, and nothing said how many stood in total or which atlas to
 * open first. The owner's standing rule is that an atlas missing coverage is unacceptable, and a deferred cell is
 * missing coverage wearing a settled word, so the half with no register was the larger half.
 *
 * ## Two properties that are the whole design
 *
 * - **A deferred cell is a property of the PUBLISHED GENERATION, not of the descriptor.** So this sweep
 *   reads the local store, which is why `atlas backlog` keeps it behind `--deferred` rather than making
 *   every run pay for it. An atlas whose generation cannot be read contributes {@link AtlasUnreadAtlas}
 *   rather than a zero — an absence and a clean atlas must never print the same, which is the same honesty
 *   `kit/answerable.ts` enforces for a dark generation.
 * - **One order, both registers.** The grouping and the sort are {@link groupByOwnerOrder}'s, so the deferred
 *   page and the exclusion page can never disagree about where an atlas sits in the owner's sequence.
 *
 * Re-derive the whole thing with `slopweaver atlas backlog --deferred --json`.
 */

import { type AtlasPlatformGroup, groupByOwnerOrder, namedAndClearAgainst } from "./backlog.js";

/** One kind a published generation left `deferred`, with the atlas it belongs to.
 * @internal
 */
export interface AtlasDeferredRow {
  readonly platform: string;
  readonly kind: string;
  readonly surface: string;
  readonly scope: string;
  /** The cell's own prose — what has and has not been reached, as the generation recorded it. */
  readonly reason: string;
}

/**
 * An atlas whose deferred cells could not be counted, and why.
 *
 * Carried rather than skipped: an atlas with no published generation is not an atlas with no deferred
 * kinds, and a register that printed them the same way would report the estate as cleaner than it is.
 *
 * @internal
 */
export interface AtlasUnreadAtlas {
  readonly platform: string;
  /** The reader's own refusal message, so the row arrives with its remedy already in it. */
  readonly because: string;
}

/** The deferred register.
 * @internal
 */
export interface AtlasDeferredBacklog {
  readonly entries: readonly AtlasPlatformGroup<AtlasDeferredRow>[];
  readonly deferredCount: number;
  /** Every atlas the sweep could not read, in registry order. */
  readonly unread: readonly AtlasUnreadAtlas[];
  /**
   * The atlases the owner named that carry no deferred kind at all.
   *
   * An atlas in {@link AtlasDeferredBacklog.unread} is never here: not-counted is not clear, and calling it
   * clear is exactly the overstatement this register's `unread` field exists to prevent.
   */
  readonly namedAndClear: readonly string[];
}

/**
 * Order a swept set of deferred cells into the register.
 *
 * @param rows every deferred cell the sweep read, from every atlas
 * @param unread the atlases it could not read, each carrying the reader's refusal
 * @returns the register, ordered the owner's way and counted
 */
export function orderAtlasDeferred({
  rows,
  unread,
}: {
  rows: readonly AtlasDeferredRow[];
  unread: readonly AtlasUnreadAtlas[];
}): AtlasDeferredBacklog {
  const entries = groupByOwnerOrder({ rows });
  const unreadPlatforms = new Set(unread.map((atlas) => atlas.platform));
  return {
    deferredCount: rows.length,
    entries,
    namedAndClear: namedAndClearAgainst({ entries }).filter((platform) => !unreadPlatforms.has(platform)),
    unread: [...unread],
  };
}
