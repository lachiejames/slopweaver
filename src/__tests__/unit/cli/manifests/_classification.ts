/**
 * The six classification fields a manifest row declares for downstream gates, keyed by verb, so a manifest test
 * can assert one literal table and a classification swapped between two verbs fails under both keys.
 */
import type { CommandMeta } from "../../../../cli/defineCommand.js";
import type { VerbManifestEntry } from "../../../../cli/manifest.js";

/** The fields of a verb's meta that the door, catalog and reliability gates read. */
export type ManifestClassification = Pick<
  CommandMeta,
  "effect" | "doorRouted" | "createsWorkItem" | "diagnostic" | "dryParseSafe" | "parseRejectIsIoFree"
>;

/**
 * One verb's classification, copied field by field so prose fields never enter the comparison.
 *
 * @returns the six classification fields of the entry's meta
 */
export function classificationOf({ entry }: { entry: VerbManifestEntry }): ManifestClassification {
  return {
    createsWorkItem: entry.meta.createsWorkItem,
    diagnostic: entry.meta.diagnostic,
    doorRouted: entry.meta.doorRouted,
    dryParseSafe: entry.meta.dryParseSafe,
    effect: entry.meta.effect,
    parseRejectIsIoFree: entry.meta.parseRejectIsIoFree,
  };
}

/**
 * Every verb's classification, keyed by the verb itself.
 *
 * @returns a record from verb to its six classification fields
 */
export function classificationsOf({
  manifest,
}: {
  manifest: Readonly<Record<string, VerbManifestEntry>>;
}): Readonly<Record<string, ManifestClassification>> {
  return Object.fromEntries(
    Object.entries(manifest).map(([verb, entry]) => [verb, classificationOf({ entry })] as const),
  );
}
