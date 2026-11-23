import { describe, expect, it } from "vitest";

import {
  failedVantaCoverageCell,
  succeededVantaCoverageCell,
  vantaCoverageFreshness,
} from "../../../../atlas/vanta/coverage.js";
import type { VantaCoverageCell } from "../../../../atlas/vanta/model.js";

describe("succeededVantaCoverageCell", () => {
  it("stamps a synced, non-failed cell", () => {
    const cell = succeededVantaCoverageCell({
      artifacts: [],
      at: "2026-01-01T00:00:00.000Z",
      channel: "manage-api",
      reason: "3 read",
      role: "authoritative",
      scope: "controls-active",
      state: "synced",
      surface: "controls-active",
    });
    expect(cell.lastSuccessAt).toBe("2026-01-01T00:00:00.000Z");
    expect(cell.latestAttemptFailed).toBe(false);
    expect(cell.unblockedBy).toBeNull();
  });

  it("copies the artifacts array rather than aliasing it", () => {
    const artifacts = [
      {
        byteLength: 1,
        kind: "api-json" as const,
        mediaType: "application/json",
        relativePath: "a",
        sha256: "0".repeat(64),
      },
    ];
    const cell = succeededVantaCoverageCell({
      artifacts,
      at: "2026-01-01T00:00:00.000Z",
      channel: "manage-api",
      reason: "ok",
      role: "authoritative",
      scope: "x",
      state: "synced",
      surface: "x",
    });
    artifacts.push({
      byteLength: 2,
      kind: "api-json",
      mediaType: "application/json",
      relativePath: "b",
      sha256: "1".repeat(64),
    });
    expect(cell.artifacts).toHaveLength(1);
  });
});

describe("failedVantaCoverageCell", () => {
  it("carries forward the previous success, marking this attempt failed", () => {
    const previous: VantaCoverageCell = succeededVantaCoverageCell({
      artifacts: [],
      at: "2026-01-01T00:00:00.000Z",
      channel: "manage-api",
      reason: "ok",
      role: "authoritative",
      scope: "x",
      state: "synced",
      surface: "x",
    });
    const cell = failedVantaCoverageCell({
      channel: "manage-api",
      previous,
      reason: "boom",
      role: "authoritative",
      scope: "x",
      state: "unreadable",
      surface: "x",
      unblockedBy: null,
    });
    expect(cell.lastSuccessAt).toBe("2026-01-01T00:00:00.000Z");
    expect(cell.latestAttemptFailed).toBe(true);
  });

  it("has no prior success when this is the first attempt", () => {
    const cell = failedVantaCoverageCell({
      channel: "manage-api",
      previous: null,
      reason: "boom",
      role: "authoritative",
      scope: "x",
      state: "not-configured",
      surface: "x",
      unblockedBy: "set the env var",
    });
    expect(cell.lastSuccessAt).toBeNull();
    expect(cell.unblockedBy).toBe("set the env var");
  });
});
describe("vantaCoverageFreshness", () => {
  it("reads the cell's own lastSuccessAt/latestAttemptFailed", () => {
    const cell = succeededVantaCoverageCell({
      artifacts: [],
      at: "2026-01-01T00:00:00.000Z",
      channel: "manage-api",
      reason: "ok",
      role: "authoritative",
      scope: "x",
      state: "synced",
      surface: "x",
    });
    const assessment = vantaCoverageFreshness({ cell, nowMs: Date.parse("2026-01-01T01:00:00.000Z") });
    expect(assessment.verdict).toBe("current");
  });
});
