/**
 * The lexer and token cursor under `protoParse.ts`.
 *
 * Comments (`//` and `/* *\/`) are stripped by a string-aware lexer, because googleapis protos carry
 * `https://` URLs inside option strings and a naive strip would cut them in half. A string or block comment
 * the file never closes is a typed refusal, never a token swallowing the rest of the file.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type GoogleSecopsProtoSyntaxError, GoogleSecopsProtoSyntaxErrors } from "./errors.js";

/** One lexed token. Strings carry their decoded content; everything else its source text. */
export interface ProtoToken {
  readonly kind: "ident" | "string" | "punct";
  readonly value: string;
}

/** What one lexing step consumed: the token it produced, `null` for whitespace or a comment, and where it ended. */
interface LexStep {
  readonly token: ProtoToken | null;
  readonly next: number;
}

/** A character of an identifier, keyword, dotted name or number — the lexer reads all four as one token kind. */
const IDENT_CHAR = /[A-Za-z0-9_.]/u;
const WHITESPACE = /\s/u;
/** A service's or rpc's own name: an identifier, no dot. */
const SIMPLE_NAME = /^[A-Za-z_]\w*$/u;
/**
 * A whole option name, as protobuf spells one: a name or a parenthesised extension, then any number of
 * `.field` or `.(extension)` parts — `deprecated`, `(google.api.http)`, `(google.api.http).get`.
 */
const OPTION_NAME = /^(?:\w+(?:\.\w+)*|\(\.?\w+(?:\.\w+)*\))(?:\.\w+|\.\(\.?\w+(?:\.\w+)*\))*$/u;
/** The keywords that open a proto statement and never a text-format field, so never sit in an option value. */
const AGGREGATE_FOREIGN = new Set(["option", "rpc", "service"]);
/** The punctuation an option name may hold besides identifiers: `(google.api.http).get`. */
const OPTION_NAME_PUNCT: ReadonlySet<string> = new Set(["(", ")", "."]);
/** The string escapes that decode to the escaped character itself; every other escape is refused. */
const SELF_ESCAPES: ReadonlySet<string> = new Set(["\\", '"', "'"]);

/**
 * The offset after a comment opening at `at`.
 *
 * @param text the whole file
 * @param at the offset to look at
 * @returns the offset just past the comment, `null` when no comment opens there
 */
function skipComment({ text, at }: { text: string; at: number }): Result<number | null, GoogleSecopsProtoSyntaxError> {
  if (text.startsWith("//", at)) {
    const end = text.indexOf("\n", at);
    return ok(end === -1 ? text.length : end + 1);
  }
  if (!text.startsWith("/*", at)) {
    return ok(null);
  }
  const end = text.indexOf("*/", at + 2);
  if (end === -1) {
    return err(GoogleSecopsProtoSyntaxErrors.unterminated({ construct: "block comment", offset: at }));
  }
  return ok(end + 2);
}

/**
 * Lex one quoted string starting at `start`, decoding `\\`, `\"` and `\'` and refusing every other escape.
 *
 * @param text the whole file
 * @param start the offset of the opening quote
 * @param quote which quote opened it
 * @returns the string token and the offset after the closing quote
 */
function lexString({
  text,
  start,
  quote,
}: {
  text: string;
  start: number;
  quote: string;
}): Result<LexStep, GoogleSecopsProtoSyntaxError> {
  let value = "";
  let at = start + 1;
  while (at < text.length && text.charAt(at) !== "\n") {
    const char = text.charAt(at);
    if (char === quote) {
      return ok({ next: at + 1, token: { kind: "string", value } });
    }
    if (char !== "\\") {
      value += char;
      at += 1;
      continue;
    }
    // Only the escapes that stand for themselves: protobuf's hex, octal, unicode and control escapes would
    // each decode to a different character than dropping the backslash gives, so a path would be misread.
    const escapedChar = text.charAt(at + 1);
    if (!SELF_ESCAPES.has(escapedChar)) {
      return err(
        GoogleSecopsProtoSyntaxErrors.unexpectedToken({
          expected: String.raw`one of the escapes \\ \" \' in a string`,
          found: `\\${escapedChar}`,
        }),
      );
    }
    value += escapedChar;
    at += 2;
  }
  return err(GoogleSecopsProtoSyntaxErrors.unterminated({ construct: "string", offset: start }));
}

/**
 * Lex one identifier, keyword, dotted name or number starting at `at`.
 *
 * @param text the whole file
 * @param at the offset of its first character
 * @returns the identifier token and the offset after it
 */
function lexIdent({ text, at }: { text: string; at: number }): LexStep {
  let end = at + 1;
  while (end < text.length && IDENT_CHAR.test(text.charAt(end))) {
    end += 1;
  }
  return { next: end, token: { kind: "ident", value: text.slice(at, end) } };
}

