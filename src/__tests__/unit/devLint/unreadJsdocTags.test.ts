import { describe, expect, it } from "vitest";

import { unreadJsdocTags } from "../../../devLint/unreadJsdocTags.js";

/** The detail every unread tag carries, for the tag it names. */
function detailFor({ tag }: { tag: string }): string {
  return `@${tag} opens this line, but the compiler read no tag here; an inline run of three or more backticks earlier in the block swallows every tag after it, so reword that run`;
}

/** The detail an unread tag in a block attached to no node carries, for the tag it names. */
function unattachedDetailFor({ tag }: { tag: string }): string {
  return `@${tag} opens this line, but its block documents no declaration, so the compiler read no tag in it; move the block onto the declaration it documents, or make it a plain comment`;
}

const FENCE = "```";

describe("unreadJsdocTags", () => {
  it("refuses a JavaScript @import an inline backtick run swallowed, which the import seam would read as no edge", () => {
    const content = [
      "/**",
      ` * Example ${FENCE}ts`,
      ' * @import { Node } from "typescript"',
      " */",
      "export function f() {}",
      "",
    ].join("\n");

    expect(unreadJsdocTags({ content, path: "src/probe.js" })).toEqual([
      { detail: detailFor({ tag: "import" }), kind: "unread-tag", line: 3, path: "src/probe.js" },
    ]);
  });

  it("refuses a swallowed @import in a block shadowed by a second stacked block, which the import seam still reads", () => {
    const content = [
      "/**",
      ` * Example ${FENCE}ts`,
      ' * @import { Node } from "typescript"',
      " */",
      "/** Documents f. */",
      "export function f() {}",
      "",
    ].join("\n");

    expect(unreadJsdocTags({ content, path: "src/probe.js" })).toEqual([
      { detail: detailFor({ tag: "import" }), kind: "unread-tag", line: 3, path: "src/probe.js" },
    ]);
  });

  it("reads lines the way the compiler does, so a CR-only file's swallowed @import is still refused", () => {
    const content = [
      "/**",
      ` * Example ${FENCE}ts`,
      ' * @import { Node } from "typescript"',
      " */",
      "export function f() {}",
      "",
    ].join("\r");

    expect(unreadJsdocTags({ content, path: "src/probe.js" })).toEqual([
      { detail: detailFor({ tag: "import" }), kind: "unread-tag", line: 3, path: "src/probe.js" },
    ]);
  });

  it.each([
    { name: "U+2028", separator: String.fromCodePoint(0x2028) },
    { name: "U+2029", separator: String.fromCodePoint(0x2029) },
  ])(
    "reads $name as the line break the compiler counts it as, so a swallowed @import after one is still refused",
    ({ separator }) => {
      const content = [
        "/**",
        ` * Example ${FENCE}ts${separator} * @import { Node } from "typescript"`,
        " */",
        "export function f() {}",
        "",
      ].join("\n");

      expect(unreadJsdocTags({ content, path: "src/probe.js" })).toEqual([
        { detail: detailFor({ tag: "import" }), kind: "unread-tag", line: 3, path: "src/probe.js" },
      ]);
    },
  );

  it("refuses a swallowed tag in a block at the end of a file, which 7.1 attaches to the end-of-file token", () => {
    const content = [
      "export const x = 1;",
      "/**",
      ` * Example ${FENCE}ts`,
      ' * @import { Node } from "typescript"',
      " */",
      "",
    ].join("\n");

    expect(unreadJsdocTags({ content, path: "src/probe.js" })).toEqual([
      { detail: detailFor({ tag: "import" }), kind: "unread-tag", line: 4, path: "src/probe.js" },
    ]);
  });

  it("refuses a tag in a block left before a closing brace, attached to nothing", () => {
    const content = ["export function f() {", "  f();", '  /** @import { Node } from "typescript" */', "}", ""].join(
      "\n",
    );

    expect(unreadJsdocTags({ content, path: "src/probe.js" })).toEqual([
      { detail: unattachedDetailFor({ tag: "import" }), kind: "unread-tag", line: 3, path: "src/probe.js" },
    ]);
  });

  it.each([
    { name: "a third star", opener: "/***" },
    { name: "a star gutter after the opener", opener: "/** *" },
  ])("refuses a tag on a block's opening line behind $name", ({ opener }) => {
    const content = ["export function f() {", `  ${opener} @import { Node } from "typescript" */`, "}", ""].join("\n");

    expect(unreadJsdocTags({ content, path: "src/probe.js" })).toEqual([
      { detail: unattachedDetailFor({ tag: "import" }), kind: "unread-tag", line: 2, path: "src/probe.js" },
    ]);
  });

  it.each([
    { name: "at the end of the file", tail: [] },
    { name: "before the next statement", tail: ["export const y = 2;"] },
  ])("refuses a tag in a block written after code on its own line, $name, which is trailing trivia", ({ tail }) => {
    const content = ["export const x = 1; /**", ' * @import { Node } from "typescript"', " */", ...tail, ""].join("\n");

    expect(unreadJsdocTags({ content, path: "src/probe.js" })).toEqual([
      { detail: unattachedDetailFor({ tag: "import" }), kind: "unread-tag", line: 2, path: "src/probe.js" },
    ]);
  });

  it.each([
    {
      name: "after a statement with a trailing line comment",
      lines: ["const HATCH = 1; // registry-owned", ""],
    },
    {
      name: "after a detached file-overview block",
      lines: ["/**", " * Overview.", " */", ""],
    },
  ])("reads a block $name as the parsed block it is", ({ lines }) => {
    const content = [
      ...lines,
      "/**",
      " * Whether a tool call is a sub-agent dispatch.",
      " *",
      " * @param toolName the payload's tool name",
      " * @returns whether it is",
      " */",
      "export function isSubagentTool({ toolName }: { toolName: string }): boolean {",
      "  return toolName.length > 0;",
      "}",
      "",
    ].join("\n");

    expect(unreadJsdocTags({ content, path: "src/probe.ts" })).toEqual([]);
  });

  it("never reads a /** inside a string, a template or a line comment as a block", () => {
    const content = [
      'export const a = "/**\\n * @param x\\n */";',
      "export const b = `",
      "/**",
      " * @returns y",
      " */`;",
      "// /** @import { Node } from 'typescript' */",
      "",
    ].join("\n");

    expect(unreadJsdocTags({ content, path: "src/probe.js" })).toEqual([]);
  });

  it.each([
    { name: "a form feed", blank: String.fromCodePoint(0x0c) },
    { name: "a no-break space", blank: String.fromCodePoint(0xa0) },
  ])("reads $name before the tag as the blank the compiler skips, both ways", ({ blank }) => {
    const swallowed = [
      "/**",
      ` * Example ${FENCE}ts`,
      ` *${blank}@import { Node } from "typescript"`,
      " */",
      "export function f() {}",
      "",
    ];
    const read = [
      "/**",
      " * Example `ts`",
      ` *${blank}@import { Node } from "typescript"`,
      " */",
      "export function f() {}",
      "",
    ];

    expect(unreadJsdocTags({ content: swallowed.join("\n"), path: "src/probe.js" })).toEqual([
      { detail: detailFor({ tag: "import" }), kind: "unread-tag", line: 3, path: "src/probe.js" },
    ]);
    expect(unreadJsdocTags({ content: read.join("\n"), path: "src/probe.js" })).toEqual([]);
  });

  it.each([{ tag: "ñame" }, { tag: "$scope" }, { tag: "_private" }])(
    "reads @$tag as the identifier-named tag the compiler reads, both ways",
    ({ tag }) => {
      const swallowed = ["/**", ` * Example ${FENCE}ts`, ` * @${tag} the value`, " */", "export const v = 1;", ""];
      const read = ["/**", " * Example `ts`", ` * @${tag} the value`, " */", "export const v = 1;", ""];

      expect(unreadJsdocTags({ content: swallowed.join("\n"), path: "src/probe.ts" })).toEqual([
        { detail: detailFor({ tag }), kind: "unread-tag", line: 3, path: "src/probe.ts" },
      ]);
      expect(unreadJsdocTags({ content: read.join("\n"), path: "src/probe.ts" })).toEqual([]);
    },
  );

  it("reads a tag behind a gutter of two stars as a tag line, so a swallowed one is still refused", () => {
    const content = [
      "/**",
      ` * Example ${FENCE}ts`,
      " ** @returns the value",
      " */",
      "function f(): number {",
      "  return 1;",
      "}",
      "",
    ].join("\n");

    expect(unreadJsdocTags({ content, path: "src/probe.ts" })).toEqual([
      { detail: detailFor({ tag: "returns" }), kind: "unread-tag", line: 3, path: "src/probe.ts" },
    ]);
  });

  it("names every swallowed tag line in a TypeScript block, in source order", () => {
    const content = [
      "/**",
      ` * Closes the fence at a ${FENCE}text block.`,
      " *",
      " * @param value the text to fence",
      " * @returns the fenced text",
      " */",
      "export function g({ value }: { value: string }): string {",
      "  return value;",
      "}",
      "",
    ].join("\n");

    expect(unreadJsdocTags({ content, path: "src/g.ts" })).toEqual([
      { detail: detailFor({ tag: "param" }), kind: "unread-tag", line: 4, path: "src/g.ts" },
      { detail: detailFor({ tag: "returns" }), kind: "unread-tag", line: 5, path: "src/g.ts" },
    ]);
  });

  it("finds nothing in the same block once the run is reworded", () => {
    const content = [
      "/**",
      " * Closes the fence at a fenced `text` block.",
      " *",
      " * @param value the text to fence",
      " * @returns the fenced text",
      " */",
      "export function g({ value }: { value: string }): string {",
      "  return value;",
      "}",
      "",
    ].join("\n");

    expect(unreadJsdocTags({ content, path: "src/g.ts" })).toEqual([]);
  });

  it("reads a tag nested under another, such as a typedef's properties, as read", () => {
    const content = [
      "/**",
      " * @typedef {Object} Shape",
      " * @property {string} name the shape's name",
      " * @property {number} sides how many sides it has",
      " */",
      "",
      "/** @type {Shape} */",
      'export const square = { name: "square", sides: 4 };',
      "",
    ].join("\n");

    expect(unreadJsdocTags({ content, path: "src/shape.js" })).toEqual([]);
  });

  it("treats an @word part way through a line as prose, never as a tag", () => {
    const content = [
      "/**",
      " * Mail a@example.com, or tag `@me` in the thread.",
      " *",
      " * @returns nothing worth naming",
      " */",
      "export function h(): number {",
      "  return 1;",
      "}",
      "",
    ].join("\n");

    expect(unreadJsdocTags({ content, path: "src/h.ts" })).toEqual([]);
  });
});
