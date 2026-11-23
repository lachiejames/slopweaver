/**
 * The proto lexer and cursor: comments stripped without cutting a URL inside a string, escapes decoded,
 * an unclosed construct refused, and an option's name and value read to exactly where the grammar ends them.
 */
import { describe, expect, it } from "vitest";

import { GoogleSecopsProtoSyntaxErrors } from "../../../../atlas/googleSecops/errors.js";
import {
  braceDelta,
  describeProtoToken,
  lexProto,
  ProtoCursor,
  type ProtoToken,
} from "../../../../atlas/googleSecops/protoLex.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

/**
 * A cursor over lexed text.
 *
 * @param text proto source
 * @returns a cursor on its first token
 */
function cursorOver({ text }: { text: string }): ProtoCursor {
  return new ProtoCursor({ tokens: unwrap(lexProto({ text })) });
}

describe("lexProto", () => {
  it("keeps a // inside a string and drops both comment forms around it", () => {
    const text = '// head\noption x = "https://a/b"; /* tail { } */ rpc';
    expect(unwrap(lexProto({ text }))).toStrictEqual([
      { kind: "ident", value: "option" },
      { kind: "ident", value: "x" },
      { kind: "punct", value: "=" },
      { kind: "string", value: "https://a/b" },
      { kind: "punct", value: ";" },
      { kind: "ident", value: "rpc" },
    ]);
  });

  it("decodes a backslash escape and reads a dotted name and a number as one identifier each", () => {
    const text = String.raw`google.api.http 42 'it\'s'`;
    expect(unwrap(lexProto({ text })).map((token) => token.value)).toStrictEqual(["google.api.http", "42", "it's"]);
  });

  it("refuses a string the line ends inside, naming where it opened", () => {
    expect(unwrapErr(lexProto({ text: 'a = "open\n";' }))).toStrictEqual(
      GoogleSecopsProtoSyntaxErrors.unterminated({ construct: "string", offset: 4 }),
    );
  });

  it("refuses a block comment the file never closes", () => {
    const error = unwrapErr(lexProto({ text: "a /* never" }));
    expect(error.message).toBe("unterminated block comment starting at offset 2");
  });

  it("answers no tokens for whitespace and comments alone", () => {
    expect(unwrap(lexProto({ text: "  // only\n/* a comment */\n" }))).toStrictEqual([]);
  });

  it("reads /*/ as a comment's opening only, so what follows stays commented out up to its */", () => {
    expect(unwrap(lexProto({ text: "/*/ service Hidden { } */" }))).toStrictEqual([]);
  });

  it("runs a // comment on the last line to the end of the file, with no newline to close it", () => {
    expect(unwrap(lexProto({ text: "a // service Hidden { }" }))).toStrictEqual([{ kind: "ident", value: "a" }]);
  });

  it("separates tokens on every whitespace protoc does — tab, carriage return, form feed and vertical tab", () => {
    const separated = ["\t", "\r", "\f", "\v"].map((space) =>
      unwrap(lexProto({ text: `service${space}Hidden` })).map((token) => token.value),
    );
    expect(separated).toStrictEqual([
      ["service", "Hidden"],
      ["service", "Hidden"],
      ["service", "Hidden"],
      ["service", "Hidden"],
    ]);
  });
});

