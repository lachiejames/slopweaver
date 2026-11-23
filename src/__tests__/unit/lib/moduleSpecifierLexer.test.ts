/**
 * `lexSpecifierTokens`: the token stream a module-specifier reader reads, and the brace and paren judgements that
 * decide whether a `/` opens a regular expression.
 */

import { describe, expect, it } from "vitest";
import { lexSpecifierTokens } from "#lib/moduleSpecifierLexer.js";

/** The tokens of `text` as `[kind, text]` pairs, or the reason the lexer gave up. */
function pairs({ fileName = "x.ts", text }: { fileName?: string; text: string }): unknown {
  const lexing = lexSpecifierTokens({ fileName, text });
  if (lexing.kind === "uncertain") {
    return lexing;
  }
  return lexing.tokens.kinds.map((kind, index) => [kind, lexing.tokens.texts[index]]);
}

describe("lexSpecifierTokens", () => {
  it("keeps a string's raw contents, skips comments, and splits punctuators by maximal munch", () => {
    expect(pairs({ text: 'a ??= b?.c /* x */ >>>= "./s\\"q" // y\n' })).toEqual([
      ["identifier", "a"],
      ["punctuator", "??="],
      ["identifier", "b"],
      ["punctuator", "?."],
      ["identifier", "c"],
      ["punctuator", ">>>="],
      ["string", './s\\"q'],
    ]);
  });

  it("reads `?.` before a digit as a conditional, not optional chaining", () => {
    expect(pairs({ text: "a?.5:1" })).toEqual([
      ["identifier", "a"],
      ["punctuator", "?"],
      ["number", ".5"],
      ["punctuator", ":"],
      ["number", "1"],
    ]);
  });

  it("resumes a template after each substitution, nested ones too", () => {
    expect(pairs({ text: "`a${`b${c}d`}e`" })).toEqual([
      ["template-head", ""],
      ["template-head", ""],
      ["identifier", "c"],
      ["template-tail", "d"],
      ["template-tail", "e"],
    ]);
  });

  it("reads a slash as a regex where an operand begins and as division where one ended", () => {
    const regex = pairs({ text: "if (x) /a/.test(s);" });
    const division = pairs({ text: "f(x) / a / b;" });
    expect([regex, division]).toEqual([
      [
        ["identifier", "if"],
        ["punctuator", "("],
        ["identifier", "x"],
        ["punctuator", ")"],
        ["regex", "/a/"],
        ["punctuator", "."],
        ["identifier", "test"],
        ["punctuator", "("],
        ["identifier", "s"],
        ["punctuator", ")"],
        ["punctuator", ";"],
      ],
      [
        ["identifier", "f"],
        ["punctuator", "("],
        ["identifier", "x"],
        ["punctuator", ")"],
        ["punctuator", "/"],
        ["identifier", "a"],
        ["punctuator", "/"],
        ["identifier", "b"],
        ["punctuator", ";"],
      ],
    ]);
  });

  it("reads a slash after a non-null `!` as division and after a logical `!` as a regex", () => {
    const nonNull = pairs({ text: "a! / b" });
    const logical = pairs({ text: "= !/x/" });
    expect([nonNull, logical]).toEqual([
      [
        ["identifier", "a"],
        ["punctuator", "!"],
        ["punctuator", "/"],
        ["identifier", "b"],
      ],
      [
        ["punctuator", "="],
        ["punctuator", "!"],
        ["regex", "/x/"],
      ],
    ]);
  });

  it("lexes a private name apart from an identifier", () => {
    expect(pairs({ text: "this.#require" })).toEqual([
      ["identifier", "this"],
      ["punctuator", "."],
      ["private-name", "require"],
    ]);
  });

  it("marks a require or import whose innermost brace is a type or object body, and never one in a block", () => {
    const text =
      'interface I { require("a"); }\nfunction f() { require("b"); import("e"); }\nrequire("c");\ninterface J { import("d"); }';
    const lexing = lexSpecifierTokens({ fileName: "x.ts", text });
    expect(lexing.kind).toBe("tokens");
    const { tokens } = lexing as Extract<typeof lexing, { kind: "tokens" }>;
    const marked = [...tokens.bodyCalls].map((index) => tokens.texts[index + 2]);
    expect(marked).toEqual(["a", "d"]);
  });

  it("gives up on a `<` that may open JSX only in a file that parses JSX", () => {
    const text = "const v = <div />;";
    expect([pairs({ fileName: "x.tsx", text }), pairs({ fileName: "x.js", text })]).toEqual([
      { kind: "uncertain", why: "possible JSX" },
      { kind: "uncertain", why: "possible JSX" },
    ]);
    expect(pairs({ fileName: "x.tsx", text: "const b = a < c;" })).toEqual([
      ["identifier", "const"],
      ["identifier", "b"],
      ["punctuator", "="],
      ["identifier", "a"],
      ["punctuator", "<"],
      ["identifier", "c"],
      ["punctuator", ";"],
    ]);
  });
});
