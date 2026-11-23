/**
 * Hand-built observations for the pass-reservation tests: `rankFixtures.ts`'s rows, signed in to a named provider
 * account so the account join (`codex/accountIdentity.ts`) has something to prove.
 */
import { makePassBound } from "../../../codex/bounds.js";
import type { CodexPlanObservation } from "../../../codex/fleetTypes.js";
import type { CodexPassReservation } from "../../../codex/passReservation.js";
import { unwrap } from "../../../lib/result.js";
import type { UsageLimitPercent } from "../../../plans/usageLimit.js";
import { gauge, NOW, observation, window } from "./rankFixtures.js";

/** A ten-minute pass bound: a reservation taken at {@link NOW} stands until 12:25. */
export const BOUND = unwrap(makePassBound({ boundSeconds: 600 }));

/** When a reservation taken at {@link NOW} under {@link BOUND} lapses. */
export const EXPIRES = "2026-09-22T12:25:00.000Z";

/**
 * A row whose weekly window reads `percent`, signed in as `account` (and `email`, when given).
 *
 * @param account the provider account id the live read carried, or undefined for none
 * @param readFrom where the weekly reading came from — a live read unless told otherwise
 * @returns the observation
 */
export function accountRow({
  account,
  alias,
  email,
  percent,
  readFrom = "live",
  usageLimitPercent = 100,
}: {
  account: string | undefined;
  alias: string;
  email?: string;
  percent: number | undefined;
  readFrom?: "live" | "rollout";
  usageLimitPercent?: UsageLimitPercent;
}): CodexPlanObservation {
  const reading =
    percent === undefined ? undefined : gauge({ observedAtIso: NOW, windows: [window({ usedPercent: percent })] });
  const base = observation({ alias, gauge: reading, readFrom, usageLimitPercent });
  return {
    ...base,
    live: {
      accountId: account,
      codexHome: base.destination.codexHome,
      email,
      gauges: [],
      kind: "signed-in",
      ordinaryUsageAllowed: undefined,
      planType: "pro",
      readAtIso: NOW,
      resetCreditsAvailable: 0,
    },
  };
}

/**
 * One standing reservation row, held at {@link NOW} on the given identities.
 *
 * @param identities the account digests the row was reserved against
 * @returns the row
 */
export function heldRow({
  expiresAtIso = EXPIRES,
  id,
  identities,
}: {
  expiresAtIso?: string;
  id: string;
  identities: readonly string[];
}): CodexPassReservation {
  return {
    accountIdentities: identities,
    accountKey: "a".repeat(64),
    acquiredAtIso: NOW,
    destinationAlias: "plan-one",
    expiresAtIso,
    id,
    pid: 4242,
    weeklyPoints: 1,
  };
}
