/**
 * The reference map's parser over SYNTHETIC rows: every name below is invented, so a failure message can be
 * checked for never echoing a pattern without a real name ever appearing in a test.
 */
import { describe, expect, it } from "vitest";

import { parseReferenceMap } from "../../../hygiene/referenceMap.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const HEADER = "class\tflags\tpattern";

/** A map file from its rows, the header first. */
const mapText = ({ rows }: { rows: readonly string[] }): string => [HEADER, ...rows].join("\n");

describe("parseReferenceMap", () => {
  it("compiles each row with its class, global, and case-insensitive under `i`", () => {
    const rows = unwrap(
      parseReferenceMap({ text: mapText({ rows: ["people\ti\t\\bZorblatt\\b", "hosts\t-\tquux\\.example"] }) }),
    );
    expect(rows.map((row) => row.className)).toEqual(["people", "hosts"]);
    expect(rows.map((row) => row.re.flags)).toEqual(["gi", "g"]);
    expect([..."a zorblatt b".matchAll(rows[0]!.re)].length).toBe(1);
  });

  it("skips comments and blank lines, and accepts CRLF", () => {
    const text = `# a comment\r\n\r\n${HEADER}\r\npeople\t-\tZorblatt\r\n`;
    expect(unwrap(parseReferenceMap({ text })).length).toBe(1);
  });

  it("keeps an exact duplicate row once, so it cannot double a count", () => {
    expect(unwrap(parseReferenceMap({ text: mapText({ rows: ["people\t-\tZorb", "people\t-\tZorb"] }) })).length).toBe(
      1,
    );
  });

  it("refuses a file with no header", () => {
    expect(unwrapErr(parseReferenceMap({ text: "people\t-\tZorb" })).code).toBe("MAP_HEADER_MISSING");
    expect(unwrapErr(parseReferenceMap({ text: "" })).code).toBe("MAP_HEADER_MISSING");
  });

  it("refuses a header with no row, because a zero over it would prove nothing", () => {
    expect(unwrapErr(parseReferenceMap({ text: HEADER })).code).toBe("MAP_EMPTY");
  });

  it("refuses each malformed row by its line, without quoting the pattern", () => {
    const cases = [
      { row: "people\tZorbsecret", why: "expected 3 tab-separated cells, got 2" },
      { row: "People\t-\tZorbsecret", why: "the class must be lowercase words joined by '-'" },
      { row: "people\tx\tZorbsecret", why: "flags must be 'i' or '-'" },
      { row: "people\t-\t", why: "the pattern is empty" },
      { row: "people\t-\t(Zorbsecret", why: "the pattern is not a valid regular expression" },
      { row: "people\t-\t(Zorbsecret)?", why: "the pattern matches the empty string, so it matches everywhere" },
    ];
    expect(cases.length).toBeGreaterThan(0);
    for (const { row, why } of cases) {
      const error = unwrapErr(parseReferenceMap({ text: mapText({ rows: [row] }) }));
      expect(error.message).toBe(`reference map line 2: ${why}`);
      expect(error.message).not.toContain("Zorbsecret");
    }
  });
});
