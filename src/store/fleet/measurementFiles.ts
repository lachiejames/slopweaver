/**
 * Finding the measurement files under a state home: every file under each of the four roots, at any depth,
 * except the OS-written ones `./measurement.ts` names. The walk itself is `./homeWalk.ts`.
 */
import { stateHomePaths } from "../../stateHome.js";

import { type HomeFileListing, listFilesUnder } from "./homeWalk.js";
import { isSkippedMeasurementName, type MeasurementClass } from "./measurement.js";

/**
 * Each class's absolute root under a state home.
 *
 * @param home the state home
 * @returns one root per class
 */
export function measurementRoots({ home }: { home: string }): Readonly<Record<MeasurementClass, string>> {
  const paths = stateHomePaths({ home });
  return {
    bakeoff: paths.bakeoff,
    "datadog-shots": paths.datadogShotsDir,
    evidence: paths.evidenceDir,
    proof: paths.proofDir,
  };
}

/**
 * Every measurement file under one root, at any depth.
 *
 * @param root the class's root
 * @returns the files found and every directory that would not read
 */
export function listMeasurementFiles({ root }: { root: string }): HomeFileListing {
  return listFilesUnder({ accept: (fileName) => !isSkippedMeasurementName({ fileName }), root });
}
