import { describe, expect, it } from "vitest";

import {
  failedFigmaCoverageCell,
  figmaCoverageFreshness,
  figmaSurfaceLastSuccess,
  succeededFigmaCoverageCell,
} from "../../../../atlas/figma/coverage.js";
import { FIGMA_ATLAS_CHANNELS, type FigmaArtifactRef, type FigmaAtlasChannel } from "../../../../atlas/figma/model.js";

const AT = "2026-10-12T07:00:00.000Z";
const NOW_MS = Date.parse("2026-10-12T12:00:00.000Z");
/** The descriptor declares the pinned window: fourteen days. */
const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

const PROOF: FigmaArtifactRef = {
  byteLength: 1204,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "proof/home.png",
  sha256: "a".repeat(64),
};

const SCOPE_BY_CHANNEL: readonly (readonly [FigmaAtlasChannel, string])[] = [
  ["api", "api-token-scopes"],
  ["browser", "browser-signed-in-role"],
];

function succeeded({ channel, at }: { channel: FigmaAtlasChannel; at: string }) {
  return succeededFigmaCoverageCell({
    artifacts: [PROOF],
    at,
    channel,
    reason: "read every file",
    role: "authoritative",
    scope: "team/files",
    state: "synced",
    surface: "files",
  });
}

describe("figmaSurfaceLastSuccess", () => {
  const specCell = succeededFigmaCoverageCell({
    artifacts: [],
    at: AT,
    channel: "api",
    reason: "the pinned OpenAPI document",
    role: "authoritative",
    scope: "declared-operations",
    state: "synced",
    surface: "openapi-spec",
  });
  const tokenless = failedFigmaCoverageCell({
    channel: "api",
    previous: null,
    reason: "no Figma token",
    role: "authoritative",
    scope: "whole-account",
    state: "not-configured",
    surface: "rest-entities",
    unblockedBy: "a personal access token",
  });

  it("carries forward the last success the surface's stored cell records", () => {
    expect(figmaSurfaceLastSuccess({ coverage: [tokenless, specCell], surface: "openapi-spec" })).toBe(AT);
  });

  it("answers null for a stored cell that has never succeeded", () => {
    expect(figmaSurfaceLastSuccess({ coverage: [tokenless, specCell], surface: "rest-entities" })).toBeNull();
  });

  it("answers null for a surface no stored cell covers", () => {
    expect(figmaSurfaceLastSuccess({ coverage: [specCell], surface: "rest-entities" })).toBeNull();
    expect(figmaSurfaceLastSuccess({ coverage: [], surface: "openapi-spec" })).toBeNull();
  });
});

describe("succeededFigmaCoverageCell", () => {
  it("stamps the whole cell as a fresh success under the channel's own ceiling", () => {
    expect(succeeded({ at: AT, channel: "api" })).toStrictEqual({
      artifacts: [PROOF],
      channel: "api",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: "read every file",
      role: "authoritative",
      scope: "team/files",
      state: "synced",
      surface: "files",
      unblockedBy: null,
      visibilityScope: "api-token-scopes",
    });
  });

  it("maps every channel to its own visibility scope", () => {
    expect(FIGMA_ATLAS_CHANNELS.length).toBeGreaterThan(0);
    expect(SCOPE_BY_CHANNEL.map(([channel]) => channel)).toStrictEqual([...FIGMA_ATLAS_CHANNELS]);
    expect(SCOPE_BY_CHANNEL.map(([channel]) => succeeded({ at: AT, channel }).visibilityScope)).toStrictEqual(
      SCOPE_BY_CHANNEL.map(([, scope]) => scope),
    );
  });

  it("copies the artifacts rather than aliasing the caller's array", () => {
    const artifacts = [PROOF];
    const cell = succeededFigmaCoverageCell({
      artifacts,
      at: AT,
      channel: "browser",
      reason: "r",
      role: "corroborating",
      scope: "s",
      state: "synced",
      surface: "files",
    });
    artifacts.push({ ...PROOF, relativePath: "proof/other.png" });
    expect(cell.artifacts).toStrictEqual([PROOF]);
  });
});