/**
 * Lex whatever starts at `at`: whitespace, a comment, a string, an identifier or one punctuation character.
 *
 * @param text the whole file
 * @param at the offset to lex from
 * @returns what was consumed, or why the text could not be lexed
 */
function lexOne({ text, at }: { text: string; at: number }): Result<LexStep, GoogleSecopsProtoSyntaxError> {
  const char = text.charAt(at);
  if (WHITESPACE.test(char)) {
    return ok({ next: at + 1, token: null });
  }
  const comment = skipComment({ at, text });
  if (comment.isErr()) {
    return err(comment.error);
  }
  if (comment.value !== null) {
    return ok({ next: comment.value, token: null });
  }
  if (char === '"' || char === "'") {
    return lexString({ quote: char, start: at, text });
  }
  if (IDENT_CHAR.test(char)) {
    return ok(lexIdent({ at, text }));
  }
  return ok({ next: at + 1, token: { kind: "punct", value: char } });
}

/**
 * Lex proto source into tokens, dropping whitespace and comments.
 *
 * @param text the whole file
 * @returns the tokens, or the first construct the file never closed
 */
export function lexProto({ text }: { text: string }): Result<readonly ProtoToken[], GoogleSecopsProtoSyntaxError> {
  const tokens: ProtoToken[] = [];
  let at = 0;
  while (at < text.length) {
    const step = lexOne({ at, text });
    if (step.isErr()) {
      return err(step.error);
    }
    if (step.value.token !== null) {
      tokens.push(step.value.token);
    }
    at = step.value.next;
  }
  return ok(tokens);
}

/**
 * A token rendered for an error message.
 *
 * @param token the token found, or `null` at the end of the file
 * @returns a short description
 */
export function describeProtoToken({ token }: { token: ProtoToken | null }): string {
  if (token === null) {
    return "the end of the file";
  }
  return token.kind === "string" ? `a string "${token.value}"` : `'${token.value}'`;
}

/**
 * How a token moves the brace depth.
 *
 * @param token the token just consumed
 * @returns 1 for `{`, -1 for `}`, 0 for anything else
 */
export function braceDelta({ token }: { token: ProtoToken }): number {
  if (token.kind !== "punct") {
    return 0;
  }
  if (token.value === "{") {
    return 1;
  }
  return token.value === "}" ? -1 : 0;
}

/**
 * The refusal for a token that is not part of one option value.
 *
 * @param token what was found, or `null` at the end of the file
 * @returns that refusal
 */
function unexpectedValue({ token }: { token: ProtoToken | null }): Result<never, GoogleSecopsProtoSyntaxError> {
  return err(
    GoogleSecopsProtoSyntaxErrors.unexpectedToken({
      expected: "one option value",
      found: describeProtoToken({ token }),
    }),
  );
}

/** A cursor over the token list with the handful of moves the grammar needs. */
export class ProtoCursor {
  private at = 0;
  private readonly tokens: readonly ProtoToken[];

  constructor({ tokens }: { tokens: readonly ProtoToken[] }) {
    this.tokens = tokens;
  }

  /**
   * The token under the cursor without consuming it.
   *
   * @returns the token, or `null` past the end
   */
  peek(): ProtoToken | null {
    const token = this.tokens[this.at];
    if (token === undefined) {
      return null;
    }
    return token;
  }

  /**
   * Consume one token.
   *
   * @returns the token, or `null` past the end
   */
  next(): ProtoToken | null {
    const token = this.peek();
    this.at += 1;
    return token;
  }

  /**
   * Whether the token under the cursor is exactly this punctuation or identifier.
   *
   * @param value the text to compare
   * @returns true when it matches
   */
  is({ value }: { value: string }): boolean {
    const token = this.peek();
    return token !== null && token.kind !== "string" && token.value === value;
  }

  /**
   * Consume a token that must be exactly `value`.
   *
   * @param value the punctuation or keyword required here
   * @returns ok, or what was found instead
   */
  expect({ value }: { value: string }): Result<void, GoogleSecopsProtoSyntaxError> {
    const matches = this.is({ value });
    const token = this.next();
    if (!matches) {
      return err(
        GoogleSecopsProtoSyntaxErrors.unexpectedToken({ expected: `'${value}'`, found: describeProtoToken({ token }) }),
      );
    }
    return ok(undefined);
  }

  /**
   * Consume an identifier.
   *
   * @returns its text, or what was found instead
   */
  ident(): Result<string, GoogleSecopsProtoSyntaxError> {
    const token = this.next();
    if (token?.kind !== "ident") {
      return err(
        GoogleSecopsProtoSyntaxErrors.unexpectedToken({
          expected: "an identifier",
          found: describeProtoToken({ token }),
        }),
      );
    }
    return ok(token.value);
  }

