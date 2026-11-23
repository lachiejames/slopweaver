/**
 * The refused-exclusion backlog, ordered the way the owner ruled it should be worked.
 *
 * ## Why this is a REGISTER and never a gate
 *
 * `coverage.ts` already decides which rows are refused — {@link isRefusedExclusion} is the one predicate,
 * and nothing here re-judges it. What this module adds is the other half of the owner's ruling: the refused
 * exclusions are a backlog worked through steadily, starting with
 * datadog, vanta, linear, slack, notion, github, cloudflare, jumpcloud and googleadmin.
 *
 * Two things follow from that ruling and both are code rather than prose:
 *
 * - **An order.** {@link ATLAS_BACKLOG_ORDER} is the owner's nine, in their sequence. Every other atlas sorts
 *   after them, densest first, so a session that finishes the nine still has somewhere to go.
 * - **No exit code.** `slopweaver atlas backlog` always exits 0. A backlog that failed a run would be the
 *   gate the owner declined, and the sweep would then have to be kept out of CI to stay honest — which is exactly
 *   how a register becomes unreadable. `slopweaver atlas <platform> coverage` still exits 3 on the same
 *   rows; that verb answers "is this ONE atlas complete", which is a different question and stays a gate.
 *
 * The two grounds that withhold records on a ruling rather than on volume — `disclosure-bound` and
 * `payload-not-map` — SURVIVE (the same ruling), so they never appear here. They are
 * settled decisions, not debt.
 *
 * Re-derive the whole register at any time with `slopweaver atlas backlog --json`.
 */

import { type AtlasDescriptor, type AtlasExclusion, isRefusedExclusion } from "./contract.js";

/**
 * The atlases the owner named, in the sequence the owner named them.
 *
 * Spelled as platform keys the registry answers to, so a typo here is a row that never sorts rather than a
 * silent no-op — `unnamedBacklogPlatforms` in the unit test is what catches one.
 */
export const ATLAS_BACKLOG_ORDER: readonly string[] = [
  "datadog",
  "vanta",
  "linear",
  "slack",
  "notion",
  "github",
  "cloudflare",
  "jumpcloud",
  "google-admin",
];

/** One refused exclusion, with the remedy its own ground already carries.
 * @internal
 */
export interface AtlasBacklogRow {
  readonly platform: string;
  /** The refused ground — only ever `not-fetched` or `shape-index`; nothing else reaches this list. */
  readonly ground: AtlasExclusion["ground"];
  /** The prose the descriptor carries: what is not held, and why. */
  readonly because: string;
  /** What would close this row — `wouldBeClosedBy` for a fetch, `wouldBeMeasuredBy` for a weight. */
  readonly remedy: string;
}

/** One atlas's whole share of the backlog, in the position the owner's ruling puts it.
 * @internal
 */
export type AtlasBacklogEntry = AtlasPlatformGroup<AtlasBacklogRow>;

/** The whole register.
 * @internal
 */
export interface AtlasBacklog {
  readonly entries: readonly AtlasBacklogEntry[];
  readonly refusedCount: number;
  readonly notFetchedCount: number;
  /** Refused `shape-index` rows. Every one of them is on an `unmeasured` basis — a measured one is not refused. */
  readonly unmeasuredCount: number;
  /** The atlases the owner named that carry nothing refused — already clear, and worth saying so. */
  readonly namedAndClear: readonly string[];
}

/**
 * What would close one refused exclusion, read off the arm that already carries it.
 *
 * Only two shapes ever reach this — {@link isRefusedExclusion} admits `not-fetched` and `shape-index` on an
 * `unmeasured` basis and nothing else — and each of those carries a required non-empty string saying what
 * would close it. The last line is the compiler's price for that being true rather than a real branch: a
 * ground with no declared remedy falls back to its own prose instead of an empty cell.
 *
 * @param exclusion a refused exclusion
 * @returns the remedy that ground declares
 */
function remedyOf({ exclusion }: { exclusion: AtlasExclusion }): string {
  if (exclusion.ground === "not-fetched") {
    return exclusion.wouldBeClosedBy;
  }
  if (exclusion.ground === "shape-index" && exclusion.volume.basis === "unmeasured") {
    return exclusion.volume.wouldBeMeasuredBy;
  }
  return exclusion.because;
}

