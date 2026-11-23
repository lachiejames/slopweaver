/**
 * The state {@link ./moduleSpecifierLexer.ts} carries through one file, and the one judgement a lexer cannot make
 * from characters alone: whether the next token stands where an OPERAND begins. That decides whether a `/` opens a
 * regular expression or divides, and whether a `<` in a JSX file may open an element.
 *
 * It is judged from the previous token, as JavaScript tools without a parser judge it, with two stacks for the two
 * tokens that cannot be judged alone: a `)` (did its `(` open an `if`/`while`/`for`/`with` head?) and a `}` (did its
 * `{` open a block or an expression?). Where even that does not settle it, the answer is "unsettled", and the reader
 * asks the syntax tree instead of guessing.
 *
 * Imports no TypeScript: the point of the lexer is a whole-tree reader that never parses.
 */

/** What one token is; a specifier reader needs no finer distinction. */
export type SpecifierTokenKind =
  | "identifier"
  | "string"
  | "template-full"
  | "template-head"
  | "template-middle"
  | "template-tail"
  | "number"
  | "regex"
  | "punctuator"
  | "private-name";

/**
 * What a `{` opened: a statement block, the body after a non-control `)` (a function's, which may end an expression
 * as `function(){} / x` does), an expression (an object literal), a template substitution, or unknown.
 */
export type BraceKind = "block" | "function-body" | "expression" | "unknown" | "template";

/** Whether the next token stands where an operand begins, or the previous tokens do not settle it. */
export type OperandNext = "yes" | "no" | "unsettled";

/** The lexer's position, output and memory over one file. */
export interface LexState {
  readonly text: string;
  readonly jsx: boolean;
  pos: number;
  readonly kinds: SpecifierTokenKind[];
  readonly texts: string[];
  readonly braces: BraceKind[];
  /** Each `require` or `import` token whose innermost open brace is a class, interface, type or object body. */
  readonly bodyCalls: Set<number>;
  readonly parens: boolean[];
  lastParenControl: boolean;
  lastBraceKind: BraceKind;
  /** Whether a line break, or a block comment holding one, sits between the last token and the position. */
  lineBreakBefore: boolean;
  why: string | undefined;
}

/**
 * The reserved words a `/` after opens a regular expression: an operand may follow each, or each ends a statement
 * (`debugger`, `break`, `continue`), so a `/` on the next line begins the next one. None can be a variable name.
 */
const OPERAND_AFTER_WORD: ReadonlySet<string> = new Set([
  "break",
  "case",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "extends",
  "in",
  "instanceof",
  "new",
  "return",
  "throw",
  "typeof",
  "void",
]);
/** A keyword in one place and a plain name in another, so a `/` after it is not settled. */
const UNSETTLED_AFTER_WORD: ReadonlySet<string> = new Set(["await", "of", "yield"]);
const LOOP_JUMP: ReadonlySet<string> = new Set(["break", "continue"]);
const MEMBER_ACCESS: ReadonlySet<string> = new Set([".", "?."]);
const CONTROL_HEAD: ReadonlySet<string> = new Set(["for", "if", "while", "with"]);
const BLOCK_AFTER_WORD: ReadonlySet<string> = new Set(["do", "else", "finally", "try"]);
const BLOCK_AFTER_PUNCTUATOR: ReadonlySet<string> = new Set([")", "=>", ";", "{", "}"]);
const NON_ASCII_SPACE: ReadonlySet<number> = new Set([0xa0, 0x85, 0x1680, 0x202f, 0x205f, 0x3000, 0xfeff]);
/**
 * TypeScript parses JSX in a `.tsx`, `.jsx`, `.js`, `.mjs` or `.cjs` file (its JSX language variant), reading the
 * extension case-insensitively as its script-kind inference does: `x.TSX` parses JSX.
 */
const JSX_FILE = /\.(?:[cm]?js|jsx|tsx)$/iu;

/**
 * A fresh state over one file, past a byte-order mark and a hashbang line, as TypeScript's scanner starts.
 *
 * @param fileName decides whether the file parses JSX, as TypeScript's script kind does
 * @returns the state at the first character to lex
 */
export function lexStateOf({ fileName, text }: { fileName: string; text: string }): LexState {
  const state: LexState = {
    bodyCalls: new Set(),
    braces: [],
    jsx: JSX_FILE.test(fileName),
    kinds: [],
    lastBraceKind: "unknown",
    lastParenControl: false,
    lineBreakBefore: false,
    parens: [],
    pos: text.charCodeAt(0) === 0xfeff ? 1 : 0,
    text,
    texts: [],
    why: undefined,
  };
  if (text.charCodeAt(state.pos) === 35 && text.charCodeAt(state.pos + 1) === 33) {
    while (state.pos < text.length && !isLineBreak({ code: text.charCodeAt(state.pos) })) {
      state.pos += 1;
    }
  }
  return state;
}

