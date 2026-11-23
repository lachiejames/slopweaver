import { describe, expect, it } from "vitest";

import type { CrowdstrikeGap } from "../../../../atlas/crowdstrike/entities.js";
import { CrowdstrikeErrors } from "../../../../atlas/crowdstrike/errors.js";
import {
  classifyCrowdstrikeGap,
  openCrowdstrikeGap,
  openCrowdstrikeGaps,
  reconcileCrowdstrikeGaps,
} from "../../../../atlas/crowdstrike/gaps.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-04T00:00:00.000Z";
const LATER = "2026-09-05T00:00:00.000Z";

function gap({
  condition = "scope-refused",
  scope = "tenant/host",
}: { condition?: CrowdstrikeGap["condition"]; scope?: string } = {}): CrowdstrikeGap {
  return openCrowdstrikeGap({
    at: AT,
    condition,
    fields: [],
    kind: "host",
    reason: "refused",
    scope,
    surfaces: ["falcon-api"],
  });
}

describe("classifyCrowdstrikeGap", () => {
  it("maps each failure kind to its own condition", () => {
    expect(
      classifyCrowdstrikeGap({
        error: CrowdstrikeErrors.scopeRefused({ callId: "x", path: "/p", scope: "devices:read" }),
      }),
    ).toBe("scope-refused");
    expect(classifyCrowdstrikeGap({ error: CrowdstrikeErrors.routeAbsent({ callId: "x", path: "/p" }) })).toBe(
      "route-absent",
    );
    expect(
      classifyCrowdstrikeGap({ error: CrowdstrikeErrors.authFailed({ reason: "r", remintAttempted: true }) }),
    ).toBe("auth-failed");
    expect(classifyCrowdstrikeGap({ error: CrowdstrikeErrors.unusableResponse({ callId: "x", reason: "r" }) })).toBe(
      "schema-drift",
    );
  });
});

describe("openCrowdstrikeGap", () => {
  it("gives the same condition and scope the same identity across runs", () => {
    expect(gap().id).toBe(
      openCrowdstrikeGap({
        at: LATER,
        condition: "scope-refused",
        fields: [],
        kind: "host",
        reason: "other words",
        scope: "tenant/host",
        surfaces: [],
      }).id,
    );
  });

  it("gives a different scope a different identity", () => {
    expect(gap({ scope: "tenant/host" }).id).not.toBe(gap({ scope: "tenant/detection" }).id);
  });
});

describe("reconcileCrowdstrikeGaps", () => {
  it("keeps the ORIGINAL first-detection stamp when a gap is seen again", () => {
    const merged = unwrap(
      reconcileCrowdstrikeGaps({ at: LATER, observed: [gap()], rechecks: [], runFailed: false, stored: [gap()] }),
    );
    expect(merged[0]!.firstDetectedAt).toBe(AT);
    expect(merged[0]!.lastDetectedAt).toBe(LATER);
  });

  it("closes a gap only when its OWN condition and scope were rechecked", () => {
    const merged = unwrap(
      reconcileCrowdstrikeGaps({
        at: LATER,
        observed: [],
        rechecks: [{ condition: "scope-refused", resolved: true, scope: "tenant/host" }],
        runFailed: false,
        stored: [gap()],
      }),
    );
    expect(merged[0]!.status).toBe("closed");
  });

  it("does NOT close a gap whose scope was not the one rechecked", () => {
    const merged = unwrap(
      reconcileCrowdstrikeGaps({
        at: LATER,
        observed: [],
        rechecks: [{ condition: "scope-refused", resolved: true, scope: "tenant/detection" }],
        runFailed: false,
        stored: [gap()],
      }),
    );
    expect(merged[0]!.status).toBe("open");
  });

  it("closes NOTHING on a run that itself failed", () => {
    const merged = unwrap(
      reconcileCrowdstrikeGaps({
        at: LATER,
        observed: [],
        rechecks: [{ condition: "scope-refused", resolved: true, scope: "tenant/host" }],
        runFailed: true,
        stored: [gap()],
      }),
    );
    expect(merged[0]!.status).toBe("open");
  });
});

describe("openCrowdstrikeGaps", () => {
  it("returns only the open ones", () => {
    const closed = { ...gap({ scope: "tenant/detection" }), status: "closed" as const };
    expect(openCrowdstrikeGaps({ gaps: [gap(), closed] }).map((entry) => entry.scope)).toEqual(["tenant/host"]);
  });
});
