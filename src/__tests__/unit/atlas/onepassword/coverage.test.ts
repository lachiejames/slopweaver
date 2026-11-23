import { describe, expect, it } from "vitest";

import {
  failedOnepasswordCoverageCell,
  findCoverageCell,
  onepasswordCoverageFreshness,
  succeededOnepasswordCoverageCell,
} from "../../../../atlas/onepassword/coverage.js";
import { ONEPASSWORD_CHANNELS, type OnepasswordArtifactRef } from "../../../../atlas/onepassword/model.js";

const AT = "2026-10-12T11:00:00.000Z";
const NOW_MS = Date.parse("2026-10-12T12:00:00.000Z");
const THIRTY_SIX_HOURS_MS = 36 * 60 * 60 * 1000;

const ARTIFACT: OnepasswordArtifactRef = {
  byteLength: 2048,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "artifacts/vaults.png",
  sha256: "d".repeat(64),
};

describe("succeededOnepasswordCoverageCell", () => {
  it("stamps the whole cell as a fresh success with the admin-visible boundary", () => {
    const cell = succeededOnepasswordCoverageCell({
      artifacts: [ARTIFACT],
      at: AT,
      channel: "admin-cli",
      reason: "read 14 vault(s)",
      role: "authoritative",
      scope: "account/acme",
      state: "synced",
      surface: "vaults",
    });
    expect(cell).toStrictEqual({
      artifacts: [ARTIFACT],
      channel: "admin-cli",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: "read 14 vault(s)",
      role: "authoritative",
      scope: "account/acme",
      state: "synced",
      surface: "vaults",
      unblockedBy: null,
      visibilityScope: "admin-visible",
    });
  });

  it("gives every channel the one admin-visible boundary", () => {
    expect(ONEPASSWORD_CHANNELS.length).toBeGreaterThan(0);
    const scopes = ONEPASSWORD_CHANNELS.map(
      (channel) =>
        succeededOnepasswordCoverageCell({
          artifacts: [],
          at: AT,
          channel,
          reason: "r",
          role: "corroborating",
          scope: "s",
          state: "synced",
          surface: "vaults",
        }).visibilityScope,
    );
    expect(scopes).toStrictEqual(["admin-visible", "admin-visible", "admin-visible"]);
  });

  it("records the channel that produced each look", () => {
    const channels = ONEPASSWORD_CHANNELS.map(
      (channel) =>
        succeededOnepasswordCoverageCell({
          artifacts: [],
          at: AT,
          channel,
          reason: "r",
          role: "corroborating",
          scope: "s",
          state: "synced",
          surface: "vaults",
        }).channel,
    );
    expect(channels).toStrictEqual(["admin-cli", "events-api", "browser"]);
  });

  it("does not alias the caller's artifacts array", () => {
    const artifacts: OnepasswordArtifactRef[] = [ARTIFACT];
    const cell = succeededOnepasswordCoverageCell({
      artifacts,
      at: AT,
      channel: "browser",
      reason: "r",
      role: "discovery",
      scope: "s",
      state: "synced",
      surface: "vaults",
    });
    artifacts.push({ ...ARTIFACT, relativePath: "artifacts/other.png" });
    expect(cell.artifacts).toStrictEqual([ARTIFACT]);
  });
});

