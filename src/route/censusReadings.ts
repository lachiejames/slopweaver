/**
 * Read the Datadog census for one question — the effectful half of `./censusReading.ts`.
 *
 * Reads the MANIFEST only (`readCatalogueManifest`), because `route plan` and `turn brief` run on every
 * question and the rows cost seconds. An install with no census reads as nothing rather than as an error: a
 * question on a machine that never built one routes exactly as it did before the census existed.
 */
import { DATADOG_ATLAS_DESCRIPTOR } from "../atlas/datadog/descriptor.js";
import { atlasFreshnessWindowMs } from "../atlas/kit/freshnessWindow.js";
import { type CensusAge, censusAge } from "../datadog/detective/censusAge.js";
import { readCatalogueManifest } from "../datadog/detective/store.js";
import { type CensusReading, censusBriefLines, censusServiceMatches } from "./censusReading.js";

/** What the census said about one question, with its age. */
export interface CensusRouteReading {
  readonly reading: CensusReading;
  readonly age: CensusAge;
}

/**
 * How long a census may stand before a reader calls it stale — the rebuild schedule's own window.
 *
 * @returns the window in milliseconds, from the Datadog atlas descriptor that schedules the rebuild
 */
export function censusStaleAfterMs(): number {
  return atlasFreshnessWindowMs({ descriptor: DATADOG_ATLAS_DESCRIPTOR });
}

/**
 * Read the census against one question.
 *
 * @param home the state home the census lives under
 * @param question the question as asked
 * @param nowMs the instant the age is judged at
 * @returns the matches and the census age, or nothing when this install holds no readable census
 */
export function censusRouteReading({
  home,
  question,
  nowMs,
}: {
  home: string;
  question: string;
  nowMs: number;
}): CensusRouteReading | null {
  const manifest = readCatalogueManifest({ home });
  if (manifest.isErr()) {
    return null;
  }
  return {
    age: censusAge({ manifest: manifest.value, nowMs, staleAfterMs: censusStaleAfterMs() }),
    reading: censusServiceMatches({ manifest: manifest.value, question }),
  };
}

/**
 * What the Datadog census says this question names, as `turn brief` lines — empty when it names nothing or this
 * install holds no census. The judging session should see that the telemetry estate holds a
 * name the question used, before it picks its legs. It is a HINT and says so — `./censusReading.ts` carries
 * why a name alone is never evidence the question is about telemetry.
 *
 * @param home the state home the census lives under
 * @param question the question as asked
 * @returns the lines, possibly none
 */
export function censusLinesFor({ home, question }: { home: string; question: string }): readonly string[] {
  const census = censusRouteReading({ home, nowMs: Date.now(), question });
  if (census === null) {
    return [];
  }
  return censusBriefLines({ ageLine: census.age.line, reading: census.reading });
}