describe("ProtoCursor", () => {
  it("reads an option name of identifiers, dots and parentheses up to and including its =", () => {
    const cursor = cursorOver({ text: "(google.api.http).get = x" });
    expect(unwrap(cursor.optionName())).toBe("(google.api.http).get");
    expect(cursor.peek()).toStrictEqual({ kind: "ident", value: "x" });
  });

  it("refuses an option name that runs into a ;, a brace, a string or the end before any =", () => {
    const found = ["(a) ; rpc B = 1", "(a) { b = 1", '(a) "s" = 1', "(a)"].map(
      (text) => unwrapErr(cursorOver({ text }).optionName()).message,
    );
    expect(found).toStrictEqual([
      "expected an option name and '=', found ';'",
      "expected an option name and '=', found '{'",
      `expected an option name and '=', found a string "s"`,
      "expected an option name and '=', found the end of the file",
    ]);
  });

  it("refuses two name segments side by side, which are two statements run together", () => {
    const found = ["deprecated\noption (google.api.http).additional_bindings = {", "(a)(b) = 1", "(a) b = 1"].map(
      (text) => unwrapErr(cursorOver({ text }).optionName()).message,
    );
    expect(found).toStrictEqual([
      "expected an option name and '=', found 'option'",
      "expected an option name and '=', found '('",
      "expected an option name and '=', found 'b'",
    ]);
  });

  it("refuses an option name whose parentheses do not pair, rather than reading it as some other option", () => {
    const found = ["(a.b = 1", "a) = 1", "(a)) = 1", "((a)) = 1", "() = 1"].map(
      (text) => unwrapErr(cursorOver({ text }).optionName()).message,
    );
    expect(found).toStrictEqual([
      "expected a well-formed option name, found '(a.b'",
      "expected a well-formed option name, found 'a)'",
      "expected a well-formed option name, found '(a))'",
      "expected a well-formed option name, found '((a))'",
      "expected a well-formed option name, found '()'",
    ]);
  });

  it("reads every spelling protobuf gives an option name", () => {
    const spellings = ["deprecated", "(google.api.http)", "(.google.api.http).get", "(a).b.(c.d).e", "(a).(.b.c)"];
    const names = spellings.map((name) => unwrap(cursorOver({ text: `${name} = 1` }).optionName()));
    expect(names).toStrictEqual([
      "deprecated",
      "(google.api.http)",
      "(.google.api.http).get",
      "(a).b.(c.d).e",
      "(a).(.b.c)",
    ]);
  });

  it("reads a declaration's name only when it holds no dot", () => {
    expect(unwrap(cursorOver({ text: "RuleService" }).simpleName())).toBe("RuleService");
    expect(unwrapErr(cursorOver({ text: "v1.RuleService" }).simpleName()).message).toBe(
      "expected a name, found 'v1.RuleService'",
    );
  });

  it("skips exactly one option value and its ;, whichever of the four shapes it takes", () => {
    // A quoted "{" is a string value, never the opening of a braced one that would run past its ;.
    const values = ["{ a: { b: 1 } }", '"a," "b"', '"{"', "parent", "-5"];
    const next = values.map((value) => {
      const cursor = cursorOver({ text: `${value}; rpc` });
      expect(cursor.skipOptionValue().isOk()).toBe(true);
      return cursor.peek();
    });
    expect(next).toStrictEqual(values.map(() => ({ kind: "ident", value: "rpc" })));
  });

  it("refuses a value with no ; after it rather than folding the next option into it", () => {
    const cursor = cursorOver({ text: '"name"\noption (google.api.http).additional_bindings = { delete: "/v1/x" };' });
    expect(unwrapErr(cursor.skipOptionValue()).message).toBe("expected ';', found 'option'");
  });

  it("refuses a parenthesis or a declaration keyword inside a braced value, which is a statement folded in", () => {
    const found = ["{ a: 1 option (b) = {} }", "{ a: (b) }", "{ rpc: 1 }", "{ service: 1 }"].map(
      (text) => unwrapErr(cursorOver({ text: `${text};` }).skipOptionValue()).message,
    );
    expect(found).toStrictEqual([
      "expected one option value, found 'option'",
      "expected one option value, found '('",
      "expected one option value, found 'rpc'",
      "expected one option value, found 'service'",
    ]);
  });

  it("refuses a value the file ends inside, or one that is not a value at all", () => {
    expect(unwrapErr(cursorOver({ text: "{ a: 1" }).skipOptionValue()).message).toBe(
      "expected one option value, found the end of the file",
    );
    expect(unwrapErr(cursorOver({ text: "; rpc" }).skipOptionValue()).message).toBe(
      "expected one option value, found ';'",
    );
  });

  it("names what it found when a required token is missing", () => {
    const cursor = cursorOver({ text: '"s"' });
    expect(unwrapErr(cursor.expect({ value: "{" }))).toStrictEqual(
      GoogleSecopsProtoSyntaxErrors.unexpectedToken({ expected: "'{'", found: 'a string "s"' }),
    );
    expect(unwrapErr(cursor.ident()).message).toBe("expected an identifier, found the end of the file");
  });

  it("never reads a string as an identifier, so a quoted key or type is refused", () => {
    expect(unwrapErr(cursorOver({ text: '"get"' }).ident()).message).toBe(
      'expected an identifier, found a string "get"',
    );
  });

  it("never matches a string token as punctuation or a keyword", () => {
    expect(cursorOver({ text: '"{"' }).is({ value: "{" })).toBe(false);
    expect(cursorOver({ text: "{" }).is({ value: "{" })).toBe(true);
  });
});

describe("braceDelta and describeProtoToken", () => {
  it("moves depth only on a brace", () => {
    const tokens: readonly ProtoToken[] = [
      { kind: "punct", value: "{" },
      { kind: "punct", value: "}" },
      { kind: "punct", value: ";" },
      { kind: "string", value: "{" },
    ];
    expect(tokens.map((token) => braceDelta({ token }))).toStrictEqual([1, -1, 0, 0]);
  });

  it("renders each token kind and the end of the file", () => {
    expect(describeProtoToken({ token: null })).toBe("the end of the file");
    expect(describeProtoToken({ token: { kind: "ident", value: "rpc" } })).toBe("'rpc'");
    expect(describeProtoToken({ token: { kind: "string", value: "x" } })).toBe('a string "x"');
  });
});