/**
 * TypeScript's line terminators.
 *
 * @returns true for LF, CR, LINE SEPARATOR and PARAGRAPH SEPARATOR
 */
export function isLineBreak({ code }: { code: number }): boolean {
  return code === 10 || code === 13 || code === 0x2028 || code === 0x2029;
}

/**
 * TypeScript's single-line white space (`isWhiteSpaceSingleLine`), NEXT LINE and ZERO WIDTH SPACE included.
 *
 * @returns true for a character the scanner skips between tokens
 */
export function isSpace({ code }: { code: number }): boolean {
  if (code === 32 || code === 9) {
    return true;
  }
  if (code < 128) {
    return code === 11 || code === 12;
  }
  return NON_ASCII_SPACE.has(code) || (code >= 0x2000 && code <= 0x200b);
}

/**
 * An ASCII character that may start an identifier.
 *
 * @returns true for a letter, `$` or `_`
 */
export function isAsciiIdStart({ code }: { code: number }): boolean {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code === 36 || code === 95;
}

/**
 * An ASCII decimal digit.
 *
 * @returns true for `0` to `9`
 */
export function isDigit({ code }: { code: number }): boolean {
  return code >= 48 && code <= 57;
}

/**
 * Append one token.
 *
 * @param value a string literal's raw contents, quotes stripped; any other token's text
 */
export function push({ state, kind, value }: { state: LexState; kind: SpecifierTokenKind; value: string }): void {
  state.kinds.push(kind);
  state.texts.push(value);
  state.lineBreakBefore = false;
}

/**
 * Stop the lexer: what follows cannot be read off tokens alone.
 *
 * @param why the reason, reported to whoever reads the file instead
 */
export function giveUp({ state, why }: { state: LexState; why: string }): void {
  state.why = why;
  state.pos = state.text.length;
}

/** Whether the token `back` places from the end (1 = the last) ends an operand, so a `!` after it is non-null. */
function endsOperandAt({ state, back }: { state: LexState; back: number }): boolean {
  const index = state.kinds.length - back;
  if (index < 0) {
    return false;
  }
  const value = state.texts[index]!;
  switch (state.kinds[index]!) {
    case "identifier":
      return !OPERAND_AFTER_WORD.has(value) && !UNSETTLED_AFTER_WORD.has(value);
    case "punctuator":
      return value === ")" || value === "]";
    // A head or middle opens a `${` substitution, where an operand begins.
    case "template-head":
    case "template-middle":
      return false;
    case "string":
    case "template-full":
    case "template-tail":
    case "number":
    case "regex":
    case "private-name":
      return true;
  }
}

/** After a `!`, `++` or `--`, whose own role (prefix or postfix) turns on the token before it. */
function afterUnary({ state, value }: { state: LexState; value: string }): OperandNext {
  const before = state.kinds.length - 2;
  const closer = state.kinds[before] === "punctuator" && (state.texts[before] === ")" || state.texts[before] === "}");
  // `await!` is a non-null assertion on a variable named `await` in a script, and a prefix operand nowhere.
  const unsettledWord = state.kinds[before] === "identifier" && UNSETTLED_AFTER_WORD.has(state.texts[before]!);
  if (closer || unsettledWord) {
    return "unsettled";
  }
  if (endsOperandAt({ back: 2, state })) {
    return "no";
  }
  return value === "!" ? "yes" : "unsettled";
}

/** After a punctuator. */
function afterPunctuator({ state, value }: { state: LexState; value: string }): OperandNext {
  switch (value) {
    case ")":
      return state.lastParenControl ? "yes" : "no";
    case "]":
      return "no";
    case "}":
      // After any other brace the tokens cannot tell an object literal (`x = {}` then a division) from a type
      // literal (`type T = {}`, `A | {}`, where ASI ends the statement and a `/` opens a regular expression).
      return state.lastBraceKind === "block" ? "yes" : "unsettled";
    case "!":
    case "++":
    case "--":
      return afterUnary({ state, value });
    case ">":
      return "unsettled";
    default:
      return "yes";
  }
}

/**
 * Whether the token at `index` names a property (`o.return`, `o?.delete`): a keyword there is a plain name.
 *
 * @param index the identifier token to judge
 * @returns whether a `.` or `?.` comes just before it
 */
