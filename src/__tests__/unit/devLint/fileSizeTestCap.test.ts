import { describe, expect, it } from "vitest";
import {
  capFor,
  type FileSize,
  fileSizeOf,
  MAX_FILE_LINES,
  MAX_TEST_FILE_LINES,
  offendersOf,
} from "../../../devLint/fileSizeMeasure.js";
import { baselineOf, isFileSizeSubject } from "../../../devLint/fileSizeRatchet.js";

/** A measured file, spelled once so a case names only the field it is about. */
const size = ({ path, codeLines }: { path: string; codeLines: number }): FileSize => ({
  codeLines,
  exempt: false,
  exemptMarker: false,
  path,
  rawLines: codeLines + 10,
  registerMarker: false,
});

describe("MAX_TEST_FILE_LINES", () => {
  it("is 500 for a test file, beside the 300 every other file keeps", () => {
    expect(MAX_TEST_FILE_LINES).toBe(500);
    expect(MAX_FILE_LINES).toBe(300);
  });
});

describe("isFileSizeSubject — a test file is measured now", () => {
  it("measures a test file under src/ as well as site/", () => {
    expect(isFileSizeSubject({ path: "src/__tests__/unit/lib/result.test.ts" })).toBe(true);
  });

  it("measures a helper under __tests__ too, which is not a test file", () => {
    expect(isFileSizeSubject({ path: "src/__tests__/replayFixture.ts" })).toBe(true);
  });

  it("measures the gate itself — its source, entry and test", () => {
    expect(isFileSizeSubject({ path: "src/devLint/fileSizeRatchet.ts" })).toBe(true);
    expect(isFileSizeSubject({ path: "src/devLint/fileSizeRatchet.entry.ts" })).toBe(true);
    expect(isFileSizeSubject({ path: "src/__tests__/unit/devLint/fileSizeRatchet.test.ts" })).toBe(true);
  });
});

describe("capFor", () => {
  it("gives a test file of either extension the test cap", () => {
    expect(capFor({ path: "src/__tests__/unit/a.test.ts" })).toBe(500);
    expect(capFor({ path: "site/__tests__/unit/Board.test.tsx" })).toBe(500);
  });

  it("gives source, and a helper or fake under __tests__, the source cap", () => {
    expect(capFor({ path: "src/cli/index.ts" })).toBe(300);
    expect(capFor({ path: "src/__tests__/setup-polly.ts" })).toBe(300);
    expect(capFor({ path: "src/__tests__/fakes/testing.ts" })).toBe(300);
  });
});

describe("offendersOf — two caps", () => {
  it("holds a test file to 500 and a source file to 300, so a 400-line test is clean and a 400-line module is not", () => {
    const sizes = [
      size({ codeLines: 400, path: "src/__tests__/unit/a.test.ts" }),
      size({ codeLines: 400, path: "src/a.ts" }),
      size({ codeLines: MAX_TEST_FILE_LINES, path: "site/__tests__/unit/b.test.tsx" }),
      size({ codeLines: MAX_TEST_FILE_LINES + 1, path: "site/__tests__/unit/c.test.tsx" }),
    ];
    expect(offendersOf({ sizes }).map((one) => one.path)).toEqual(["site/__tests__/unit/c.test.tsx", "src/a.ts"]);
  });

  it("holds a helper under __tests__ to the source cap, because it is not a test file", () => {
    const sizes = [size({ codeLines: 400, path: "src/__tests__/replayFixture.ts" })];
    expect(offendersOf({ sizes }).map((one) => one.path)).toEqual(["src/__tests__/replayFixture.ts"]);
  });
});

describe("fileSizeOf — a test file carries no marker", () => {
  it("exempts a test file by no marker, even one with a signed row, but still READS each so the gate refuses it", () => {
    const exempt = "// max-file-lines-exempt: a long scenario\nconst a = 1;";
    const register = "// max-file-lines-register: a table of cases\nconst a = 1;";
    const generated = "// GENERATED — do not hand-edit\nconst a = 1;";
    const signed = new Set(["src/__tests__/unit/a.test.ts", "site/__tests__/unit/b.test.tsx"]);
    const flags = [
      fileSizeOf({ approvedTradeoffPaths: signed, content: exempt, path: "src/__tests__/unit/a.test.ts" }),
      fileSizeOf({ approvedTradeoffPaths: signed, content: register, path: "site/__tests__/unit/b.test.tsx" }),
      fileSizeOf({ approvedTradeoffPaths: signed, content: generated, path: "src/__tests__/unit/c.test.ts" }),
    ].map((one) => [one.exempt, one.exemptMarker, one.registerMarker]);
    expect(flags).toEqual([
      [false, true, false],
      [false, false, true],
      [false, false, false],
    ]);
  });

  it("still honours a signed exemption on a helper under __tests__, which is not a test file", () => {
    const content = "// max-file-lines-exempt: a generated fixture table\nconst a = 1;";
    const path = "src/__tests__/fixtureTable.ts";
    expect(fileSizeOf({ approvedTradeoffPaths: new Set([path]), content, path }).exempt).toBe(true);
  });

  it("writes an over-500 test file to offenders, never exempt, even when it carries a marker", () => {
    const content = `// max-file-lines-exempt: a long scenario\n${"const a = 1;\n".repeat(501)}`;
    const path = "src/__tests__/unit/a.test.ts";
    const current = offendersOf({ sizes: [fileSizeOf({ approvedTradeoffPaths: new Set([path]), content, path })] });
    expect(baselineOf({ current })).toEqual({
      exempt: [],
      offenders: [{ codeLines: 501, path: "src/__tests__/unit/a.test.ts" }],
    });
  });
});
