/**
 * The import projection: one decoded row of the old register, projected into a row of the store.
 *
 * The NULL assertions are the point of this file. `behaviourChange` and `retrievalCue` have no source in the
 * old register, and neither does `learner` for any row but one the owner holds — `fleet` is what an absent field
 * means, so it cannot be told apart from a row written before the field existed. The failure this guards
 * against is a future change that helpfully fills them in — attributing every imported row to the importing
 * session, say, which would put 706 fabricated facts into a store whose only value is that what it says was
 * observed.
 */
import { describe, expect, it } from "vitest";

import { projectLesson } from "../../../../knowledge/importLessons.js";
import { unwrap } from "../../../../lib/result.js";
import { DIGEST, LINE, lesson, RECORDING_ID } from "./harness.js";

describe("projectLesson", () => {
  it("leaves the placement fields NULL rather than inventing them", () => {
    const row = unwrap(projectLesson({ lesson: lesson(), lineNumber: 1, line: LINE, recordingId: RECORDING_ID }));
    expect(row.learner).toBe(null);
    expect(row.behaviourChange).toBe(null);
    expect(row.retrievalCue).toBe(null);
  });

  it("carries the owner's learner through, because `owner` is the one value that was always explicit", () => {
    const row = unwrap(
      projectLesson({
        lesson: lesson({ learner: "owner" }),
        lineNumber: 1,
        recordingId: RECORDING_ID,
        line: LINE,
      }),
    );
    expect(row.learner).toBe("owner");
  });

  it("preserves the claim id, the run and the source instant exactly", () => {
    const row = unwrap(projectLesson({ lesson: lesson(), lineNumber: 1, line: LINE, recordingId: RECORDING_ID }));
    expect(row.id).toBe("l-0000000000009003");
    expect(row.run).toBe("owner-steer-6-sep");
    expect(row.recordedAt?.toISOString()).toBe("2026-09-07T22:23:24.368Z");
  });

  it("files every imported row as a lesson, since the old register had no other kind", () => {
    expect(unwrap(projectLesson({ lesson: lesson(), lineNumber: 1, line: LINE, recordingId: RECORDING_ID })).kind).toBe(
      "lesson",
    );
  });

  it("carries the import key for its own physical line", () => {
    const row = unwrap(projectLesson({ lesson: lesson(), lineNumber: 706, line: LINE, recordingId: RECORDING_ID }));
    expect(row.importKey).toBe(`${DIGEST}:0000000706`);
  });

  it("nulls an absent repro and caveat rather than storing empty strings", () => {
    const row = unwrap(
      projectLesson({
        lesson: lesson({ caveat: "  ", repro: "" }),
        lineNumber: 1,
        recordingId: RECORDING_ID,
        line: LINE,
      }),
    );
    expect(row.repro).toBe(null);
    expect(row.caveat).toBe(null);
  });

  it("refuses a row whose instant cannot be parsed, naming the line", () => {
    const projected = projectLesson({
      lesson: lesson({ recordedAtIso: "not a date" }),
      lineNumber: 19,
      recordingId: RECORDING_ID,
      line: LINE,
    });
    expect(projected.isErr()).toBe(true);
    expect(projected._unsafeUnwrapErr().message).toBe("line 19 of the register is not a decodable lesson row");
  });

  it("refuses a row whose claim is empty, naming the line", () => {
    const projected = projectLesson({
      lesson: lesson({ claim: "   " }),
      lineNumber: 4,
      recordingId: RECORDING_ID,
      line: LINE,
    });
    expect(projected._unsafeUnwrapErr().message).toBe("line 4 of the register is not a decodable lesson row");
  });
});
