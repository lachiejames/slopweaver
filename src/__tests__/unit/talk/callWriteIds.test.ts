/*
 * A call line's write id: a batch that repeats one is malformed, and a line whose id the file holds is not written
 * again. The file is a plain fake seam; nothing is mocked.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import type { CallEntry } from "../../../talk/callRecord.js";
import { entriesNotHeld, repeatsWriteId, unwrittenEntries } from "../../../talk/callWriteIds.js";

const HELD = "0f1e2d3c-4b5a-4968-8776-655443322110";
const FRESH = "1f1e2d3c-4b5a-4968-8776-655443322110";
const said = ({ id, writeId }: { id: string; writeId?: string }): CallEntry => ({
  atIso: "2026-09-27T13:02:42.296Z",
  final: true,
  id,
  kind: "segment",
  text: id,
  who: "owner",
  ...(writeId === undefined ? {} : { writeId }),
});

describe("repeatsWriteId", () => {
  it("finds two lines sharing an id, and never counts lines that carry none", () => {
    expect([
      repeatsWriteId({ entries: [said({ id: "a", writeId: HELD }), said({ id: "b", writeId: HELD })] }),
      repeatsWriteId({ entries: [said({ id: "a", writeId: HELD }), said({ id: "b", writeId: FRESH })] }),
      repeatsWriteId({ entries: [said({ id: "a" }), said({ id: "b" })] }),
    ]).toEqual([true, false, false]);
  });
});

describe("unwrittenEntries", () => {
  it("keeps the lines whose id the file does not hold, and every line with none", () => {
    const [held, fresh, bare] = [
      said({ id: "a", writeId: HELD }),
      said({ id: "b", writeId: FRESH }),
      said({ id: "c" }),
    ];
    const entries = [held, fresh, bare];
    expect(unwrap(unwrittenEntries({ entries, held: () => ok([held]) }))).toEqual([fresh, bare]);
  });

  it("never reads the file when no line carries an id", () => {
    const entries = [said({ id: "a" })];
    expect(unwrap(unwrittenEntries({ entries, held: () => err("the file was read") }))).toEqual(entries);
  });

  it("passes on why the file could not be read", () => {
    const entries = [said({ id: "a", writeId: HELD })];
    expect(unwrapErr(unwrittenEntries({ entries, held: () => err("EACCES") }))).toBe("EACCES");
  });
});

describe("entriesNotHeld", () => {
  it("drops a line whose id a held line carries, keeping order, and keeps every line with none", () => {
    const [held, fresh, bare] = [
      said({ id: "a", writeId: HELD }),
      said({ id: "b", writeId: FRESH }),
      said({ id: "c" }),
    ];
    expect([
      entriesNotHeld({ entries: [bare, held, fresh], held: [held, said({ id: "d" })] }),
      entriesNotHeld({ entries: [held, fresh], held: [] }),
    ]).toEqual([
      [bare, fresh],
      [held, fresh],
    ]);
  });
});
