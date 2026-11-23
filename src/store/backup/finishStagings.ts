/**
 * What a run does once every destination has been tried — a night's or a sweep's: name what each destination still
 * lacks, release the frozen copies of every staging all its destinations now hold, and prune.
 *
 * Done ONCE, after the last destination, never between two: a staging released or pruned after this Mac's send
 * would be gone before the SSD's. Both a release and a prune read parsed receipts against what each staging owes
 * (`./stagingDestinations.ts`), so a missing or truncated receipt, or a drive that was out, keeps everything.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ConfiguredDestination, DestinationId } from "./destinationConfig.js";
import { snapshotDirectory } from "./filesLeg.js";
import { releasePreparedFiles } from "./filesPrepare.js";
import { isStranded, prunableStagings, removeStaging, stagedDirectoryNames } from "./staging.js";
import { stagingUploadedToAll } from "./stagingDestinations.js";

/** The stagings one destination still lacks, by directory name. */
export interface StrandedFor {
  readonly destination: ConfiguredDestination;
  readonly names: readonly string[];
}

/** A staging finishing meant to release or prune and could not, so it stays on disk for a later run. */
export interface UnremovedStaging {
  readonly name: string;
  readonly why: string;
}

/** What finishing did. */
export interface FinishedStagings {
  readonly stranded: readonly StrandedFor[];
  /** Stagings whose frozen copies were released, because every destination they owe holds them. */
  readonly released: readonly string[];
  readonly pruned: readonly string[];
  /** What a release or prune could not remove — reported, never thrown, so the night's record is still written. */
  readonly unremoved: readonly UnremovedStaging[];
}

/**
 * Remove each name in turn, catching each one's throw, so one undeletable staging neither stops the rest nor
 * escapes the run before its `last.json` is written.
 *
 * @param names the staging directory names to remove
 * @param remove what removing one means
 * @returns what was removed, and what was not with why
 */
function removeEach({ names, remove }: { names: readonly string[]; remove: (name: string) => void }): {
  removed: readonly string[];
  unremoved: readonly UnremovedStaging[];
} {
  const removed: string[] = [];
  const unremoved: UnremovedStaging[] = [];
  for (const name of names) {
    try {
      remove(name);
      removed.push(name);
    } catch (error) {
      unremoved.push({ name, why: error instanceof Error ? error.message : String(error) });
    }
  }
  return { removed, unremoved };
}

/**
 * Name, release and prune, after every destination has been tried.
 *
 * @param root the staging root
 * @param tonight tonight's staging directory name, left out of what is NAMED stranded — its own report says it —
 *   or `null` for a sweep
 * @param destinations every configured destination, for the stranded names
 * @param obligations the ids every staging's obligation is read against
 * @param keepLocal how many eligible stagings to keep
 * @param prune whether to prune at all — `false` when nothing reached any destination tonight
 * @returns what each destination lacks, what was released, what was pruned and what could not be removed
 */
export function finishStagings({
  root,
  tonight,
  destinations,
  obligations,
  keepLocal,
  prune,
}: {
  root: string;
  tonight: string | null;
  destinations: readonly ConfiguredDestination[];
  obligations: readonly DestinationId[];
  keepLocal: number;
  prune: boolean;
}): FinishedStagings {
  const names = stagedDirectoryNames({ root });
  const stranded = destinations.map((destination) => ({
    destination,
    names: names.filter((name) => name !== tonight && isStranded({ destination, directory: join(root, name) })),
  }));
  const releasable = names.filter(
    (name) =>
      existsSync(snapshotDirectory({ directory: join(root, name) })) &&
      stagingUploadedToAll({ directory: join(root, name), obligations }),
  );
  const released = removeEach({
    names: releasable,
    remove: (name) => {
      releasePreparedFiles({ directory: join(root, name) });
    },
  });
  const pruned = removeEach({
    names: prune ? prunableStagings({ keep: keepLocal, obligations, root }) : [],
    remove: (name) => {
      removeStaging({ directory: join(root, name) });
    },
  });
  return {
    pruned: pruned.removed,
    released: released.removed,
    stranded,
    unremoved: [...released.unremoved, ...pruned.unremoved],
  };
}
