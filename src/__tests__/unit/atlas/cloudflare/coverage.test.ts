import { describe, expect, it } from "vitest";

import {
  cloudflareCoverageFreshness,
  failedCloudflareCoverageCell,
  hasUsableCloudflareCoverage,
  isUsableCloudflareCoverageCell,
  priorCoverageCell,
  succeededCloudflareCoverageCell,
} from "../../../../atlas/cloudflare/coverage.js";
import { CLOUDFLARE_VISIBILITY_SCOPE } from "../../../../atlas/cloudflare/model.js";

const AT = "2026-01-01T00:00:00.000Z";

describe("succeededCloudflareCoverageCell", () => {
  it("stamps a fresh success", () => {
    const cell = succeededCloudflareCoverageCell({ at: AT, reason: "read 3 zones", scope: "s", state: "synced" });
    expect(cell).toEqual({
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: "read 3 zones",
      scope: "s",
      state: "synced",
      unblockedBy: null,
      visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
    });
  });
});

describe("failedCloudflareCoverageCell", () => {
  it("carries forward a prior success", () => {
    const previous = succeededCloudflareCoverageCell({ at: AT, reason: "ok", scope: "s", state: "synced" });
    const cell = failedCloudflareCoverageCell({
      previous,
      reason: "boom",
      scope: "s",
      state: "unreadable",
      unblockedBy: null,
    });
    expect(cell.lastSuccessAt).toBe(AT);
    expect(cell.latestAttemptFailed).toBe(true);
  });

  it("has no prior success when there was none", () => {
    const cell = failedCloudflareCoverageCell({
      previous: null,
      reason: "boom",
      scope: "s",
      state: "unreadable",
      unblockedBy: "a fresh token",
    });
    expect(cell.lastSuccessAt).toBeNull();
    expect(cell.unblockedBy).toBe("a fresh token");
  });
});

describe("priorCoverageCell", () => {
  it("finds the cell recorded under the attempted scope, and only that one", () => {
    const mine = succeededCloudflareCoverageCell({ at: AT, reason: "mine", scope: "s", state: "synced" });
    const other = succeededCloudflareCoverageCell({ at: AT, reason: "other", scope: "t", state: "synced" });
    expect(priorCoverageCell({ coverage: [other, mine], scope: "s" })).toBe(mine);
  });

  it("reads a scope with no recorded cell as no history: null", () => {
    const other = succeededCloudflareCoverageCell({ at: AT, reason: "other", scope: "t", state: "synced" });
    expect(priorCoverageCell({ coverage: [other], scope: "s" })).toBe(null);
    expect(priorCoverageCell({ coverage: [], scope: "s" })).toBe(null);
  });
});

describe("isUsableCloudflareCoverageCell / hasUsableCloudflareCoverage", () => {
  it("is usable only when synced", () => {
    const synced = succeededCloudflareCoverageCell({ at: AT, reason: "ok", scope: "s", state: "synced" });
    const deferred = succeededCloudflareCoverageCell({ at: AT, reason: "ok", scope: "s", state: "deferred" });
    expect(isUsableCloudflareCoverageCell({ cell: synced })).toBe(true);
    expect(isUsableCloudflareCoverageCell({ cell: deferred })).toBe(false);
  });

  it("reports usable if at least one cell is usable", () => {
    const synced = succeededCloudflareCoverageCell({ at: AT, reason: "ok", scope: "s", state: "synced" });
    const failed = failedCloudflareCoverageCell({
      previous: null,
      reason: "boom",
      scope: "t",
      state: "unreadable",
      unblockedBy: null,
    });
    expect(hasUsableCloudflareCoverage({ cells: [failed, synced] })).toBe(true);
    expect(hasUsableCloudflareCoverage({ cells: [failed] })).toBe(false);
  });
});

describe("cloudflareCoverageFreshness", () => {
  it("delegates to the freshness assessment", () => {
    const cell = succeededCloudflareCoverageCell({ at: AT, reason: "ok", scope: "s", state: "synced" });
    const assessment = cloudflareCoverageFreshness({ cell, nowMs: Date.parse(AT) });
    expect(assessment.verdict).toBe("current");
  });
});
