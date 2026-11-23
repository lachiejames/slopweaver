import { describe, expect, it } from "vitest";

import {
  failedGeminiAiStudioCoverageCell,
  geminiAiStudioCoverageFreshness,
  succeededGeminiAiStudioCoverageCell,
} from "../../../../atlas/geminiAiStudio/coverage.js";
import {
  GEMINI_AI_STUDIO_CHANNELS,
  type GeminiAiStudioArtifactRef,
  type GeminiAiStudioChannel,
} from "../../../../atlas/geminiAiStudio/model.js";

const AT = "2026-10-01T00:00:00.000Z";
const LATER = "2026-10-02T00:00:00.000Z";
const AT_MS = Date.parse(AT);
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const SHOT: GeminiAiStudioArtifactRef = {
  byteLength: 1024,
  kind: "page-png",
  mediaType: "image/png",
  relativePath: "artifacts/models.png",
  sha256: "a".repeat(64),
};

const SCOPE_BY_CHANNEL: readonly (readonly [GeminiAiStudioChannel, string])[] = [
  ["compiled", "compiled-published-discovery"],
  ["api", "api-project-key"],
  ["browser", "browser-signed-in-account"],
];

describe("succeededGeminiAiStudioCoverageCell", () => {
  it("stamps the whole cell as a fresh success on its channel", () => {
    const cell = succeededGeminiAiStudioCoverageCell({
      artifacts: [SHOT],
      at: AT,
      channel: "browser",
      reason: "walked the models page",
      role: "corroborating",
      scope: "project/default",
      state: "synced",
      surface: "models",
    });
    expect(cell).toStrictEqual({
      artifacts: [SHOT],
      channel: "browser",
      lastSuccessAt: AT,
      latestAttemptFailed: false,
      reason: "walked the models page",
      role: "corroborating",
      scope: "project/default",
      state: "synced",
      surface: "models",
      unblockedBy: null,
      visibilityScope: "browser-signed-in-account",
    });
  });

  it("covers every declared channel in the visibility table", () => {
    expect(GEMINI_AI_STUDIO_CHANNELS.length).toBeGreaterThan(0);
    expect(SCOPE_BY_CHANNEL.map(([channel]) => channel)).toStrictEqual([...GEMINI_AI_STUDIO_CHANNELS]);
  });

  it.each(SCOPE_BY_CHANNEL)("maps the %s channel to the %s visibility scope", (channel, scope) => {
    const cell = succeededGeminiAiStudioCoverageCell({
      artifacts: [],
      at: AT,
      channel,
      reason: "read",
      role: "authoritative",
      scope: "tenant",
      state: "synced",
      surface: "models",
    });
    expect(cell.channel).toBe(channel);
    expect(cell.visibilityScope).toBe(scope);
  });

  it("does not alias the caller's artifacts array", () => {
    const artifacts: GeminiAiStudioArtifactRef[] = [SHOT];
    const cell = succeededGeminiAiStudioCoverageCell({
      artifacts,
      at: AT,
      channel: "api",
      reason: "read",
      role: "authoritative",
      scope: "tenant",
      state: "synced",
      surface: "models",
    });
    artifacts.push({ ...SHOT, relativePath: "artifacts/other.png" });
    expect(cell.artifacts).toStrictEqual([SHOT]);
  });
});

