import { describe, expect, it } from "vitest";

import {
  failedWorkosCoverageCell,
  succeededWorkosCoverageCell,
  workosCoverageFreshness,
} from "../../../../atlas/workos/coverage.js";
import {
  WORKOS_ATLAS_CHANNELS,
  type WorkosArtifactRef,
  type WorkosAtlasChannel,
  type WorkosCoverageCell,
} from "../../../../atlas/workos/model.js";

const AT = "2026-10-12T10:00:00.000Z";
const NOW_MS = Date.parse("2026-10-12T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
/** WorkOS declares the daily window: thirty-six hours. */
const DECLARED_WINDOW_MS = 36 * HOUR_MS;

const SCREENSHOT: WorkosArtifactRef = {
  byteLength: 2048,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "artifacts/dashboard.png",
  sha256: "c".repeat(64),
};

const CHANNEL_SCOPES: readonly (readonly [WorkosAtlasChannel, string])[] = [
  ["api", "api-key-environment"],
  ["browser", "browser-dashboard-role"],
];

/** A stored cell whose only variable parts are the instant and the failure flag under test. */
function storedCell({
  lastSuccessAt = AT,
  latestAttemptFailed = false,
}: {
  lastSuccessAt?: string | null;
  latestAttemptFailed?: boolean;
}): WorkosCoverageCell {
  return {
    artifacts: [],
    channel: "api",
    lastSuccessAt,
    latestAttemptFailed,
    reason: "stored",
    role: "authoritative",
    scope: "environment/organizations",
    state: "synced",
    surface: "organizations",
    unblockedBy: null,
    visibilityScope: "api-key-environment",
  };
}

describe("succeededWorkosCoverageCell", () => {
  it("stamps the whole cell as a fresh success under the channel's own scope", () => {
    const cell = succeededWorkosCoverageCell({
      artifacts: [SCREENSHOT],
      at: AT,
      channel: "browser",
      reason: "walked 9 dashboard page(s)",
      role: "corroborating",
      scope: "team/dashboard",
      state: "synced",
      surface: "dashboard",
    });
    expect(cell).toStrictEqual({
      artifacts: [SCREENSHOT],
      channel: "browser",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: "walked 9 dashboard page(s)",
      role: "corroborating",
      scope: "team/dashboard",
      state: "synced",
      surface: "dashboard",
      unblockedBy: null,
      visibilityScope: "browser-dashboard-role",
    });
  });

  it("maps every declared channel to its own visibility scope", () => {
    expect(CHANNEL_SCOPES.map(([channel]) => channel)).toStrictEqual([...WORKOS_ATLAS_CHANNELS]);
    const scopes = CHANNEL_SCOPES.map(
      ([channel]) =>
        succeededWorkosCoverageCell({
          artifacts: [],
          at: AT,
          channel,
          reason: "r",
          role: "authoritative",
          scope: "s",
          state: "synced",
          surface: "organizations",
        }).visibilityScope,
    );
    expect(scopes).toStrictEqual(CHANNEL_SCOPES.map(([, scope]) => scope));
  });

  it("does not alias the caller's artifact array", () => {
    const artifacts = [SCREENSHOT];
    const cell = succeededWorkosCoverageCell({
      artifacts,
      at: AT,
      channel: "api",
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "synced",
      surface: "organizations",
    });
    artifacts.push({ ...SCREENSHOT, relativePath: "artifacts/late.png" });
    expect(cell.artifacts).toStrictEqual([SCREENSHOT]);
  });
});

describe("failedWorkosCoverageCell", () => {
  it("keeps the prior success's instant and artifacts while the attempt's own fields replace the rest", () => {
    const previous = succeededWorkosCoverageCell({
      artifacts: [SCREENSHOT],
      at: AT,
      channel: "api",
      reason: "read 3 organization(s)",
      role: "authoritative",
      scope: "environment/organizations",
      state: "synced",
      surface: "organizations",
    });
    const cell = failedWorkosCoverageCell({
      channel: "browser",
      previous,
      reason: "sign-in wall",
      role: "corroborating",
      scope: "team/dashboard",
      state: "unreadable",
      surface: "organizations",
      unblockedBy: "sign in again",
    });
    expect(cell).toStrictEqual({
      artifacts: [SCREENSHOT],
      channel: "browser",
      lastSuccessAt: AT,
      latestAttemptFailed: true,
      reason: "sign-in wall",
      role: "corroborating",
      scope: "team/dashboard",
      state: "unreadable",
      surface: "organizations",
      unblockedBy: "sign in again",
      visibilityScope: "browser-dashboard-role",
    });
  });

  it("has no success and no artifacts when nothing came before", () => {
    const cell = failedWorkosCoverageCell({
      channel: "api",
      previous: null,
      reason: "no key minted",
      role: "authoritative",
      scope: "environment/organizations",
      state: "not-configured",
      surface: "organizations",
      unblockedBy: null,
    });
    expect(cell).toStrictEqual({
      artifacts: [],
      channel: "api",
      lastSuccessAt: null,
      latestAttemptFailed: true,
      reason: "no key minted",
      role: "authoritative",
      scope: "environment/organizations",
      state: "not-configured",
      surface: "organizations",
      unblockedBy: null,
      visibilityScope: "api-key-environment",
    });
  });

  it("does not alias the prior cell's artifact array", () => {
    const previous = succeededWorkosCoverageCell({
      artifacts: [SCREENSHOT],
      at: AT,
      channel: "api",
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "synced",
      surface: "organizations",
    });
    const cell = failedWorkosCoverageCell({
      channel: "api",
      previous,
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "unreadable",
      surface: "organizations",
      unblockedBy: null,
    });
    previous.artifacts.push({ ...SCREENSHOT, relativePath: "artifacts/late.png" });
    expect(cell.artifacts).toStrictEqual([SCREENSHOT]);
  });
});

describe("workosCoverageFreshness", () => {
  it("judges against the declared thirty-six hour window, so a five-hour-old success is current", () => {
    const assessment = workosCoverageFreshness({
      cell: storedCell({ lastSuccessAt: new Date(NOW_MS - 5 * HOUR_MS).toISOString() }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("current");
    expect(assessment.mayQuoteAsCurrent).toBe(true);
    expect(assessment.windowMs).toBe(DECLARED_WINDOW_MS);
  });

  it("still calls a success exactly at the window's edge current", () => {
    const assessment = workosCoverageFreshness({
      cell: storedCell({ lastSuccessAt: new Date(NOW_MS - DECLARED_WINDOW_MS).toISOString() }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("current");
  });

  it("calls a success one minute past the window historical", () => {
    const assessment = workosCoverageFreshness({
      cell: storedCell({ lastSuccessAt: new Date(NOW_MS - DECLARED_WINDOW_MS - MINUTE_MS).toISOString() }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("historical");
    expect(assessment.mayQuoteAsCurrent).toBe(false);
    expect(assessment.windowMs).toBe(DECLARED_WINDOW_MS);
  });

  it("never calls a recent success current when the latest attempt failed", () => {
    const assessment = workosCoverageFreshness({
      cell: storedCell({ latestAttemptFailed: true }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("historical");
  });

  it("reports a cell that never succeeded as never-synced", () => {
    const assessment = workosCoverageFreshness({
      cell: storedCell({ lastSuccessAt: null, latestAttemptFailed: true }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("never-synced");
  });
});
