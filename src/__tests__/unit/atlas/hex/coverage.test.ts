import { describe, expect, it } from "vitest";

import {
  failedHexCoverageCell,
  hexCoverageFreshness,
  succeededHexCoverageCell,
} from "../../../../atlas/hex/coverage.js";
import { HEX_ATLAS_DESCRIPTOR } from "../../../../atlas/hex/descriptor.js";
import { HEX_ATLAS_CHANNELS, type HexArtifactRef, type HexAtlasChannel } from "../../../../atlas/hex/model.js";
import { atlasFreshnessWindowMs } from "../../../../atlas/kit/freshnessWindow.js";

const AT = "2026-10-01T00:00:00.000Z";
const LATER = "2026-10-02T00:00:00.000Z";
const AT_MS = Date.parse(AT);
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const SHOT: HexArtifactRef = {
  byteLength: 4096,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "artifacts/projects.png",
  sha256: "c".repeat(64),
};

/*
 * The constructors derive scope from the CHANNEL only, by design (`model.ts` § HEX_VISIBILITY_SCOPES): a
 * caller that read with a token names HEX_TOKEN_VISIBILITY_SCOPE itself, so `api` here is always anonymous.
 */
const SCOPE_BY_CHANNEL: readonly (readonly [HexAtlasChannel, string])[] = [
  ["api", "api-anonymous-published"],
  ["browser", "browser-signed-in-role"],
];

describe("succeededHexCoverageCell", () => {
  it("stamps the whole cell as a fresh success on its channel", () => {
    const cell = succeededHexCoverageCell({
      artifacts: [SHOT],
      at: AT,
      channel: "browser",
      reason: "walked the projects page",
      role: "corroborating",
      scope: "workspace/acme",
      state: "synced",
      surface: "projects",
    });
    expect(cell).toStrictEqual({
      artifacts: [SHOT],
      channel: "browser",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: "walked the projects page",
      role: "corroborating",
      scope: "workspace/acme",
      state: "synced",
      surface: "projects",
      unblockedBy: null,
      visibilityScope: "browser-signed-in-role",
    });
  });

  it("covers every declared channel in the visibility table", () => {
    expect(HEX_ATLAS_CHANNELS.length).toBeGreaterThan(0);
    expect(SCOPE_BY_CHANNEL.map(([channel]) => channel)).toStrictEqual([...HEX_ATLAS_CHANNELS]);
  });

  it.each(SCOPE_BY_CHANNEL)("maps the %s channel to the %s visibility scope", (channel, scope) => {
    const cell = succeededHexCoverageCell({
      artifacts: [],
      at: AT,
      channel,
      reason: "read",
      role: "authoritative",
      scope: "tenant",
      state: "synced",
      surface: "projects",
    });
    expect(cell.channel).toBe(channel);
    expect(cell.visibilityScope).toBe(scope);
  });

  it("does not alias the caller's artifacts array", () => {
    const artifacts: HexArtifactRef[] = [SHOT];
    const cell = succeededHexCoverageCell({
      artifacts,
      at: AT,
      channel: "api",
      reason: "read",
      role: "authoritative",
      scope: "tenant",
      state: "synced",
      surface: "projects",
    });
    artifacts.push({ ...SHOT, relativePath: "artifacts/other.png" });
    expect(cell.artifacts).toStrictEqual([SHOT]);
  });
});

