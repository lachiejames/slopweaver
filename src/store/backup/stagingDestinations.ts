/**
 * Which destinations one staging OWES: recorded once, when the staging is created, so that what may be pruned
 * is a property of the staging and not of whatever the list says tonight.
 *
 * Adding a destination applies to stagings made from then on — it cannot make an older staging, whose file
 * snapshots may already be released, owe the new drive. Removing one with `--remove-destination` does lift its
 * obligation, because what is owed is the recorded set INTERSECTED with the destinations still configured.
 *
 * A staging written before the list existed records nothing, and is read as owing every configured destination:
 * the conservative reading, since it keeps the copy until each holds it. One whose record does not parse cannot
 * say what it owes, so it is kept (never eligible to prune) and offered to every destination's sweep.
 *
 * **What "configured" means for pruning.** A one-run `--destination` or environment override replaces the list for
 * that run's SENDS, but not for what is owed: pruning reads the union of the remembered list and the active one
 * ({@link pruneObligations}), so a one-off send cannot delete the only staging still owed to the remembered SSD.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { readJsonFile, writeJsonFile } from "#lib/jsonFile.js";

import type { ConfiguredDestination, DestinationId } from "./destinationConfig.js";
import { readReceipt } from "./receipts.js";

/** The file in a staging directory naming the destinations it owes. */
export const STAGING_DESTINATIONS_FILE = "destinations.json";

const stagingDestinationsSchema = z
  .object({ destinationIds: z.array(z.string().min(1)), schemaVersion: z.literal(1) })
  .strict();

/** What a staging owes, as read off its record. */
export type StagingObligation =
  | { readonly kind: "recorded"; readonly ids: readonly DestinationId[] }
  | { readonly kind: "unrecorded" }
  | { readonly kind: "unreadable" };

/**
 * Record which destinations a new staging owes. Throws on a failed write, like every other staging write.
 *
 * @param directory the staging directory, already created
 * @param destinations the destinations this run sends it to, in list order
 */
export function writeStagingDestinations({
  directory,
  destinations,
}: {
  directory: string;
  destinations: readonly ConfiguredDestination[];
}): void {
  writeJsonFile({
    path: join(directory, STAGING_DESTINATIONS_FILE),
    value: { destinationIds: destinations.map((destination) => destination.id), schemaVersion: 1 },
  });
}

/**
 * What one staging owes, read off its record.
 *
 * @param directory the staging directory
 * @returns the recorded ids, `unrecorded` when the staging carries no record and so owes every configured
 *   destination, or `unreadable` when the record does not parse
 */
export function stagingObligation({ directory }: { directory: string }): StagingObligation {
  const path = join(directory, STAGING_DESTINATIONS_FILE);
  if (!existsSync(path)) {
    return { kind: "unrecorded" };
  }
  const parsed = stagingDestinationsSchema.safeParse(readJsonFile({ path }));
  if (!parsed.success) {
    return { kind: "unreadable" };
  }
  return { ids: parsed.data.destinationIds, kind: "recorded" };
}

/**
 * Whether one staging owes one destination — the sweep's question, before it asks about a receipt.
 *
 * @param directory the staging directory
 * @param id the destination's stable id
 * @returns true unless the staging's record names other destinations only
 */
export function stagingOwes({ directory, id }: { directory: string; id: DestinationId }): boolean {
  const obligation = stagingObligation({ directory });
  if (obligation.kind !== "recorded") {
    return true;
  }
  return obligation.ids.includes(id);
}

/**
 * Whether every destination a staging still owes holds a readable receipt for it — pruning's whole criterion.
 *
 * @param directory the staging directory
 * @param obligations the ids still configured, from {@link pruneObligations}
 * @returns true only when the staging owes at least one of them and each holds its receipt
 */
export function stagingUploadedToAll({
  directory,
  obligations,
}: {
  directory: string;
  obligations: readonly DestinationId[];
}): boolean {
  const obligation = stagingObligation({ directory });
  if (obligation.kind === "unreadable") {
    return false;
  }
  const required =
    obligation.kind === "unrecorded" ? obligations : obligation.ids.filter((id) => obligations.includes(id));
  if (required.length === 0) {
    return false;
  }
  return required.every((id) => readReceipt({ directory, id }) !== null);
}

/**
 * The destinations pruning treats as still configured: the remembered list, plus tonight's active one when an
 * override replaced it, each id once, remembered first.
 *
 * @param remembered the remembered list, empty when none is set
 * @param active the destinations this run sends to
 * @returns the ids every staging's obligation is read against
 */
export function pruneObligations({
  remembered,
  active,
}: {
  remembered: readonly ConfiguredDestination[];
  active: readonly ConfiguredDestination[];
}): readonly DestinationId[] {
  return [...new Set([...remembered, ...active].map((destination) => destination.id))];
}
