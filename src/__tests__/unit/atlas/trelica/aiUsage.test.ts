import { describe, expect, it } from "vitest";

import {
  TRELICA_AI_TABLE_TAKE,
  TRELICA_AI_TOP_N,
  TRELICA_AI_USAGE_READS,
  trelicaAiUsageBody,
  trelicaAiWindow,
} from "../../../../atlas/trelica/aiUsage.js";
import { TRELICA_AI_USAGE_DIMENSIONS } from "../../../../atlas/trelica/model.js";

describe("trelicaAiWindow", () => {
  it("ends on the run's own UTC day and reaches back two years", () => {
    expect(trelicaAiWindow({ at: "2026-10-02T12:00:00.000Z" })).toEqual({
      endDate: "2026-10-02",
      startDate: "2024-10-02",
    });
  });
});

describe("trelicaAiUsageBody", () => {
  it("varies only the window and the offset", () => {
    expect(trelicaAiUsageBody({ tableSkip: 400, window: { endDate: "2026-10-02", startDate: "2024-10-02" } })).toEqual({
      endDate: "2026-10-02",
      includeTableData: true,
      startDate: "2024-10-02",
      tableSkip: 400,
      tableTake: TRELICA_AI_TABLE_TAKE,
      topN: TRELICA_AI_TOP_N,
    });
  });
});

describe("TRELICA_AI_USAGE_READS", () => {
  it("lists exactly one read per dimension, each under the explorer's own service", () => {
    const reads = Object.values(TRELICA_AI_USAGE_READS);
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.map((read) => read.dimension).toSorted()).toEqual([...TRELICA_AI_USAGE_DIMENSIONS]);
    expect(reads.filter((read) => !read.path.startsWith("/AppsApi/AppAIUsage/UsageBy"))).toEqual([]);
  });
});
