import { describe, expect, it } from "vitest";

import {
  failedInngestCoverageCell,
  inngestCoverageFreshness,
  succeededInngestCoverageCell,
} from "../../../../atlas/inngest/coverage.js";
import { INNGEST_CHANNELS, type InngestArtifactRef, type InngestChannel } from "../../../../atlas/inngest/model.js";

const AT = "2026-10-01T00:00:00.000Z";
const LATER = "2026-10-02T00:00:00.000Z";
const AT_MS = Date.parse(AT);
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const SHOT: InngestArtifactRef = {
  byteLength: 512,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "artifacts/functions.png",
  sha256: "d".repeat(64),
};

const SCOPE_BY_CHANNEL: readonly (readonly [InngestChannel, string])[] = [
  ["compiled", "compiled-published-catalogue"],
  ["api", "api-signing-key"],
  ["browser", "browser-signed-in-account"],
];

describe("succeededInngestCoverageCell", () => {
  it("stamps the whole cell as a fresh success on its channel", () => {
    const cell = succeededInngestCoverageCell({
      artifacts: [SHOT],
      at: AT,
      channel: "browser",
      reason: "walked the functions page",
      role: "corroborating",
      scope: "environment/production",
      state: "synced",
      surface: "functions",
    });
    expect(cell).toStrictEqual({
      artifacts: [SHOT],
      channel: "browser",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: "walked the functions page",
      role: "corroborating",
      scope: "environment/production",
      state: "synced",
      surface: "functions",
      unblockedBy: null,
      visibilityScope: "browser-signed-in-account",
    });
  });

  it("covers every declared channel in the visibility table", () => {
    expect(INNGEST_CHANNELS.length).toBeGreaterThan(0);
    expect(SCOPE_BY_CHANNEL.map(([channel]) => channel)).toStrictEqual([...INNGEST_CHANNELS]);
  });

  it.each(SCOPE_BY_CHANNEL)("maps the %s channel to the %s visibility scope", (channel, scope) => {
    const cell = succeededInngestCoverageCell({
      artifacts: [],
      at: AT,
      channel,
      reason: "read",
      role: "authoritative",
      scope: "tenant",
      state: "synced",
      surface: "functions",
    });
    expect(cell.channel).toBe(channel);
    expect(cell.visibilityScope).toBe(scope);
  });

  it("does not alias the caller's artifacts array", () => {
    const artifacts: InngestArtifactRef[] = [SHOT];
    const cell = succeededInngestCoverageCell({
      artifacts,
      at: AT,
      channel: "api",
      reason: "read",
      role: "authoritative",
      scope: "tenant",
      state: "synced",
      surface: "functions",
    });
    artifacts.push({ ...SHOT, relativePath: "artifacts/other.png" });
    expect(cell.artifacts).toStrictEqual([SHOT]);
  });
});

