/**
 * Every module specifier a file's text imports, read off {@link ./moduleSpecifierLexer.ts}'s token stream with no
 * TypeScript loaded — the cheap path to exactly what `moduleSpecifiersOf` (`./tsSyntax.ts`) reads off a syntax tree.
 *
 * The tree is the definition. Where a token stream cannot settle what the tree reads, this answers UNCERTAIN with the
 * reason, and `tsSyntax.moduleSpecifiers` parses that one file instead: a lexer uncertainty, a `declare module "x"`
 * (whether it augments `x` is TypeScript's own module test), a `require` or `import(…)` that may be a declaration
 * (`function require(…)`, a method `import("x") {}`, a member `require("x");` at the start of a class, interface
 * or type body), a name glued to a number (`1require(…)`), a member `x.require(…)` (its node starts before its name, so a nested load inside `x` would come out
 * of order), a generic `require<T>(…)`, an `import source x from` (a source-phase import to TypeScript 7 only), and a
 * specifier spelled with an escape.
 *
 * What it reads, as the tree does, in source order with duplicates kept: `import "x"`, `import … from "x"` (type-only,
 * namespace and `defer` clauses included), `export [type] * [as n] from "x"`, `export [type] { … } from "x"`,
 * `import(…)` as a call or a type and `require(…)` (an optional call `require?.(…)` and `new require(…)` included),
 * each where the load's first argument starts with a string or a substitution-free template.
 *
 * **The promise holds for text TypeScript parses with no syntax error.** Malformed text can still read differently:
 * `class C { export * from "x"; }` reads as a re-export here and as nothing in the tree. Every caller reads tracked
 * files, which CI's typecheck holds to no syntax error, so chasing each recovery the parser makes would buy nothing.
 */
import { lexSpecifierTokens, type SpecifierTokens } from "./moduleSpecifierLexer.js";

/** A file's specifiers, or why the tokens cannot be trusted to read them. */
export type SpecifierReading =
  | { readonly kind: "read"; readonly specifiers: readonly string[] }
  | { readonly kind: "uncertain"; readonly why: string };

type Step =
  | { readonly kind: "none" }
  | { readonly kind: "edge"; readonly specifier: string }
  | { readonly kind: "uncertain"; readonly why: string };