describe("failedGeminiAiStudioCoverageCell", () => {
  it("keeps the prior success and its artifacts, and takes the failed attempt's own fields", () => {
    const previous = succeededGeminiAiStudioCoverageCell({
      artifacts: [SHOT],
      at: AT,
      channel: "compiled",
      reason: "parsed the discovery document",
      role: "authoritative",
      scope: "discovery",
      state: "synced",
      surface: "models",
    });
    const cell = failedGeminiAiStudioCoverageCell({
      channel: "api",
      previous,
      reason: "no Gemini API key is configured",
      role: "corroborating",
      scope: "project/default",
      state: "not-configured",
      surface: "models",
      unblockedBy: "set a Gemini API key",
    });
    expect(cell).toStrictEqual({
      artifacts: [SHOT],
      channel: "api",
      lastSuccessAt: AT,
      latestAttemptFailed: true,
      reason: "no Gemini API key is configured",
      role: "corroborating",
      scope: "project/default",
      state: "not-configured",
      surface: "models",
      unblockedBy: "set a Gemini API key",
      visibilityScope: "api-project-key",
    });
  });

  it("has no success and no artifacts when there was no previous cell", () => {
    const cell = failedGeminiAiStudioCoverageCell({
      channel: "browser",
      previous: null,
      reason: "signed out",
      role: "discovery",
      scope: "account",
      state: "unreadable",
      surface: "models",
      unblockedBy: null,
    });
    expect(cell.lastSuccessAt).toBe(null);
    expect(cell.artifacts).toStrictEqual([]);
    expect(cell.latestAttemptFailed).toBe(true);
    expect(cell.unblockedBy).toBe(null);
    expect(cell.visibilityScope).toBe("browser-signed-in-account");
  });

  it.each(SCOPE_BY_CHANNEL)("maps a failed %s attempt to the %s visibility scope", (channel, scope) => {
    const cell = failedGeminiAiStudioCoverageCell({
      channel,
      previous: null,
      reason: "failed",
      role: "authoritative",
      scope: "tenant",
      state: "unreadable",
      surface: "models",
      unblockedBy: null,
    });
    expect(cell.visibilityScope).toBe(scope);
  });

  it("does not alias the previous cell's artifacts array", () => {
    const previous = succeededGeminiAiStudioCoverageCell({
      artifacts: [SHOT],
      at: AT,
      channel: "api",
      reason: "read",
      role: "authoritative",
      scope: "tenant",
      state: "synced",
      surface: "models",
    });
    const cell = failedGeminiAiStudioCoverageCell({
      channel: "api",
      previous,
      reason: "failed",
      role: "authoritative",
      scope: "tenant",
      state: "unreadable",
      surface: "models",
      unblockedBy: null,
    });
    previous.artifacts.push({ ...SHOT, relativePath: "artifacts/other.png" });
    expect(cell.artifacts).toStrictEqual([SHOT]);
  });
});

describe("geminiAiStudioCoverageFreshness", () => {
  const cellAt = ({ at }: { at: string }): ReturnType<typeof succeededGeminiAiStudioCoverageCell> =>
    succeededGeminiAiStudioCoverageCell({
      artifacts: [],
      at,
      channel: "compiled",
      reason: "read",
      role: "authoritative",
      scope: "discovery",
      state: "synced",
      surface: "models",
    });

  it("judges a five-hour-old success current, because the declared window is fourteen days", () => {
    const assessment = geminiAiStudioCoverageFreshness({ cell: cellAt({ at: AT }), nowMs: AT_MS + 5 * HOUR_MS });
    expect(assessment.verdict).toBe("current");
    expect(assessment.mayQuoteAsCurrent).toBe(true);
    expect(assessment.windowMs).toBe(14 * DAY_MS);
  });

  it("judges a success exactly at the fourteen-day window current", () => {
    const assessment = geminiAiStudioCoverageFreshness({ cell: cellAt({ at: AT }), nowMs: AT_MS + 14 * DAY_MS });
    expect(assessment.verdict).toBe("current");
  });

  it("judges a success one minute past the fourteen-day window historical", () => {
    const assessment = geminiAiStudioCoverageFreshness({
      cell: cellAt({ at: AT }),
      nowMs: AT_MS + 14 * DAY_MS + MINUTE_MS,
    });
    expect(assessment.verdict).toBe("historical");
    expect(assessment.mayQuoteAsCurrent).toBe(false);
  });

  it("judges a failed latest attempt historical however recent the prior success", () => {
    const failed = failedGeminiAiStudioCoverageCell({
      channel: "compiled",
      previous: cellAt({ at: LATER }),
      reason: "failed",
      role: "authoritative",
      scope: "discovery",
      state: "unreadable",
      surface: "models",
      unblockedBy: null,
    });
    const assessment = geminiAiStudioCoverageFreshness({ cell: failed, nowMs: Date.parse(LATER) + HOUR_MS });
    expect(assessment.verdict).toBe("historical");
  });

  it("judges a cell that never succeeded never-synced", () => {
    const failed = failedGeminiAiStudioCoverageCell({
      channel: "api",
      previous: null,
      reason: "failed",
      role: "authoritative",
      scope: "tenant",
      state: "not-configured",
      surface: "models",
      unblockedBy: null,
    });
    const assessment = geminiAiStudioCoverageFreshness({ cell: failed, nowMs: AT_MS });
    expect(assessment.verdict).toBe("never-synced");
  });
});
