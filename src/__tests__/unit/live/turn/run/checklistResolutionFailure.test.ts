import { describe, expect, it } from "vitest";

import { answered, checklistFailure, MENTION, PROVENANCE, withheldOf } from "./fixtures.js";
import { drive, fakeQuery, NULL_HOLD, recordingPoster } from "./harness.js";

describe("runTurn checklist resolution failure", () => {
  it("reports NO checklistFailure when delete succeeds", async () => {
    const outcome = await drive({
      mention: MENTION,
      poster: recordingPoster({ log: [] }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: ["loaded", "ranked"] }),
    });
    expect(checklistFailure(outcome)).toBeUndefined();
  });

  it("reports NO checklistFailure when delete fails but the finalize fallback succeeds", async () => {
    const outcome = await drive({
      mention: MENTION,
      poster: recordingPoster({ deleteWorkingFails: true, log: [] }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: ["loaded", "ranked"] }),
    });
    expect(checklistFailure(outcome)).toBeUndefined();
  });

  it("reports checklistFailure, naming the stuck message, when BOTH delete and finalize fail", async () => {
    const outcome = await drive({
      mention: MENTION,
      poster: recordingPoster({ deleteWorkingFails: true, finalizeWorkingFails: true, log: [] }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: ["loaded", "ranked"] }),
    });
    expect(answered(outcome)).toBe(true);
    expect(checklistFailure(outcome)).toContain("C1");
    expect(checklistFailure(outcome)).toContain("1712345678.000300");
  });

  it("reports checklistFailure on a withheld turn too, when both delete and finalize fail", async () => {
    const outcome = await drive({
      hold: NULL_HOLD,
      mention: MENTION,
      poster: recordingPoster({
        finalizeWorkingFails: true,
        log: [],
        withhold: { code: "owner-only", reason: "not the owner" },
      }),
      provenance: PROVENANCE,
      query: fakeQuery({ phases: ["loaded", "ranked"] }),
    });
    expect(answered(outcome)).toBe(false);
    expect(withheldOf(outcome)).toBeDefined();
    expect(checklistFailure(outcome)).toContain("C1");
  });
});
