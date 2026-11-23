/*
 * The lexer on its own: which source becomes a tag, which stays text, and that a code fence is never scanned.
 * Every fixture is synthetic.
 */
import { describe, expect, it } from "vitest";

import { lex } from "../../../../corpus/notion/markdownLexer.js";

describe("lex", () => {
  it("returns nothing for an empty body", () => {
    expect(lex({ markdown: "" })).toEqual([]);
  });

  it("splits a container into its open tag, its text and its close tag", () => {
    expect(lex({ markdown: '<callout icon="x">body</callout>' })).toEqual([
      { attrs: { icon: "x" }, tag: "callout", type: "open" },
      { text: "body", type: "text" },
      { attrs: {}, tag: "callout", type: "close" },
    ]);
  });

  it("reads a self-closing tag and the two tags Notion writes unclosed as void", () => {
    expect(lex({ markdown: '<mention-user url="u"/><br><col>' })).toEqual([
      { attrs: { url: "u" }, tag: "mention-user", type: "void" },
      { attrs: {}, tag: "br", type: "void" },
      { attrs: {}, tag: "col", type: "void" },
    ]);
  });

  it("keeps a fenced code block whole and never scans it for tags", () => {
    expect(lex({ markdown: "```ts\nconst a = <b>c</b>;\n```" })).toEqual([
      { kind: "code", language: "ts", text: "const a = <b>c</b>;" },
    ]);
  });

  it("leaves a bare angle bracket in prose as text", () => {
    expect(lex({ markdown: "latency < 200ms and p99 > 1s" })).toEqual([
      { text: "latency < 200ms and p99 > 1s", type: "text" },
    ]);
  });
});
