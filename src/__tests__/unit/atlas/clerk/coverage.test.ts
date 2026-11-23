import { describe, expect, it } from "vitest";

import {
  clerkCoverageFreshness,
  failedClerkCoverageCell,
  succeededClerkCoverageCell,
} from "../../../../atlas/clerk/coverage.js";
import { CLERK_CHANNELS, type ClerkArtifactRef, type ClerkChannel } from "../../../../atlas/clerk/model.js";

const AT = "2026-10-12T07:00:00.000Z";
const NOW_MS = Date.parse("2026-10-12T12:00:00.000Z");
/** The descriptor declares the daily window: thirty-six hours. */
const WINDOW_MS = 36 * 60 * 60 * 1000;

const PROOF: ClerkArtifactRef = {
  byteLength: 2048,
  kind: "page-json",
  mediaType: "application/json",
  relativePath: "specs/backend.json",
  sha256: "b".repeat(64),
};

const SCOPE_BY_CHANNEL: readonly (readonly [ClerkChannel, string])[] = [
  ["compiled", "compiled-published-specifications"],
  ["api", "api-secret-key-instance"],
  ["browser", "browser-signed-in-membership"],
];

function succeeded({ channel, at }: { channel: ClerkChannel; at: string }) {
  return succeededClerkCoverageCell({
    artifacts: [PROOF],
    at,
    channel,
    reason: "read four documents",
    role: "authoritative",
    scope: "published-specifications",
    state: "synced",
    surface: "specifications",
  });
}

describe("succeededClerkCoverageCell", () => {
  it("stamps the whole cell as a fresh success under the channel's own ceiling", () => {
    expect(succeeded({ at: AT, channel: "compiled" })).toStrictEqual({
      artifacts: [PROOF],
      channel: "compiled",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: "read four documents",
      role: "authoritative",
      scope: "published-specifications",
      state: "synced",
      surface: "specifications",
      unblockedBy: null,
      visibilityScope: "compiled-published-specifications",
    });
  });

  it("maps every channel to its own visibility scope", () => {
    expect(CLERK_CHANNELS.length).toBeGreaterThan(0);
    expect(SCOPE_BY_CHANNEL.map(([channel]) => channel)).toStrictEqual([...CLERK_CHANNELS]);
    expect(SCOPE_BY_CHANNEL.map(([channel]) => succeeded({ at: AT, channel }).visibilityScope)).toStrictEqual(
      SCOPE_BY_CHANNEL.map(([, scope]) => scope),
    );
  });

  it("copies the artifacts rather than aliasing the caller's array", () => {
    const artifacts = [PROOF];
    const cell = succeededClerkCoverageCell({
      artifacts,
      at: AT,
      channel: "browser",
      reason: "r",
      role: "corroborating",
      scope: "s",
      state: "synced",
      surface: "dashboard",
    });
    artifacts.push({ ...PROOF, relativePath: "specs/other.json" });
    expect(cell.artifacts).toStrictEqual([PROOF]);
  });
});

describe("failedClerkCoverageCell", () => {
  it("keeps the prior success and artifacts while the attempt's own fields replace the rest", () => {
    const previous = succeeded({ at: AT, channel: "compiled" });
    const cell = failedClerkCoverageCell({
      channel: "api",
      previous,
      reason: "the secret key was refused",
      role: "corroborating",
      scope: "instance/users",
      state: "invalid-configuration",
      surface: "specifications",
      unblockedBy: "issue a read-only secret key",
    });
    expect(cell).toStrictEqual({
      artifacts: [PROOF],
      channel: "api",
      lastSuccessAt: AT,
      latestAttemptFailed: true,
      reason: "the secret key was refused",
      role: "corroborating",
      scope: "instance/users",
      state: "invalid-configuration",
      surface: "specifications",
      unblockedBy: "issue a read-only secret key",
      visibilityScope: "api-secret-key-instance",
    });
    expect(cell.artifacts).not.toBe(previous.artifacts);
  });

  it("has no success to carry when the surface was never touched", () => {
    const cell = failedClerkCoverageCell({
      channel: "api",
      previous: null,
      reason: "no key",
      role: "authoritative",
      scope: "instance/users",
      state: "not-configured",
      surface: "api",
      unblockedBy: null,
    });
    expect(cell.lastSuccessAt).toBe(null);
    expect(cell.artifacts).toStrictEqual([]);
    expect(cell.latestAttemptFailed).toBe(true);
    expect(cell.unblockedBy).toBe(null);
    expect(cell.visibilityScope).toBe("api-secret-key-instance");
  });

  it("maps every channel to its own visibility scope", () => {
    const scopes = SCOPE_BY_CHANNEL.map(
      ([channel]) =>
        failedClerkCoverageCell({
          channel,
          previous: null,
          reason: "r",
          role: "authoritative",
          scope: "s",
          state: "unavailable",
          surface: "api",
          unblockedBy: null,
        }).visibilityScope,
    );
    expect(scopes).toStrictEqual(SCOPE_BY_CHANNEL.map(([, scope]) => scope));
  });

  it("copies the prior artifacts rather than aliasing them", () => {
    const previous = succeeded({ at: AT, channel: "compiled" });
    const cell = failedClerkCoverageCell({
      channel: "compiled",
      previous,
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "unreadable",
      surface: "specifications",
      unblockedBy: null,
    });
    previous.artifacts.push({ ...PROOF, relativePath: "specs/other.json" });
    expect(cell.artifacts).toStrictEqual([PROOF]);
  });
});

describe("clerkCoverageFreshness", () => {
  it("judges against the descriptor's declared window, so a five-hour-old success is still current", () => {
    const verdict = clerkCoverageFreshness({ cell: succeeded({ at: AT, channel: "compiled" }), nowMs: NOW_MS });
    expect(verdict.verdict).toBe("current");
    expect(verdict.mayQuoteAsCurrent).toBe(true);
    expect(verdict.windowMs).toBe(WINDOW_MS);
    expect(verdict.ageMs).toBe(5 * 60 * 60 * 1000);
  });

  it("is still current exactly at the window's edge", () => {
    const at = new Date(NOW_MS - WINDOW_MS).toISOString();
    const verdict = clerkCoverageFreshness({ cell: succeeded({ at, channel: "compiled" }), nowMs: NOW_MS });
    expect(verdict.verdict).toBe("current");
  });

  it("is historical one minute past the declared window", () => {
    const at = new Date(NOW_MS - WINDOW_MS - 60_000).toISOString();
    const verdict = clerkCoverageFreshness({ cell: succeeded({ at, channel: "compiled" }), nowMs: NOW_MS });
    expect(verdict.verdict).toBe("historical");
    expect(verdict.mayQuoteAsCurrent).toBe(false);
    expect(verdict.windowMs).toBe(WINDOW_MS);
  });

  it("is historical inside the window when the latest attempt failed", () => {
    const cell = failedClerkCoverageCell({
      channel: "api",
      previous: succeeded({ at: AT, channel: "compiled" }),
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "unreadable",
      surface: "specifications",
      unblockedBy: null,
    });
    expect(clerkCoverageFreshness({ cell, nowMs: NOW_MS }).verdict).toBe("historical");
  });

  it("is never-synced for a cell with no success", () => {
    const cell = failedClerkCoverageCell({
      channel: "api",
      previous: null,
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "not-configured",
      surface: "api",
      unblockedBy: null,
    });
    expect(clerkCoverageFreshness({ cell, nowMs: NOW_MS }).verdict).toBe("never-synced");
  });
});