const NONE: Step = { kind: "none" };
/** Words that take an operand, so a call after one is an expression and never a member's start. */
const OPERATOR_WORDS: ReadonlySet<string> = new Set([
  "await",
  "delete",
  "new",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

function isWord({ tokens, index, value }: { tokens: SpecifierTokens; index: number; value: string }): boolean {
  return tokens.kinds[index] === "identifier" && tokens.texts[index] === value;
}

function isPunctuator({ tokens, index, value }: { tokens: SpecifierTokens; index: number; value: string }): boolean {
  return tokens.kinds[index] === "punctuator" && tokens.texts[index] === value;
}

/** The specifier a string (or, where `templates` allows, a substitution-free template) at `index` spells. */
function literalAt({ tokens, index, templates }: { tokens: SpecifierTokens; index: number; templates: boolean }): Step {
  const kind = tokens.kinds[index];
  if (kind !== "string" && !(templates && kind === "template-full")) {
    return NONE;
  }
  const raw = tokens.texts[index]!;
  if (raw.includes("\\")) {
    return { kind: "uncertain", why: "escaped specifier" };
  }
  // A template's value turns each CRLF and lone CR into LF, as TypeScript's `text` does; a string cannot hold either.
  return { kind: "edge", specifier: kind === "template-full" ? raw.replaceAll(/\r\n?/gu, "\n") : raw };
}

/** `from "x"` at `index`. */
function fromAt({ tokens, index }: { tokens: SpecifierTokens; index: number }): Step {
  return isWord({ index, tokens, value: "from" }) ? literalAt({ index: index + 1, templates: false, tokens }) : NONE;
}

/** The index after the `}` matching the `{` at `open`, or -1 when none matches before a template part. */
function afterBraces({ tokens, open }: { tokens: SpecifierTokens; open: number }): number {
  let depth = 0;
  for (let index = open; index < tokens.kinds.length; index += 1) {
    const kind = tokens.kinds[index];
    if (kind === "template-head" || kind === "template-middle" || kind === "template-tail") {
      return -1;
    }
    if (kind === "punctuator" && (tokens.texts[index] === "{" || tokens.texts[index] === "}")) {
      depth += tokens.texts[index] === "{" ? 1 : -1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return -1;
}

/** A static import's clause from `cursor` to its `from "x"`: names, `,`, `*`, and a skipped `{ … }`. */
function importClauseStep({ tokens, cursor }: { tokens: SpecifierTokens; cursor: number }): Step {
  let at = cursor;
  while (at !== -1 && at < tokens.kinds.length) {
    const from = fromAt({ index: at, tokens });
    if (from.kind !== "none") {
      return from;
    }
    if (tokens.kinds[at] === "identifier" || isPunctuator({ index: at, tokens, value: "," })) {
      at += 1;
    } else if (isPunctuator({ index: at, tokens, value: "*" })) {
      at += 1;
    } else if (isPunctuator({ index: at, tokens, value: "{" })) {
      at = afterBraces({ open: at, tokens });
    } else {
      return NONE;
    }
  }
  return NONE;
}

/** What an `import` keyword at `index` loads: `import("x")`, `import "x"`, or a clause `from "x"`. */
function importStep({ tokens, index }: { tokens: SpecifierTokens; index: number }): Step {
  // `import<T>("x")` parses with no error and the tree reads it as a load, as it does `require<T>("x")`.
  if (isPunctuator({ index: index + 1, tokens, value: "<" })) {
    return { kind: "uncertain", why: "generic import" };
  }
  if (isPunctuator({ index: index + 1, tokens, value: "(" })) {
    return settledCall({
      index,
      literal: literalAt({ index: index + 2, templates: true, tokens }),
      open: index + 1,
      tokens,
    });
  }
  const bare = literalAt({ index: index + 1, templates: false, tokens });
  if (bare.kind !== "none") {
    return bare;
  }
  // `import source x from "y"` is a source-phase import to TypeScript 7 and a broken default import to TypeScript 6,
  // so the tree's answer turns on the parser's version: the reader leaves it to the tree.
  const sourcePhase =
    isWord({ index: index + 1, tokens, value: "source" }) &&
    tokens.kinds[index + 2] === "identifier" &&
    !isWord({ index: index + 2, tokens, value: "from" });
  return sourcePhase ? { kind: "uncertain", why: "import source" } : importClauseStep({ cursor: index + 1, tokens });
}

/** What an `export` keyword at `index` re-exports from: `export [type] * [as n] from "x"` or `{ … } from "x"`. */
function exportStep({ tokens, index }: { tokens: SpecifierTokens; index: number }): Step {
  const cursor = isWord({ index: index + 1, tokens, value: "type" }) ? index + 2 : index + 1;
  if (isPunctuator({ index: cursor, tokens, value: "*" })) {
    const named = isWord({ index: cursor + 1, tokens, value: "as" });
    return fromAt({ index: named ? cursor + 3 : cursor + 1, tokens });
  }
  if (!isPunctuator({ index: cursor, tokens, value: "{" })) {
    return NONE;
  }
  const after = afterBraces({ open: cursor, tokens });
  return after === -1 ? NONE : fromAt({ index: after, tokens });
}

/** The index of the `)` matching the `(` at `open`, or -1. */
function closingParen({ tokens, open }: { tokens: SpecifierTokens; open: number }): number {
  let depth = 0;
  for (let index = open; index < tokens.kinds.length; index += 1) {
    if (tokens.kinds[index] === "punctuator" && (tokens.texts[index] === "(" || tokens.texts[index] === ")")) {
      depth += tokens.texts[index] === "(" ? 1 : -1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

/**
 * Why a `require` or `import` at `index`, called at `open` with a literal, may be a declaration spelled like a call
 * rather than a load: `function require("x")`, a method `import("x") {}` or `require("x"): T`, or a member of a
 * class, interface or type body.
 */
function declarationDoubt({
  tokens,
  index,
  open,
}: {
  tokens: SpecifierTokens;
  index: number;
  open: number;
}): string | undefined {
  const name = tokens.texts[index]!;
  if (
    isWord({ index: index - 1, tokens, value: "function" }) ||
    isPunctuator({ index: index - 1, tokens, value: "*" })
  ) {
    return `${name} declaration`;
  }
  const close = closingParen({ open, tokens });
  const declared =
    isPunctuator({ index: close + 1, tokens, value: "{" }) || isPunctuator({ index: close + 1, tokens, value: ":" });
  if (declared) {
    return `${name} declaration shape`;
  }
  // A member of a class, interface or type body (`abstract require("x");`, `interface I { require("x"); }`) declares
  // a method whatever follows it; where the innermost brace may be such a body, a member-start position is doubt.
  const memberStart =
    (tokens.kinds[index - 1] === "identifier" && !OPERATOR_WORDS.has(tokens.texts[index - 1]!)) ||
    [",", ";", "{", "}"].some((value) => isPunctuator({ index: index - 1, tokens, value }));
  const member = tokens.bodyCalls.has(index) && memberStart && !insideGroup({ index, tokens });
  return member ? `${name} member shape` : undefined;
}

/**
 * Whether the token at `index` sits inside a `(` or `[` opened after its innermost `{`, as each element of
 * `Promise.all([import("a"), import("b")])` does: an expression, never a member's start. Walks back to the first
 * unmatched opener and answers false on a template token, which leaves the doubt standing.
 *
 * @returns true only when an unmatched `(` or `[` comes before any unmatched `{`
 */
function insideGroup({ tokens, index }: { tokens: SpecifierTokens; index: number }): boolean {
  let depth = 0;
  for (let at = index - 1; at >= 0; at -= 1) {
    const kind = tokens.kinds[at];
    if (kind === "template-head" || kind === "template-middle" || kind === "template-tail") {
      return false;
    }
    const value = kind === "punctuator" ? tokens.texts[at] : undefined;
    if (value === ")" || value === "]" || value === "}") {
      depth += 1;
    } else if (value === "(" || value === "[" || value === "{") {
      if (depth === 0) {
        return value !== "{";
      }
      depth -= 1;
    }
  }
  return false;
}

/**
 * Settle a call's literal `edge` at `index`: kept, or uncertain when the call may be a declaration.
 *
 * @param literal what the literal argument read as
 * @param open the `(` the call opens at
 * @returns the edge, the literal's own non-edge answer, or why the call is doubtful
 */
function settledCall({
  tokens,
  index,
  open,
  literal,
}: {
  tokens: SpecifierTokens;
  index: number;
  open: number;
  literal: Step;
}): Step {
  if (literal.kind !== "edge") {
    return literal;
  }
  const doubt = declarationDoubt({ index, open, tokens });
  return doubt === undefined ? literal : { kind: "uncertain", why: doubt };
}

/** What a `require` at `index` loads, when it is called with a literal first argument. */
function requireStep({ tokens, index }: { tokens: SpecifierTokens; index: number }): Step {
  const open = isPunctuator({ index: index + 1, tokens, value: "?." }) ? index + 2 : index + 1;
  if (isPunctuator({ index: open, tokens, value: "<" })) {
    return { kind: "uncertain", why: "generic require" };
  }
  if (!isPunctuator({ index: open, tokens, value: "(" })) {
    return NONE;
  }
  // A member `x.require(…)` starts its node at `x`, so a load inside `x` comes first in the tree.
  const member =
    isPunctuator({ index: index - 1, tokens, value: "." }) || isPunctuator({ index: index - 1, tokens, value: "?." });
  if (member) {
    const literal = literalAt({ index: open + 1, templates: true, tokens });
    return literal.kind === "edge" ? { kind: "uncertain", why: "member require" } : literal;
  }
  return settledCall({ index, literal: literalAt({ index: open + 1, templates: true, tokens }), open, tokens });
}

/** What the identifier at `index` contributes. */
function stepAt({ tokens, index }: { tokens: SpecifierTokens; index: number }): Step {
  const name = tokens.texts[index];
  if (name === "require") {
    return requireStep({ index, tokens });
  }
  const member =
    isPunctuator({ index: index - 1, tokens, value: "." }) || isPunctuator({ index: index - 1, tokens, value: "?." });
  if (member) {
    return NONE;
  }
  if (name === "import") {
    return isPunctuator({ index: index + 1, tokens, value: "." }) ? NONE : importStep({ index, tokens });
  }
  if (name === "export") {
    return exportStep({ index, tokens });
  }
  const augments =
    name === "declare" && isWord({ index: index + 1, tokens, value: "module" }) && tokens.kinds[index + 2] === "string";
  return augments ? { kind: "uncertain", why: "declare module" } : NONE;
}

/**
 * Every module specifier a file's text imports, read without TypeScript — or why the tokens cannot settle it, in
 * which case the caller reads the syntax tree. Where it answers, the answer is the tree's (`moduleSpecifiersOf`).
 *
 * @param fileName decides whether the file parses JSX, as TypeScript's script kind does
 * @param text the file's contents
 * @returns the specifiers as written, in source order, duplicates kept; or the reason to parse instead
 */
export function readModuleSpecifiers({ fileName, text }: { fileName: string; text: string }): SpecifierReading {
  const lexing = lexSpecifierTokens({ fileName, text });
  if (lexing.kind === "uncertain") {
    return lexing;
  }
  const { tokens } = lexing;
  const specifiers: string[] = [];
  for (let index = 0; index < tokens.kinds.length; index += 1) {
    if (tokens.kinds[index] !== "identifier") {
      continue;
    }
    const step = stepAt({ index, tokens });
    if (step.kind === "uncertain") {
      return step;
    }
    if (step.kind === "edge") {
      specifiers.push(step.specifier);
    }
  }
  return { kind: "read", specifiers };
}
