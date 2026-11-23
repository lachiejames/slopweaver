import { describe, expect, it } from "vitest";

import {
  airtableCoverageFreshness,
  airtableSurfaceLastSuccess,
  failedAirtableCoverageCell,
  succeededAirtableCoverageCell,
} from "../../../../atlas/airtable/coverage.js";
import {
  AIRTABLE_ATLAS_CHANNELS,
  type AirtableArtifactRef,
  type AirtableAtlasChannel,
} from "../../../../atlas/airtable/model.js";

const AT = "2026-10-12T07:00:00.000Z";
const NOW_MS = Date.parse("2026-10-12T12:00:00.000Z");
/** The descriptor declares the pinned window: fourteen days. */
const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

const PROOF: AirtableArtifactRef = {
  byteLength: 1204,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "proof/home.png",
  sha256: "a".repeat(64),
};

const SCOPE_BY_CHANNEL: readonly (readonly [AirtableAtlasChannel, string])[] = [
  ["api", "api-token-scopes"],
  ["browser", "browser-signed-in-role"],
];

function succeeded({ channel, at }: { channel: AirtableAtlasChannel; at: string }) {
  return succeededAirtableCoverageCell({
    artifacts: [PROOF],
    at,
    channel,
    reason: "read every base",
    role: "authoritative",
    scope: "workspace/bases",
    state: "synced",
    surface: "bases",
  });
}

describe("airtableSurfaceLastSuccess", () => {
  const neverReached = failedAirtableCoverageCell({
    channel: "api",
    previous: null,
    reason: "no Airtable invite",
    role: "authoritative",
    scope: "whole-enterprise",
    state: "not-configured",
    surface: "rest-entities",
    unblockedBy: "an invite",
  });

  it("carries forward the last success the surface's stored cell records", () => {
    const coverage = [neverReached, succeeded({ at: AT, channel: "api" })];
    expect(airtableSurfaceLastSuccess({ coverage, surface: "bases" })).toBe(AT);
  });

  it("answers null for a stored cell that has never succeeded", () => {
    const coverage = [neverReached, succeeded({ at: AT, channel: "api" })];
    expect(airtableSurfaceLastSuccess({ coverage, surface: "rest-entities" })).toBeNull();
  });

  it("answers null for a surface no stored cell covers", () => {
    expect(
      airtableSurfaceLastSuccess({ coverage: [succeeded({ at: AT, channel: "api" })], surface: "rest-entities" }),
    ).toBeNull();
    expect(airtableSurfaceLastSuccess({ coverage: [], surface: "bases" })).toBeNull();
  });
});

describe("succeededAirtableCoverageCell", () => {
  it("stamps the whole cell as a fresh success under the channel's own ceiling", () => {
    expect(succeeded({ at: AT, channel: "api" })).toStrictEqual({
      artifacts: [PROOF],
      channel: "api",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: "read every base",
      role: "authoritative",
      scope: "workspace/bases",
      state: "synced",
      surface: "bases",
      unblockedBy: null,
      visibilityScope: "api-token-scopes",
    });
  });

  it("maps every channel to its own visibility scope", () => {
    expect(AIRTABLE_ATLAS_CHANNELS.length).toBeGreaterThan(0);
    expect(SCOPE_BY_CHANNEL.map(([channel]) => channel)).toStrictEqual([...AIRTABLE_ATLAS_CHANNELS]);
    expect(SCOPE_BY_CHANNEL.map(([channel]) => succeeded({ at: AT, channel }).visibilityScope)).toStrictEqual(
      SCOPE_BY_CHANNEL.map(([, scope]) => scope),
    );
  });

  it("copies the artifacts rather than aliasing the caller's array", () => {
    const artifacts = [PROOF];
    const cell = succeededAirtableCoverageCell({
      artifacts,
      at: AT,
      channel: "browser",
      reason: "r",
      role: "corroborating",
      scope: "s",
      state: "synced",
      surface: "bases",
    });
    artifacts.push({ ...PROOF, relativePath: "proof/other.png" });
    expect(cell.artifacts).toStrictEqual([PROOF]);
  });
});

