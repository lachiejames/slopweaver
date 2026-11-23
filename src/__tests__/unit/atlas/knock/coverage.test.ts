import { describe, expect, it } from "vitest";

import {
  failedKnockCoverageCell,
  knockCoverageFreshness,
  succeededKnockCoverageCell,
} from "../../../../atlas/knock/coverage.js";
import { KNOCK_ATLAS_CHANNELS, type KnockArtifactRef } from "../../../../atlas/knock/model.js";

const AT = "2026-10-12T11:00:00.000Z";
const NOW_MS = Date.parse("2026-10-12T12:00:00.000Z");
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

const ARTIFACT: KnockArtifactRef = {
  byteLength: 2048,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "artifacts/workflows.png",
  sha256: "a".repeat(64),
};

const CHANNEL_SCOPES = [
  { channel: "api", scope: "api-credential-scope" },
  { channel: "browser", scope: "browser-signed-in-role" },
] as const;

describe("succeededKnockCoverageCell", () => {
  it("stamps the whole cell as a fresh success through the api channel", () => {
    const cell = succeededKnockCoverageCell({
      artifacts: [ARTIFACT],
      at: AT,
      channel: "api",
      reason: "read 12 workflow(s)",
      role: "authoritative",
      scope: "environment/development",
      state: "synced",
      surface: "management-api",
    });
    expect(cell).toStrictEqual({
      artifacts: [ARTIFACT],
      channel: "api",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: "read 12 workflow(s)",
      role: "authoritative",
      scope: "environment/development",
      state: "synced",
      surface: "management-api",
      unblockedBy: null,
      visibilityScope: "api-credential-scope",
    });
  });

  it("maps every channel to its own visibility ceiling", () => {
    expect(CHANNEL_SCOPES.map((entry) => entry.channel)).toStrictEqual([...KNOCK_ATLAS_CHANNELS]);
    const scopes = CHANNEL_SCOPES.map(
      ({ channel }) =>
        succeededKnockCoverageCell({
          artifacts: [],
          at: AT,
          channel,
          reason: "r",
          role: "corroborating",
          scope: "s",
          state: "synced",
          surface: "dashboard",
        }).visibilityScope,
    );
    expect(scopes).toStrictEqual(["api-credential-scope", "browser-signed-in-role"]);
  });

  it("does not alias the caller's artifacts array", () => {
    const artifacts: KnockArtifactRef[] = [ARTIFACT];
    const cell = succeededKnockCoverageCell({
      artifacts,
      at: AT,
      channel: "browser",
      reason: "r",
      role: "discovery",
      scope: "s",
      state: "synced",
      surface: "dashboard",
    });
    artifacts.push({ ...ARTIFACT, relativePath: "artifacts/other.png" });
    expect(cell.artifacts).toStrictEqual([ARTIFACT]);
  });
});

describe("failedKnockCoverageCell", () => {
  it("keeps the prior success and artifacts while this attempt's own fields replace the rest", () => {
    const previous = succeededKnockCoverageCell({
      artifacts: [ARTIFACT],
      at: AT,
      channel: "api",
      reason: "read 12 workflow(s)",
      role: "authoritative",
      scope: "environment/development",
      state: "synced",
      surface: "management-api",
    });
    const cell = failedKnockCoverageCell({
      channel: "browser",
      previous,
      reason: "signed out",
      role: "corroborating",
      scope: "environment/production",
      state: "unreadable",
      surface: "dashboard",
      unblockedBy: "sign in to the Knock dashboard",
    });
    expect(cell).toStrictEqual({
      artifacts: [ARTIFACT],
      channel: "browser",
      lastSuccessAt: AT,
      latestAttemptFailed: true,
      reason: "signed out",
      role: "corroborating",
      scope: "environment/production",
      state: "unreadable",
      surface: "dashboard",
      unblockedBy: "sign in to the Knock dashboard",
      visibilityScope: "browser-signed-in-role",
    });
    expect(cell.artifacts).not.toBe(previous.artifacts);
  });

  it("has no success and no artifacts when the surface was never touched", () => {
    const cell = failedKnockCoverageCell({
      channel: "api",
      previous: null,
      reason: "401 from the management api",
      role: "authoritative",
      scope: "environment/development",
      state: "invalid-configuration",
      surface: "management-api",
      unblockedBy: null,
    });
    expect(cell).toStrictEqual({
      artifacts: [],
      channel: "api",
      lastSuccessAt: null,
      latestAttemptFailed: true,
      reason: "401 from the management api",
      role: "authoritative",
      scope: "environment/development",
      state: "invalid-configuration",
      surface: "management-api",
      unblockedBy: null,
      visibilityScope: "api-credential-scope",
    });
  });

  it("maps every channel to its own visibility ceiling", () => {
    expect(CHANNEL_SCOPES.length).toBeGreaterThan(0);
    const scopes = CHANNEL_SCOPES.map(
      ({ channel }) =>
        failedKnockCoverageCell({
          channel,
          previous: null,
          reason: "r",
          role: "discovery",
          scope: "s",
          state: "unavailable",
          surface: "dashboard",
          unblockedBy: null,
        }).visibilityScope,
    );
    expect(scopes).toStrictEqual(CHANNEL_SCOPES.map((entry) => entry.scope));
  });
});

describe("knockCoverageFreshness", () => {
  const stampedAt = ({ iso }: { iso: string }) =>
    succeededKnockCoverageCell({
      artifacts: [],
      at: iso,
      channel: "api",
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "synced",
      surface: "management-api",
    });

  it("judges a cell five hours old current, because Knock declares a fourteen-day window", () => {
    const assessment = knockCoverageFreshness({
      cell: stampedAt({ iso: "2026-10-12T07:00:00.000Z" }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("current");
    expect(assessment.mayQuoteAsCurrent).toBe(true);
    expect(assessment.windowMs).toBe(FOURTEEN_DAYS_MS);
  });

  it("judges a cell just past fourteen days historical", () => {
    const assessment = knockCoverageFreshness({
      cell: stampedAt({ iso: "2026-09-28T11:59:00.000Z" }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("historical");
    expect(assessment.mayQuoteAsCurrent).toBe(false);
    expect(assessment.windowMs).toBe(FOURTEEN_DAYS_MS);
  });
});
