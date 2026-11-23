/**
 * The compiled sync's census check: this run's own numbers against the reviewed pin, before anything is
 * published. Its own module so the comparison is reachable without the verb that calls it.
 */
import { compiledCensusMismatch } from "../kit/compiledSync.js";

import { MICROSOFT365_ATLAS_PLATFORM } from "./model.js";
import { MICROSOFT365_METHOD_CENSUS, MICROSOFT365_SPEC_PIN } from "./specLock.js";

/**
 * Every way this run's own numbers can disagree with what was reviewed.
 *
 * A thin binding over `kit/compiledSync.ts`, which carries the comparison and the message both compiled
 * atlases share. Exported so a test can drive it without a 44 MB document: the numbers it checks are the
 * whole point of the verb, and a check reachable only through a network fetch is a check nothing exercises.
 *
 * @param census what this run measured
 * @returns every disagreement, or `null` when the census is exactly the pinned one
 *
 * @internal
 */
export function microsoft365CensusMismatch({
  census,
}: {
  census: {
    pathCount: number;
    operationCount: number;
    methodCounts: Readonly<Record<string, number>>;
    rootCount: number;
    schemaCount: number;
  };
}): readonly string[] | null {
  return compiledCensusMismatch({
    census,
    pin: {
      methodCounts: MICROSOFT365_METHOD_CENSUS,
      operationCount: MICROSOFT365_SPEC_PIN.operationCount,
      pathCount: MICROSOFT365_SPEC_PIN.pathCount,
      rootCount: MICROSOFT365_SPEC_PIN.rootCount,
      schemaCount: MICROSOFT365_SPEC_PIN.schemaCount,
    },
    platform: MICROSOFT365_ATLAS_PLATFORM,
  });
}
