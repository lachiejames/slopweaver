import { describe, expect, it } from "vitest";

import {
  failedHiveCoverageCell,
  hiveCoverageFreshness,
  succeededHiveCoverageCell,
} from "../../../../atlas/graphqlHive/coverage.js";
import {
  HIVE_ATLAS_CHANNELS,
  type HiveArtifactRef,
  type HiveAtlasChannel,
} from "../../../../atlas/graphqlHive/model.js";

const AT = "2026-10-01T00:00:00.000Z";
const LATER = "2026-10-02T00:00:00.000Z";
const AT_MS = Date.parse(AT);
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const SHOT: HiveArtifactRef = {
  byteLength: 2048,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "artifacts/targets.png",
  sha256: "b".repeat(64),
};

const SCOPE_BY_CHANNEL: readonly (readonly [HiveAtlasChannel, string])[] = [
  ["api", "api-token-scopes"],
  ["browser", "browser-signed-in-role"],
];

describe("succeededHiveCoverageCell", () => {
  it("stamps the whole cell as a fresh success on its channel", () => {
    const cell = succeededHiveCoverageCell({
      artifacts: [SHOT],
      at: AT,
      channel: "browser",
      reason: "walked the targets page",
      role: "corroborating",
      scope: "organization/acme",
      state: "synced",
      surface: "targets",
    });
    expect(cell).toStrictEqual({
      artifacts: [SHOT],
      channel: "browser",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: "walked the targets page",
      role: "corroborating",
      scope: "organization/acme",
      state: "synced",
      surface: "targets",
      unblockedBy: null,
      visibilityScope: "browser-signed-in-role",
    });
  });

  it("covers every declared channel in the visibility table", () => {
    expect(HIVE_ATLAS_CHANNELS.length).toBeGreaterThan(0);
    expect(SCOPE_BY_CHANNEL.map(([channel]) => channel)).toStrictEqual([...HIVE_ATLAS_CHANNELS]);
  });

  it.each(SCOPE_BY_CHANNEL)("maps the %s channel to the %s visibility scope", (channel, scope) => {
    const cell = succeededHiveCoverageCell({
      artifacts: [],
      at: AT,
      channel,
      reason: "read",
      role: "authoritative",
      scope: "tenant",
      state: "synced",
      surface: "targets",
    });
    expect(cell.channel).toBe(channel);
    expect(cell.visibilityScope).toBe(scope);
  });

  it("does not alias the caller's artifacts array", () => {
    const artifacts: HiveArtifactRef[] = [SHOT];
    const cell = succeededHiveCoverageCell({
      artifacts,
      at: AT,
      channel: "api",
      reason: "read",
      role: "authoritative",
      scope: "tenant",
      state: "synced",
      surface: "targets",
    });
    artifacts.push({ ...SHOT, relativePath: "artifacts/other.png" });
    expect(cell.artifacts).toStrictEqual([SHOT]);
  });
});

