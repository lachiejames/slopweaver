/**
 * The one decoder of a reconciliation's disconnected hold — `disconnectedRows` and `disconnectedUnread` as
 * `handover reconcile --json` emits them (`../cli/commands/handover/reconcileRun.ts`'s `holdFields`).
 *
 * Two readers count on it: `./heldWork.ts` reports how many rows the hold took, and `./recipeFailureGate.ts`
 * exempts the slugs it names from the seats a recipe failure is owed. One copy each let them disagree — one
 * fed held-work a list naming a row beside an unlistable-store reason, and it reported the row held while
 * the gate called the same reading self-contradictory. A reading either decodes here or neither trusts it.
 */

import { INTEGRATION_NAMES } from "../handover/integrationNeeds.js";
import { isRecord } from "../lib/parsers.js";
import type { ListReading } from "./idleCapacityGate.js";

/**
 * One `disconnectedRows` entry exactly as `handover reconcile --json` emits it: a non-empty slug and path, and at
 * least one need, every one an integration the table carries.
 */
function isDisconnectedRow(entry: unknown): entry is { slug: string } {
  if (!isRecord(entry)) {
    return false;
  }
  const { needs, path, slug } = entry;
  return (
    typeof slug === "string" &&
    slug !== "" &&
    typeof path === "string" &&
    path !== "" &&
    Array.isArray(needs) &&
    needs.length > 0 &&
    needs.every((need) => typeof need === "string" && INTEGRATION_NAMES.includes(need))
  );
}

/**
 * The slugs a reconciliation held because they need an integration this install is not connected to, one per
 * held row. An absent list holds none, the way a reading from a build before the hold judged; a present list that
 * will not decode, an unread partner that is neither null nor a reason, or a row named beside an unlistable store
 * (`readDisconnected` holds nothing then) is unreadable, since a guess would either clear a row or invent one.
 *
 * @param reconciliation the parsed `handover reconcile --json` document
 * @returns the held slugs in the order the reading lists them, or why the reading cannot be trusted
 */
export function disconnectedSlugsOf({
  reconciliation,
}: {
  reconciliation: Record<string, unknown>;
}): ListReading<readonly string[]> {
  const listed = reconciliation["disconnectedRows"];
  if (listed === undefined) {
    return { kind: "read", value: [] };
  }
  if (!Array.isArray(listed) || !listed.every(isDisconnectedRow)) {
    return {
      kind: "unreadable",
      why: "the reconciliation's `disconnectedRows` is not a list of `{ needs, path, slug }` rows",
    };
  }
  const unread = reconciliation["disconnectedUnread"];
  // The writer emits both fields together, so a list without its null-or-reason partner is not its reading.
  if (unread !== null && typeof unread !== "string") {
    return { kind: "unreadable", why: "the reconciliation's `disconnectedUnread` is neither null nor a reason" };
  }
  if (typeof unread === "string" && listed.length > 0) {
    return {
      kind: "unreadable",
      why: "the reconciliation holds rows for a disconnected integration while saying the secrets store did not list",
    };
  }
  return { kind: "read", value: listed.map((entry) => entry.slug) };
}

/**
 * The first slug the hold names that the same reading's `held` list does not carry as a `blocked` row. The hold
 * demotes its row to `blocked` (`../handover/rowStanding.ts`), so a slug standing anywhere else — ready, held under
 * another standing, or absent — is a reading at odds with itself, and a count off it would invent a hold (a row the same
 * reading listed as ready is such a counterexample).
 *
 * @param slugs what {@link disconnectedSlugsOf} read
 * @param held the reconciliation's `held` entries, as it emitted them
 * @returns the contradicting slug, or `undefined` when every one is held blocked
 */
export function slugNotHeldBlocked({
  held,
  slugs,
}: {
  held: readonly unknown[];
  slugs: readonly string[];
}): string | undefined {
  const blocked = new Set(
    held.flatMap((entry) =>
      isRecord(entry) && entry["standing"] === "blocked" && typeof entry["id"] === "string" ? [entry["id"]] : [],
    ),
  );
  return slugs.find((slug) => !blocked.has(slug));
}
