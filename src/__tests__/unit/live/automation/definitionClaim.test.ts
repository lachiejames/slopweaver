/**
 * The CLAIM on one due row — "a lease claimed on spawn that fails safe".
 *
 * Every case here is about the property that makes it fail safe: the expiry is the row's own next firing,
 * so nothing is tuned and a claim can never outlive the schedule it belongs to.
 */
import { describe, expect, it } from "vitest";

import {
  claimIsLive,
  liveClaimFor,
  nextFiringAfter,
  RecipeClaimErrors,
  type RecipeDefinitionClaim,
} from "../../../../live/automation/definitionClaim.js";

const HOURLY = "0 * * * *";

/** One stored claim, overridable field by field. */
function claim(over: Partial<RecipeDefinitionClaim> = {}): RecipeDefinitionClaim {
  return {
    claimId: "claim-0001",
    claimedAtIso: "2026-09-08T12:05:00.000Z",
    claimedBy: "supervisor-tick",
    expiresAtIso: "2026-09-08T13:00:00.000Z",
    slotIso: "2026-09-08T12:00:00.000Z",
    ...over,
  };
}

describe("nextFiringAfter", () => {
  it("expires a claim at the row's own next firing", () => {
    expect(nextFiringAfter({ afterIso: "2026-09-08T12:05:00.000Z", cadence: HOURLY })).toBe("2026-09-08T13:00:00.000Z");
  });

  it("reports a cadence it cannot read rather than inventing an expiry", () => {
    const result = nextFiringAfter({ afterIso: "2026-09-08T12:05:00.000Z", cadence: "every so often" });
    expect((result as { readonly error: string }).error).toContain("Invalid characters");
  });
});

describe("claimIsLive", () => {
  it("holds before the expiry", () => {
    expect(claimIsLive({ claim: claim(), nowIso: "2026-09-08T12:59:59.000Z" })).toBe(true);
  });

  it("is spent AT the expiry, so the firing that releases it is never also held by it", () => {
    expect(claimIsLive({ claim: claim(), nowIso: "2026-09-08T13:00:00.000Z" })).toBe(false);
  });

  it("treats an unparseable expiry as EXPIRED, so a corrupt claim releases a row rather than silencing it", () => {
    expect(claimIsLive({ claim: claim({ expiresAtIso: "not an instant" }), nowIso: "2026-09-08T12:10:00.000Z" })).toBe(
      false,
    );
  });
});

describe("liveClaimFor", () => {
  it("returns the claim holding a row", () => {
    const held = liveClaimFor({
      claims: { "knock-alerts": claim() },
      nowIso: "2026-09-08T12:30:00.000Z",
      recipeId: "knock-alerts",
    });
    expect(held?.claimedBy).toBe("supervisor-tick");
  });

  it("returns undefined for a row whose claim has expired", () => {
    const held = liveClaimFor({
      claims: { "knock-alerts": claim() },
      nowIso: "2026-09-08T14:00:00.000Z",
      recipeId: "knock-alerts",
    });
    expect(held).toBe(undefined);
  });

  it("returns undefined for a row nothing claimed", () => {
    const held = liveClaimFor({ claims: {}, nowIso: "2026-09-08T12:30:00.000Z", recipeId: "knock-alerts" });
    expect(held).toBe(undefined);
  });
});

describe("RecipeClaimErrors", () => {
  it("names the holder and the expiry a caller has to wait for", () => {
    const error = RecipeClaimErrors.alreadyHeld({
      expiresAtIso: "2026-09-08T13:00:00.000Z",
      heldBy: "supervisor-tick",
      recipeId: "knock-alerts",
    });
    expect(error.code).toBe("ALREADY_HELD");
    expect(error.message).toContain("already claimed by supervisor-tick");
    expect(error.message).toContain("2026-09-08T13:00:00.000Z");
  });

  it("says an unschedulable cadence leaves no firing to expire the claim at", () => {
    const error = RecipeClaimErrors.cadenceUnschedulable({
      cadence: "every so often",
      reason: "bad expression",
      recipeId: "knock-alerts",
    });
    expect(error.code).toBe("CADENCE_UNSCHEDULABLE");
    expect(error.message).toContain("no next firing to expire the claim at");
  });
});
