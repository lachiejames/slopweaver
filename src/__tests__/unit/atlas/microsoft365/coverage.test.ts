import { describe, expect, it } from "vitest";

import {
  failedMicrosoft365CoverageCell,
  microsoft365CoverageFreshness,
  succeededMicrosoft365CoverageCell,
} from "../../../../atlas/microsoft365/coverage.js";
import type { Microsoft365ArtifactRef, Microsoft365Channel } from "../../../../atlas/microsoft365/model.js";
import { MICROSOFT365_CHANNELS } from "../../../../atlas/microsoft365/model.js";

const AT = "2026-10-01T00:00:00.000Z";
const LATER = "2026-10-02T00:00:00.000Z";
const AT_MS = Date.parse(AT);
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** The exact ceiling `model.ts` assigns each channel, spelled out so a swapped mapping reddens a case. */
const SCOPE_BY_CHANNEL: Record<Microsoft365Channel, string> = {
  api: "api-application-consent",
  browser: "browser-signed-in-roles",
  compiled: "compiled-published-specification",
};

const ARTIFACT: Microsoft365ArtifactRef = {
  byteLength: 1024,
  kind: "api-json",
  mediaType: "application/json",
  relativePath: "artifacts/graph-spec.json",
  sha256: "a".repeat(64),
};

const OTHER_ARTIFACT: Microsoft365ArtifactRef = {
  byteLength: 2048,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "artifacts/page.png",
  sha256: "b".repeat(64),
};

const succeededAt = ({ at }: { at: string }): ReturnType<typeof succeededMicrosoft365CoverageCell> =>
  succeededMicrosoft365CoverageCell({
    artifacts: [],
    at,
    channel: "compiled",
    reason: "parsed the pinned Graph specification",
    role: "authoritative",
    scope: "specification",
    state: "synced",
    surface: "users",
  });

const succeededOn = ({
  artifacts,
  channel,
}: {
  artifacts: readonly Microsoft365ArtifactRef[];
  channel: Microsoft365Channel;
}): ReturnType<typeof succeededMicrosoft365CoverageCell> =>
  succeededMicrosoft365CoverageCell({
    artifacts,
    at: AT,
    channel,
    reason: "parsed the pinned Graph specification",
    role: "authoritative",
    scope: "specification",
    state: "synced",
    surface: "users",
  });

describe("microsoft365CoverageFreshness", () => {
  it("judges a five-hour-old success current, because the declared window is fourteen days", () => {
    const assessment = microsoft365CoverageFreshness({ cell: succeededAt({ at: AT }), nowMs: AT_MS + 5 * HOUR_MS });
    expect(assessment.verdict).toBe("current");
    expect(assessment.mayQuoteAsCurrent).toBe(true);
    expect(assessment.windowMs).toBe(14 * DAY_MS);
  });

  it("judges a success exactly at the fourteen-day window current", () => {
    const assessment = microsoft365CoverageFreshness({ cell: succeededAt({ at: AT }), nowMs: AT_MS + 14 * DAY_MS });
    expect(assessment.verdict).toBe("current");
  });

  it("judges a success one minute past the fourteen-day window historical", () => {
    const assessment = microsoft365CoverageFreshness({
      cell: succeededAt({ at: AT }),
      nowMs: AT_MS + 14 * DAY_MS + MINUTE_MS,
    });
    expect(assessment.verdict).toBe("historical");
    expect(assessment.mayQuoteAsCurrent).toBe(false);
  });

  it("judges a failed latest attempt historical however recent the prior success", () => {
    const failed = failedMicrosoft365CoverageCell({
      channel: "api",
      previous: succeededAt({ at: LATER }),
      reason: "no application registration",
      role: "corroborating",
      scope: "tenant",
      state: "not-configured",
      surface: "users",
      unblockedBy: null,
    });
    const assessment = microsoft365CoverageFreshness({ cell: failed, nowMs: Date.parse(LATER) + HOUR_MS });
    expect(assessment.verdict).toBe("historical");
  });

  it("judges a cell that never succeeded never-synced", () => {
    const failed = failedMicrosoft365CoverageCell({
      channel: "api",
      previous: null,
      reason: "no application registration",
      role: "corroborating",
      scope: "tenant",
      state: "not-configured",
      surface: "users",
      unblockedBy: null,
    });
    const assessment = microsoft365CoverageFreshness({ cell: failed, nowMs: AT_MS });
    expect(assessment.verdict).toBe("never-synced");
  });
});