/**
 * Every refused row one atlas declares, in the order its descriptor declares them.
 *
 * @param platform the atlas these rows belong to
 * @param descriptor its own declaration
 * @returns its refused rows, each carrying the remedy its ground names
 */
export function refusedRowsOf({
  platform,
  descriptor,
}: {
  platform: string;
  descriptor: AtlasDescriptor;
}): readonly AtlasBacklogRow[] {
  return descriptor.excludes
    .filter((exclusion) => isRefusedExclusion({ exclusion }))
    .map((exclusion) => ({
      because: exclusion.because,
      ground: exclusion.ground,
      platform,
      remedy: remedyOf({ exclusion }),
    }));
}

/**
 * Where the owner's ruling puts one atlas.
 *
 * @param platform the atlas to place
 * @returns its 1-based position in {@link ATLAS_BACKLOG_ORDER}, or `null` when the owner did not name it
 */
export function namedPositionOf({ platform }: { platform: string }): number | null {
  const index = ATLAS_BACKLOG_ORDER.indexOf(platform);
  return index === -1 ? null : index + 1;
}

/** One atlas's share of any register, in the position the owner's ruling puts it.
 * @internal
 */
export interface AtlasPlatformGroup<TRow> {
  readonly platform: string;
  /** Where the owner's ruling puts this atlas, or `null` for one the owner did not name. */
  readonly namedPosition: number | null;
  readonly rows: readonly TRow[];
}

/**
 * Group rows by their atlas and sort the atlases into the order the owner asked for.
 *
 * The owner's nine come first, in their sequence, whether or not they are the densest — that is the whole
 * point of a stated order, and sorting them by count instead would quietly overrule it. Everything else follows,
 * densest first so the tail drains fastest, and ties break on the platform name so two runs of the same
 * tree print the same list.
 *
 * Generic over the row because the SAME ruling orders both halves of the coverage debt: the refused
 * exclusions a descriptor declares, and the kinds a published generation left `deferred`
 * ({@link ./deferredBacklog}). One sort, so the two registers can never disagree about where an atlas sits.
 *
 * @param rows every row to place, from every atlas
 * @returns one group per atlas that carries a row, ordered the owner's way
 */
export function groupByOwnerOrder<TRow extends { readonly platform: string }>({
  rows,
}: {
  rows: readonly TRow[];
}): readonly AtlasPlatformGroup<TRow>[] {
  const byPlatform = new Map<string, TRow[]>();
  for (const row of rows) {
    const held = byPlatform.get(row.platform);
    if (held === undefined) {
      byPlatform.set(row.platform, [row]);
    } else {
      held.push(row);
    }
  }
  const unordered: readonly AtlasPlatformGroup<TRow>[] = [...byPlatform.entries()].map(([platform, own]) => ({
    namedPosition: namedPositionOf({ platform }),
    platform,
    rows: own,
  }));
  return unordered.toSorted((left, right) => {
    if (left.namedPosition !== null && right.namedPosition !== null) {
      return left.namedPosition - right.namedPosition;
    }
    if (left.namedPosition !== null) {
      return -1;
    }
    if (right.namedPosition !== null) {
      return 1;
    }
    const byCount = right.rows.length - left.rows.length;
    return byCount === 0 ? left.platform.localeCompare(right.platform) : byCount;
  });
}

/**
 * The atlases the owner named that carry nothing in a register — already clear, and worth saying so.
 *
 * @param entries the register's own groups
 * @returns the owner's nine, minus every atlas the register holds a row for, in their sequence
 */
export function namedAndClearAgainst<TRow>({
  entries,
}: {
  entries: readonly AtlasPlatformGroup<TRow>[];
}): readonly string[] {
  const carrying = new Set(entries.map((entry) => entry.platform));
  return ATLAS_BACKLOG_ORDER.filter((platform) => !carrying.has(platform));
}

/**
 * Sort every atlas that carries refused rows into the order the owner asked for.
 *
 * @param rows every refused row this build declares, from every atlas
 * @returns the whole register, ordered and counted
 */
export function orderAtlasBacklog({ rows }: { rows: readonly AtlasBacklogRow[] }): AtlasBacklog {
  const entries = groupByOwnerOrder({ rows });
  return {
    entries,
    namedAndClear: namedAndClearAgainst({ entries }),
    notFetchedCount: rows.filter((row) => row.ground === "not-fetched").length,
    refusedCount: rows.length,
    unmeasuredCount: rows.filter((row) => row.ground === "shape-index").length,
  };
}
