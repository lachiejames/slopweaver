import { describe, expect, it } from "vitest";
import { ts, withSourceFile } from "#lib/tsSyntax.js";
import { type ExpectedParams, expectedParamNames } from "../../../devLint/jsdocParamNames.js";

/** The expected params of the first function declaration in `text`. */
function expectedOf({ text }: { text: string }): ExpectedParams | undefined {
  return withSourceFile({
    fileName: "fixture.ts",
    text,
    use: (sf) => {
      const fn = sf.statements.find((stmt): stmt is ts.FunctionDeclaration => ts.isFunctionDeclaration(stmt))!;
      return expectedParamNames({ node: fn, sf });
    },
  });
}

describe("expectedParamNames", () => {
  it("reads the declared type's fields, including one never bound", () => {
    expect(expectedOf({ text: "function f({ a }: { a: string; b: number }) {}" })).toEqual({
      complete: true,
      names: ["a", "b"],
    });
  });

  it("takes positional identifiers as they are", () => {
    expect(expectedOf({ text: "function f(left: string, right: string) {}" })).toEqual({
      complete: true,
      names: ["left", "right"],
    });
  });

  it("resolves a local interface", () => {
    expect(expectedOf({ text: "interface Opts { x: 1; y: 2 }\nfunction f({ x }: Opts) {}" })).toEqual({
      complete: true,
      names: ["x", "y"],
    });
  });

  it("yields undefined for an annotation it cannot resolve", () => {
    expect(expectedOf({ text: 'import type { Opts } from "./o.js";\nfunction f({ x }: Opts) {}' })).toBeUndefined();
  });

  it("yields undefined for an array pattern", () => {
    expect(expectedOf({ text: "function f([a]: string[]) {}" })).toBeUndefined();
  });
});
