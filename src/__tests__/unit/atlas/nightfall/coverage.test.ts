import { describe, expect, it } from "vitest";

import {
  nightfallPublishedCoverageCell,
  nightfallUnconfiguredCoverageCell,
} from "../../../../atlas/nightfall/coverage.js";
import type { NightfallCoverageCell } from "../../../../atlas/nightfall/model.js";

const AT = "2026-10-01T00:00:00.000Z";
const PRIOR_AT = "2026-09-20T08:30:00.000Z";

const ARTIFACT = {
  byteLength: 4096,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "artifacts/console/findings.png",
  sha256: "b".repeat(64),
} as const;

/** A live-channel cell that once SUCCEEDED, as a stored generation would carry it. */
function priorSuccess({ channel }: { channel: "console" | "workflow-api" }): NightfallCoverageCell {
  return {
    artifacts: [ARTIFACT],
    channel,
    lastSuccessAt: PRIOR_AT,
    latestAttemptFailed: false,
    reason: "read the findings page",
    role: "corroborating",
    scope: "nightfall",
    state: "synced",
    surface: channel,
    unblockedBy: null,
    visibilityScope: "console-signed-in-roles",
  };
}

describe("nightfallPublishedCoverageCell", () => {
  it("stamps a nonzero kind as a fresh authoritative success quoting the operation count", () => {
    const cell = nightfallPublishedCoverageCell({ at: AT, kind: "finding", operations: 9 });
    expect(cell).toStrictEqual({
      artifacts: [],
      channel: "published-api",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason:
        "the vendor's six published documents declare 9 operation(s) for finding, and its record shape was read from their own component schemas; this grades the MAP, never this organisation's records",
      role: "authoritative",
      scope: "nightfall",
      state: "synced",
      surface: "published-api",
      unblockedBy: null,
      visibilityScope: "published-documents",
    });
  });

  it("grades a kind with no operations synced, with the zero-kind reason", () => {
    const cell = nightfallPublishedCoverageCell({ at: AT, kind: "hook", operations: 0 });
    expect(cell.state).toBe("synced");
    expect(cell.lastSuccessAt).toBe(AT);
    expect(cell.latestAttemptFailed).toBe(false);
    expect(cell.reason).toBe(
      "no published operation declares hook — it is declared so a channel that finds one has somewhere to land it",
    );
  });

  it("treats a single operation as nonzero", () => {
    const cell = nightfallPublishedCoverageCell({ at: AT, kind: "scan", operations: 1 });
    expect(cell.reason).toBe(
      "the vendor's six published documents declare 1 operation(s) for scan, and its record shape was read from their own component schemas; this grades the MAP, never this organisation's records",
    );
  });

  it("gives a fresh artifacts array on every call", () => {
    const first = nightfallPublishedCoverageCell({ at: AT, kind: "page", operations: 1 });
    const second = nightfallPublishedCoverageCell({ at: AT, kind: "page", operations: 1 });
    expect(first.artifacts).not.toBe(second.artifacts);
  });
});

describe("nightfallUnconfiguredCoverageCell", () => {
  it("grades workflow-api not-configured with the API key remedy and no prior success", () => {
    const cell = nightfallUnconfiguredCoverageCell({
      at: AT,
      channel: "workflow-api",
      kind: "finding",
      previous: null,
    });
    expect(cell).toStrictEqual({
      artifacts: [],
      channel: "workflow-api",
      lastSuccessAt: null,
      latestAttemptFailed: true,
      reason: "no Nightfall credential is configured on this installation, so no operation has been called",
      role: "authoritative",
      scope: "nightfall",
      state: "not-configured",
      surface: "workflow-api",
      unblockedBy:
        "mint a Nightfall API key in the console and store it: slopweaver secrets set nightfall-api-key — every published operation declares bearerAuth and this installation holds no Nightfall credential",
      visibilityScope: "bearer-token-scopes",
    });
  });

  it("grades console not-configured with the sign-in remedy and no prior success", () => {
    const cell = nightfallUnconfiguredCoverageCell({ at: AT, channel: "console", kind: "finding", previous: null });
    expect(cell).toStrictEqual({
      artifacts: [],
      channel: "console",
      lastSuccessAt: null,
      latestAttemptFailed: true,
      reason: "no signed-in console session exists in the owner's own Chrome, so no page has been opened",
      role: "corroborating",
      scope: "nightfall",
      state: "not-configured",
      surface: "console",
      unblockedBy:
        "sign in to app.nightfall.ai in the work Chrome profile, then run: slopweaver atlas nightfall walk — the cookie probe reports no session today and nothing here signs in on the owner's behalf",
      visibilityScope: "console-signed-in-roles",
    });
  });

  it("gives the two unconfigured channels different reasons and remedies", () => {
    const api = nightfallUnconfiguredCoverageCell({ at: AT, channel: "workflow-api", kind: "scan", previous: null });
    const signedIn = nightfallUnconfiguredCoverageCell({ at: AT, channel: "console", kind: "scan", previous: null });
    expect(api.reason).not.toBe(signedIn.reason);
    expect(api.unblockedBy).not.toBe(signedIn.unblockedBy);
  });

  it("grades every kind the same, because kind does not change the unconfigured cell", () => {
    const finding = nightfallUnconfiguredCoverageCell({ at: AT, channel: "console", kind: "finding", previous: null });
    const plugin = nightfallUnconfiguredCoverageCell({ at: AT, channel: "console", kind: "plugin", previous: null });
    expect(plugin).toStrictEqual(finding);
  });

  it("keeps a workflow-api prior success's instant and artifacts through a failure", () => {
    const previous = priorSuccess({ channel: "workflow-api" });
    const cell = nightfallUnconfiguredCoverageCell({ at: AT, channel: "workflow-api", kind: "finding", previous });
    expect(cell.lastSuccessAt).toBe(PRIOR_AT);
    expect(cell.artifacts).toStrictEqual([ARTIFACT]);
    expect(cell.latestAttemptFailed).toBe(true);
    expect(cell.state).toBe("not-configured");
    expect(cell.visibilityScope).toBe("bearer-token-scopes");
  });

  it("keeps a console prior success's instant and artifacts through a failure", () => {
    const previous = priorSuccess({ channel: "console" });
    const cell = nightfallUnconfiguredCoverageCell({ at: AT, channel: "console", kind: "finding", previous });
    expect(cell.lastSuccessAt).toBe(PRIOR_AT);
    expect(cell.artifacts).toStrictEqual([ARTIFACT]);
    expect(cell.latestAttemptFailed).toBe(true);
    expect(cell.reason).toBe(
      "no signed-in console session exists in the owner's own Chrome, so no page has been opened",
    );
  });

  it("does not stamp this run's instant on a failure", () => {
    const cell = nightfallUnconfiguredCoverageCell({ at: AT, channel: "console", kind: "finding", previous: null });
    expect(cell.lastSuccessAt).toBe(null);
  });
});
