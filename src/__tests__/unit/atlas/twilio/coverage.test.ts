import { describe, expect, it } from "vitest";

import {
  failedTwilioCoverageCell,
  succeededTwilioCoverageCell,
  twilioCoverageFreshness,
} from "../../../../atlas/twilio/coverage.js";
import {
  TWILIO_ATLAS_CHANNELS,
  type TwilioArtifactRef,
  type TwilioAtlasChannel,
  type TwilioCoverageCell,
} from "../../../../atlas/twilio/model.js";

const AT = "2026-10-12T10:00:00.000Z";
const NOW_MS = Date.parse("2026-10-12T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
/** Twilio declares the pinned window: fourteen days. */
const DECLARED_WINDOW_MS = 14 * 24 * HOUR_MS;

const SCREENSHOT: TwilioArtifactRef = {
  byteLength: 2048,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "artifacts/console.png",
  sha256: "b".repeat(64),
};

const CHANNEL_SCOPES: readonly (readonly [TwilioAtlasChannel, string])[] = [
  ["api", "api-published-definitions"],
  ["browser", "browser-signed-in-role"],
];

/** A stored cell whose only variable parts are the instant and the failure flag under test. */
function storedCell({
  lastSuccessAt = AT,
  latestAttemptFailed = false,
}: {
  lastSuccessAt?: string | null;
  latestAttemptFailed?: boolean;
}): TwilioCoverageCell {
  return {
    artifacts: [],
    channel: "api",
    lastSuccessAt,
    latestAttemptFailed,
    reason: "stored",
    role: "authoritative",
    scope: "definitions",
    state: "synced",
    surface: "definitions",
    unblockedBy: null,
    visibilityScope: "api-published-definitions",
  };
}

describe("succeededTwilioCoverageCell", () => {
  it("stamps the whole cell as a fresh success under the channel's own scope", () => {
    const cell = succeededTwilioCoverageCell({
      artifacts: [SCREENSHOT],
      at: AT,
      channel: "browser",
      reason: "walked 12 console page(s)",
      role: "corroborating",
      scope: "account/console",
      state: "synced",
      surface: "console",
    });
    expect(cell).toStrictEqual({
      artifacts: [SCREENSHOT],
      channel: "browser",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: "walked 12 console page(s)",
      role: "corroborating",
      scope: "account/console",
      state: "synced",
      surface: "console",
      unblockedBy: null,
      visibilityScope: "browser-signed-in-role",
    });
  });

  it("maps every declared channel to its own visibility scope", () => {
    expect(CHANNEL_SCOPES.map(([channel]) => channel)).toStrictEqual([...TWILIO_ATLAS_CHANNELS]);
    const scopes = CHANNEL_SCOPES.map(
      ([channel]) =>
        succeededTwilioCoverageCell({
          artifacts: [],
          at: AT,
          channel,
          reason: "r",
          role: "authoritative",
          scope: "s",
          state: "synced",
          surface: "definitions",
        }).visibilityScope,
    );
    expect(scopes).toStrictEqual(CHANNEL_SCOPES.map(([, scope]) => scope));
  });

  it("does not alias the caller's artifact array", () => {
    const artifacts = [SCREENSHOT];
    const cell = succeededTwilioCoverageCell({
      artifacts,
      at: AT,
      channel: "api",
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "synced",
      surface: "definitions",
    });
    artifacts.push({ ...SCREENSHOT, relativePath: "artifacts/late.png" });
    expect(cell.artifacts).toStrictEqual([SCREENSHOT]);
  });
});

describe("failedTwilioCoverageCell", () => {
  it("keeps the prior success's instant and artifacts while the attempt's own fields replace the rest", () => {
    const previous = succeededTwilioCoverageCell({
      artifacts: [SCREENSHOT],
      at: AT,
      channel: "api",
      reason: "read the public definitions",
      role: "authoritative",
      scope: "definitions",
      state: "synced",
      surface: "console",
    });
    const cell = failedTwilioCoverageCell({
      channel: "browser",
      previous,
      reason: "sign-in wall",
      role: "corroborating",
      scope: "account/console",
      state: "unreadable",
      surface: "console",
      unblockedBy: "sign in again",
    });
    expect(cell).toStrictEqual({
      artifacts: [SCREENSHOT],
      channel: "browser",
      lastSuccessAt: AT,
      latestAttemptFailed: true,
      reason: "sign-in wall",
      role: "corroborating",
      scope: "account/console",
      state: "unreadable",
      surface: "console",
      unblockedBy: "sign in again",
      visibilityScope: "browser-signed-in-role",
    });
  });

  it("has no success and no artifacts when nothing came before", () => {
    const cell = failedTwilioCoverageCell({
      channel: "api",
      previous: null,
      reason: "repository unreachable",
      role: "authoritative",
      scope: "definitions",
      state: "unavailable",
      surface: "definitions",
      unblockedBy: null,
    });
    expect(cell).toStrictEqual({
      artifacts: [],
      channel: "api",
      lastSuccessAt: null,
      latestAttemptFailed: true,
      reason: "repository unreachable",
      role: "authoritative",
      scope: "definitions",
      state: "unavailable",
      surface: "definitions",
      unblockedBy: null,
      visibilityScope: "api-published-definitions",
    });
  });

  it("does not alias the prior cell's artifact array", () => {
    const previous = succeededTwilioCoverageCell({
      artifacts: [SCREENSHOT],
      at: AT,
      channel: "api",
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "synced",
      surface: "definitions",
    });
    const cell = failedTwilioCoverageCell({
      channel: "api",
      previous,
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "unreadable",
      surface: "definitions",
      unblockedBy: null,
    });
    previous.artifacts.push({ ...SCREENSHOT, relativePath: "artifacts/late.png" });
    expect(cell.artifacts).toStrictEqual([SCREENSHOT]);
  });
});

describe("twilioCoverageFreshness", () => {
  it("judges against the declared fourteen day window, so a five-hour-old success is current", () => {
    const assessment = twilioCoverageFreshness({
      cell: storedCell({ lastSuccessAt: new Date(NOW_MS - 5 * HOUR_MS).toISOString() }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("current");
    expect(assessment.mayQuoteAsCurrent).toBe(true);
    expect(assessment.windowMs).toBe(DECLARED_WINDOW_MS);
  });

  it("still calls a success exactly at the window's edge current", () => {
    const assessment = twilioCoverageFreshness({
      cell: storedCell({ lastSuccessAt: new Date(NOW_MS - DECLARED_WINDOW_MS).toISOString() }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("current");
  });

  it("calls a success one minute past the window historical", () => {
    const assessment = twilioCoverageFreshness({
      cell: storedCell({ lastSuccessAt: new Date(NOW_MS - DECLARED_WINDOW_MS - MINUTE_MS).toISOString() }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("historical");
    expect(assessment.mayQuoteAsCurrent).toBe(false);
    expect(assessment.windowMs).toBe(DECLARED_WINDOW_MS);
  });

  it("never calls a recent success current when the latest attempt failed", () => {
    const assessment = twilioCoverageFreshness({
      cell: storedCell({ latestAttemptFailed: true }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("historical");
  });

  it("reports a cell that never succeeded as never-synced", () => {
    const assessment = twilioCoverageFreshness({
      cell: storedCell({ lastSuccessAt: null, latestAttemptFailed: true }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("never-synced");
  });
});