describe("failedFigmaCoverageCell", () => {
  it("keeps the prior success and artifacts while the attempt's own fields replace the rest", () => {
    const previous = succeeded({ at: AT, channel: "api" });
    const cell = failedFigmaCoverageCell({
      channel: "browser",
      previous,
      reason: "the signed-in session expired",
      role: "corroborating",
      scope: "browser/files",
      state: "unreadable",
      surface: "files",
      unblockedBy: "sign in again",
    });
    expect(cell).toStrictEqual({
      artifacts: [PROOF],
      channel: "browser",
      lastSuccessAt: AT,
      latestAttemptFailed: true,
      reason: "the signed-in session expired",
      role: "corroborating",
      scope: "browser/files",
      state: "unreadable",
      surface: "files",
      unblockedBy: "sign in again",
      visibilityScope: "browser-signed-in-role",
    });
    expect(cell.artifacts).not.toBe(previous.artifacts);
  });

  it("has no success to carry when the surface was never touched", () => {
    const cell = failedFigmaCoverageCell({
      channel: "api",
      previous: null,
      reason: "no token",
      role: "authoritative",
      scope: "team/files",
      state: "not-configured",
      surface: "files",
      unblockedBy: null,
    });
    expect(cell.lastSuccessAt).toBe(null);
    expect(cell.artifacts).toStrictEqual([]);
    expect(cell.latestAttemptFailed).toBe(true);
    expect(cell.unblockedBy).toBe(null);
    expect(cell.visibilityScope).toBe("api-token-scopes");
  });

  it("maps every channel to its own visibility scope", () => {
    const scopes = SCOPE_BY_CHANNEL.map(
      ([channel]) =>
        failedFigmaCoverageCell({
          channel,
          previous: null,
          reason: "r",
          role: "authoritative",
          scope: "s",
          state: "unavailable",
          surface: "files",
          unblockedBy: null,
        }).visibilityScope,
    );
    expect(scopes).toStrictEqual(SCOPE_BY_CHANNEL.map(([, scope]) => scope));
  });

  it("copies the prior artifacts rather than aliasing them", () => {
    const previous = succeeded({ at: AT, channel: "api" });
    const cell = failedFigmaCoverageCell({
      channel: "api",
      previous,
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "unreadable",
      surface: "files",
      unblockedBy: null,
    });
    previous.artifacts.push({ ...PROOF, relativePath: "proof/other.png" });
    expect(cell.artifacts).toStrictEqual([PROOF]);
  });
});

describe("figmaCoverageFreshness", () => {
  it("judges against the descriptor's declared window, so a five-hour-old success is still current", () => {
    const verdict = figmaCoverageFreshness({ cell: succeeded({ at: AT, channel: "api" }), nowMs: NOW_MS });
    expect(verdict.verdict).toBe("current");
    expect(verdict.mayQuoteAsCurrent).toBe(true);
    expect(verdict.windowMs).toBe(WINDOW_MS);
    expect(verdict.ageMs).toBe(5 * 60 * 60 * 1000);
  });

  it("is still current exactly at the window's edge", () => {
    const at = new Date(NOW_MS - WINDOW_MS).toISOString();
    const verdict = figmaCoverageFreshness({ cell: succeeded({ at, channel: "api" }), nowMs: NOW_MS });
    expect(verdict.verdict).toBe("current");
  });

  it("is historical one minute past the declared window", () => {
    const at = new Date(NOW_MS - WINDOW_MS - 60_000).toISOString();
    const verdict = figmaCoverageFreshness({ cell: succeeded({ at, channel: "api" }), nowMs: NOW_MS });
    expect(verdict.verdict).toBe("historical");
    expect(verdict.mayQuoteAsCurrent).toBe(false);
    expect(verdict.windowMs).toBe(WINDOW_MS);
  });

  it("is historical inside the window when the latest attempt failed", () => {
    const cell = failedFigmaCoverageCell({
      channel: "api",
      previous: succeeded({ at: AT, channel: "api" }),
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "unreadable",
      surface: "files",
      unblockedBy: null,
    });
    expect(figmaCoverageFreshness({ cell, nowMs: NOW_MS }).verdict).toBe("historical");
  });

  it("is never-synced for a cell with no success", () => {
    const cell = failedFigmaCoverageCell({
      channel: "api",
      previous: null,
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "not-configured",
      surface: "files",
      unblockedBy: null,
    });
    expect(figmaCoverageFreshness({ cell, nowMs: NOW_MS }).verdict).toBe("never-synced");
  });
});
