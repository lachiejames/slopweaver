/**
 * `store import-fleet --only measurements` — every file under `bakeoff/`, `datadog-shots/`, `evidence/` and
 * `proof/`, into `measurement_blob` and `measurement_location`, with every body a `text` column cannot hold
 * uploaded to the Storage bucket `measurements` first.
 *
 * The files are read one at a time and folded as they are read, so only DISTINCT bodies stay resident, as the
 * `owner-turns` leg does. `datadog/` is deliberately NOT a root: `hits.jsonl` is a cache of raw events that
 * `src/datadog/detective/hitsCache.ts` says must never become a store of Datadog, and the catalogue is a
 * rebuilt census whose home is a table of its own (`docs/store/fleet-state-and-measurements.md` § "The measurements").
 */
import { readFileSync, statSync } from "node:fs";

import { errorMessage } from "#lib/errorMessage.js";
import { err, type Result } from "#lib/result.js";
import type { StoreClient } from "../../../store/client.js";
import { type FleetImportError, FleetImportErrors } from "../../../store/fleet/errors.js";
import { type HomeFileListing, homeRelativePath } from "../../../store/fleet/homeWalk.js";
import {
  foldMeasurements,
  type ProjectedMeasurement,
  projectMeasurementFile,
} from "../../../store/fleet/measurement.js";
import { listMeasurementFiles, measurementRoots } from "../../../store/fleet/measurementFiles.js";
import { importMeasurements, measurementObjects } from "../../../store/fleet/measurementStore.js";
import { MEASUREMENT_CLASSES } from "../../../store/schema/measurement.js";

import type { LegOutcome } from "./importFleetCore.js";

/**
 * Every measurement file under the home, projected one at a time; a directory or file that will not read is
 * pushed onto `refused` and skipped.
 *
 * @param home the state home
 * @param refused where each refusal is recorded, named with its path
 * @param tally how many files projected, counted as they are yielded
 * @returns a generator of projected files, in class then walk order
 */
function* projectedFiles({
  home,
  refused,
  tally,
}: {
  home: string;
  refused: FleetImportError[];
  tally: { projected: number };
}): Generator<ProjectedMeasurement> {
  const roots = measurementRoots({ home });
  for (const measurementClass of MEASUREMENT_CLASSES) {
    const listing = listMeasurementFiles({ root: roots[measurementClass] });
    for (const refusal of listingRefusals({ listing })) {
      refused.push(refusal);
    }
    for (const path of listing.files) {
      const projected = projectOne({ home, path });
      if (projected.isErr()) {
        refused.push(projected.error);
        continue;
      }
      tally.projected += 1;
      yield projected.value;
    }
  }
}

/**
 * What a listing refuses before any file is read: a directory that would not read, and every symbolic link.
 *
 * @param listing one root's walk
 * @returns one refusal per unreadable directory and per link
 */
function listingRefusals({ listing }: { listing: HomeFileListing }): readonly FleetImportError[] {
  const unreadable = listing.unreadable.map((entry) =>
    FleetImportErrors.unstorableMeasurement({
      path: entry.locator,
      reason: `the directory would not read: ${entry.why}`,
    }),
  );
  const links = listing.links.map((path) =>
    FleetImportErrors.unstorableMeasurement({
      path,
      reason: "it is a symbolic link — the store holds files, and a link is never followed out of its root",
    }),
  );
  return unreadable.concat(links);
}

/**
 * Read one file and project it.
 *
 * @param home the state home the path is made relative to
 * @param path the file, absolute
 * @returns the projected file, or the refusal naming why it would not read or project
 */
function projectOne({ home, path }: { home: string; path: string }): Result<ProjectedMeasurement, FleetImportError> {
  let bytes: Buffer;
  let fileModifiedAt: Date;
  try {
    bytes = readFileSync(path);
    fileModifiedAt = statSync(path).mtime;
  } catch (cause) {
    return err(FleetImportErrors.unstorableMeasurement({ path, reason: errorMessage({ error: cause }) }));
  }
  return projectMeasurementFile({ bytes, fileModifiedAt, relativePath: homeRelativePath({ home, path }) });
}

/**
 * Project every measurement file and, unless this is a dry run, upload the new objects and write the rows.
 *
 * @param client the open connection, or `undefined` on a dry run — which opens no Storage connection either
 * @param home the state home whose four roots are read; the Storage API is read off the running local stack
 * @returns what this leg did — `written` is new bodies plus new locations, so a re-run over an unchanged home
 *   reports zero
 */
export async function runMeasurementsLeg({
  client,
  home,
}: {
  client: StoreClient | undefined;
  home: string;
}): Promise<LegOutcome> {
  const refused: FleetImportError[] = [];
  const tally = { projected: 0 };
  const folded = foldMeasurements({ projected: projectedFiles({ home, refused, tally }) });
  const outcome = {
    absentSource: undefined,
    leg: "measurements" as const,
    projected: tally.projected,
    unreadableLines: 0,
  };
  if (client === undefined) {
    return { ...outcome, refused, written: 0 };
  }
  const written = await importMeasurements({ client, folded, objects: () => measurementObjects() });
  if (written.isErr()) {
    refused.push(FleetImportErrors.legWriteFailed({ path: home, reason: written.error.message }));
    return { ...outcome, refused, written: 0 };
  }
  return { ...outcome, refused, written: written.value.blobs + written.value.locations };
}
