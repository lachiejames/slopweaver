import { describe, expect, it } from "vitest";

import { testFilePathsFromLine, testFilePathsFromText } from "../../../../live/github/testFailurePaths.js";

/** The escape character a runner's colour codes open with. */
const ESC = String.fromCodePoint(27);

describe("testFilePathsFromLine", () => {
  it("reads Vitest's FAIL line, the shape a unit job prints for a failing case", () => {
    expect(
      testFilePathsFromLine({ line: " FAIL  src/__tests__/unit/review/landing.test.ts > pressable > presses" }),
    ).toEqual(["src/__tests__/unit/review/landing.test.ts"]);
  });

  it("reads Vitest's summary line only when it reports failures", () => {
    expect(testFilePathsFromLine({ line: "❯ src/a.test.ts (4 tests | 1 failed) 30ms" })).toEqual(["src/a.test.ts"]);
    expect(testFilePathsFromLine({ line: "❯ src/a.test.ts (4 tests) 30ms" })).toEqual([]);
  });

  it("reads a runner error annotation naming a spec file", () => {
    expect(testFilePathsFromLine({ line: "##[error]site/__tests__/unit/now.spec.tsx:12:3 expected 2" })).toEqual([
      "site/__tests__/unit/now.spec.tsx",
    ]);
  });

  it("strips colour codes that would otherwise split FAIL from its path", () => {
    expect(testFilePathsFromLine({ line: `${ESC}[31mFAIL${ESC}[39m src/b.test.ts` })).toEqual(["src/b.test.ts"]);
  });

  it("normalises a Windows separator and a leading ./ to one repository path", () => {
    expect(testFilePathsFromLine({ line: "FAIL ./src\\c.test.mts" })).toEqual(["src/c.test.mts"]);
  });

  it("never takes a path from a PASSING line, even one naming a test file", () => {
    expect(testFilePathsFromLine({ line: " ✓ src/__tests__/unit/review/landing.test.ts (12 tests) 40ms" })).toEqual([]);
  });

  it("takes nothing from a failure line naming no test file", () => {
    expect(testFilePathsFromLine({ line: "##[error]site/components/live/Now.tsx:86:11: unnecessary" })).toEqual([]);
  });
});

describe("testFilePathsFromText", () => {
  it("names each failing file once, in first-seen order", () => {
    expect(
      testFilePathsFromText({
        text: "FAIL src/z.test.ts > one\n ✓ src/y.test.ts\nFAIL src/x.test.ts\nFAIL src/z.test.ts > two",
      }),
    ).toEqual(["src/z.test.ts", "src/x.test.ts"]);
  });

  it("names nothing in an empty text", () => {
    expect(testFilePathsFromText({ text: "" })).toEqual([]);
  });
});
