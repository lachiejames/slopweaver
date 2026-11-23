/**
 * A journal file's lines parsed one by one (`../../../fleet/jsonlValues.ts`): blank lines skipped, every other line
 * numbered as it sits in the file, and a line that is not JSON kept as a gap rather than dropped or thrown.
 */
import { describe, expect, it } from "vitest";

import { jsonLineValue, jsonlValues } from "../../../fleet/jsonlValues.js";

describe("jsonLineValue", () => {
  it("parses a JSON line and answers undefined for one that is not JSON", () => {
    expect([jsonLineValue({ line: '{"kind":"seat-gone"}' }), jsonLineValue({ line: '{"kind":' })]).toEqual([
      { kind: "seat-gone" },
      undefined,
    ]);
  });
});

describe("jsonlValues", () => {
  it("numbers each non-blank line as it sits in the file, keeping a torn one as an undefined value", () => {
    expect(jsonlValues({ text: '{"a":1}\n\n   \n{"a":\n[2]\n' })).toEqual([
      { line: 1, value: { a: 1 } },
      { line: 4, value: undefined },
      { line: 5, value: [2] },
    ]);
  });

  it("answers nothing for an empty text", () => {
    expect(jsonlValues({ text: "" })).toEqual([]);
  });
});
