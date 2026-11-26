import { describe, expect, it } from "vitest";
import { compareLoaded } from "../../../../devLint/testEnshittification.js";

const A = "src/__tests__/unit/x/a.test.ts";
const B = "src/__tests__/unit/x/b.test.ts";

const CASE_X = ['  it("x", () => {', '    expect(x("a")).toBe("a");', '    expect(x("")).toBe("");', "  });"];
const CASE_Y = ['  it("y", () => {', "    expect(y(1)).toBe(1);", "    expect(y(2)).toBe(2);", "  });"];

/** A one-suite test file holding the given cases. */
function file({ cases }: { cases: readonly (readonly string[])[] }): string {
  return ['describe("s", () => {', ...cases.flat(), "});", ""].join("\n");
}

/** No `deleted-with-code:` claim anywhere, so only the counts decide. */
const NO_CLAIMS = (): { verified: readonly string[]; unproven: readonly string[] } => ({ unproven: [], verified: [] });

describe("compareLoaded — a case moved into an existing sibling", () => {
  // The whole-diff read's counterexample: X's credit to A must not also stand in B's head for the Y B deleted.
  it("refuses the sibling that took the case and deleted its own, and passes the file the case left", () => {
    const compared = [
      { baseText: file({ cases: [CASE_X] }), headText: file({ cases: [] }), path: A },
      { baseText: file({ cases: [CASE_Y] }), headText: file({ cases: [CASE_X] }), path: B },
    ];
    expect(compareLoaded({ added: [], compared, settle: NO_CLAIMS })).toEqual([
      `${B}: 2 expect() call(s) became 0`,
      `${B}: 2 exact-value matcher(s) became 0`,
    ]);
  });

  it("passes both when the sibling keeps what it had", () => {
    const compared = [
      { baseText: file({ cases: [CASE_X] }), headText: file({ cases: [] }), path: A },
      { baseText: file({ cases: [CASE_Y] }), headText: file({ cases: [CASE_Y, CASE_X] }), path: B },
    ];
    expect(compareLoaded({ added: [], compared, settle: NO_CLAIMS })).toEqual([]);
  });

  it("refuses the file the case left when no sibling received it", () => {
    const compared = [{ baseText: file({ cases: [CASE_X] }), headText: file({ cases: [] }), path: A }];
    expect(compareLoaded({ added: [], compared, settle: NO_CLAIMS })).toEqual([
      `${A}: 2 expect() call(s) became 0`,
      `${A}: 2 exact-value matcher(s) became 0`,
    ]);
  });
});
