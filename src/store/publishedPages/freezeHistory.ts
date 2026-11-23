/**
 * The store half of `briefing freeze`'s new-history refusal (`../../outbound/briefing/freezeStore.ts` § A key with no
 * history is REFUSED): a freeze without `--new` naming a key the store holds no version of is refused, and the refusal
 * names the held keys a hair away from it. Asked inside the freeze's own transaction, after its page lock, so a
 * history created or removed concurrently is seen as it is.
 *
 * The criterion is a version COUNT of zero, not a missing page row: a local page published with no version yet would
 * be a page with no history to extend.
 */
import { count, eq } from "drizzle-orm";

import { levenshteinDistance } from "#lib/editDistance.js";

import type { StoreWriter } from "../client.js";
import { publishedPageVersionTable } from "../schema/publishedPages.js";

import { type PagesFreezeOpensHistoryError, PublishedPagesImportErrors } from "./errors.js";

/** Measured on a real key drift: the forked id differed from the canonical one by two substitutions. */
const NEIGHBOUR_DISTANCE_MAX = 2;

/** How many neighbours a refusal names before it stops (rule 7 — a refusal is read in a terminal). */
const NEIGHBOUR_NAMED_MAX = 3;

/**
 * The held keys within two characters of a key, nearest first, at most three.
 *
 * @param key the key the freeze resolved to
 * @param held every held key with its version count
 * @returns the neighbours, each with its distance
 */
export function freezeNeighbours({
  key,
  held,
}: {
  key: string;
  held: readonly { key: string; versions: number }[];
}): PagesFreezeOpensHistoryError["neighbours"] {
  return held
    .map((row) => ({ ...row, distance: levenshteinDistance({ left: row.key, right: key }) }))
    .filter((row) => row.distance > 0 && row.distance <= NEIGHBOUR_DISTANCE_MAX)
    .toSorted((left, right) => left.distance - right.distance)
    .slice(0, NEIGHBOUR_NAMED_MAX);
}

/**
 * Refuse a freeze that would open a history it was not told to open.
 *
 * @param writer the freeze's open transaction, which already holds the key's lock
 * @param key the freeze's key
 * @returns the refusal, or nothing when the key already holds a version
 */
export async function freezeOpensHistory({
  writer,
  key,
}: {
  writer: StoreWriter;
  key: string;
}): Promise<PagesFreezeOpensHistoryError | undefined> {
  const [own] = await writer
    .select({ versions: count() })
    .from(publishedPageVersionTable)
    .where(eq(publishedPageVersionTable.pageKey, key));
  if (own !== undefined && own.versions > 0) {
    return undefined;
  }
  const held = await writer
    .select({ key: publishedPageVersionTable.pageKey, versions: count() })
    .from(publishedPageVersionTable)
    .groupBy(publishedPageVersionTable.pageKey);
  return PublishedPagesImportErrors.freezeOpensHistory({ key, neighbours: freezeNeighbours({ held, key }) });
}
