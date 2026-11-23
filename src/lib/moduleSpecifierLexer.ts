/**
 * A lexer for module-specifier reading that imports no TypeScript: one pass over a file's characters, so a reader of
 * the whole repository never parses (on TypeScript 7, a parse is a round trip to the Go server per file).
 *
 * It knows exactly what a specifier reader must not misread — comments, strings, template literals (a substitution's
 * brace kept on the brace stack, so a template nested in a substitution resumes in the right place) and regular
 * expressions — and where the tokens alone cannot settle a question it stops with the reason, so the caller asks the
 * syntax tree instead: a `/` whose role {@link ./moduleSpecifierLexState.ts} cannot settle, a `<` that may open JSX
 * in a file that parses JSX, an escaped identifier, a character TypeScript would not accept, an unterminated literal.
 */
import {
  braceOpened,
  giveUp,
  isAsciiIdStart,
  isDigit,
  isLineBreak,
  isSpace,
  type LexState,
  lexStateOf,
  opensControlHead,
  operandNext,
  push,
  type SpecifierTokenKind,
} from "./moduleSpecifierLexState.js";
import { punctuatorLength } from "./moduleSpecifierPunctuator.js";

/** A file's tokens as two parallel arrays; a string literal's text is its raw contents, quotes stripped. */
export interface SpecifierTokens {
  readonly kinds: readonly SpecifierTokenKind[];
  readonly texts: readonly string[];
  /** The index of each `require` or `import` whose innermost open brace is a class, interface, type or object body. */
  readonly bodyCalls: ReadonlySet<number>;
}

/** A file's tokens, or why tokens alone cannot be trusted to read it. */
export type SpecifierLexing =
  { readonly kind: "tokens"; readonly tokens: SpecifierTokens } | { readonly kind: "uncertain"; readonly why: string };

/** TypeScript's line terminators, as {@link isLineBreak} reads them one character at a time. */
const LINE_BREAK = /[\n\r\u2028\u2029]/u;
const ID_START = /[\p{ID_Start}$_]/u;
const ID_CONTINUE = /[\p{ID_Continue}$\u200C\u200D]/u;
/** A hex, binary, octal or decimal literal with separators, exponent and `n` suffix, as TypeScript scans one. */
const NUMERIC_LITERAL =
  /0[xX][\da-fA-F_]*n?|0[bB][01_]*n?|0[oO][0-7_]*n?|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?[\d_]*)?n?/uy;

/** Skip a `//` or `/*` comment at `pos`; false when none starts there. */
function skipComment({ state }: { state: LexState }): boolean {
  const { text } = state;
  const next = text.charCodeAt(state.pos + 1);
  if (next === 47) {
    state.pos += 2;
    while (state.pos < text.length && !isLineBreak({ code: text.charCodeAt(state.pos) })) {
      state.pos += 1;
    }
    return true;
  }
  if (next !== 42) {
    return false;
  }
  const close = text.indexOf("*/", state.pos + 2);
  if (close === -1) {
    giveUp({ state, why: "unterminated comment" });
  } else {
    if (LINE_BREAK.test(text.slice(state.pos + 2, close))) {
      state.lineBreakBefore = true;
    }
    state.pos = close + 2;
  }
  return true;
}

/** A quoted string at `pos`, pushed with its raw contents. */
function scanString({ state, quote }: { state: LexState; quote: number }): void {
  const { text } = state;
  const start = state.pos + 1;
  let pos = start;
  while (pos < text.length && text.charCodeAt(pos) !== quote) {
    const code = text.charCodeAt(pos);
    if (code === 10 || code === 13) {
      break;
    }
    pos += code === 92 ? 2 : 1;
  }
  if (pos >= text.length || text.charCodeAt(pos) !== quote) {
    giveUp({ state, why: "unterminated string" });
    return;
  }
  push({ kind: "string", state, value: text.slice(start, pos) });
  state.pos = pos + 1;
}

/**
 * Where the template span starting at `start` ends.
 *
 * @returns the index of its closing backtick or of the `$` of a `${`, or -1 when the text ends first
 */
function templateSpanEnd({ text, start }: { text: string; start: number }): number {
  let pos = start;
  while (pos < text.length) {
    const code = text.charCodeAt(pos);
    const substitution = code === 36 && text.charCodeAt(pos + 1) === 123;
    if (code === 96 || substitution) {
      return pos;
    }
    pos += code === 92 ? 2 : 1;
  }
  return -1;
}

/** Template characters from `pos` to the closing backtick or a `${`, pushed as one span. */
function scanTemplateSpan({ state, head }: { state: LexState; head: boolean }): void {
  const { text } = state;
  const start = state.pos;
  const end = templateSpanEnd({ start, text });
  if (end === -1) {
    giveUp({ state, why: "unterminated template" });
    return;
  }
  if (text.charCodeAt(end) === 96) {
    const kind = head ? "template-full" : "template-tail";
    push({ kind, state, value: text.slice(start, end) });
    state.pos = end + 1;
    return;
  }
  push({ kind: head ? "template-head" : "template-middle", state, value: "" });
  state.braces.push("template");
  state.pos = end + 2;
}

