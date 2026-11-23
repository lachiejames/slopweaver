import { describe, expect, it } from "vitest";
import { ts, withSourceFile } from "#lib/tsSyntax.js";

import { isPassThroughFallback, unwrapped } from "../../../devLint/fallbackHelperShape.js";

/** The first function declaration in a snippet, judged by the criterion. */
function judged({ source }: { source: string }): boolean {
  return withSourceFile({
    fileName: "x.ts",
    text: source,
    use: (sf) => {
      const fn = sf.statements.find((statement) => ts.isFunctionDeclaration(statement))!;
      return isPassThroughFallback({ fn });
    },
  });
}

describe("isPassThroughFallback — the helper shape", () => {
  it("is a generic function substituting null", () => {
    const source =
      "function orNull<T>(v: T | undefined): T | null {\n  if (v === undefined) return null;\n  return v;\n}\n";
    expect(judged({ source })).toBe(true);
  });

  it("is a generic function substituting an empty list", () => {
    const source = "function orEmpty<T>(v: T[] | undefined): T[] {\n  if (v == null) return [];\n  return v;\n}\n";
    expect(judged({ source })).toBe(true);
  });

  it("is a non-generic function substituting its own parameter", () => {
    const source =
      "function orDefault({ v, d }: { v: string | undefined; d: string }): string {\n  if (v === undefined) return d;\n  return v;\n}\n";
    expect(judged({ source })).toBe(true);
  });

  it("is a generic function substituting a call to a caller-supplied factory", () => {
    const source =
      "function storedOrEmpty<F>({ stored, empty }: { stored: F | null; empty: () => F }): F {\n  if (stored === null) return empty();\n  return stored;\n}\n";
    expect(judged({ source })).toBe(true);
  });

  it("is not a generic function whose absent branch returns a call, which may throw", () => {
    const source =
      "function required<T>(v: T | undefined): T {\n  if (v === undefined) return fail();\n  return v;\n}\n";
    expect(judged({ source })).toBe(false);
  });

  it("is not a non-generic function substituting a literal", () => {
    const source =
      'function orDash(v: string | undefined): string {\n  if (v === undefined) return "-";\n  return v;\n}\n';
    expect(judged({ source })).toBe(false);
  });

  it("is not a body with an else, or a third statement", () => {
    const withElse =
      "function f<T>(v: T | undefined): T | null {\n  if (v === undefined) return null;\n  else return v;\n}\n";
    const three =
      "function f<T>(v: T | undefined): T | null {\n  log();\n  if (v === undefined) return null;\n  return v;\n}\n";
    expect(judged({ source: withElse })).toBe(false);
    expect(judged({ source: three })).toBe(false);
  });
});

describe("unwrapped", () => {
  it("unwraps as, satisfies, a non-null assertion and parentheses together", () => {
    withSourceFile({
      fileName: "x.ts",
      text: "const a = ((b! as never) satisfies never);\n",
      use: (sf) => {
        const statement = sf.statements[0] as ts.VariableStatement;
        const init = statement.declarationList.declarations[0]!.initializer!;
        expect(unwrapped({ node: init }).getText()).toBe("b");
      },
    });
  });

  it("unwraps every layer of parentheses", () => {
    withSourceFile({
      fileName: "x.ts",
      text: "const a = ((b));\n",
      use: (sf) => {
        const statement = sf.statements[0] as ts.VariableStatement;
        const init = statement.declarationList.declarations[0]!.initializer!;
        expect(unwrapped({ node: init }).getText()).toBe("b");
      },
    });
  });
});

describe("isPassThroughFallback — wrappers and literal spellings", () => {
  it("reads through type-only wrappers on the test, the substitute and the returned value", () => {
    const source =
      "function f<T>(v: T | undefined): T | null {\n  if ((v as unknown) === (void 0)) return null as T | null;\n  return v!;\n}\n";
    expect(judged({ source })).toBe(true);
  });

  it("is a generic function substituting a negated number or a bigint", () => {
    const negative =
      "function f<T>(v: T | undefined): T | number {\n  if (v === undefined) return -1;\n  return v;\n}\n";
    const bigint = "function f<T>(v: T | undefined): T | bigint {\n  if (v === undefined) return 0n;\n  return v;\n}\n";
    expect(judged({ source: negative })).toBe(true);
    expect(judged({ source: bigint })).toBe(true);
  });

  it("is not a generator of the same shape", () => {
    const source =
      "function* f<T>(v: T | undefined): Generator<T> {\n  if (v === undefined) return null;\n  return v;\n}\n";
    expect(judged({ source })).toBe(false);
  });
});
