/**
 * Every admitted Datadog operation's response boundary, by registry name: the generated batches joined into one
 * lookup. Each boundary is built when this module loads (`../../lib/boundaryWalk.ts` requires it), so a schema
 * `defineBoundary` would refuse fails the import rather than the first sync to reach it.
 *
 * An operation the pinned specification declares as answering a file has no boundary, and is listed in
 * `generated/responseInventory.ts` instead.
 */
import { DATADOG_RESPONSE_BOUNDARIES_1 } from "./generated/responseBoundaries1.js";
import { DATADOG_RESPONSE_BOUNDARIES_2 } from "./generated/responseBoundaries2.js";
import { DATADOG_RESPONSE_BOUNDARIES_3 } from "./generated/responseBoundaries3.js";
import { DATADOG_RESPONSE_BOUNDARIES_4 } from "./generated/responseBoundaries4.js";
import type { DatadogResponseBoundary } from "./responseBoundary.js";

/**
 * Each admitted JSON operation's boundary, by registry name.
 * @internal
 */
export const DATADOG_RESPONSE_BOUNDARIES: ReadonlyMap<string, DatadogResponseBoundary> = new Map(
  [
    ...DATADOG_RESPONSE_BOUNDARIES_1,
    ...DATADOG_RESPONSE_BOUNDARIES_2,
    ...DATADOG_RESPONSE_BOUNDARIES_3,
    ...DATADOG_RESPONSE_BOUNDARIES_4,
  ].map((boundary) => [boundary.surface, boundary]),
);
