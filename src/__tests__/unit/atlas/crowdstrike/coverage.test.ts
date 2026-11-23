import { describe, expect, it } from "vitest";

import {
  crowdstrikeCoverageStateFor,
  crowdstrikeKindScope,
  crowdstrikeUnblockedBy,
  failedCrowdstrikeCoverageCell,
  replaceCrowdstrikeCoverageCell,
  succeededCrowdstrikeCoverageCell,
} from "../../../../atlas/crowdstrike/coverage.js";
import { CrowdstrikeErrors } from "../../../../atlas/crowdstrike/errors.js";

const AT = "2026-09-04T00:00:00.000Z";

describe("crowdstrikeCoverageStateFor", () => {
  it("grades a scope refusal unreadable, never not-configured", () => {
    const error = CrowdstrikeErrors.scopeRefused({
      callId: "alert-ids",
      path: "/alerts/queries/alerts/v2",
      scope: "alerts:read",
    });
    expect(crowdstrikeCoverageStateFor({ error })).toBe("unreadable");
  });

  it("grades a 404 unavailable, because the route may never have been provisioned", () => {
    const error = CrowdstrikeErrors.routeAbsent({ callId: "x", path: "/incidents/queries/incidents/v1" });
    expect(crowdstrikeCoverageStateFor({ error })).toBe("unavailable");
  });

  it("grades a repeated auth failure invalid-configuration", () => {
    const error = CrowdstrikeErrors.authFailed({ reason: "HTTP 401 twice", remintAttempted: true });
    expect(crowdstrikeCoverageStateFor({ error })).toBe("invalid-configuration");
  });

  it("grades an incomplete read deferred, so it is retried rather than reported as a hole", () => {
    const error = CrowdstrikeErrors.incompleteRead({ callId: "x", observedSoFar: 40, reason: "cursor repeated" });
    expect(crowdstrikeCoverageStateFor({ error })).toBe("deferred");
  });
});

describe("crowdstrikeUnblockedBy", () => {
  it("names the exact scope a refusal needs", () => {
    const error = CrowdstrikeErrors.scopeRefused({ callId: "alert-ids", path: "/alerts", scope: "alerts:read" });
    expect(crowdstrikeUnblockedBy({ error })).toContain("Read on alerts:read");
  });

  it("offers nothing for a failure no action resolves", () => {
    const error = CrowdstrikeErrors.routeAbsent({ callId: "x", path: "/gone" });
    expect(crowdstrikeUnblockedBy({ error })).toBe(null);
  });
});

describe("coverage cells", () => {
  it("stamps a success with this run's instant and no unblocking advice", () => {
    const cell = succeededCrowdstrikeCoverageCell({
      at: AT,
      reason: "read 175 host(s)",
      role: "authoritative",
      scope: "tenant/host",
      surface: "falcon-api",
    });
    expect(cell.state).toBe("synced");
    expect(cell.lastSuccessAt).toBe(AT);
    expect(cell.latestAttemptFailed).toBe(false);
    expect(cell.unblockedBy).toBe(null);
  });

  it("carries a prior success forward through a failure", () => {
    const previous = succeededCrowdstrikeCoverageCell({
      at: AT,
      reason: "read 175 host(s)",
      role: "authoritative",
      scope: "tenant/host",
      surface: "falcon-api",
    });
    const error = CrowdstrikeErrors.scopeRefused({ callId: "x", path: "/devices", scope: "devices:read" });
    const cell = failedCrowdstrikeCoverageCell({
      error,
      previous,
      role: "authoritative",
      scope: "tenant/host",
      surface: "falcon-api",
    });
    expect(cell.lastSuccessAt).toBe(AT);
    expect(cell.latestAttemptFailed).toBe(true);
    expect(cell.state).toBe("unreadable");
  });
});

describe("replaceCrowdstrikeCoverageCell", () => {
  it("replaces one surface's cell and leaves the other surface's alone", () => {
    const api = succeededCrowdstrikeCoverageCell({
      at: AT,
      reason: "api",
      role: "authoritative",
      scope: "tenant/host",
      surface: "falcon-api",
    });
    const browser = succeededCrowdstrikeCoverageCell({
      at: AT,
      reason: "browser",
      role: "authoritative",
      scope: "tenant/host",
      surface: "falcon-console",
    });
    const replaced = replaceCrowdstrikeCoverageCell({ cell: { ...api, reason: "api again" }, cells: [api, browser] });
    expect(replaced.map((cell) => [cell.surface, cell.reason])).toEqual([
      ["falcon-api", "api again"],
      ["falcon-console", "browser"],
    ]);
  });
});

describe("crowdstrikeKindScope", () => {
  it("scopes a cell to the tenant and the kind", () => {
    expect(crowdstrikeKindScope({ kind: "prevention-policy" })).toBe("tenant/prevention-policy");
  });
});
