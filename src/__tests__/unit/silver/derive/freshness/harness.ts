/*
 * What the freshness contract's test files share: the stamp form of an observation, which the roster, moved-source
 * and settled-for-ask files all compare a later observation against.
 */
import type { FreshnessObservation, FreshnessStamp } from "../../../../../silver/derive/freshness.js";

/**
 * The stamp form of an observation, taken at `observedAtIso` (a minute before it was written, by default).
 *
 * @returns the observation as a version-one stamp, derived at the fixed instant the stale verdicts name
 */
export function stampOf({
  observation,
  observedAtIso = "2026-08-20T18:47:58.000Z",
}: {
  observation: FreshnessObservation;
  observedAtIso?: string | null;
}): FreshnessStamp {
  return { ...observation, artefacts: null, derivedAtIso: "2026-08-20T18:48:58.000Z", observedAtIso, version: 1 };
}
