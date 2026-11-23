/**
 * The three `fleet-ceiling-report` seams of `RecipeRunDueDeps` for a suite no such row reaches: each answers a
 * failure naming that, so a dispatch bug that did reach one reads as a failed firing rather than a quiet success.
 * A suite that does run one spreads this FIRST and overrides the seam it records after it.
 */
import { FleetCeilingDeliveryErrors } from "../cli/commands/automation/fleetCeilingDeliveryErrors.js";
import type { RecipeRunDueDeps } from "../cli/commands/automation/rowRunners.js";
import { err } from "../lib/result.js";

/** Why each seam answers a failure here. */
const UNREACHED = "no fleet-ceiling-report row reaches this suite";

/** Every `fleet-ceiling-report` seam, each answering {@link UNREACHED}. */
export const UNREACHED_FLEET_CEILING_SEAMS: Pick<
  RecipeRunDueDeps,
  "readFleetCeilingReport" | "readFleetWhy" | "deliverFleetCeiling" | "withdrawFleetCeilingCard"
> = {
  deliverFleetCeiling: ({ delivery }) =>
    Promise.resolve(err(FleetCeilingDeliveryErrors.cardFailed({ slug: delivery.slug, why: UNREACHED }))),
  readFleetCeilingReport: () => Promise.resolve(err([UNREACHED])),
  readFleetWhy: () => ({ kind: "unreadable", reason: UNREACHED }),
  withdrawFleetCeilingCard: ({ slug }) =>
    Promise.resolve(err(FleetCeilingDeliveryErrors.cardFailed({ slug, why: UNREACHED }))),
};
