/*
 * The recall ledger's half of the export round trip: `parseExportedRecall` preserves every identity and both
 * instants, and refuses a malformed line as a corrupt row. These cases ran under the `parseExportedLine` describe
 * before the split, and keep that title so each case's full name is unchanged.
 */
import { describe, expect, it } from "vitest";

import { parseExportedRecall } from "../../../../knowledge/recallRestore.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("parseExportedLine", () => {
  it("round-trips a recall ledger line, every identity and both instants preserved", () => {
    const exported = {
      createdAt: "2026-09-16T11:00:00.000Z",
      evidence: "re-ran the probe and it still came back empty",
      memoryId: "t-abc",
      outcome: "held",
      recallId: "a0000097-0000-4000-8000-000000000104",
      recordedAt: "2026-09-16T10:00:00.000Z",
      recordingId: "77777777-2222-3333-4444-555555555555",
      run: "ad-hoc",
      seq: 4,
    };
    const row = unwrap(parseExportedRecall({ line: JSON.stringify(exported), lineNumber: 1 }));
    expect([row.recallId, row.memoryId, row.outcome, row.seq, row.recordedAt.toISOString()]).toEqual([
      "a0000097-0000-4000-8000-000000000104",
      "t-abc",
      "held",
      4,
      "2026-09-16T10:00:00.000Z",
    ]);
  });

  it("refuses a recall whose outcome is outside the vocabulary", () => {
    const parsed = parseExportedRecall({
      line: JSON.stringify({
        createdAt: "2026-09-16T11:00:00.000Z",
        evidence: "e",
        memoryId: "t-abc",
        outcome: "maybe",
        recallId: "r",
        recordedAt: "2026-09-16T10:00:00.000Z",
        recordingId: "x",
        run: "ad-hoc",
        seq: 5,
      }),
      lineNumber: 3,
    });
    expect(unwrapErr(parsed).code).toBe("CORRUPT_ROW");
  });

  it("refuses a recall line that is not JSON at all", () => {
    expect(unwrapErr(parseExportedRecall({ line: "{ not json", lineNumber: 1 })).code).toBe("CORRUPT_ROW");
  });

  it("refuses a recall line that decodes to something other than an object", () => {
    expect(unwrapErr(parseExportedRecall({ line: "[1,2,3]", lineNumber: 2 })).code).toBe("CORRUPT_ROW");
  });

  it("refuses a recall whose instant cannot be parsed, rather than restoring an invalid date", () => {
    const parsed = parseExportedRecall({
      line: JSON.stringify({
        createdAt: "2026-09-16T11:00:00.000Z",
        evidence: "e",
        memoryId: "t-abc",
        outcome: "held",
        recallId: "r",
        recordedAt: "not-a-date",
        recordingId: "x",
        run: "ad-hoc",
        seq: 6,
      }),
      lineNumber: 7,
    });
    expect(unwrapErr(parsed).code).toBe("CORRUPT_ROW");
  });

  it("refuses a recall with no seq, which is what orders two rows at one instant", () => {
    const parsed = parseExportedRecall({
      line: JSON.stringify({
        createdAt: "2026-09-16T11:00:00.000Z",
        evidence: "e",
        memoryId: "t-abc",
        outcome: "held",
        recallId: "r",
        recordedAt: "2026-09-16T10:00:00.000Z",
        recordingId: "x",
        run: "ad-hoc",
      }),
      lineNumber: 4,
    });
    expect(unwrapErr(parsed).code).toBe("CORRUPT_ROW");
  });
});
