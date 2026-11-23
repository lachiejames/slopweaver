import { describe, expect, it } from "vitest";
import { MAX_FILE_LINES, rawLineCountOf } from "../../../devLint/fileSizeMeasure.js";
import { isFileSizeSubject } from "../../../devLint/fileSizeRatchet.js";

describe("isFileSizeSubject", () => {
  it("measures the console's .tsx, the file that grew to 1,218 lines outside the scope", () => {
    expect(isFileSizeSubject({ path: "site/components/live/Board.tsx" })).toBe(true);
  });

  it("measures the console's .ts and the Electron shell", () => {
    expect(isFileSizeSubject({ path: "site/lib/queueRows.ts" })).toBe(true);
    expect(isFileSizeSubject({ path: "desktop/src/main.ts" })).toBe(true);
  });

  it("still measures src/, eval/ and hooks/", () => {
    expect(isFileSizeSubject({ path: "src/cli/index.ts" })).toBe(true);
    expect(isFileSizeSubject({ path: "eval/run.ts" })).toBe(true);
    expect(isFileSizeSubject({ path: "hooks/pretooluse.ts" })).toBe(true);
  });

  it("measures tests, of either extension", () => {
    expect(isFileSizeSubject({ path: "site/__tests__/unit/queueRows.test.ts" })).toBe(true);
    expect(isFileSizeSubject({ path: "site/__tests__/unit/Workstreams.test.tsx" })).toBe(true);
  });

  it("leaves the two upstream registry trees out, and only those", () => {
    expect(isFileSizeSubject({ path: "site/components/ai-elements/code-block.tsx" })).toBe(false);
    expect(isFileSizeSubject({ path: "site/components/ui/select.tsx" })).toBe(false);
    expect(isFileSizeSubject({ path: "site/components/console/Queue.tsx" })).toBe(true);
  });

  it("holds every tree to the one cap — no tree is out by name any more", () => {
    expect(isFileSizeSubject({ path: "skills/github/SKILL.ts" })).toBe(true);
    expect(isFileSizeSubject({ path: "site/next.config.mjs" })).toBe(true);
  });
});

describe("isFileSizeSubject — every tree and every JS/TS extension", () => {
  it("takes tools/, config/ and the root, and every extension", () => {
    expect(
      ["tools/gen.ts", "config/vitest/unit.ts", "eslint.config.mjs", "x.cjs", "a.mts", "b.cts", "c.js", "d.tsx"].filter(
        (path) => isFileSizeSubject({ path }),
      ),
    ).toEqual([
      "tools/gen.ts",
      "config/vitest/unit.ts",
      "eslint.config.mjs",
      "x.cjs",
      "a.mts",
      "b.cts",
      "c.js",
      "d.tsx",
    ]);
  });

  it("measures a test file, leaves non-code out, and measures the gate itself", () => {
    expect(isFileSizeSubject({ path: "src/a.test.ts" })).toBe(true);
    expect(isFileSizeSubject({ path: "README.md" })).toBe(false);
    expect(isFileSizeSubject({ path: "src/devLint/fileSizeRatchet.ts" })).toBe(true);
  });
});

describe("rawLineCountOf", () => {
  it("counts newlines the way wc -l does", () => {
    expect(rawLineCountOf({ content: "a\nb\nc\n" })).toBe(3);
  });

  it("does not count a final line lacking a trailing newline", () => {
    expect(rawLineCountOf({ content: "a\nb\nc" })).toBe(2);
  });

  it("is zero for empty content", () => {
    expect(rawLineCountOf({ content: "" })).toBe(0);
  });
});

describe("MAX_FILE_LINES", () => {
  it("is 300 — the owner's number, not a step toward one", () => {
    expect(MAX_FILE_LINES).toBe(300);
  });
});
