import { describe, expect, it } from "vitest";
import { declaredDeletedSymbols } from "../../../../devLint/testAssertionCounts.js";

describe("declaredDeletedSymbols", () => {
  it("reads every symbol a line-comment marker names, across markers", () => {
    const content = [
      "// deleted-with-code: parseProgressArgs, slackProgressCommand",
      "const x = 1;",
      "// deleted-with-code: renderProgressBar",
    ].join("\n");
    expect(declaredDeletedSymbols({ content })).toEqual([
      "parseProgressArgs",
      "slackProgressCommand",
      "renderProgressBar",
    ]);
  });

  it("reads a marker inside a JSDoc block, where a file overview actually explains the deletion", () => {
    const content = ["/**", " * why the suite went.", " * deleted-with-code: parseProgressArgs", " */"].join("\n");
    expect(declaredDeletedSymbols({ content })).toEqual(["parseProgressArgs"]);
  });

  it("claims NOTHING for the phrase inside a fixture string, which is how this gate's own tests carry it", () => {
    const content = `const fixture = "deleted-with-code: parseProgressArgs";`;
    expect(declaredDeletedSymbols({ content })).toEqual([]);
  });

  it("claims nothing for a marker trailing real code on the same line", () => {
    const content = `const x = 1; // deleted-with-code: parseProgressArgs`;
    expect(declaredDeletedSymbols({ content })).toEqual([]);
  });

  it("reads an empty list from a marker that names nobody, so a bare marker exempts nothing", () => {
    expect(declaredDeletedSymbols({ content: "// deleted-with-code:" })).toEqual([]);
  });

  it("finds no marker in a file that carries none", () => {
    expect(declaredDeletedSymbols({ content: "expect(1).toBe(1);" })).toEqual([]);
  });
});
