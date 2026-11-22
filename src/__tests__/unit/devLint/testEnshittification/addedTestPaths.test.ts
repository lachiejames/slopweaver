import { describe, expect, it } from "vitest";
import { addedTestPaths } from "../../../../devLint/testEnshittification.js";

describe("addedTestPaths", () => {
  it("reads an addition, the only place a case split off an existing file can land", () => {
    expect(addedTestPaths({ fields: ["A", "src/__tests__/unit/a.test.ts"] })).toEqual(["src/__tests__/unit/a.test.ts"]);
  });

  it("reads no modification, deletion, rename or copy", () => {
    const fields = [
      "M",
      "src/__tests__/unit/m.test.ts",
      "D",
      "src/__tests__/unit/d.test.ts",
      "R100",
      "src/__tests__/unit/old.test.ts",
      "src/__tests__/unit/new.test.ts",
      "C100",
      "src/__tests__/unit/src.test.ts",
      "src/__tests__/unit/copy.test.ts",
    ];
    expect(addedTestPaths({ fields })).toEqual([]);
  });

  it("drops an added non-test file and a test-named file outside the test tree", () => {
    const fields = ["A", "src/__tests__/replayFixture.ts", "A", "src/devLint/a.test.ts"];
    expect(addedTestPaths({ fields })).toEqual([]);
  });

  it("advances past a two-path record, so an addition after it still reads", () => {
    const fields = [
      "R096",
      "src/__tests__/unit/old.test.ts",
      "src/__tests__/unit/new.test.ts",
      "A",
      "src/__tests__/unit/after.test.ts",
    ];
    expect(addedTestPaths({ fields })).toEqual(["src/__tests__/unit/after.test.ts"]);
  });

  it("keeps git's order and a path carrying a newline", () => {
    const fields = ["A", "src/__tests__/unit/b.test.ts", "A", "src/__tests__/unit/od\nd.test.ts"];
    expect(addedTestPaths({ fields })).toEqual(["src/__tests__/unit/b.test.ts", "src/__tests__/unit/od\nd.test.ts"]);
  });
});
