/*
 * `rekeyPlan`: rows a whole-file-digest import stored, rewritten to each line's own key with the line number kept,
 * and refused whenever a row's claim, line or decodability does not match the line its key names.
 */
import { describe, expect, it } from "vitest";

import { importKeyFor, rekeyPlan } from "../../../../knowledge/importLessons.js";
import { DIGEST, lesson } from "./harness.js";

describe("rekeyPlan", () => {
  /** Three physical lines of a register, and the rows a WHOLE-FILE-digest import would have stored. */
  const threeLines = (): readonly string[] =>
    [1, 2, 3].map((n) => JSON.stringify(lesson({ claim: `claim ${String(n)}`, id: `l-000000000000000${String(n)}` })));

  const oldKeyed = ({ lines }: { lines: readonly string[] }) =>
    lines.map((_line, index) => ({
      claim: `claim ${String(index + 1)}`,
      importKey: `${DIGEST}:${String(index + 1).padStart(10, "0")}`,
      recordingId: `r-${String(index + 1)}`,
    }));

  it("rewrites every old-scheme key to the line's own digest, keeping the line number", () => {
    const lines = threeLines();
    const plan = rekeyPlan({ lines, stored: oldKeyed({ lines }) });

    expect(plan).toEqual({
      kind: "rekey",
      rekeys: [1, 2, 3].map((n) => ({
        from: `${DIGEST}:${String(n).padStart(10, "0")}`,
        recordingId: `r-${String(n)}`,
        to: importKeyFor({ line: lines[n - 1]!, lineNumber: n }),
      })),
    });
  });

  it("is a no-op when every stored key is already the per-line one", () => {
    const lines = threeLines();
    const stored = lines.map((line, index) => ({
      claim: `claim ${String(index + 1)}`,
      importKey: importKeyFor({ line, lineNumber: index + 1 }),
      recordingId: `r-${String(index + 1)}`,
    }));

    expect(rekeyPlan({ lines, stored })).toEqual({ kind: "current", rows: 3 });
  });

  it("REFUSES when a row's claim is not the claim on the line its key names", () => {
    // The whole safety of a rekey: the line NUMBER survives in the old key, but attaching a row to a line
    // that has since moved would file somebody else's observation under this row's id.
    const lines = threeLines();
    const stored = [{ claim: "a claim no line holds", importKey: `${DIGEST}:0000000002`, recordingId: "r-2" }];

    expect(rekeyPlan({ lines, stored })).toEqual({
      kind: "mismatch",
      lineNumber: 2,
      recordingId: "r-2",
      why: "the claim on that line is not the claim this row holds",
    });
  });

  it("REFUSES a key naming a line the file does not have, rather than skipping that row", () => {
    const lines = threeLines();
    const stored = [{ claim: "claim 9", importKey: `${DIGEST}:0000000009`, recordingId: "r-9" }];

    expect(rekeyPlan({ lines, stored })).toEqual({
      kind: "mismatch",
      lineNumber: 9,
      recordingId: "r-9",
      why: "its key names a line the source file does not have",
    });
  });

  it("REFUSES a row whose line cannot be decoded at all, naming the line", () => {
    const stored = [{ claim: "claim 1", importKey: `${DIGEST}:0000000001`, recordingId: "r-1" }];
    const plan = rekeyPlan({ lines: ["{not json"], stored });

    expect(plan.kind).toBe("mismatch");
    expect(plan).toMatchObject({ lineNumber: 1, recordingId: "r-1" });
  });
});