describe("failedAirtableCoverageCell", () => {
  it("keeps the prior success and artifacts while the attempt's own fields replace the rest", () => {
    const previous = succeeded({ at: AT, channel: "api" });
    const cell = failedAirtableCoverageCell({
      channel: "browser",
      previous,
      reason: "the signed-in session expired",
      role: "corroborating",
      scope: "browser/bases",
      state: "unreadable",
      surface: "bases",
      unblockedBy: "sign in again",
    });
    expect(cell).toStrictEqual({
      artifacts: [PROOF],
      channel: "browser",
      lastSuccessAt: AT,
      latestAttemptFailed: true,
      reason: "the signed-in session expired",
      role: "corroborating",
      scope: "browser/bases",
      state: "unreadable",
      surface: "bases",
      unblockedBy: "sign in again",
      visibilityScope: "browser-signed-in-role",
    });
    expect(cell.artifacts).not.toBe(previous.artifacts);
  });

  it("has no success to carry when the surface was never touched", () => {
    const cell = failedAirtableCoverageCell({
      channel: "api",
      previous: null,
      reason: "no token",
      role: "authoritative",
      scope: "workspace/bases",
      state: "not-configured",
      surface: "bases",
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
        failedAirtableCoverageCell({
          channel,
          previous: null,
          reason: "r",
          role: "authoritative",
          scope: "s",
          state: "unavailable",
          surface: "bases",
          unblockedBy: null,
        }).visibilityScope,
    );
    expect(scopes).toStrictEqual(SCOPE_BY_CHANNEL.map(([, scope]) => scope));
  });

  it("copies the prior artifacts rather than aliasing them", () => {
    const previous = succeeded({ at: AT, channel: "api" });
    const cell = failedAirtableCoverageCell({
      channel: "api",
      previous,
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "unreadable",
      surface: "bases",
      unblockedBy: null,
    });
    previous.artifacts.push({ ...PROOF, relativePath: "proof/other.png" });
    expect(cell.artifacts).toStrictEqual([PROOF]);
  });
});

describe("airtableCoverageFreshness", () => {
  it("judges against the descriptor's declared window, so a five-hour-old success is still current", () => {
    const verdict = airtableCoverageFreshness({ cell: succeeded({ at: AT, channel: "api" }), nowMs: NOW_MS });
    expect(verdict.verdict).toBe("current");
    expect(verdict.mayQuoteAsCurrent).toBe(true);
    expect(verdict.windowMs).toBe(WINDOW_MS);
    expect(verdict.ageMs).toBe(5 * 60 * 60 * 1000);
  });

  it("is still current exactly at the window's edge", () => {
    const at = new Date(NOW_MS - WINDOW_MS).toISOString();
    const verdict = airtableCoverageFreshness({ cell: succeeded({ at, channel: "api" }), nowMs: NOW_MS });
    expect(verdict.verdict).toBe("current");
  });

  it("is historical one minute past the declared window", () => {
    const at = new Date(NOW_MS - WINDOW_MS - 60_000).toISOString();
    const verdict = airtableCoverageFreshness({ cell: succeeded({ at, channel: "api" }), nowMs: NOW_MS });
    expect(verdict.verdict).toBe("historical");
    expect(verdict.mayQuoteAsCurrent).toBe(false);
    expect(verdict.windowMs).toBe(WINDOW_MS);
  });

  it("is historical inside the window when the latest attempt failed", () => {
    const cell = failedAirtableCoverageCell({
      channel: "api",
      previous: succeeded({ at: AT, channel: "api" }),
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "unreadable",
      surface: "bases",
      unblockedBy: null,
    });
    expect(airtableCoverageFreshness({ cell, nowMs: NOW_MS }).verdict).toBe("historical");
  });

  it("is never-synced for a cell with no success", () => {
    const cell = failedAirtableCoverageCell({
      channel: "api",
      previous: null,
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "not-configured",
      surface: "bases",
      unblockedBy: null,
    });
    expect(airtableCoverageFreshness({ cell, nowMs: NOW_MS }).verdict).toBe("never-synced");
  });
});
