import { describe, expect, it } from "vitest";
import { isScannablePath, scanRedos } from "../../../devLint/redosCheck.js";

describe("scanRedos", () => {
  it("flags a catastrophic-backtracking regex literal", () => {
    const hits = scanRedos({ content: "const r = /^(a+)+$/;", path: "src/x.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.pattern).toBe("^(a+)+$");
  });

  it("does not flag a safe regex literal", () => {
    expect(scanRedos({ content: "const r = /^[a-z]+$/;", path: "src/x.ts" })).toEqual([]);
  });

  it("flags a catastrophic new RegExp(stringLiteral)", () => {
    const hits = scanRedos({ content: 'const r = new RegExp("^(a+)+$");', path: "src/x.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.pattern).toBe("^(a+)+$");
  });

  it("does not flag a safe new RegExp(stringLiteral)", () => {
    expect(scanRedos({ content: 'const r = new RegExp("^[a-z]+$");', path: "src/x.ts" })).toEqual([]);
  });

  it("does not flag `new RegExp` written with no argument list at all", () => {
    expect(scanRedos({ content: "const r = new RegExp;", path: "src/x.ts" })).toEqual([]);
  });

  it("does not flag new RegExp(x) built from a dynamic (non-literal) pattern", () => {
    expect(scanRedos({ content: "const r = new RegExp(pattern);", path: "src/x.ts" })).toEqual([]);
  });

  it("reports the source line", () => {
    const content = ["const a = 1;", "const r = /^(a+)+$/;"].join("\n");
    expect(scanRedos({ content, path: "src/x.ts" })[0]!.line).toBe(2);
  });
});

describe("isScannablePath", () => {
  it("includes a source under src/, eval/ or hooks/", () => {
    expect(isScannablePath({ path: "src/corpus/watermark.ts" })).toBe(true);
  });

  it("excludes a non-TS file and this gate's own sources", () => {
    expect(isScannablePath({ path: "src/devLint/redosCheck.ts" })).toBe(false);
  });
});