  /**
   * Consume a declaration's own name: one identifier with no dot. The lexer folds dots into a name, so a
   * dotted `service v1.RuleService` would otherwise move the package boundary every selector is built on.
   *
   * @returns the name, or what was found instead
   */
  simpleName(): Result<string, GoogleSecopsProtoSyntaxError> {
    const token = this.peek();
    if (token?.kind !== "ident" || !SIMPLE_NAME.test(token.value)) {
      this.next();
      return err(
        GoogleSecopsProtoSyntaxErrors.unexpectedToken({ expected: "a name", found: describeProtoToken({ token }) }),
      );
    }
    return this.ident();
  }

  /**
   * Read an option's name up to and including its `=`, the cursor just past `option`.
   *
   * The name is identifiers, dots and parentheses only. Reading "to the next `=`" instead would let an
   * option missing its `=` run on through the next declaration to find one, swallowing that declaration.
   *
   * @returns the name with its tokens joined, or what was found where the name had to end
   */
  optionName(): Result<string, GoogleSecopsProtoSyntaxError> {
    const parts: string[] = [];
    let previous: ProtoToken | null = null;
    while (!this.is({ value: "=" })) {
      const token = this.next();
      const namePart = token !== null && (token.kind === "ident" || OPTION_NAME_PUNCT.has(token.value));
      // A new name segment (`(`, or a name not continuing with `.`) may only open the name, follow `(`, or
      // follow a name ending in `.`. Two segments side by side are two statements run together: `option
      // deprecated` missing its `= true;` would otherwise fuse with the next `option (google.api.http)...`.
      const opensSegment =
        token !== null && (token.value === "(" || (token.kind === "ident" && !token.value.startsWith(".")));
      const segmentMayOpen =
        previous === null || previous.value === "(" || (previous.kind === "ident" && previous.value.endsWith("."));
      if (token === null || !namePart || (opensSegment && !segmentMayOpen)) {
        return err(
          GoogleSecopsProtoSyntaxErrors.unexpectedToken({
            expected: "an option name and '='",
            found: describeProtoToken({ token }),
          }),
        );
      }
      parts.push(token.value);
      previous = token;
    }
    this.next();
    const name = parts.join("");
    // The token rule above keeps two statements from fusing; this one keeps the parentheses whole, so an
    // unclosed `(google.api.http.additional_bindings` cannot pass for some unrelated option and be skipped.
    if (!OPTION_NAME.test(name)) {
      return err(
        GoogleSecopsProtoSyntaxErrors.unexpectedToken({ expected: "a well-formed option name", found: `'${name}'` }),
      );
    }
    return ok(name);
  }

  /**
   * Skip exactly one option value and the `;` that must end it: one braced aggregate, a run of adjacent
   * strings, or one identifier or number (a leading `-` allowed).
   *
   * A value bounded by its own shape, rather than "up to the next `;`", is what keeps a missing `;` from
   * folding the NEXT option — an `additional_bindings`, say — into this skipped one unseen.
   *
   * @returns ok, or the first token that is not part of one value and its `;`
   */
  skipOptionValue(): Result<void, GoogleSecopsProtoSyntaxError> {
    const first = this.next();
    if (first === null) {
      return unexpectedValue({ token: first });
    }
    const skipped = this.skipValueFrom({ first });
    if (skipped.isErr()) {
      return skipped;
    }
    return this.expect({ value: ";" });
  }

  /**
   * Skip the rest of one option value whose first token is already consumed.
   *
   * @param first the value's first token
   * @returns ok, or the first token that is not part of that value
   */
  private skipValueFrom({ first }: { first: ProtoToken }): Result<void, GoogleSecopsProtoSyntaxError> {
    if (first.kind === "punct" && first.value === "{") {
      return this.skipAggregateBody();
    }
    if (first.kind === "string") {
      while (this.peek()?.kind === "string") {
        this.next();
      }
      return ok(undefined);
    }
    const scalar = first.kind === "punct" && first.value === "-" ? this.next() : first;
    if (scalar?.kind !== "ident") {
      return unexpectedValue({ token: scalar });
    }
    return ok(undefined);
  }

  /**
   * Skip a braced aggregate value, the cursor just past its `{`, up to and including its closing `}`.
   *
   * @returns ok, or the token that ends the file inside it or cannot belong to it
   */
  private skipAggregateBody(): Result<void, GoogleSecopsProtoSyntaxError> {
    for (let depth = 1; depth > 0;) {
      const token = this.next();
      // A text-format aggregate holds no parentheses and no declaration, so either one means a statement
      // was folded into this value, which skipping the value would silently drop.
      if (token === null || token.value === "(" || (token.kind === "ident" && AGGREGATE_FOREIGN.has(token.value))) {
        return unexpectedValue({ token });
      }
      depth += braceDelta({ token });
    }
    return ok(undefined);
  }
}
