/**
 * The primitive-ratchet gate's own tests: it must catch a new top-level function whose body is the exact
 * shape of a registered primitive's, survive reformatting/comments, and NOT catch an unrelated function or
 * one that only looks similar because a variable was renamed.
 */

import { describe, expect, it } from "vitest";
import { withSourceFile } from "#lib/tsSyntax.js";
import {
  canonicalBodyOf,
  isScannablePath,
  scanPrimitiveRatchet,
  structuralKeyOf,
} from "../../../devLint/primitiveRatchet.js";

const OPT_STR = `function optStr({ value }: { value: unknown }): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}`;

/** Build the one-entry canonical-primitives list `scanPrimitiveRatchet` expects, from real source text. */
function canonicalFrom({ content, name, file }: { content: string; name: string; file: string }): readonly {
  readonly primitive: { readonly file: string; readonly name: string };
  readonly key: string;
}[] {
  const key = canonicalBodyOf({ content, name });
  if (key === undefined) {
    throw new Error("fixture did not contain the named function — fix the fixture, not the test");
  }
  return [{ key, primitive: { file, name } }];
}

describe("canonicalBodyOf", () => {
  it("returns the body's structural key for a top-level function with that name", () => {
    expect(canonicalBodyOf({ content: OPT_STR, name: "optStr" })).toBeDefined();
  });

  it("returns undefined when no top-level function by that name exists", () => {
    expect(canonicalBodyOf({ content: OPT_STR, name: "missingFn" })).toBeUndefined();
  });

  it("returns undefined for a function declared without a body (an ambient overload)", () => {
    expect(
      canonicalBodyOf({ content: "declare function optStr(value: unknown): string | undefined;\n", name: "optStr" }),
    ).toBeUndefined();
  });
});

describe("scanPrimitiveRatchet — catches", () => {
  const canonicalPrimitives = canonicalFrom({ content: OPT_STR, file: "src/corpus/slack/shape.ts", name: "optStr" });

  it("a byte-identical copy under a different name", () => {
    const content = `function localCopy({ value }: { value: unknown }): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}`;
    const hits = scanPrimitiveRatchet({ canonicalPrimitives, content, path: "src/x.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.functionName).toBe("localCopy");
    expect(hits[0]!.primitive).toEqual({ file: "src/corpus/slack/shape.ts", name: "optStr" });
  });

  it("a copy reformatted onto multiple lines", () => {
    const content = `function optStr({ value }: { value: unknown }): string | undefined {
  return typeof value === "string" &&
    value.length > 0
    ? value
    : undefined;
}`;
    expect(scanPrimitiveRatchet({ canonicalPrimitives, content, path: "src/x.ts" })).toHaveLength(1);
  });

  it("a copy carrying an extra comment", () => {
    const content = `function optStr({ value }: { value: unknown }): string | undefined {
  // a non-empty string field
  return typeof value === "string" && value.length > 0 ? value : undefined;
}`;
    expect(scanPrimitiveRatchet({ canonicalPrimitives, content, path: "src/x.ts" })).toHaveLength(1);
  });

  it("reports the function's own declaration line", () => {
    const content = `\n\nfunction optStr({ value }: { value: unknown }): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}`;
    expect(scanPrimitiveRatchet({ canonicalPrimitives, content, path: "src/x.ts" })[0]!.line).toBe(3);
  });
});

describe("scanPrimitiveRatchet — does not catch", () => {
  const canonicalPrimitives = canonicalFrom({ content: OPT_STR, file: "src/corpus/slack/shape.ts", name: "optStr" });

  it("a function whose body renamed a variable", () => {
    const content = `function optStr({ v }: { v: unknown }): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}`;
    expect(scanPrimitiveRatchet({ canonicalPrimitives, content, path: "src/x.ts" })).toEqual([]);
  });

  it("an unrelated function", () => {
    const content = `function add({ a, b }: { a: number; b: number }): number {
  return a + b;
}`;
    expect(scanPrimitiveRatchet({ canonicalPrimitives, content, path: "src/x.ts" })).toEqual([]);
  });

  it("a function nested inside another (not top-level)", () => {
    const content = `function outer(): string | undefined {
  function optStr({ value }: { value: unknown }): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }
  return optStr({ value: "x" });
}`;
    expect(scanPrimitiveRatchet({ canonicalPrimitives, content, path: "src/x.ts" })).toEqual([]);
  });

  it("a file with no top-level function declarations at all", () => {
    expect(scanPrimitiveRatchet({ canonicalPrimitives, content: "export const x = 1;\n", path: "src/x.ts" })).toEqual(
      [],
    );
  });
});

describe("structuralKeyOf", () => {
  it("is equal for the same identifier referenced twice, unequal for two different identifiers", () => {
    withSourceFile({
      fileName: "x.ts",
      text: "a; b;",
      use: (sf) => {
        expect(structuralKeyOf({ node: sf.statements[0]! })).not.toBe(structuralKeyOf({ node: sf.statements[1]! }));
      },
    });
  });

  it("is equal for two string literals with the same text", () => {
    withSourceFile({
      fileName: "x.ts",
      text: '"hi"; "hi";',
      use: (sf) => {
        expect(structuralKeyOf({ node: sf.statements[0]! })).toBe(structuralKeyOf({ node: sf.statements[1]! }));
      },
    });
  });

  it("is unequal for two string literals with different text", () => {
    withSourceFile({
      fileName: "x.ts",
      text: '"hi"; "bye";',
      use: (sf) => {
        expect(structuralKeyOf({ node: sf.statements[0]! })).not.toBe(structuralKeyOf({ node: sf.statements[1]! }));
      },
    });
  });
});

describe("isScannablePath", () => {
  it("scans the source trees", () => {
    expect(isScannablePath({ path: "src/cli/commands/github/core.ts" })).toBe(true);
    expect(isScannablePath({ path: "eval/x.ts" })).toBe(true);
    expect(isScannablePath({ path: "hooks/y.ts" })).toBe(true);
  });

  it("does not scan its own source", () => {
    expect(isScannablePath({ path: "src/devLint/primitiveRatchet.ts" })).toBe(false);
  });

  it("does not scan outside the source trees", () => {
    expect(isScannablePath({ path: "docs/architecture.md" })).toBe(false);
  });
});