describe("failedInngestCoverageCell", () => {
  it("keeps the prior success and its artifacts, and takes the failed attempt's own fields", () => {
    const previous = succeededInngestCoverageCell({
      artifacts: [SHOT],
      at: AT,
      channel: "compiled",
      reason: "parsed the API reference catalogue",
      role: "authoritative",
      scope: "catalogue",
      state: "synced",
      surface: "functions",
    });
    const cell = failedInngestCoverageCell({
      channel: "api",
      previous,
      reason: "no signing key is configured",
      role: "corroborating",
      scope: "environment/production",
      state: "not-configured",
      surface: "functions",
      unblockedBy: "set an Inngest signing key",
    });
    expect(cell).toStrictEqual({
      artifacts: [SHOT],
      channel: "api",
      lastSuccessAt: AT,
      latestAttemptFailed: true,
      reason: "no signing key is configured",
      role: "corroborating",
      scope: "environment/production",
      state: "not-configured",
      surface: "functions",
      unblockedBy: "set an Inngest signing key",
      visibilityScope: "api-signing-key",
    });
  });

  it("has no success and no artifacts when there was no previous cell", () => {
    const cell = failedInngestCoverageCell({
      channel: "browser",
      previous: null,
      reason: "signed out",
      role: "discovery",
      scope: "account",
      state: "unreadable",
      surface: "functions",
      unblockedBy: null,
    });
    expect(cell.lastSuccessAt).toBe(null);
    expect(cell.artifacts).toStrictEqual([]);
    expect(cell.latestAttemptFailed).toBe(true);
    expect(cell.unblockedBy).toBe(null);
    expect(cell.visibilityScope).toBe("browser-signed-in-account");
  });

  it.each(SCOPE_BY_CHANNEL)("maps a failed %s attempt to the %s visibility scope", (channel, scope) => {
    const cell = failedInngestCoverageCell({
      channel,
      previous: null,
      reason: "failed",
      role: "authoritative",
      scope: "tenant",
      state: "unreadable",
      surface: "functions",
      unblockedBy: null,
    });
    expect(cell.visibilityScope).toBe(scope);
  });

  it("does not alias the previous cell's artifacts array", () => {
    const previous = succeededInngestCoverageCell({
      artifacts: [SHOT],
      at: AT,
      channel: "api",
      reason: "read",
      role: "authoritative",
      scope: "tenant",
      state: "synced",
      surface: "functions",
    });
    const cell = failedInngestCoverageCell({
      channel: "api",
      previous,
      reason: "failed",
      role: "authoritative",
      scope: "tenant",
      state: "unreadable",
      surface: "functions",
      unblockedBy: null,
    });
    previous.artifacts.push({ ...SHOT, relativePath: "artifacts/other.png" });
    expect(cell.artifacts).toStrictEqual([SHOT]);
  });
});

describe("inngestCoverageFreshness", () => {
  const cellAt = ({ at }: { at: string }): ReturnType<typeof succeededInngestCoverageCell> =>
    succeededInngestCoverageCell({
      artifacts: [],
      at,
      channel: "compiled",
      reason: "read",
      role: "authoritative",
      scope: "catalogue",
      state: "synced",
      surface: "functions",
    });

  it("judges a five-hour-old success current, because the declared window is fourteen days", () => {
    const assessment = inngestCoverageFreshness({ cell: cellAt({ at: AT }), nowMs: AT_MS + 5 * HOUR_MS });
    expect(assessment.verdict).toBe("current");
    expect(assessment.mayQuoteAsCurrent).toBe(true);
    expect(assessment.windowMs).toBe(14 * DAY_MS);
  });

  it("judges a success exactly at the fourteen-day window current", () => {
    const assessment = inngestCoverageFreshness({ cell: cellAt({ at: AT }), nowMs: AT_MS + 14 * DAY_MS });
    expect(assessment.verdict).toBe("current");
  });

  it("judges a success one minute past the fourteen-day window historical", () => {
    const assessment = inngestCoverageFreshness({ cell: cellAt({ at: AT }), nowMs: AT_MS + 14 * DAY_MS + MINUTE_MS });
    expect(assessment.verdict).toBe("historical");
    expect(assessment.mayQuoteAsCurrent).toBe(false);
  });

  it("judges a failed latest attempt historical however recent the prior success", () => {
    const failed = failedInngestCoverageCell({
      channel: "compiled",
      previous: cellAt({ at: LATER }),
      reason: "failed",
      role: "authoritative",
      scope: "catalogue",
      state: "unreadable",
      surface: "functions",
      unblockedBy: null,
    });
    const assessment = inngestCoverageFreshness({ cell: failed, nowMs: Date.parse(LATER) + HOUR_MS });
    expect(assessment.verdict).toBe("historical");
  });

  it("judges a cell that never succeeded never-synced", () => {
    const failed = failedInngestCoverageCell({
      channel: "api",
      previous: null,
      reason: "failed",
      role: "authoritative",
      scope: "tenant",
      state: "not-configured",
      surface: "functions",
      unblockedBy: null,
    });
    const assessment = inngestCoverageFreshness({ cell: failed, nowMs: AT_MS });
    expect(assessment.verdict).toBe("never-synced");
  });
});
