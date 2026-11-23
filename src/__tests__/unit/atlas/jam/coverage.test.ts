import { describe, expect, it } from "vitest";

import {
  failedJamCoverageCell,
  jamCoverageFreshness,
  succeededJamCoverageCell,
  withJamCoverageCell,
} from "../../../../atlas/jam/coverage.js";
import type { JamArtifactRef, JamAtlasChannel, JamCoverageCell } from "../../../../atlas/jam/model.js";
import { JAM_ATLAS_CHANNELS } from "../../../../atlas/jam/model.js";

const AT = "2026-10-12T07:00:00.000Z";
const NOW_MS = Date.parse("2026-10-12T12:00:00.000Z");
/** The descriptor declares the pinned window: fourteen days. */
const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** The exact ceiling `model.ts` assigns each channel, spelled out so a swapped mapping reddens a case. */
const SCOPE_BY_CHANNEL: Record<JamAtlasChannel, string> = {
  api: "api-oauth-bearer-token",
  browser: "browser-signed-in-account",
  compiled: "compiled-published-documents",
};

const ARTIFACT: JamArtifactRef = {
  byteLength: 1024,
  kind: "api-json",
  mediaType: "application/json",
  relativePath: "artifacts/openapi.json",
  sha256: "a".repeat(64),
};

const OTHER_ARTIFACT: JamArtifactRef = {
  byteLength: 2048,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "artifacts/page.png",
  sha256: "b".repeat(64),
};

function succeededAt({ at }: { at: string }): ReturnType<typeof succeededJamCoverageCell> {
  return succeededJamCoverageCell({
    artifacts: [],
    at,
    channel: "compiled",
    reason: "read the OpenAPI description",
    role: "authoritative",
    scope: "published-documents",
    state: "synced",
    surface: "published-api",
  });
}

function succeededOn({
  artifacts,
  channel,
  surface,
}: {
  artifacts: readonly JamArtifactRef[];
  channel: JamAtlasChannel;
  surface: JamCoverageCell["surface"];
}): JamCoverageCell {
  return succeededJamCoverageCell({
    artifacts,
    at: AT,
    channel,
    reason: "read the OpenAPI description",
    role: "authoritative",
    scope: "published-documents",
    state: "synced",
    surface,
  });
}

describe("jamCoverageFreshness", () => {
  it("judges against the descriptor's declared window, so a five-hour-old success is still current", () => {
    const verdict = jamCoverageFreshness({ cell: succeededAt({ at: AT }), nowMs: NOW_MS });
    expect(verdict.verdict).toBe("current");
    expect(verdict.mayQuoteAsCurrent).toBe(true);
    expect(verdict.windowMs).toBe(WINDOW_MS);
    expect(verdict.ageMs).toBe(5 * 60 * 60 * 1000);
  });

  it("is still current exactly at the window's edge", () => {
    const at = new Date(NOW_MS - WINDOW_MS).toISOString();
    expect(jamCoverageFreshness({ cell: succeededAt({ at }), nowMs: NOW_MS }).verdict).toBe("current");
  });

  it("is historical one minute past the declared window", () => {
    const at = new Date(NOW_MS - WINDOW_MS - 60_000).toISOString();
    const verdict = jamCoverageFreshness({ cell: succeededAt({ at }), nowMs: NOW_MS });
    expect(verdict.verdict).toBe("historical");
    expect(verdict.mayQuoteAsCurrent).toBe(false);
    expect(verdict.windowMs).toBe(WINDOW_MS);
  });

  it("is historical inside the window when the latest attempt failed", () => {
    const failed = failedJamCoverageCell({
      channel: "compiled",
      previous: succeededAt({ at: AT }),
      reason: "the description would not parse",
      role: "authoritative",
      scope: "published-documents",
      state: "unreadable",
      surface: "published-api",
      unblockedBy: null,
    });
    expect(jamCoverageFreshness({ cell: failed, nowMs: NOW_MS }).verdict).toBe("historical");
  });

  it("is never-synced for a cell with no success", () => {
    const failed = failedJamCoverageCell({
      channel: "compiled",
      previous: null,
      reason: "the description would not parse",
      role: "authoritative",
      scope: "published-documents",
      state: "unreadable",
      surface: "published-api",
      unblockedBy: null,
    });
    expect(jamCoverageFreshness({ cell: failed, nowMs: NOW_MS }).verdict).toBe("never-synced");
  });
});

describe("succeededJamCoverageCell", () => {
  it("returns the whole cell, stamped as a fresh success under the channel's own ceiling", () => {
    const cell = succeededJamCoverageCell({
      artifacts: [ARTIFACT],
      at: AT,
      channel: "compiled",
      reason: "read the OpenAPI description",
      role: "authoritative",
      scope: "published-documents",
      state: "synced",
      surface: "published-api",
    });
    expect(cell).toStrictEqual({
      artifacts: [ARTIFACT],
      channel: "compiled",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: "read the OpenAPI description",
      role: "authoritative",
      scope: "published-documents",
      state: "synced",
      surface: "published-api",
      unblockedBy: null,
      visibilityScope: "compiled-published-documents",
    });
  });

  it("maps every channel in the registry to its own exact visibility ceiling", () => {
    expect(JAM_ATLAS_CHANNELS.length).toBeGreaterThan(0);
    expect(Object.keys(SCOPE_BY_CHANNEL).toSorted()).toStrictEqual(JAM_ATLAS_CHANNELS.toSorted());
    for (const channel of JAM_ATLAS_CHANNELS) {
      const cell = succeededOn({ artifacts: [], channel, surface: "web-app" });
      expect(cell.channel).toBe(channel);
      expect(cell.visibilityScope).toBe(SCOPE_BY_CHANNEL[channel]);
    }
  });

  it("does not alias the caller's artifacts array", () => {
    const artifacts = [ARTIFACT];
    const cell = succeededOn({ artifacts, channel: "compiled", surface: "published-api" });
    artifacts.push(OTHER_ARTIFACT);
    expect(cell.artifacts).toStrictEqual([ARTIFACT]);
  });
});