describe("succeededMicrosoft365CoverageCell", () => {
  it("returns the whole cell, stamped as a fresh success under the channel's own ceiling", () => {
    const cell = succeededMicrosoft365CoverageCell({
      artifacts: [ARTIFACT],
      at: AT,
      channel: "compiled",
      reason: "parsed the pinned Graph specification",
      role: "authoritative",
      scope: "specification",
      state: "synced",
      surface: "users",
    });
    expect(cell).toStrictEqual({
      artifacts: [ARTIFACT],
      channel: "compiled",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: "parsed the pinned Graph specification",
      role: "authoritative",
      scope: "specification",
      state: "synced",
      surface: "users",
      unblockedBy: null,
      visibilityScope: "compiled-published-specification",
    });
  });

  it("maps every channel in the registry to its own exact visibility ceiling", () => {
    expect(MICROSOFT365_CHANNELS.length).toBeGreaterThan(0);
    expect(Object.keys(SCOPE_BY_CHANNEL).toSorted()).toStrictEqual(MICROSOFT365_CHANNELS.toSorted());
    for (const channel of MICROSOFT365_CHANNELS) {
      const cell = succeededOn({ artifacts: [], channel });
      expect(cell.channel).toBe(channel);
      expect(cell.visibilityScope).toBe(SCOPE_BY_CHANNEL[channel]);
    }
  });

  it("does not alias the caller's artifacts array", () => {
    const artifacts = [ARTIFACT];
    const cell = succeededOn({ artifacts, channel: "compiled" });
    artifacts.push(OTHER_ARTIFACT);
    expect(cell.artifacts).toStrictEqual([ARTIFACT]);
  });
});

describe("failedMicrosoft365CoverageCell", () => {
  it("keeps the prior success and its artifacts, and takes the failed attempt's own fields", () => {
    const previous = succeededOn({ artifacts: [ARTIFACT], channel: "compiled" });
    const cell = failedMicrosoft365CoverageCell({
      channel: "api",
      previous,
      reason: "no application registration",
      role: "corroborating",
      scope: "tenant",
      state: "not-configured",
      surface: "users",
      unblockedBy: "register an Entra application",
    });
    expect(cell).toStrictEqual({
      artifacts: [ARTIFACT],
      channel: "api",
      lastSuccessAt: AT,
      latestAttemptFailed: true,
      reason: "no application registration",
      role: "corroborating",
      scope: "tenant",
      state: "not-configured",
      surface: "users",
      unblockedBy: "register an Entra application",
      visibilityScope: "api-application-consent",
    });
  });

  it("with no prior cell carries no success and no artifacts", () => {
    const cell = failedMicrosoft365CoverageCell({
      channel: "browser",
      previous: null,
      reason: "the walk has not run",
      role: "discovery",
      scope: "signed-in-pages",
      state: "not-configured",
      surface: "users",
      unblockedBy: "run the walk",
    });
    expect(cell).toStrictEqual({
      artifacts: [],
      channel: "browser",
      lastSuccessAt: null,
      latestAttemptFailed: true,
      reason: "the walk has not run",
      role: "discovery",
      scope: "signed-in-pages",
      state: "not-configured",
      surface: "users",
      unblockedBy: "run the walk",
      visibilityScope: "browser-signed-in-roles",
    });
  });

  it("maps every channel in the registry to its own exact visibility ceiling", () => {
    expect(MICROSOFT365_CHANNELS.length).toBeGreaterThan(0);
    for (const channel of MICROSOFT365_CHANNELS) {
      const cell = failedMicrosoft365CoverageCell({
        channel,
        previous: null,
        reason: "nothing read",
        role: "discovery",
        scope: "none",
        state: "not-configured",
        surface: "users",
        unblockedBy: null,
      });
      expect(cell.channel).toBe(channel);
      expect(cell.visibilityScope).toBe(SCOPE_BY_CHANNEL[channel]);
    }
  });

  it("does not alias the prior cell's artifacts array", () => {
    const previous = succeededOn({ artifacts: [ARTIFACT], channel: "compiled" });
    const cell = failedMicrosoft365CoverageCell({
      channel: "compiled",
      previous,
      reason: "the specification would not parse",
      role: "authoritative",
      scope: "specification",
      state: "unreadable",
      surface: "users",
      unblockedBy: null,
    });
    previous.artifacts.push(OTHER_ARTIFACT);
    expect(cell.artifacts).toStrictEqual([ARTIFACT]);
  });
});
