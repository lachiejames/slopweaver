/*
 * What the `fleet-unhealthy` verdict's split test files share beyond `../fleetHealthFixtures.js`: the claimed
 * firing that never started, and the one window with two broken rows that both `evaluateFleetUnhealthy` files
 * judge. It moved here when the verdict's one test file was split by behaviour.
 */
import type { ProbedAttempt } from "../../../../monitor/fleetHealthAttempts.js";

import { DIED_BY_LEASE, FAILED, many } from "../fleetHealthFixtures.js";

/** A lease run out on a firing a seat claimed and never started — a resync reads DEFERRED. */
export const NEVER_STARTED: { readonly leaseExpiresIso: string; readonly outcome: null } = {
  leaseExpiresIso: "2026-09-29T11:00:00.000Z",
  outcome: null,
};

/** Six clean runs of one row, two failures of another and two deaths of a third, all inside the day. */
export const TWO_BROKEN: readonly ProbedAttempt[] = [
  ...many({ count: 6, shape: { recipeId: "atlas-linear" } }),
  ...many({ count: 2, shape: { outcome: FAILED, recipeId: "atlas-hex" } }),
  ...many({ count: 2, shape: { ...DIED_BY_LEASE, recipeId: "resync-corpus-slack" } }),
];
