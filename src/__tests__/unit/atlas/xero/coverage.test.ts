import { describe, expect, it } from "vitest";

import {
  failedXeroCoverageCell,
  storedXeroCoverageCell,
  succeededXeroCoverageCell,
  xeroCoverageFreshness,
} from "../../../../atlas/xero/coverage.js";
import type { XeroArtifactRef, XeroCoverageCell, XeroCoverageSurface } from "../../../../atlas/xero/model.js";

const AT = "2026-10-12T10:00:00.000Z";
const NOW_MS = Date.parse("2026-10-12T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
/** Xero declares the pinned window: fourteen days. */
const DECLARED_WINDOW_MS = 14 * 24 * HOUR_MS;

const SCREENSHOT: XeroArtifactRef = {
  byteLength: 2048,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "artifacts/organisation.png",
  sha256: "d".repeat(64),
};

/** Xero keys the claim boundary on the SURFACE, so the table is per surface, not per channel. */
const SURFACE_SCOPES: readonly (readonly [XeroCoverageSurface, string])[] = [
  ["sdk-declared", "sdk-declarations"],
  ["browser-walk", "browser-signed-in-user"],
  ["web-client", "browser-signed-in-user"],
  ["live-api", "oauth-connection-scopes"],
];

/** A stored cell whose only variable parts are the instant and the failure flag under test. */
function storedCell({
  lastSuccessAt = AT,
  latestAttemptFailed = false,
}: {
  lastSuccessAt?: string | null;
  latestAttemptFailed?: boolean;
}): XeroCoverageCell {
  return {
    artifacts: [],
    channel: "api",
    lastSuccessAt,
    latestAttemptFailed,
    reason: "stored",
    role: "authoritative",
    scope: "sdk/accounting",
    state: "synced",
    surface: "sdk-declared",
    unblockedBy: null,
    visibilityScope: "sdk-declarations",
  };
}

describe("storedXeroCoverageCell", () => {
  const walk: XeroCoverageCell = { ...storedCell({}), channel: "browser", surface: "browser-walk" };

  it("returns the cell the kind file already holds for that surface", () => {
    expect(storedXeroCoverageCell({ coverage: [storedCell({}), walk], surface: "browser-walk" })).toBe(walk);
  });

  it("is null for a surface no stored cell covers, because it was never touched", () => {
    expect(storedXeroCoverageCell({ coverage: [walk], surface: "live-api" })).toBe(null);
    expect(storedXeroCoverageCell({ coverage: [], surface: "browser-walk" })).toBe(null);
  });
});

describe("succeededXeroCoverageCell", () => {
  it("stamps the whole cell as a fresh success under the surface's own scope", () => {
    const cell = succeededXeroCoverageCell({
      artifacts: [SCREENSHOT],
      at: AT,
      channel: "browser",
      reason: "walked 7 organisation page(s)",
      role: "corroborating",
      scope: "user/organisations",
      state: "synced",
      surface: "browser-walk",
    });
    expect(cell).toStrictEqual({
      artifacts: [SCREENSHOT],
      channel: "browser",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: "walked 7 organisation page(s)",
      role: "corroborating",
      scope: "user/organisations",
      state: "synced",
      surface: "browser-walk",
      unblockedBy: null,
      visibilityScope: "browser-signed-in-user",
    });
  });

  it("maps every declared surface to its own visibility scope, whatever the channel", () => {
    expect(SURFACE_SCOPES.length).toBeGreaterThan(0);
    const scopes = SURFACE_SCOPES.map(
      ([surface]) =>
        succeededXeroCoverageCell({
          artifacts: [],
          at: AT,
          channel: "api",
          reason: "r",
          role: "authoritative",
          scope: "s",
          state: "synced",
          surface,
        }).visibilityScope,
    );
    expect(scopes).toStrictEqual(SURFACE_SCOPES.map(([, scope]) => scope));
  });

  it("gives the two api-channel surfaces different scopes, because the surface decides", () => {
    const sdk = succeededXeroCoverageCell({
      artifacts: [],
      at: AT,
      channel: "api",
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "synced",
      surface: "sdk-declared",
    });
    const live = succeededXeroCoverageCell({
      artifacts: [],
      at: AT,
      channel: "api",
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "synced",
      surface: "live-api",
    });
    expect([sdk.channel, live.channel]).toStrictEqual(["api", "api"]);
    expect([sdk.visibilityScope, live.visibilityScope]).toStrictEqual(["sdk-declarations", "oauth-connection-scopes"]);
  });

  it("does not alias the caller's artifact array", () => {
    const artifacts = [SCREENSHOT];
    const cell = succeededXeroCoverageCell({
      artifacts,
      at: AT,
      channel: "browser",
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "synced",
      surface: "web-client",
    });
    artifacts.push({ ...SCREENSHOT, relativePath: "artifacts/late.png" });
    expect(cell.artifacts).toStrictEqual([SCREENSHOT]);
  });
});

describe("failedXeroCoverageCell", () => {
  it("keeps the prior success's instant and artifacts while the attempt's own fields replace the rest", () => {
    const previous = succeededXeroCoverageCell({
      artifacts: [SCREENSHOT],
      at: AT,
      channel: "browser",
      reason: "walked 7 organisation page(s)",
      role: "authoritative",
      scope: "user/organisations",
      state: "synced",
      surface: "browser-walk",
    });
    const cell = failedXeroCoverageCell({
      channel: "browser",
      previous,
      reason: "sign-in wall",
      role: "corroborating",
      scope: "user/people",
      state: "unreadable",
      surface: "browser-walk",
      unblockedBy: "sign in again",
    });
    expect(cell).toStrictEqual({
      artifacts: [SCREENSHOT],
      channel: "browser",
      lastSuccessAt: AT,
      latestAttemptFailed: true,
      reason: "sign-in wall",
      role: "corroborating",
      scope: "user/people",
      state: "unreadable",
      surface: "browser-walk",
      unblockedBy: "sign in again",
      visibilityScope: "browser-signed-in-user",
    });
  });

  it("maps every declared surface to its own visibility scope on a failure too", () => {
    expect(SURFACE_SCOPES.length).toBeGreaterThan(0);
    const scopes = SURFACE_SCOPES.map(
      ([surface]) =>
        failedXeroCoverageCell({
          channel: "api",
          previous: null,
          reason: "r",
          role: "authoritative",
          scope: "s",
          state: "unreadable",
          surface,
          unblockedBy: null,
        }).visibilityScope,
    );
    expect(scopes).toStrictEqual(SURFACE_SCOPES.map(([, scope]) => scope));
  });

  it("has no success and no artifacts when nothing came before", () => {
    const cell = failedXeroCoverageCell({
      channel: "api",
      previous: null,
      reason: "no OAuth connection",
      role: "authoritative",
      scope: "tenant/accounting",
      state: "not-configured",
      surface: "live-api",
      unblockedBy: "connect a Xero app",
    });
    expect(cell).toStrictEqual({
      artifacts: [],
      channel: "api",
      lastSuccessAt: null,
      latestAttemptFailed: true,
      reason: "no OAuth connection",
      role: "authoritative",
      scope: "tenant/accounting",
      state: "not-configured",
      surface: "live-api",
      unblockedBy: "connect a Xero app",
      visibilityScope: "oauth-connection-scopes",
    });
  });

  it("does not alias the prior cell's artifact array", () => {
    const previous = succeededXeroCoverageCell({
      artifacts: [SCREENSHOT],
      at: AT,
      channel: "browser",
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "synced",
      surface: "web-client",
    });
    const cell = failedXeroCoverageCell({
      channel: "browser",
      previous,
      reason: "r",
      role: "authoritative",
      scope: "s",
      state: "unreadable",
      surface: "web-client",
      unblockedBy: null,
    });
    previous.artifacts.push({ ...SCREENSHOT, relativePath: "artifacts/late.png" });
    expect(cell.artifacts).toStrictEqual([SCREENSHOT]);
  });
});

describe("xeroCoverageFreshness", () => {
  it("judges against the declared fourteen day window, so a five-hour-old success is current", () => {
    const assessment = xeroCoverageFreshness({
      cell: storedCell({ lastSuccessAt: new Date(NOW_MS - 5 * HOUR_MS).toISOString() }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("current");
    expect(assessment.mayQuoteAsCurrent).toBe(true);
    expect(assessment.windowMs).toBe(DECLARED_WINDOW_MS);
  });

  it("still calls a success exactly at the window's edge current", () => {
    const assessment = xeroCoverageFreshness({
      cell: storedCell({ lastSuccessAt: new Date(NOW_MS - DECLARED_WINDOW_MS).toISOString() }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("current");
  });

  it("calls a success one minute past the window historical", () => {
    const assessment = xeroCoverageFreshness({
      cell: storedCell({ lastSuccessAt: new Date(NOW_MS - DECLARED_WINDOW_MS - MINUTE_MS).toISOString() }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("historical");
    expect(assessment.mayQuoteAsCurrent).toBe(false);
    expect(assessment.windowMs).toBe(DECLARED_WINDOW_MS);
  });

  it("never calls a recent success current when the latest attempt failed", () => {
    const assessment = xeroCoverageFreshness({
      cell: storedCell({ latestAttemptFailed: true }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("historical");
  });

  it("reports a cell that never succeeded as never-synced", () => {
    const assessment = xeroCoverageFreshness({
      cell: storedCell({ lastSuccessAt: null, latestAttemptFailed: true }),
      nowMs: NOW_MS,
    });
    expect(assessment.verdict).toBe("never-synced");
  });
});
