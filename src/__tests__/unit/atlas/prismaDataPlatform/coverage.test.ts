import { describe, expect, it } from "vitest";

import {
  failedPrismaCoverageCell,
  prismaCoverageFreshness,
  prismaSurfaceLastSuccess,
  succeededPrismaCoverageCell,
} from "../../../../atlas/prismaDataPlatform/coverage.js";
import {
  PRISMA_DATA_PLATFORM_ATLAS_CHANNELS,
  type PrismaDataPlatformArtifactRef,
} from "../../../../atlas/prismaDataPlatform/model.js";

const AT = "2026-10-12T11:00:00.000Z";
const NOW_MS = Date.parse("2026-10-12T12:00:00.000Z");
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

const ARTIFACT: PrismaDataPlatformArtifactRef = {
  byteLength: 2048,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "artifacts/projects.png",
  sha256: "b".repeat(64),
};

const CHANNEL_SCOPES = [
  { channel: "api", scope: "api-credential-type" },
  { channel: "browser", scope: "browser-signed-in-role" },
] as const;

describe("prismaSurfaceLastSuccess", () => {
  const consoleCell = failedPrismaCoverageCell({
    channel: "browser",
    previous: succeededPrismaCoverageCell({
      artifacts: [],
      at: AT,
      channel: "browser",
      reason: "three console routes established",
      role: "discovery",
      scope: "declared-routes",
      state: "synced",
      surface: "console-routes",
    }),
    reason: "the inventory cannot be completed signed out",
    role: "discovery",
    scope: "declared-routes",
    state: "unreadable",
    surface: "console-routes",
    unblockedBy: "a signed-in walk",
  });
  const credentialless = failedPrismaCoverageCell({
    channel: "api",
    previous: null,
    reason: "no Prisma credential",
    role: "authoritative",
    scope: "whole-account",
    state: "not-configured",
    surface: "management-api",
    unblockedBy: "a service token",
  });

  it("carries forward the success a stored cell kept through a later failed attempt", () => {
    expect(prismaSurfaceLastSuccess({ coverage: [credentialless, consoleCell], surface: "console-routes" })).toBe(AT);
  });

  it("answers null for a stored cell that has never succeeded", () => {
    expect(prismaSurfaceLastSuccess({ coverage: [credentialless, consoleCell], surface: "management-api" })).toBeNull();
  });

  it("answers null for a surface no stored cell covers", () => {
    expect(prismaSurfaceLastSuccess({ coverage: [consoleCell], surface: "management-api" })).toBeNull();
    expect(prismaSurfaceLastSuccess({ coverage: [], surface: "console-routes" })).toBeNull();
  });
});

describe("succeededPrismaCoverageCell", () => {
  it("stamps the whole cell as a fresh success through the api channel", () => {
    const cell = succeededPrismaCoverageCell({
      artifacts: [ARTIFACT],
      at: AT,
      channel: "api",
      reason: "read 3 project(s)",
      role: "authoritative",
      scope: "workspace/acme",
      state: "synced",
      surface: "management-api",
    });
    expect(cell).toStrictEqual({
      artifacts: [ARTIFACT],
      channel: "api",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: "read 3 project(s)",
      role: "authoritative",
      scope: "workspace/acme",
      state: "synced",
      surface: "management-api",
      unblockedBy: null,
      visibilityScope: "api-credential-type",
    });
  });

  it("maps every channel to its own visibility ceiling", () => {
    expect(CHANNEL_SCOPES.map((entry) => entry.channel)).toStrictEqual([...PRISMA_DATA_PLATFORM_ATLAS_CHANNELS]);
    const scopes = CHANNEL_SCOPES.map(
      ({ channel }) =>
        succeededPrismaCoverageCell({
          artifacts: [],
          at: AT,
          channel,
          reason: "r",
          role: "corroborating",
          scope: "s",
          state: "synced",
          surface: "console",
        }).visibilityScope,
    );
    expect(scopes).toStrictEqual(["api-credential-type", "browser-signed-in-role"]);
  });

  it("does not alias the caller's artifacts array", () => {
    const artifacts: PrismaDataPlatformArtifactRef[] = [ARTIFACT];
    const cell = succeededPrismaCoverageCell({
      artifacts,
      at: AT,
      channel: "browser",
      reason: "r",
      role: "discovery",
      scope: "s",
      state: "synced",
      surface: "console",
    });
    artifacts.push({ ...ARTIFACT, relativePath: "artifacts/other.png" });
    expect(cell.artifacts).toStrictEqual([ARTIFACT]);
  });
});

