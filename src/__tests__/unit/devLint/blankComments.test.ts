/* `blankComments` — comments out by the compiler's ranges, code and line structure kept exactly. */
import { describe, expect, it } from "vitest";
import { blankComments } from "../../../devLint/blankComments.js";

describe("blankComments", () => {
  it("blanks a line comment, a block comment and a doc comment, keeping every newline and the length", () => {
    const content = ["// a", "/** b", " * c */", "const x = 1; // d", "/* e */ const y = 2;"].join("\n");

    const blanked = blankComments({ content, path: "src/a.ts" });

    expect(blanked.length).toBe(content.length);
    expect(blanked.split("\n").map((line) => line.trim())).toEqual(["", "", "", "const x = 1;", "const y = 2;"]);
  });

  it("blanks a comment no node owns — the body of an empty object, an empty call and an empty file's tail", () => {
    const content = [
      "export const x = { /* SLOPWEAVER_ALLOW_GHOST */ };",
      "f(/* SLOPWEAVER_ALLOW_GHOST */);",
      "// SLOPWEAVER_ALLOW_GHOST",
    ].join("\n");

    expect(
      blankComments({ content, path: "src/a.ts" })
        .split("\n")
        .map((line) => line.replace(/ +/g, " ")),
    ).toEqual(["export const x = { };", "f( );", " "]);
  });

  it("keeps a generator method and a string that only looks like a comment", () => {
    const content = ["const o = {", '  *values() { return "/* not a comment */"; }', "};"].join("\n");

    expect(blankComments({ content, path: "src/a.ts" })).toBe(content);
  });

  it("keeps the text unchanged when there is no comment at all", () => {
    expect(blankComments({ content: "", path: "src/a.ts" })).toBe("");
    expect(blankComments({ content: "export const a = 1;\n", path: "src/a.ts" })).toBe("export const a = 1;\n");
  });

  it("counts positions in UTF-16 units, so a comment after an astral character is blanked exactly", () => {
    const content = 'const s = "😀"; // gone';

    expect(blankComments({ content, path: "src/a.ts" }).trimEnd()).toBe('const s = "😀";');
  });
});