/** Whether a regular expression body is inside a character class after `code`, given whether it was before. */
function inClassAfter({ inClass, code }: { inClass: boolean; code: number }): boolean {
  return (inClass || code === 91) && code !== 93;
}

/**
 * Where the body of the regular expression opening at `start` closes: a `/` inside a character class does not.
 *
 * @returns the index of the closing `/`, or -1 when a line break or the text's end comes first
 */
function regexBodyEnd({ text, start }: { text: string; start: number }): number {
  let pos = start + 1;
  let inClass = false;
  while (pos < text.length) {
    const code = text.charCodeAt(pos);
    if (isLineBreak({ code })) {
      return -1;
    }
    if (code === 47 && !inClass) {
      return pos;
    }
    inClass = inClassAfter({ code, inClass });
    pos += code === 92 ? 2 : 1;
  }
  return -1;
}

/** A regular expression literal at `pos`, with its flags. */
function scanRegex({ state }: { state: LexState }): void {
  const { text } = state;
  const start = state.pos;
  const close = regexBodyEnd({ start, text });
  if (close === -1) {
    giveUp({ state, why: "unterminated regex" });
    return;
  }
  let pos = close + 1;
  while (pos < text.length && isIdentifierPart({ code: text.charCodeAt(pos) })) {
    pos += 1;
  }
  push({ kind: "regex", state, value: text.slice(start, pos) });
  state.pos = pos;
}

/** An ASCII identifier character after the first. */
function isIdentifierPart({ code }: { code: number }): boolean {
  return isAsciiIdStart({ code }) || isDigit({ code });
}

/** The length of the identifier character at `pos` (2 for an astral one), or 0 when none is there. */
function identifierCharLength({ state, start }: { state: LexState; start: boolean }): number {
  if (state.pos >= state.text.length) {
    return 0;
  }
  const code = state.text.charCodeAt(state.pos);
  if (code < 128) {
    return (start ? isAsciiIdStart({ code }) : isIdentifierPart({ code })) ? 1 : 0;
  }
  const point = state.text.codePointAt(state.pos)!;
  const char = String.fromCodePoint(point);
  return (start ? ID_START : ID_CONTINUE).test(char) ? char.length : 0;
}

/** An identifier or keyword at `pos`; an escaped one (`e`) stops the lexer, since its text needs decoding. */
function scanIdentifier({ state, kind }: { state: LexState; kind: SpecifierTokenKind }): void {
  const start = state.pos;
  let length = identifierCharLength({ start: true, state });
  while (length > 0) {
    state.pos += length;
    length = identifierCharLength({ start: false, state });
  }
  if (state.text.charCodeAt(state.pos) === 92 || state.text.charCodeAt(start) === 92) {
    giveUp({ state, why: "escaped identifier" });
    return;
  }
  if (state.pos === start) {
    giveUp({ state, why: `character U+${state.text.charCodeAt(start).toString(16)}` });
    return;
  }
  const value = state.text.slice(start, state.pos);
  const innermost = state.braces[state.braces.length - 1];
  if ((value === "require" || value === "import") && (innermost === "unknown" || innermost === "expression")) {
    state.bodyCalls.add(state.kinds.length);
  }
  push({ kind, state, value });
}

/**
 * A numeric literal at `pos`, read as TypeScript's scanner ends one. A name glued to it (`1require("x")`) is two
 * tokens to TypeScript and an error, so the lexer leaves that file to the tree rather than swallow the name.
 */
function scanNumber({ state }: { state: LexState }): void {
  const start = state.pos;
  NUMERIC_LITERAL.lastIndex = start;
  const match = NUMERIC_LITERAL.exec(state.text);
  // The caller dispatches here on a digit, or a `.` before one, which the pattern always matches.
  state.pos = start + match![0].length;
  const next = state.text.charCodeAt(state.pos);
  if (isIdentifierPart({ code: next }) || next === 92 || next > 127) {
    giveUp({ state, why: "identifier after number" });
    return;
  }
  push({ kind: "number", state, value: state.text.slice(start, state.pos) });
}

/** Whether a `<` at `pos` may open JSX: in a file that parses JSX, where an operand begins, before a tag's start. */
function possibleJsx({ state, value }: { state: LexState; value: string }): boolean {
  if (value !== "<" || !state.jsx || operandNext({ state }) === "no") {
    return false;
  }
  const next = state.text.charCodeAt(state.pos + 1);
  return next === 62 || isAsciiIdStart({ code: next }) || next > 127;
}

