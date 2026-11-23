/**
 * The exported recording and recall lines: the generated column dropped, both instants written as ISO, and
 * every other column carried as the database returned it. Pure.
 */
import { describe, expect, it } from "vitest";

import { exportedMemoryLine, exportedRecallLine } from "../../../knowledge/exportLines.js";
import type { MemoryRecordingRow } from "../../../store/schema/memories.js";
import type { MemoryRecallRow } from "../../../store/schema/memoryRecalls.js";
import { MEMORY_LINE, RECALL_LINE } from "../store/transfer/fixtures.js";

describe("exportedMemoryLine", () => {
  it("drops the generated search column and writes the fixture's line byte for byte", () => {
    const row: MemoryRecordingRow = {
      behaviourChange: "check the sample rate first",
      caveat: null,
      claim: "acme's widget queue drains in order",
      createdAt: new Date("2026-10-01T09:00:01.000Z"),
      domain: "datadog",
      evidence: "0 of 412 traces over 7d",
      id: "l-0000000000000001",
      importKey: null,
      kind: "lesson",
      learner: "fleet",
      outcome: null,
      question: null,
      recordedAt: new Date("2026-10-01T09:00:00.000Z"),
      recordingId: "bbbbbbbb-0000-4000-8000-000000000001",
      repro: null,
      retrievalCue: "a widget queue task",
      run: "ad-hoc",
      searchable: "'acme':1 'widget':2",
      seq: 4,
      supersedes: null,
      surface: "api",
      tier: 2,
      verdict: "confirmed",
    };
    expect(exportedMemoryLine({ row })).toBe(MEMORY_LINE);
  });
});

describe("exportedRecallLine", () => {
  it("writes both instants as ISO strings and the fixture's line byte for byte", () => {
    const row: MemoryRecallRow = {
      createdAt: new Date("2026-10-02T09:00:01.000Z"),
      evidence: "re-ran the probe, still 0",
      memoryId: "l-0000000000000001",
      outcome: "held",
      recallId: "cccccccc-0000-4000-8000-000000000001",
      recordedAt: new Date("2026-10-02T09:00:00.000Z"),
      recordingId: "bbbbbbbb-0000-4000-8000-000000000001",
      run: "ad-hoc",
      seq: 2,
    };
    expect(exportedRecallLine({ row })).toBe(RECALL_LINE);
  });
});
