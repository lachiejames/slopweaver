/**
 * The `authored_absent` half of `store import-fleet --only authored` (`./importAuthoredLeg.ts`): after the files
 * are written, a run that walked the whole home, from the store its own `secrets/store-url` selected, rewrites
 * `authored_absent` with the stored paths it did not find, so `store authored-restore` never brings back a file
 * deleted since it was stored. A listed file the read found deleted (`./importAuthoredRead.ts`) is absent on this
 * same run.
 */
import type { StoreClient } from "../../../store/client.js";
import { storeUrlSelection } from "../../../store/config.js";
import { absentAuthoredPaths } from "../../../store/fleet/authoredFile.js";
import type { AuthoredListing } from "../../../store/fleet/authoredFiles.js";
import { readStoredAuthoredPaths, replaceAuthoredAbsent } from "../../../store/fleet/authoredStore.js";
import { type FleetImportError, FleetImportErrors } from "../../../store/fleet/errors.js";
import { homeRelativePath } from "../../../store/fleet/homeWalk.js";

import { listedFilesStillPresent } from "./importAuthoredRead.js";

/**
 * Why this import may not rewrite `authored_absent`, or `undefined` when it may.
 *
 * The set is only as true as the walk: a directory that would not read lists none of its files, and a home that
 * is not the one the store belongs to lists none of the store's — either would mark live files deleted, and a
 * restore would then leave them out.
 *
 * @param unreadable how many directories the walk could not read
 * @param ownSelection whether this home's own `secrets/store-url` selected the database
 * @param writeFailed whether the leg's own write already failed
 * @returns the note naming why nothing was recorded, or `undefined`
 */
export function absenceWithheldBecause({
  unreadable,
  ownSelection,
  writeFailed,
}: {
  unreadable: number;
  ownSelection: boolean;
  writeFailed: boolean;
}): string | undefined {
  if (writeFailed) {
    return "absent paths not recorded — the write failed";
  }
  if (unreadable > 0) {
    return `absent paths not recorded — ${String(unreadable)} director(ies) would not read, so the walk is not the whole home`;
  }
  if (!ownSelection) {
    return "absent paths not recorded — the store was not selected by this home's own secrets/store-url, so its paths are not known to come from this home";
  }
  return undefined;
}

/**
 * Why a computed absent set is not recorded after all, or `undefined` when it may be.
 *
 * Own selection is a correlation, not proof: a throwaway home given a copy of `secrets/store-url` selects the
 * live store as its own, and its walk would mark nearly every live file deleted. Real deletion is a small share
 * of a home — the first rehearsal found 22 deleted recipe definitions against 17,945 files present — so a set
 * larger than the walk itself reads as another home, and is refused rather than recorded.
 *
 * @param absent how many stored paths the walk did not find
 * @param listed how many files the walk found
 * @returns the note naming why nothing was recorded, or `undefined`
 */
export function absenceOutweighsWalk({ absent, listed }: { absent: number; listed: number }): string | undefined {
  if (absent > listed) {
    return `absent paths not recorded — ${String(absent)} stored path(s) missing against ${String(listed)} on disk reads as another home, not deletions`;
  }
  return undefined;
}

/** Whether this home's own `secrets/store-url`, not the environment, selected the database. */
function ownStoreSelection({ home }: { home: string }): boolean {
  const selection = storeUrlSelection({ home });
  return selection.isOk() && selection.value.origin === "secret";
}

/**
 * Rewrite `authored_absent` from this walk, or say why not.
 *
 * @param client the open connection
 * @param home the state home the walk read
 * @param present every home-relative path the walk listed that the read did not find deleted
 * @param listedCount how many files the walk listed — the foreign-home guard's denominator, kept apart from
 *   `present` so a home whose only listed file vanished still records that one deletion
 * @param unreadable how many directories the walk could not read
 * @param refused where a database failure is recorded, and read for one the import already hit
 * @returns the one note to print
 */
async function recordAbsence({
  client,
  home,
  present,
  listedCount,
  unreadable,
  refused,
}: {
  client: StoreClient;
  home: string;
  present: readonly string[];
  listedCount: number;
  unreadable: number;
  refused: FleetImportError[];
}): Promise<string> {
  const withheld = absenceWithheldBecause({
    ownSelection: ownStoreSelection({ home }),
    unreadable,
    writeFailed: refused.some((error) => error.code === "LEG_WRITE_FAILED"),
  });
  if (withheld !== undefined) {
    return withheld;
  }
  const stored = await readStoredAuthoredPaths({ client });
  if (stored.isErr()) {
    refused.push(FleetImportErrors.legWriteFailed({ path: home, reason: stored.error.message }));
    return "absent paths not recorded — the stored paths would not read";
  }
  const absent = absentAuthoredPaths({ present, stored: stored.value });
  const foreign = absenceOutweighsWalk({ absent: absent.length, listed: listedCount });
  if (foreign !== undefined) {
    return foreign;
  }
  const counts = await replaceAuthoredAbsent({ absent, client });
  if (counts.isErr()) {
    refused.push(FleetImportErrors.legWriteFailed({ path: home, reason: counts.error.message }));
    return "absent paths not recorded — the write failed";
  }
  return `${String(counts.value.absent)} stored path(s) absent from disk, which authored-restore leaves out (${String(counts.value.noticed)} new, ${String(counts.value.cleared)} present again)`;
}

/**
 * The absence note for a write run, or none on a dry run, which never touches `authored_absent`.
 *
 * @param client the open connection, or `undefined` on a dry run
 * @param home the state home the walk read
 * @param listing what the walk found
 * @param refused where a database failure is recorded, and read for one the import already hit
 * @param vanished the home-relative paths the read found deleted since the walk, so absent on this run
 * @returns no line on a dry run, else the one absence note
 */
export async function absenceNotes({
  client,
  home,
  listing,
  refused,
  vanished,
}: {
  client: StoreClient | undefined;
  home: string;
  listing: AuthoredListing;
  refused: FleetImportError[];
  vanished: readonly string[];
}): Promise<readonly string[]> {
  if (client === undefined) {
    return [];
  }
  const present = listedFilesStillPresent({
    listed: listing.files.map((path) => homeRelativePath({ home, path })),
    vanished,
  });
  const note = await recordAbsence({
    client,
    home,
    listedCount: listing.files.length,
    present,
    refused,
    unreadable: listing.unreadable.length,
  });
  return [note];
}