describe("failedHiveCoverageCell", () => {
  it("keeps the prior success and its artifacts, and takes the failed attempt's own fields", () => {
    const previous = succeededHiveCoverageCell({
      artifacts: [SHOT],
      at: AT,
      channel: "browser",
      reason: "walked the targets page",
      role: "authoritative",
      scope: "organization/acme",
      state: "synced",
      surface: "targets",
    });
    const cell = failedHiveCoverageCell({
      channel: "api",
      previous,
      reason: "registry token refused",
      role: "corroborating",
      scope: "organization/acme/api",
      state: "unreadable",
      surface: "targets",
      unblockedBy: "widen the registry access token's scopes",
    });
    expect(cell).toStrictEqual({
      artifacts: [SHOT],
      channel: "api",
      lastSuccessAt: AT,
      latestAttemptFailed: true,
      reason: "registry token refused",
      role: "corroborating",
      scope: "organization/acme/api",
      state: "unreadable",
      surface: "targets",
      unblockedBy: "widen the registry access token's scopes",
      visibilityScope: "api-token-scopes",
    });
  });

  it("has no success and no artifacts when there was no previous cell", () => {
    const cell = failedHiveCoverageCell({
      channel: "browser",
      previous: null,
      reason: "signed out",
      role: "discovery",
      scope: "account",
      state: "unreadable",
      surface: "targets",
      unblockedBy: null,
    });
    expect(cell.lastSuccessAt).toBe(null);
    expect(cell.artifacts).toStrictEqual([]);
    expect(cell.latestAttemptFailed).toBe(true);
    expect(cell.unblockedBy).toBe(null);
    expect(cell.visibilityScope).toBe("browser-signed-in-role");
  });

  it.each(SCOPE_BY_CHANNEL)("maps a failed %s attempt to the %s visibility scope", (channel, scope) => {
    const cell = failedHiveCoverageCell({
      channel,
      previous: null,
      reason: "failed",
      role: "authoritative",
      scope: "tenant",
      state: "unreadable",
      surface: "targets",
      unblockedBy: null,
    });
    expect(cell.visibilityScope).toBe(scope);
  });

  it("does not alias the previous cell's artifacts array", () => {
    const previous = succeededHiveCoverageCell({
      artifacts: [SHOT],
      at: AT,
      channel: "api",
      reason: "read",
      role: "authoritative",
      scope: "tenant",
      state: "synced",
      surface: "targets",
    });
    const cell = failedHiveCoverageCell({
      channel: "api",
      previous,
      reason: "failed",
      role: "authoritative",
      scope: "tenant",
      state: "unreadable",
      surface: "targets",
      unblockedBy: null,
    });
    previous.artifacts.push({ ...SHOT, relativePath: "artifacts/other.png" });
    expect(cell.artifacts).toStrictEqual([SHOT]);
  });
});

describe("hiveCoverageFreshness", () => {
  const cellAt = ({ at }: { at: string }): ReturnType<typeof succeededHiveCoverageCell> =>
    succeededHiveCoverageCell({
      artifacts: [],
      at,
      channel: "api",
      reason: "read",
      role: "authoritative",
      scope: "tenant",
      state: "synced",
      surface: "targets",
    });

  it("judges a five-hour-old success current, because the declared window is thirty-six hours", () => {
    const assessment = hiveCoverageFreshness({ cell: cellAt({ at: AT }), nowMs: AT_MS + 5 * HOUR_MS });
    expect(assessment.verdict).toBe("current");
    expect(assessment.mayQuoteAsCurrent).toBe(true);
    expect(assessment.windowMs).toBe(36 * HOUR_MS);
  });

  it("judges a success exactly at the thirty-six-hour window current", () => {
    const assessment = hiveCoverageFreshness({ cell: cellAt({ at: AT }), nowMs: AT_MS + 36 * HOUR_MS });
    expect(assessment.verdict).toBe("current");
  });

  it("judges a success one minute past the thirty-six-hour window historical", () => {
    const assessment = hiveCoverageFreshness({ cell: cellAt({ at: AT }), nowMs: AT_MS + 36 * HOUR_MS + MINUTE_MS });
    expect(assessment.verdict).toBe("historical");
    expect(assessment.mayQuoteAsCurrent).toBe(false);
  });

  it("judges a failed latest attempt historical however recent the prior success", () => {
    const failed = failedHiveCoverageCell({
      channel: "api",
      previous: cellAt({ at: LATER }),
      reason: "failed",
      role: "authoritative",
      scope: "tenant",
      state: "unreadable",
      surface: "targets",
      unblockedBy: null,
    });
    const assessment = hiveCoverageFreshness({ cell: failed, nowMs: Date.parse(LATER) + HOUR_MS });
    expect(assessment.verdict).toBe("historical");
  });

  it("judges a cell that never succeeded never-synced", () => {
    const failed = failedHiveCoverageCell({
      channel: "api",
      previous: null,
      reason: "failed",
      role: "authoritative",
      scope: "tenant",
      state: "not-configured",
      surface: "targets",
      unblockedBy: null,
    });
    const assessment = hiveCoverageFreshness({ cell: failed, nowMs: AT_MS });
    expect(assessment.verdict).toBe("never-synced");
  });
});