/**
 * Keep the paren and brace stacks for the punctuator `value` at `pos`.
 *
 * @returns true when it was a `}` closing a substitution, whose template has now been resumed and pushed instead
 */
function trackBrackets({ state, value }: { state: LexState; value: string }): boolean {
  if (value === "(") {
    state.parens.push(opensControlHead({ state }));
    return false;
  }
  if (value === ")") {
    state.lastParenControl = state.parens.pop() === true;
    return false;
  }
  if (value === "{") {
    state.braces.push(braceOpened({ state }));
    return false;
  }
  if (value !== "}") {
    return false;
  }
  const closed = state.braces.pop();
  if (closed === "template") {
    state.pos += 1;
    scanTemplateSpan({ head: false, state });
    return true;
  }
  // A `}` with no open brace (text that does not parse) closes a brace whose kind nothing recorded.
  if (closed === undefined) {
    state.lastBraceKind = "unknown";
  } else {
    state.lastBraceKind = closed;
  }
  return false;
}

/** A punctuator at `pos`, keeping the paren and brace stacks; a `}` closing a substitution resumes its template. */
function scanPunctuator({ state }: { state: LexState }): void {
  const length = punctuatorLength({ pos: state.pos, text: state.text });
  if (length === 0) {
    giveUp({ state, why: `character U+${state.text.charCodeAt(state.pos).toString(16)}` });
    return;
  }
  const value = state.text.slice(state.pos, state.pos + length);
  if (possibleJsx({ state, value })) {
    giveUp({ state, why: "possible JSX" });
    return;
  }
  if (trackBrackets({ state, value })) {
    return;
  }
  push({ kind: "punctuator", state, value });
  state.pos += length;
}

/** A `/` at `pos` that is not a comment: a regex where an operand begins, a division otherwise. */
function scanSlash({ state }: { state: LexState }): void {
  const operand = operandNext({ state });
  if (operand === "unsettled") {
    giveUp({ state, why: `slash after ${state.texts[state.texts.length - 1]!}` });
  } else if (operand === "yes") {
    scanRegex({ state });
  } else {
    scanPunctuator({ state });
  }
}

/**
 * Skip one whitespace or line-break character at `pos`, noting a line break.
 *
 * @returns false when `code` is neither, and nothing was skipped
 */
function skipTrivia({ state, code }: { state: LexState; code: number }): boolean {
  const lineBreak = isLineBreak({ code });
  if (!lineBreak && !isSpace({ code })) {
    return false;
  }
  if (lineBreak) {
    state.lineBreakBefore = true;
  }
  state.pos += 1;
  return true;
}

/** Whether `code` at `pos` starts an identifier: an ASCII start, an escape, or any non-ASCII character. */
function startsIdentifier({ code }: { code: number }): boolean {
  return isAsciiIdStart({ code }) || code === 92 || code > 127;
}

/** Whether `code` at `pos` starts a numeric literal: a digit, or a `.` before one. */
function startsNumber({ state, code }: { state: LexState; code: number }): boolean {
  return isDigit({ code }) || (code === 46 && isDigit({ code: state.text.charCodeAt(state.pos + 1) }));
}

/** Lex the one token (or skip the one run of trivia) at `pos`. */
function scanOne({ state }: { state: LexState }): void {
  const code = state.text.charCodeAt(state.pos);
  if (skipTrivia({ code, state })) {
    return;
  }
  if (code === 47) {
    if (!skipComment({ state })) {
      scanSlash({ state });
    }
  } else if (code === 34 || code === 39) {
    scanString({ quote: code, state });
  } else if (code === 96) {
    state.pos += 1;
    scanTemplateSpan({ head: true, state });
  } else if (startsIdentifier({ code })) {
    scanIdentifier({ kind: "identifier", state });
  } else if (code === 35) {
    state.pos += 1;
    scanIdentifier({ kind: "private-name", state });
  } else if (startsNumber({ code, state })) {
    scanNumber({ state });
  } else {
    scanPunctuator({ state });
  }
}

/**
 * Lex one file into the tokens a module-specifier reader reads, or say why tokens alone cannot be trusted to read
 * it — the caller then asks the syntax tree, which is the definition this is a cheap path to.
 *
 * @param fileName decides whether the file parses JSX (`.tsx`, `.jsx`, `.js`, `.mjs`, `.cjs`), as TypeScript does
 * @param text the file's contents
 * @returns the tokens, or the reason they cannot be trusted
 */
export function lexSpecifierTokens({ fileName, text }: { fileName: string; text: string }): SpecifierLexing {
  const state = lexStateOf({ fileName, text });
  while (state.pos < text.length) {
    scanOne({ state });
  }
  if (state.why !== undefined) {
    return { kind: "uncertain", why: state.why };
  }
  return { kind: "tokens", tokens: { bodyCalls: state.bodyCalls, kinds: state.kinds, texts: state.texts } };
}
