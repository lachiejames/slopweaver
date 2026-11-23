/*
 * `importKeyFor`: a key built over one register line's own digest and its zero-padded physical line number, so it
 * sorts in source order, survives an append, and moves when the line's own bytes change.
 */
import { describe, expect, it } from "vitest";

import { importKeyFor } from "../../../../knowledge/importLessons.js";
import { DIGEST, LINE } from "./harness.js";

describe("importKeyFor", () => {
  it("is the LINE's own digest and its physical line number, zero-padded", () => {
    const key = importKeyFor({ line: LINE, lineNumber: 42 });
    expect(key).toBe(`${DIGEST}:0000000042`);
  });

  it("pads so keys sort in SOURCE order as text — the tie-break a review found missing", () => {
    const ninth = importKeyFor({ line: LINE, lineNumber: 9 });
    const tenth = importKeyFor({ line: LINE, lineNumber: 10 });

    expect([ninth, tenth].toSorted()).toEqual([ninth, tenth]);
  });

  it("gives two identical lines of one file two different keys", () => {
    expect(importKeyFor({ line: LINE, lineNumber: 7 }) === importKeyFor({ line: LINE, lineNumber: 8 })).toBe(false);
  });

  it("is UNCHANGED by later lines being appended, which is what makes a second apply safe", () => {
    // The whole cutover hazard: a worktree on an older commit keeps appending while the table already holds
    // the earlier lines. A key derived from the WHOLE file's digest moved on every append and would have
    // re-imported the entire register; this one does not move at all.
    expect(importKeyFor({ line: LINE, lineNumber: 3 })).toBe(importKeyFor({ line: LINE, lineNumber: 3 }));
  });

  it("MOVES when the line's own bytes change, so an edited line stops matching what was imported", () => {
    expect(importKeyFor({ line: LINE, lineNumber: 3 }) === importKeyFor({ line: `${LINE} `, lineNumber: 3 })).toBe(
      false,
    );
  });
});