describe("failedPrismaCoverageCell", () => {
  it("keeps the prior success and artifacts while this attempt's own fields replace the rest", () => {
    const previous = succeededPrismaCoverageCell({
      artifacts: [ARTIFACT],
      at: AT,
      channel: "api",
      reason: "read 3 project(s)",
      role: "authoritative",
      scope: "workspace/acme",
      state: "synced",
      surface: "management-api",
    });
    const cell = failedPrismaCoverageCell({
      channel: "browser",
      previous,
      reason: "signed out",
      role: "corroborating",
      scope: "workspace/other",
      state: "unreadable",
      surface: "console",
      unblockedBy: "sign in to the Prisma console",
    });
    expect(cell).toStrictEqual({
      artifacts: [ARTIFACT],
      channel: "browser",
      lastSuccessAt: AT,
      latestAttemptFailed: true,
      reason: "signed out",
      role: "corroborating",
      scope: "workspace/other",
      state: "unreadable",
      surface: "console",
      unblockedBy: "sign in to the Prisma console",
      visibilityScope: "browser-signed-in-role",
    });
    expect(cell.artifacts).not.toBe(previous.artifacts);
  });

  it("has no success and no artifacts when the surface was never touched", () => {
    const cell = failedPrismaCoverageCell({
      channel: "api",
      previous: null,
      reason: "401 from the management api",
      role: "authoritative",
      scope: "workspace/acme",
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
      scope: "workspace/acme",
      state: "invalid-configuration",
      surface: "management-api",
      unblockedBy: null,
      visibilityScope: "api-credential-type",
    });
  });

  it("maps every channel to its own visibility ceiling", () => {
    expect(CHANNEL_SCOPES.length).toBeGreaterThan(0);
    const scopes = CHANNEL_SCOPES.map(
      ({ channel }) =>
        failedPrismaCoverageCell({
          channel,
          previous: null,
          reason: "r",
          role: "discovery",
          scope: "s",
          state: "unavailable",
          surface: "console",
          unblockedBy: null,
        }).visibilityScope,
    );
    expect(scopes).toStrictEqual(CHANNEL_SCOPES.map((entry) => entry.scope));
  });
});

describe("prismaCoverageFreshness", () => {
  const stampedAt = ({ iso }: { iso: string }) =>
    succeededPrismaCoverageCell({
      artifacts: [],
      at: iso,
      channel: "api",
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "synced",
      surface: "management-api",
    });

  it("judges a cell five hours old current, because Prisma declares a fourteen-day window", () => {
    const assessment = prismaCoverageFreshness({
      cell: stampedAt({ iso: "2026-10-12T07:00:00.000Z" }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("current");
    expect(assessment.mayQuoteAsCurrent).toBe(true);
    expect(assessment.windowMs).toBe(FOURTEEN_DAYS_MS);
  });

  it("judges a cell just past fourteen days historical", () => {
    const assessment = prismaCoverageFreshness({
      cell: stampedAt({ iso: "2026-09-28T11:59:00.000Z" }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("historical");
    expect(assessment.mayQuoteAsCurrent).toBe(false);
    expect(assessment.windowMs).toBe(FOURTEEN_DAYS_MS);
  });
});