describe("failedOnepasswordCoverageCell", () => {
  it("keeps the prior success and artifacts while this attempt's own fields replace the rest", () => {
    const previous = succeededOnepasswordCoverageCell({
      artifacts: [ARTIFACT],
      at: AT,
      channel: "admin-cli",
      reason: "read 14 vault(s)",
      role: "authoritative",
      scope: "account/acme",
      state: "synced",
      surface: "vaults",
    });
    const cell = failedOnepasswordCoverageCell({
      channel: "events-api",
      previous,
      reason: "token expired",
      role: "corroborating",
      scope: "account/other",
      state: "unreadable",
      surface: "audit-events",
      unblockedBy: "mint a new events api token",
    });
    expect(cell).toStrictEqual({
      artifacts: [ARTIFACT],
      channel: "events-api",
      lastSuccessAt: AT,
      latestAttemptFailed: true,
      reason: "token expired",
      role: "corroborating",
      scope: "account/other",
      state: "unreadable",
      surface: "audit-events",
      unblockedBy: "mint a new events api token",
      visibilityScope: "admin-visible",
    });
    expect(cell.artifacts).not.toBe(previous.artifacts);
  });

  it("has no success and no artifacts when the surface was never touched", () => {
    const cell = failedOnepasswordCoverageCell({
      channel: "browser",
      previous: null,
      reason: "signed out",
      role: "discovery",
      scope: "account/acme",
      state: "not-configured",
      surface: "vaults",
      unblockedBy: null,
    });
    expect(cell).toStrictEqual({
      artifacts: [],
      channel: "browser",
      lastSuccessAt: null,
      latestAttemptFailed: true,
      reason: "signed out",
      role: "discovery",
      scope: "account/acme",
      state: "not-configured",
      surface: "vaults",
      unblockedBy: null,
      visibilityScope: "admin-visible",
    });
  });

  it("gives every channel the one admin-visible boundary", () => {
    expect(ONEPASSWORD_CHANNELS.length).toBeGreaterThan(0);
    const scopes = ONEPASSWORD_CHANNELS.map(
      (channel) =>
        failedOnepasswordCoverageCell({
          channel,
          previous: null,
          reason: "r",
          role: "discovery",
          scope: "s",
          state: "unavailable",
          surface: "vaults",
          unblockedBy: null,
        }).visibilityScope,
    );
    expect(scopes).toStrictEqual(ONEPASSWORD_CHANNELS.map(() => "admin-visible"));
  });
});

describe("findCoverageCell", () => {
  const vaultsOnAdmin = succeededOnepasswordCoverageCell({
    artifacts: [],
    at: AT,
    channel: "admin-cli",
    reason: "r",
    role: "authoritative",
    scope: "s",
    state: "synced",
    surface: "vaults",
  });

  it("finds the cell one surface holds on one channel", () => {
    expect(findCoverageCell({ channel: "admin-cli", coverage: [vaultsOnAdmin], surface: "vaults" })).toBe(
      vaultsOnAdmin,
    );
  });

  it("answers null on a surface's first attempt on a channel, even when another channel holds a cell", () => {
    expect(findCoverageCell({ channel: "browser", coverage: [vaultsOnAdmin], surface: "vaults" })).toBeNull();
    expect(findCoverageCell({ channel: "admin-cli", coverage: [vaultsOnAdmin], surface: "groups" })).toBeNull();
    expect(findCoverageCell({ channel: "admin-cli", coverage: [], surface: "vaults" })).toBeNull();
  });
});

describe("onepasswordCoverageFreshness", () => {
  const stampedAt = ({ iso }: { iso: string }) =>
    succeededOnepasswordCoverageCell({
      artifacts: [],
      at: iso,
      channel: "admin-cli",
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "synced",
      surface: "vaults",
    });

  it("judges a cell five hours old current, because 1Password declares a thirty-six-hour window", () => {
    const assessment = onepasswordCoverageFreshness({
      cell: stampedAt({ iso: "2026-10-12T07:00:00.000Z" }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("current");
    expect(assessment.mayQuoteAsCurrent).toBe(true);
    expect(assessment.windowMs).toBe(THIRTY_SIX_HOURS_MS);
  });

  it("judges a cell just past thirty-six hours historical", () => {
    const assessment = onepasswordCoverageFreshness({
      cell: stampedAt({ iso: "2026-10-10T23:59:00.000Z" }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("historical");
    expect(assessment.mayQuoteAsCurrent).toBe(false);
    expect(assessment.windowMs).toBe(THIRTY_SIX_HOURS_MS);
  });
});