function afterMemberAccess({ state, index }: { state: LexState; index: number }): boolean {
  const before = index - 1;
  return before >= 0 && state.kinds[before] === "punctuator" && MEMBER_ACCESS.has(state.texts[before]!);
}

/**
 * Whether the token at `index` follows a `break` or `continue`. On that line it is a label and the statement ends, so
 * a `/` after it opens a regular expression; on the next line ASI has ended the statement first and it is an
 * operand. The tokens do not carry line breaks, so this is not settled.
 *
 * @param index the identifier token to judge
 * @returns whether a `break` or `continue` keyword comes just before it
 */
function afterLoopJump({ state, index }: { state: LexState; index: number }): boolean {
  const before = index - 1;
  return (
    before >= 0 &&
    state.kinds[before] === "identifier" &&
    LOOP_JUMP.has(state.texts[before]!) &&
    !afterMemberAccess({ state, index: before })
  );
}

/**
 * Whether the next token stands where an operand begins: a `/` there opens a regular expression, a `<` there may
 * open JSX. Judged from the previous token; "unsettled" where that does not decide it.
 *
 * A token that ends an operand does not settle it across a line break. A type looks like an expression to a lexer,
 * and a statement ending in one (`let x: string`, `type T = A[]`) ends at the line break, so a `/` on the next line
 * opens a regular expression where after an expression it would divide.
 *
 * @returns yes, no, or unsettled
 */
export function operandNext({ state }: { state: LexState }): OperandNext {
  const answer = operandNextOnLine({ state });
  return answer === "no" && state.lineBreakBefore ? "unsettled" : answer;
}

/** {@link operandNext} judged from the previous token alone, as if no line break came after it. */
function operandNextOnLine({ state }: { state: LexState }): OperandNext {
  const last = state.kinds.length - 1;
  if (last < 0) {
    return "yes";
  }
  const value = state.texts[last]!;
  switch (state.kinds[last]!) {
    case "identifier":
      if (afterMemberAccess({ state, index: last })) {
        return "no";
      }
      if (afterLoopJump({ state, index: last })) {
        return "unsettled";
      }
      if (OPERAND_AFTER_WORD.has(value)) {
        return "yes";
      }
      return UNSETTLED_AFTER_WORD.has(value) ? "unsettled" : "no";
    case "punctuator":
      return afterPunctuator({ state, value });
    // A head or middle opens a `${` substitution, where an operand begins: `${/x/.source}` holds a regex.
    case "template-head":
    case "template-middle":
      return "yes";
    case "string":
    case "template-full":
    case "template-tail":
    case "number":
    case "regex":
    case "private-name":
      return "no";
  }
}

/**
 * What a `{` about to be pushed opens, judged by the token before it: a function body after a `)` that closed no
 * control head; a block after a control head's `)`, `=>`, `;`, a brace or a block keyword; unknown after `:` (a `case` label or an object key) or a plain name; otherwise an expression.
 *
 * @returns the brace kind to push
 */
export function braceOpened({ state }: { state: LexState }): BraceKind {
  const last = state.kinds.length - 1;
  if (last < 0) {
    return "block";
  }
  const value = state.texts[last]!;
  if (state.kinds[last] === "punctuator") {
    if (value === ")" && !state.lastParenControl) {
      return "function-body";
    }
    if (BLOCK_AFTER_PUNCTUATOR.has(value)) {
      return "block";
    }
    return value === ":" ? "unknown" : "expression";
  }
  if (state.kinds[last] !== "identifier") {
    return "unknown";
  }
  if (BLOCK_AFTER_WORD.has(value)) {
    return "block";
  }
  return OPERAND_AFTER_WORD.has(value) || UNSETTLED_AFTER_WORD.has(value) ? "expression" : "unknown";
}

/**
 * Whether a `(` about to be pushed opens a control statement's head (`if (`, `while (`, `for (`, `for await (`,
 * `with (`).
 *
 * @returns true when the token before it is one of those keywords, and not a property name (`o.if(x)` is a call)
 */
export function opensControlHead({ state }: { state: LexState }): boolean {
  const last = state.kinds.length - 1;
  if (last < 0 || state.kinds[last] !== "identifier" || afterMemberAccess({ index: last, state })) {
    return false;
  }
  const forAwait =
    state.texts[last] === "await" &&
    state.kinds[last - 1] === "identifier" &&
    state.texts[last - 1] === "for" &&
    !afterMemberAccess({ index: last - 1, state });
  return forAwait || CONTROL_HEAD.has(state.texts[last]!);
}
