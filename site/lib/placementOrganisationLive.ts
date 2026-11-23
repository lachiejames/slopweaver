/**
 * The one effectful read of the organisation on the console side: run the allowlisted `org show --json` row and hand
 * back the fields the console reads — its team label and its placement, from the one reading. The pure half — the shape and its validation — is `./placementOrganisation.ts`.
 */
import { err, type Result } from "neverthrow";

import { type LiveResult, runLiveVerb } from "./liveVerbRun";
import { liveVerbFor } from "./liveVerbs";
import { organisationNotConfiguredWhy } from "./organisationContext";
import {
  ORGANISATION_SLUG,
  type PlacementOrganisation,
  type PlacementOrganisationError,
  PlacementOrganisationErrors,
  parsePlacementOrganisation,
} from "./placementOrganisation";

/**
 * The organisation as a live reading resolves it — the pure step after the spawn.
 *
 * @param reading what the allowlisted verb answered
 * @returns the console's fields, or the verb's own failure sentence — which, for an absent row, names
 *   `slopweaver org set`
 */
export function placementOrganisationOf({
  reading,
}: {
  reading: LiveResult;
}): Result<PlacementOrganisation, PlacementOrganisationError> {
  if (!reading.ok) {
    return err(PlacementOrganisationErrors.readFailed({ notMeasured: reading.notMeasured }));
  }
  // An unwritten store answers exit 3, which the row declares as its expected-empty payload; its sentence names
  // `org set`, so it is the refusal, never a document missing every field.
  const notConfigured = organisationNotConfiguredWhy({ payload: reading.payload });
  if (notConfigured !== undefined) {
    return err(PlacementOrganisationErrors.readFailed({ notMeasured: notConfigured }));
  }
  return parsePlacementOrganisation({ value: reading.payload });
}

/**
 * Read the organisation through `slopweaver org show --json`.
 *
 * @returns the console's fields, or why there are none
 */
export async function readPlacementOrganisation(): Promise<Result<PlacementOrganisation, PlacementOrganisationError>> {
  // The row is a literal in the allowlist, so a missing one is this file and the list disagreeing — a defect.
  const verb = liveVerbFor({ slug: ORGANISATION_SLUG })!;
  return placementOrganisationOf({ reading: await runLiveVerb({ verb }) });
}
