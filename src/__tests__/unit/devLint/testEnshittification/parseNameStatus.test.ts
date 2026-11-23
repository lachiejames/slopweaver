import { describe, expect, it } from "vitest";
import { parseNameStatus } from "../../../../devLint/testEnshittification.js";

describe("parseNameStatus", () => {
  it("reads a modification as the same path at both ends", () => {
    expect(parseNameStatus({ fields: ["M", "src/__tests__/unit/a.test.ts"] })).toEqual([
      { basePath: "src/__tests__/unit/a.test.ts", headPath: "src/__tests__/unit/a.test.ts" },
    ]);
  });

  it("follows a rename to its old path", () => {
    const fields = ["R096", "src/__tests__/unit/old.test.ts", "src/__tests__/unit/new.test.ts"];
    expect(parseNameStatus({ fields })).toEqual([
      { basePath: "src/__tests__/unit/old.test.ts", headPath: "src/__tests__/unit/new.test.ts" },
    ]);
  });

  it("drops an addition, which has no base to have got worse than", () => {
    expect(parseNameStatus({ fields: ["A", "src/__tests__/unit/a.test.ts"] })).toEqual([]);
  });

  it("drops a deletion, which has no head", () => {
    expect(parseNameStatus({ fields: ["D", "src/__tests__/unit/a.test.ts"] })).toEqual([]);
  });

  it("drops a changed file in the test tree that is not a test", () => {
    expect(parseNameStatus({ fields: ["M", "src/__tests__/replayFixture.ts"] })).toEqual([]);
  });

  it("drops a test-named file outside the test tree, which the lane never collects", () => {
    expect(parseNameStatus({ fields: ["M", "src/devLint/a.test.ts"] })).toEqual([]);
  });

  it("ignores a truncated trailing record rather than throwing", () => {
    expect(parseNameStatus({ fields: ["M", "src/__tests__/unit/a.test.ts", "R100", "only-one-side"] })).toEqual([
      { basePath: "src/__tests__/unit/a.test.ts", headPath: "src/__tests__/unit/a.test.ts" },
    ]);
  });

  it("keeps git's order across a mixed diff", () => {
    const fields = [
      "M",
      "src/__tests__/unit/b.test.ts",
      "A",
      "src/__tests__/unit/c.test.ts",
      "M",
      "src/__tests__/unit/a.test.ts",
    ];
    expect(parseNameStatus({ fields }).map((pair) => pair.headPath)).toEqual([
      "src/__tests__/unit/b.test.ts",
      "src/__tests__/unit/a.test.ts",
    ]);
  });

  // This exact case broke the previous shape: a two-path status whose
  // paths were skipped desynchronises the cursor, so the NEXT file's path is read as a status and every
  // remaining record in the diff is misparsed. A copy is the status that does it.
  it("advances past BOTH paths of a status it ignores, so the rest of the diff still parses", () => {
    const fields = [
      "C100",
      "src/__tests__/unit/src.test.ts",
      "src/__tests__/unit/copy.test.ts",
      "M",
      "src/__tests__/unit/after.test.ts",
    ];
    expect(parseNameStatus({ fields }).map((pair) => pair.headPath)).toEqual(["src/__tests__/unit/after.test.ts"]);
  });

  // The counterexample Codex reproduced against a real --depth=1 clone. Without `-z`, core.quotePath (ON by
  // default) renders this path as "src/__tests__/unit/caf\303\251.test.ts" — quotes included — which fails
  // the TEST_TREE prefix test, so a genuine assertion reduction was dropped and the gate reported
  // "nothing to compare". The `-z` stream carries the path raw, which is what makes this pass.
  it("sees a non-ASCII test path, which core.quotePath would otherwise hide", () => {
    expect(parseNameStatus({ fields: ["M", "src/__tests__/unit/café.test.ts"] })).toEqual([
      { basePath: "src/__tests__/unit/café.test.ts", headPath: "src/__tests__/unit/café.test.ts" },
    ]);
  });

  it("sees a path containing a newline, which a line-split reader would have split in two", () => {
    expect(parseNameStatus({ fields: ["M", "src/__tests__/unit/od\nd.test.ts"] })).toEqual([
      { basePath: "src/__tests__/unit/od\nd.test.ts", headPath: "src/__tests__/unit/od\nd.test.ts" },
    ]);
  });
});
