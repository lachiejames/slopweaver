import { describe, expect, it } from "vitest";

import { isScannablePath, scanAuthoredSeparators } from "../../../devLint/authoredSeparator.js";

/** Scan a snippet as if it were a source file, and report the messages in source order. */
function scan({ content }: { content: string }): readonly string[] {
  return scanAuthoredSeparators({ content, path: "src/example.ts" }).map(
    (hit) => `${String(hit.line)}: ${hit.message}`,
  );
}

describe("the `tldr` property shape", () => {
  it("catches an em dash typed into a template", () => {
    const hits = scan({ content: "const card = { tldr: `${slug} is blocked — waiting ${waited}` };\n" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!).toContain("1: a `tldr` is built from a string carrying a separator character");
  });

  it("catches one in a `+` chain, where only the second operand carries it", () => {
    const hits = scan({ content: 'const card = { tldr: "a" + "b — c" };\n' });
    expect(hits).toHaveLength(1);
  });

  it("catches a plain string literal", () => {
    expect(scan({ content: 'const card = { tldr: "a · b" };\n' })).toHaveLength(1);
  });

  it("names the headline form as where the second idea goes", () => {
    expect(scan({ content: 'const card = { tldr: "a | b" };\n' })[0]!).toContain("headlineOf({ clauses })");
  });

  it("leaves a separator-free `tldr` alone", () => {
    expect(scan({ content: 'const card = { tldr: "a-doc is blocked on you. Waiting 3.0h." };\n' })).toEqual([]);
  });

  it("leaves a `tldr` built from a named constant alone, which is the pattern it generalises", () => {
    expect(scan({ content: "const card = { tldr: `${a} ${SEP} ${b}` };\n" })).toEqual([]);
  });

  it("leaves a separator in a property that is not a `tldr` alone", () => {
    expect(scan({ content: 'const card = { lead: "a — b" };\n' })).toEqual([]);
  });
});

describe("the TL;DR-building function shape", () => {
  it("catches a separator built into a local and returned", () => {
    const content = [
      "function failureTldr({ question }: { question: string }): string {",
      "  const after = '\" — nothing was posted.';",
      "  return `${question}${after}`;",
      "}",
      "",
    ].join("\n");
    const hits = scan({ content });
    expect(hits).toHaveLength(1);
    expect(hits[0]!).toContain("2: this function builds a TL;DR");
  });

  it("catches one in an arrow function assigned to a TL;DR-named constant", () => {
    const content = ["const blockedTldr = (): string => {", '  return "a – b";', "};", ""].join("\n");
    expect(scan({ content })).toHaveLength(1);
  });

  it("matches the name case-insensitively, so `isoTldrLine` is in scope", () => {
    expect(scan({ content: 'function isoTldrLine(): string {\n  return "a | b";\n}\n' })).toHaveLength(1);
  });

  it("leaves a separator in a function that builds something else alone", () => {
    expect(scan({ content: 'function closingLines(): string {\n  return "a — b";\n}\n' })).toEqual([]);
  });

  it("reports an authored separator ONCE when both shapes see it", () => {
    const content = ['function deriveTldr(): object {\n  return { tldr: "a — b" };\n}\n'].join("");
    expect(scan({ content })).toHaveLength(1);
  });
});

describe("scope", () => {
  it("scans a tracked source file", () => {
    expect(isScannablePath({ path: "src/outbound/artifact/headline.ts" })).toBe(true);
  });

  it("skips the test tree, where a test has to be able to write the shape it refuses", () => {
    expect(isScannablePath({ path: "src/__tests__/unit/devLint/authoredSeparator.test.ts" })).toBe(false);
  });

  it("skips its own scanner, which declares the separator characters", () => {
    expect(isScannablePath({ path: "src/devLint/authoredSeparator.ts" })).toBe(false);
  });
});
