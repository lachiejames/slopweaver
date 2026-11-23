/**
 * The indirect candidate map's parser — pure. Every row is synthetic (`zorblatt`, `ABC-1`), so no test file carries
 * a hit it plants.
 */
import { describe, expect, it } from "vitest";

import { INDIRECT_CLASSES, isIndirectClass, parseIndirectMap } from "../../../hygiene/indirectMap.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const HEADER = "class\tflags\tdisposition\tpattern\treplacement";

describe("parseIndirectMap", () => {
  it("compiles every row with its class, disposition, flags and trimmed replacement", () => {
    const text = `${HEADER}\nperson\ti\treview\t\\bzorblatt\\b\t a synthetic person \nissue-key\t-\tremove\t\\bABC-\\d+\\b\tXYZ-1\n`;
    const rows = unwrap(parseIndirectMap({ text }));
    expect(rows.length).toBe(2);
    expect(rows[0]!.className).toBe("person");
    expect(rows[0]!.disposition).toBe("review");
    expect(rows[0]!.replacement).toBe("a synthetic person");
    expect(rows[0]!.re.flags).toBe("giu");
    expect(rows[1]!.re.flags).toBe("gu");
    expect(rows[1]!.re.lastIndex).toBe(0);
  });

  it("skips comments and blank lines, and keeps an exact duplicate row once", () => {
    const row = "locale\t-\taggregate\t\\ben-ZZ\\b\ten-XX";
    const rows = unwrap(parseIndirectMap({ text: `# a note\n\n${HEADER}\n${row}\n# another\n${row}\n` }));
    expect(rows.length).toBe(1);
  });

  it("refuses a map whose first line is not the header", () => {
    expect(unwrapErr(parseIndirectMap({ text: "person\ti\treview\tzorblatt\tx\n" })).code).toBe(
      "INDIRECT_MAP_HEADER_MISSING",
    );
  });

  it("refuses a map with a header and no row", () => {
    expect(unwrapErr(parseIndirectMap({ text: `${HEADER}\n` })).code).toBe("INDIRECT_MAP_EMPTY");
  });

  it.each([
    ["an unknown class", "people\ti\treview\tzorblatt\tx", "the class is not one of the closed indirect classes"],
    ["a bad flag", "person\tg\treview\tzorblatt\tx", "flags must be 'i' or '-'"],
    ["a bad disposition", "person\ti\tdelete\tzorblatt\tx", "disposition must be remove, review or aggregate"],
    ["an empty replacement", "person\ti\treview\tzorblatt\t ", "the replacement is empty"],
    ["an invalid pattern", "person\ti\treview\tzorb(latt\tx", "the pattern is not a valid regular expression"],
    ["a pattern matching the empty string", "person\ti\treview\tz*\tx", "the pattern matches the empty string"],
    ["four cells", "person\ti\treview\tzorblatt", "expected 5 tab-separated cells, got 4"],
  ])("refuses %s, naming the line and never quoting the pattern", (_label, row, why) => {
    const error = unwrapErr(parseIndirectMap({ text: `${HEADER}\n${row}\n` }));
    expect(error.code).toBe("INDIRECT_MAP_ROW_MALFORMED");
    expect(error.message).toBe(`indirect candidate map line 2: ${why}`);
    expect(error.message).not.toContain("zorb");
  });
});

describe("isIndirectClass", () => {
  it("accepts every registered class and nothing inherited", () => {
    const names = Object.keys(INDIRECT_CLASSES);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => !isIndirectClass(name))).toEqual([]);
    expect(isIndirectClass("toString")).toBe(false);
    expect(isIndirectClass("people")).toBe(false);
  });
});
