/*
 * `appendPlan`: what a second apply of the register writes, given the keys the table already holds and the keys a
 * prune retired. Only an appended tail is new; a present line after an absent one is a hole, refused.
 */
import { describe, expect, it } from "vitest";

import { appendPlan, type ImportRow, projectLesson } from "../../../../knowledge/importLessons.js";
import { unwrap } from "../../../../lib/result.js";
import { LINE, lesson, RECORDING_ID } from "./harness.js";

describe("appendPlan", () => {
  /** Three projected rows from one file, in source order. */
  const threeRows = (): readonly ImportRow[] =>
    [1, 2, 3].map((lineNumber) =>
      unwrap(
        projectLesson({
          lesson: lesson({ claim: `claim ${String(lineNumber)}` }),
          line: `${LINE}${String(lineNumber)}`,
          lineNumber,
          recordingId: `${RECORDING_ID}-${String(lineNumber)}`,
        }),
      ),
    );

  it("writes everything when the table holds none of it", () => {
    const rows = threeRows();

    expect(appendPlan({ present: new Set(), pruned: new Set(), rows })).toEqual({
      kind: "append",
      present: 0,
      pruned: 0,
      rows,
    });
  });

  it("is a no-op when the table already holds every line", () => {
    const rows = threeRows();
    const present = new Set(rows.map((row) => row.importKey));

    expect(appendPlan({ present, pruned: new Set(), rows })).toEqual({
      kind: "already-applied",
      present: 3,
      pruned: 0,
    });
  });

  it("writes ONLY the lines appended since the last apply — the cutover case", () => {
    // A worktree on an older commit kept appending after the import ran. The keys of the lines already in
    // the table are unchanged, so only the tail is new; the version keyed on the whole file's digest would
    // have re-imported all three.
    const rows = threeRows();

    expect(appendPlan({ present: new Set([rows[0]!.importKey]), pruned: new Set(), rows })).toEqual({
      kind: "append",
      present: 1,
      pruned: 0,
      rows: [rows[1]!, rows[2]!],
    });
  });

  it("REFUSES a hole — a present line after an absent one is a file that was edited, not appended to", () => {
    const rows = threeRows();

    expect(appendPlan({ present: new Set([rows[0]!.importKey, rows[2]!.importKey]), pruned: new Set(), rows })).toEqual(
      {
        firstAbsentKey: rows[1]!.importKey,
        kind: "hole",
        presentAfterIt: 1,
      },
    );
  });

  it("counts a line a prune retired as applied, never as a hole — a prune pass that removed 676", () => {
    // The table lost line 1 to an owner-approved prune; its archive keeps the key. Before, this read as a
    // present line after an absent one and refused, while the drift notice named this very apply as the fix.
    const rows = threeRows();

    expect(
      appendPlan({
        present: new Set([rows[1]!.importKey, rows[2]!.importKey]),
        pruned: new Set([rows[0]!.importKey]),
        rows,
      }),
    ).toEqual({ kind: "already-applied", present: 2, pruned: 1 });
  });

  it("reports a row restored from its prune archive as present, not pruned as well", () => {
    const rows = threeRows();

    expect(
      appendPlan({
        present: new Set(rows.map((row) => row.importKey)),
        pruned: new Set([rows[1]!.importKey]),
        rows,
      }),
    ).toEqual({ kind: "already-applied", present: 3, pruned: 0 });
  });

  it("appends only the tail after a pruned middle, and never writes the pruned line back", () => {
    const rows = threeRows();

    expect(appendPlan({ present: new Set([rows[0]!.importKey]), pruned: new Set([rows[1]!.importKey]), rows })).toEqual(
      { kind: "append", present: 1, pruned: 1, rows: [rows[2]!] },
    );
  });

  it("still REFUSES a hole when the line before a pruned one is in neither the table nor an archive", () => {
    const rows = threeRows();

    expect(appendPlan({ present: new Set([rows[2]!.importKey]), pruned: new Set([rows[1]!.importKey]), rows })).toEqual(
      { firstAbsentKey: rows[0]!.importKey, kind: "hole", presentAfterIt: 2 },
    );
  });

  it("treats an empty file as already applied rather than as something to write", () => {
    expect(appendPlan({ present: new Set(), pruned: new Set(), rows: [] })).toEqual({
      kind: "already-applied",
      present: 0,
      pruned: 0,
    });
  });
});