describe("failedJamCoverageCell", () => {
  it("keeps the prior success and its artifacts, and takes the failed attempt's own fields", () => {
    const previous = succeededOn({ artifacts: [ARTIFACT], channel: "compiled", surface: "mcp-resource" });
    const cell = failedJamCoverageCell({
      channel: "api",
      previous,
      reason: "no bearer token is held",
      role: "corroborating",
      scope: "mcp:read",
      state: "not-configured",
      surface: "mcp-resource",
      unblockedBy: "set jam-access-token",
    });
    expect(cell).toStrictEqual({
      artifacts: [ARTIFACT],
      channel: "api",
      lastSuccessAt: AT,
      latestAttemptFailed: true,
      reason: "no bearer token is held",
      role: "corroborating",
      scope: "mcp:read",
      state: "not-configured",
      surface: "mcp-resource",
      unblockedBy: "set jam-access-token",
      visibilityScope: "api-oauth-bearer-token",
    });
  });

  it("with no prior cell carries no success and no artifacts", () => {
    const cell = failedJamCoverageCell({
      channel: "browser",
      previous: null,
      reason: "the walk has not run",
      role: "discovery",
      scope: "signed-in-routes",
      state: "not-configured",
      surface: "web-app",
      unblockedBy: "run the walk",
    });
    expect(cell).toStrictEqual({
      artifacts: [],
      channel: "browser",
      lastSuccessAt: null,
      latestAttemptFailed: true,
      reason: "the walk has not run",
      role: "discovery",
      scope: "signed-in-routes",
      state: "not-configured",
      surface: "web-app",
      unblockedBy: "run the walk",
      visibilityScope: "browser-signed-in-account",
    });
  });

  it("maps every channel in the registry to its own exact visibility ceiling", () => {
    expect(JAM_ATLAS_CHANNELS.length).toBeGreaterThan(0);
    for (const channel of JAM_ATLAS_CHANNELS) {
      const cell = failedJamCoverageCell({
        channel,
        previous: null,
        reason: "nothing read",
        role: "discovery",
        scope: "none",
        state: "not-configured",
        surface: "web-app",
        unblockedBy: null,
      });
      expect(cell.channel).toBe(channel);
      expect(cell.visibilityScope).toBe(SCOPE_BY_CHANNEL[channel]);
    }
  });

  it("does not alias the prior cell's artifacts array", () => {
    const previous = succeededOn({ artifacts: [ARTIFACT], channel: "compiled", surface: "published-api" });
    const cell = failedJamCoverageCell({
      channel: "compiled",
      previous,
      reason: "the description would not parse",
      role: "authoritative",
      scope: "published-documents",
      state: "unreadable",
      surface: "published-api",
      unblockedBy: null,
    });
    previous.artifacts.push(OTHER_ARTIFACT);
    expect(cell.artifacts).toStrictEqual([ARTIFACT]);
  });
});

describe("withJamCoverageCell", () => {
  const specCell = succeededOn({ artifacts: [], channel: "compiled", surface: "published-api" });
  const routeCell = succeededOn({ artifacts: [], channel: "compiled", surface: "route-probe" });
  const pageCell = succeededOn({ artifacts: [], channel: "browser", surface: "web-app" });

  it("replaces the cell on the same surface, leaving the others in their stored order", () => {
    const replacement = { ...routeCell, reason: "probed again" };
    const result = withJamCoverageCell({ cells: [specCell, routeCell, pageCell], replacement });
    expect(result).toStrictEqual([specCell, pageCell, replacement]);
  });

  it("appends when no cell is stored for that surface", () => {
    const result = withJamCoverageCell({ cells: [specCell, routeCell], replacement: pageCell });
    expect(result).toStrictEqual([specCell, routeCell, pageCell]);
  });

  it("returns only the replacement when nothing is stored", () => {
    expect(withJamCoverageCell({ cells: [], replacement: pageCell })).toStrictEqual([pageCell]);
  });

  it("keys on the surface alone, so a replacement from another channel still displaces the stored cell", () => {
    const replacement = succeededOn({ artifacts: [], channel: "browser", surface: "published-api" });
    const result = withJamCoverageCell({ cells: [specCell, pageCell], replacement });
    expect(result).toStrictEqual([pageCell, replacement]);
  });

  it("does not mutate the stored list", () => {
    const cells = [specCell, routeCell];
    withJamCoverageCell({ cells, replacement: pageCell });
    expect(cells).toStrictEqual([specCell, routeCell]);
  });
});