describe("failedHexCoverageCell", () => {
  it("keeps the prior success and its artifacts, and takes the failed attempt's own fields", () => {
    const previous = succeededHexCoverageCell({
      artifacts: [SHOT],
      at: AT,
      channel: "api",
      reason: "read the published document",
      role: "authoritative",
      scope: "product",
      state: "synced",
      surface: "projects",
    });
    const cell = failedHexCoverageCell({
      channel: "browser",
      previous,
      reason: "signed out",
      role: "corroborating",
      scope: "workspace/acme",
      state: "unreadable",
      surface: "projects",
      unblockedBy: "sign in to Hex in the owner's Chrome",
    });
    expect(cell).toStrictEqual({
      artifacts: [SHOT],
      channel: "browser",
      lastSuccessAt: AT,
      latestAttemptFailed: true,
      reason: "signed out",
      role: "corroborating",
      scope: "workspace/acme",
      state: "unreadable",
      surface: "projects",
      unblockedBy: "sign in to Hex in the owner's Chrome",
      visibilityScope: "browser-signed-in-role",
    });
  });

  it("has no success and no artifacts when there was no previous cell", () => {
    const cell = failedHexCoverageCell({
      channel: "api",
      previous: null,
      reason: "no token",
      role: "discovery",
      scope: "workspace",
      state: "not-configured",
      surface: "projects",
      unblockedBy: null,
    });
    expect(cell.lastSuccessAt).toBe(null);
    expect(cell.artifacts).toStrictEqual([]);
    expect(cell.latestAttemptFailed).toBe(true);
    expect(cell.unblockedBy).toBe(null);
    expect(cell.visibilityScope).toBe("api-anonymous-published");
  });

  it.each(SCOPE_BY_CHANNEL)("maps a failed %s attempt to the %s visibility scope", (channel, scope) => {
    const cell = failedHexCoverageCell({
      channel,
      previous: null,
      reason: "failed",
      role: "authoritative",
      scope: "tenant",
      state: "unreadable",
      surface: "projects",
      unblockedBy: null,
    });
    expect(cell.visibilityScope).toBe(scope);
  });

  it("does not alias the previous cell's artifacts array", () => {
    const previous = succeededHexCoverageCell({
      artifacts: [SHOT],
      at: AT,
      channel: "api",
      reason: "read",
      role: "authoritative",
      scope: "tenant",
      state: "synced",
      surface: "projects",
    });
    const cell = failedHexCoverageCell({
      channel: "api",
      previous,
      reason: "failed",
      role: "authoritative",
      scope: "tenant",
      state: "unreadable",
      surface: "projects",
      unblockedBy: null,
    });
    previous.artifacts.push({ ...SHOT, relativePath: "artifacts/other.png" });
    expect(cell.artifacts).toStrictEqual([SHOT]);
  });
});

describe("hexCoverageFreshness", () => {
  const cellAt = ({ at }: { at: string }): ReturnType<typeof succeededHexCoverageCell> =>
    succeededHexCoverageCell({
      artifacts: [],
      at,
      channel: "api",
      reason: "read",
      role: "authoritative",
      scope: "tenant",
      state: "synced",
      surface: "projects",
    });

  it("judges a five-hour-old success current, because the declared window is fourteen days", () => {
    const assessment = hexCoverageFreshness({ cell: cellAt({ at: AT }), nowMs: AT_MS + 5 * HOUR_MS });
    expect(assessment.verdict).toBe("current");
    expect(assessment.mayQuoteAsCurrent).toBe(true);
    expect(assessment.windowMs).toBe(14 * DAY_MS);
  });

  it("judges against exactly the window the descriptor declares", () => {
    const assessment = hexCoverageFreshness({ cell: cellAt({ at: AT }), nowMs: AT_MS });
    expect(assessment.windowMs).toBe(atlasFreshnessWindowMs({ descriptor: HEX_ATLAS_DESCRIPTOR }));
  });

  it("judges a success exactly at the fourteen-day window current", () => {
    const assessment = hexCoverageFreshness({ cell: cellAt({ at: AT }), nowMs: AT_MS + 14 * DAY_MS });
    expect(assessment.verdict).toBe("current");
  });

  it("judges a success one minute past the fourteen-day window historical", () => {
    const assessment = hexCoverageFreshness({ cell: cellAt({ at: AT }), nowMs: AT_MS + 14 * DAY_MS + MINUTE_MS });
    expect(assessment.verdict).toBe("historical");
    expect(assessment.mayQuoteAsCurrent).toBe(false);
  });

  it("judges a failed latest attempt historical however recent the prior success", () => {
    const failed = failedHexCoverageCell({
      channel: "api",
      previous: cellAt({ at: LATER }),
      reason: "failed",
      role: "authoritative",
      scope: "tenant",
      state: "unreadable",
      surface: "projects",
      unblockedBy: null,
    });
    const assessment = hexCoverageFreshness({ cell: failed, nowMs: Date.parse(LATER) + HOUR_MS });
    expect(assessment.verdict).toBe("historical");
  });

  it("judges a cell that never succeeded never-synced", () => {
    const failed = failedHexCoverageCell({
      channel: "api",
      previous: null,
      reason: "failed",
      role: "authoritative",
      scope: "tenant",
      state: "not-configured",
      surface: "projects",
      unblockedBy: null,
    });
    const assessment = hexCoverageFreshness({ cell: failed, nowMs: AT_MS });
    expect(assessment.verdict).toBe("never-synced");
  });
});
