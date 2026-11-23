import { describe, expect, it } from "vitest";

import { addedLinesOf, hostWordingHits, isHostWordingScope, namesHostByMake } from "../../../devLint/hostWording.js";

describe("addedLinesOf", () => {
  it("numbers each added line on the new side, per file and per hunk, skipping removed lines", () => {
    const diff = [
      "diff --git a/docs/a.md b/docs/a.md",
      "--- a/docs/a.md",
      "+++ b/docs/a.md",
      "@@ -3,0 +4,2 @@",
      "+first added",
      "+second added",
      "@@ -10 +12 @@",
      "-old line",
      "+replacement",
      "diff --git a/src/b.ts b/src/b.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/b.ts",
      "@@ -0,0 +1 @@",
      "+const b = 1;",
    ];
    expect(addedLinesOf({ diff })).toEqual([
      { line: 4, path: "docs/a.md", text: "first added" },
      { line: 5, path: "docs/a.md", text: "second added" },
      { line: 12, path: "docs/a.md", text: "replacement" },
      { line: 1, path: "src/b.ts", text: "const b = 1;" },
    ]);
  });

  it("reads nothing for a deleted file", () => {
    const diff = ["--- a/gone.md", "+++ /dev/null", "@@ -1 +0,0 @@", "-was here"];
    expect(addedLinesOf({ diff })).toEqual([]);
  });

  it("reads nothing from an empty diff", () => {
    expect(addedLinesOf({ diff: [] })).toEqual([]);
  });
});

describe("namesHostByMake", () => {
  it("catches the phrase in any case and across any whitespace", () => {
    expect(namesHostByMake({ text: "Runs on this Mac." })).toBe(true);
    expect(namesHostByMake({ text: "THIS MAC only" })).toBe(true);
    expect(namesHostByMake({ text: "on this\tmac" })).toBe(true);
  });

  it("lets product names and longer words through", () => {
    expect(namesHostByMake({ text: "macOS on this machine, Keychain and Spotlight" })).toBe(false);
    expect(namesHostByMake({ text: "this macro expands" })).toBe(false);
    expect(namesHostByMake({ text: "unthis mac" })).toBe(false);
  });

  it("lets the phrase through only when a matching quote pair wraps it exactly", () => {
    expect(namesHostByMake({ text: 'the rule retires "this Mac" everywhere' })).toBe(false);
    expect(namesHostByMake({ text: "write `this Mac` as this machine" })).toBe(false);
    expect(namesHostByMake({ text: "quoted “this Mac” here" })).toBe(false);
    expect(namesHostByMake({ text: "said \"this Mac' oddly" })).toBe(true);
    expect(namesHostByMake({ text: '"runs on this Mac"' })).toBe(true);
  });

  it("still refuses a bare occurrence beside a quoted one", () => {
    expect(namesHostByMake({ text: '"this Mac" is retired, but this Mac slipped back' })).toBe(true);
  });
});

describe("isHostWordingScope", () => {
  it("judges source and docs and skips every test tree", () => {
    expect(isHostWordingScope({ path: "docs/toolchain.md" })).toBe(true);
    expect(isHostWordingScope({ path: "src/outbound/publicationScan.ts" })).toBe(true);
    expect(isHostWordingScope({ path: "src/__tests__/unit/outbound/publicationScan.test.ts" })).toBe(false);
    expect(isHostWordingScope({ path: "desktop/__tests__/unit/a.test.ts" })).toBe(false);
  });
});

describe("hostWordingHits", () => {
  it("keeps only in-scope lines that name the host", () => {
    const added = [
      { line: 1, path: "docs/a.md", text: "Install it on this Mac." },
      { line: 2, path: "docs/a.md", text: "Install it on this machine." },
      { line: 3, path: "src/__tests__/unit/a.test.ts", text: "feeds this Mac to the scan" },
    ];
    expect(hostWordingHits({ added })).toEqual([{ line: 1, path: "docs/a.md", text: "Install it on this Mac." }]);
  });

  it("returns nothing for no added lines", () => {
    expect(hostWordingHits({ added: [] })).toEqual([]);
  });
});
