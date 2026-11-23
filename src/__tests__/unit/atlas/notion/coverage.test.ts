import { describe, expect, it } from "vitest";

import {
  failedNotionCoverageCell,
  notionCoverageFreshness,
  succeededNotionCoverageCell,
} from "../../../../atlas/notion/coverage.js";
import { NOTION_ATLAS_CHANNELS, type NotionArtifactRef } from "../../../../atlas/notion/model.js";

const AT = "2026-10-12T11:00:00.000Z";
const NOW_MS = Date.parse("2026-10-12T12:00:00.000Z");
const THIRTY_SIX_HOURS_MS = 36 * 60 * 60 * 1000;

const ARTIFACT: NotionArtifactRef = {
  byteLength: 2048,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "artifacts/teamspaces.png",
  sha256: "c".repeat(64),
};

const CHANNEL_SCOPES = [
  { channel: "api", scope: "api-integration-grants" },
  { channel: "browser", scope: "browser-signed-in-role" },
] as const;

describe("succeededNotionCoverageCell", () => {
  it("stamps the whole cell as a fresh success through the api channel", () => {
    const cell = succeededNotionCoverageCell({
      artifacts: [ARTIFACT],
      at: AT,
      channel: "api",
      reason: "read 9 teamspace(s)",
      role: "authoritative",
      scope: "workspace/acme",
      state: "synced",
      surface: "public-api",
    });
    expect(cell).toStrictEqual({
      artifacts: [ARTIFACT],
      channel: "api",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: "read 9 teamspace(s)",
      role: "authoritative",
      scope: "workspace/acme",
      state: "synced",
      surface: "public-api",
      unblockedBy: null,
      visibilityScope: "api-integration-grants",
    });
  });

  it("maps every channel to its own visibility ceiling", () => {
    expect(CHANNEL_SCOPES.map((entry) => entry.channel)).toStrictEqual([...NOTION_ATLAS_CHANNELS]);
    const scopes = CHANNEL_SCOPES.map(
      ({ channel }) =>
        succeededNotionCoverageCell({
          artifacts: [],
          at: AT,
          channel,
          reason: "r",
          role: "corroborating",
          scope: "s",
          state: "synced",
          surface: "settings",
        }).visibilityScope,
    );
    expect(scopes).toStrictEqual(["api-integration-grants", "browser-signed-in-role"]);
  });

  it("does not alias the caller's artifacts array", () => {
    const artifacts: NotionArtifactRef[] = [ARTIFACT];
    const cell = succeededNotionCoverageCell({
      artifacts,
      at: AT,
      channel: "browser",
      reason: "r",
      role: "discovery",
      scope: "s",
      state: "synced",
      surface: "settings",
    });
    artifacts.push({ ...ARTIFACT, relativePath: "artifacts/other.png" });
    expect(cell.artifacts).toStrictEqual([ARTIFACT]);
  });
});

describe("failedNotionCoverageCell", () => {
  it("keeps the prior success and artifacts while this attempt's own fields replace the rest", () => {
    const previous = succeededNotionCoverageCell({
      artifacts: [ARTIFACT],
      at: AT,
      channel: "api",
      reason: "read 9 teamspace(s)",
      role: "authoritative",
      scope: "workspace/acme",
      state: "synced",
      surface: "public-api",
    });
    const cell = failedNotionCoverageCell({
      channel: "browser",
      previous,
      reason: "signed out",
      role: "corroborating",
      scope: "workspace/other",
      state: "unreadable",
      surface: "settings",
      unblockedBy: "sign in to Notion",
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
      surface: "settings",
      unblockedBy: "sign in to Notion",
      visibilityScope: "browser-signed-in-role",
    });
    expect(cell.artifacts).not.toBe(previous.artifacts);
  });

  it("has no success and no artifacts when the surface was never touched", () => {
    const cell = failedNotionCoverageCell({
      channel: "api",
      previous: null,
      reason: "401 from the public api",
      role: "authoritative",
      scope: "workspace/acme",
      state: "invalid-configuration",
      surface: "public-api",
      unblockedBy: null,
    });
    expect(cell).toStrictEqual({
      artifacts: [],
      channel: "api",
      lastSuccessAt: null,
      latestAttemptFailed: true,
      reason: "401 from the public api",
      role: "authoritative",
      scope: "workspace/acme",
      state: "invalid-configuration",
      surface: "public-api",
      unblockedBy: null,
      visibilityScope: "api-integration-grants",
    });
  });

  it("maps every channel to its own visibility ceiling", () => {
    expect(CHANNEL_SCOPES.length).toBeGreaterThan(0);
    const scopes = CHANNEL_SCOPES.map(
      ({ channel }) =>
        failedNotionCoverageCell({
          channel,
          previous: null,
          reason: "r",
          role: "discovery",
          scope: "s",
          state: "unavailable",
          surface: "settings",
          unblockedBy: null,
        }).visibilityScope,
    );
    expect(scopes).toStrictEqual(CHANNEL_SCOPES.map((entry) => entry.scope));
  });
});

describe("notionCoverageFreshness", () => {
  const stampedAt = ({ iso }: { iso: string }) =>
    succeededNotionCoverageCell({
      artifacts: [],
      at: iso,
      channel: "api",
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "synced",
      surface: "public-api",
    });

  it("judges a cell five hours old current, because Notion declares a thirty-six-hour window", () => {
    const assessment = notionCoverageFreshness({
      cell: stampedAt({ iso: "2026-10-12T07:00:00.000Z" }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("current");
    expect(assessment.mayQuoteAsCurrent).toBe(true);
    expect(assessment.windowMs).toBe(THIRTY_SIX_HOURS_MS);
  });

  it("judges a cell just past thirty-six hours historical", () => {
    const assessment = notionCoverageFreshness({
      cell: stampedAt({ iso: "2026-10-10T23:59:00.000Z" }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("historical");
    expect(assessment.mayQuoteAsCurrent).toBe(false);
    expect(assessment.windowMs).toBe(THIRTY_SIX_HOURS_MS);
  });
});
