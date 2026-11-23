/**
 * Canonicalise a catalog line's AND chains, so the restore rehearsal compares what a definition MEANS rather
 * than the shape of the expression tree Postgres happened to store.
 *
 * ## Why a dump and restore changes the text without changing the definition
 *
 * `CHECK (length(slug) between 2 and 40 and slug ~ '…')` is stored on live as a NESTED AND: the grammar's
 * `makeAndExpr` flattens `a AND b AND c` into one node as it parses, but BETWEEN is expanded into its own
 * `x >= a AND x <= b` node later, by `transformAExprBetween`, so nothing flattens that one into its parent.
 * `pg_dump` deparses the nest with its parentheses, and `pg_restore`'s re-parse of `(a AND b) AND c` then
 * flattens it, so `pg_get_constraintdef` prints the copy one level shallower than live. MEASURED,
 * `slopweaver store rehearse` against a fresh backup: 1,626 of 1,627 catalog lines matched, and the one that
 * did not was `knowledge_domain_slug_shape` (`supabase/migrations/0037_nebulous_black_bolt.sql`), live
 * `((((a) AND (b)) AND (c)))` and the copy `(((a) AND (b) AND (c)))`.
 *
 * ## What it rewrites, and what it never touches
 *
 * Inside a level whose top-level operands are joined by ` AND ` and by no ` OR `, an operand that is exactly
 * one parenthesised group, whose own top level is likewise AND-only, is spliced into its parent, operand
 * order kept. AND is associative under Postgres's three-valued logic, which also promises no evaluation
 * order, so the meaning is unchanged. Nothing else moves: `NOT (a AND b)`, an OR boundary, a cast, operand
 * order, whitespace and keyword case all stay exactly as printed, and a single-quoted literal (an `E'…'`
 * one's backslash escapes included), a dollar-quoted literal (`$$…$$`, `$tag$…$tag$`) and a double-quoted
 * identifier are opaque. A level where nothing was spliced is emitted byte for byte, and so is a whole line
 * whose quotes or parentheses do not balance, or whose groups nest deeper than `MAX_GROUP_DEPTH`.
 *
 * **The residue, stated.** A user-defined type's `typmodout` prints raw text into `format_type`, which a column
 * line and every deparsed cast carry unquoted, so a C-language type whose typmod output is itself AND-shaped
 * parentheses could have two distinct typmods canonicalised alike. Only a full SQL
 * parser closes that. MEASURED: every typmod-bearing column in `public`, `drizzle` and `storage` is a
 * built-in (`numeric`, `timestamptz`, `varchar`). Repro: select the distinct `pg_type.typmodout` of those
 * schemas' columns where `atttypmod <> -1`.
 *
 * OR is deliberately NOT flattened: `NOT BETWEEN` nests an OR the same way, but no rehearsal has measured one,
 * and a rule widened ahead of its evidence is a rule that can hide a real catalog change.
 */

/** One piece of a tokenised line: plain text, a quoted literal or identifier, or a parenthesised group. */
type Fragment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "quoted"; readonly text: string }
  | { readonly kind: "group"; readonly fragments: readonly Fragment[] };

/** One level split at its top-level separators, and whether it is an AND-only chain. */
interface Level {
  readonly operands: readonly (readonly Fragment[])[];
  readonly andChain: boolean;
}

/**
 * The deepest group nesting a line may have and still be canonicalised. Rendering recurses once per group, so
 * a deeper line is emitted unchanged rather than risking the call stack. MEASURED on Node 24, before
 * this bound: 2,000 levels threw `RangeError: Maximum call stack size exceeded`. Repro: `flattenAndChains({ text:
 * "(".repeat(2000) + "a" + ")".repeat(2000) })` with the bound removed.
 */
const MAX_GROUP_DEPTH = 200;

/** The separator Postgres deparses an AND chain with. */
const AND = " AND ";

/** Either separator, captured, so a level holding an OR is seen as one. */
const SEPARATOR = / (AND|OR) /;

/**
 * Find where a quoted run that opens at `start` closes, where a doubled quote character is an escaped one.
 *
 * In an escape-string literal (`E'…'`) a backslash also escapes the character after it, so `\'` is not the end.
 *
 * @param text the whole line
 * @param start the index of the opening quote
 * @param backslashEscapes whether the run is an `E'…'` literal
 * @returns the index just past the closing quote, or `null` when the quote never closes
 */
function quotedEnd({
  backslashEscapes,
  start,
  text,
}: {
  backslashEscapes: boolean;
  start: number;
  text: string;
}): number | null {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length) {
    if (backslashEscapes && text[index] === "\\") {
      index += 2;
      continue;
    }
    if (text[index] !== quote) {
      index += 1;
      continue;
    }
    if (text[index + 1] !== quote) {
      return index + 1;
    }
    index += 2;
  }
  return null;
}

/**
 * A dollar-quote opening tag: `$$` or `$tag$`, the tag never starting with a digit (`$1` is a parameter). Any
 * non-ASCII character is a letter here, as in Postgres's own lexer (`dolq_start [A-Za-z\200-\377_]`), so `$é$`
 * opens a quote.
 */
const DOLLAR_TAG = /^\$(?:[A-Za-z_\u0080-\u{10FFFF}][A-Za-z0-9_\u0080-\u{10FFFF}]*)?\$/u;

/**
 * A character that continues an identifier, so a `$` right after one belongs to the identifier; non-ASCII
 * included, as in Postgres's `ident_cont [A-Za-z\200-\377_0-9\$]`.
 */
const IDENTIFIER_CHAR = /[A-Za-z0-9_$\u0080-\u{10FFFF}]/u;

/**
 * Whether the quote at `start` opens an escape-string literal: an `E` or `e` right before it that is not the
 * tail of a longer identifier.
 *
 * @param text the whole line
 * @param start the index of a single quote
 * @returns true for `E'…'`, false for a plain `'…'` or an identifier ending in `e` before a quote
 */
function isEscapeStringPrefix({ start, text }: { start: number; text: string }): boolean {
  const prefix = text[start - 1];
  if (prefix !== "E" && prefix !== "e") {
    return false;
  }
  const before = text[start - 2];
  return before === undefined || !IDENTIFIER_CHAR.test(before);
}

/**
 * Find where a dollar-quoted run that opens at `start` closes, when a dollar quote does open there.
 *
 * @param text the whole line
 * @param start the index of a `$`
 * @returns `"none"` when no dollar quote opens there, the index just past its closing tag, or `null` when
 *   it never closes
 */
function dollarQuotedEnd({ start, text }: { start: number; text: string }): number | "none" | null {
  const previous = text[start - 1];
  if (previous !== undefined && IDENTIFIER_CHAR.test(previous)) {
    return "none";
  }
  const tag = DOLLAR_TAG.exec(text.slice(start))?.[0];
  if (tag === undefined) {
    return "none";
  }
  const close = text.indexOf(tag, start + tag.length);
  if (close === -1) {
    return null;
  }
  return close + tag.length;
}

/**
 * Append one fragment to a level, merging plain text into the text fragment it follows, so a level never holds
 * two text fragments side by side and a separator is never split across two.
 *
 * @param level the level being built
 * @param fragment the fragment to append
 */
function appendFragment({ fragment, level }: { fragment: Fragment; level: Fragment[] }): void {
  const last = level.at(-1);
  if (fragment.kind === "text" && last?.kind === "text") {
    level[level.length - 1] = { kind: "text", text: last.text + fragment.text };
    return;
  }
  level.push(fragment);
}

/**
 * Read one character outside any quoted run: `(` opens a group, `)` closes one, anything else is plain text.
 *
 * @param char the character
 * @param stack the open levels, innermost last
 * @returns false when a `)` closes a group that was never opened, or a `(` opens one past `MAX_GROUP_DEPTH`
 */
function readCharacter({ char, stack }: { char: string; stack: Fragment[][] }): boolean {
  if (char === "(") {
    if (stack.length > MAX_GROUP_DEPTH) {
      return false;
    }
    stack.push([]);
    return true;
  }
  if (char !== ")") {
    appendFragment({ fragment: { kind: "text", text: char }, level: stack.at(-1)! });
    return true;
  }
  if (stack.length === 1) {
    return false;
  }
  const fragments = stack.pop()!;
  appendFragment({ fragment: { fragments, kind: "group" }, level: stack.at(-1)! });
  return true;
}

/**
 * Tokenise a line into text, quoted runs and nested groups.
 *
 * @param text the line
 * @returns the top-level fragments, or `null` when a quote or a parenthesis does not balance
 */
function parseFragments({ text }: { text: string }): readonly Fragment[] | null {
  const stack: Fragment[][] = [[]];
  let index = 0;
  while (index < text.length) {
    const end = quotedRunEnd({ start: index, text });
    if (end === null) {
      return null;
    }
    if (end !== "none") {
      appendFragment({ fragment: { kind: "quoted", text: text.slice(index, end) }, level: stack.at(-1)! });
      index = end;
      continue;
    }
    if (!readCharacter({ char: text[index]!, stack })) {
      return null;
    }
    index += 1;
  }
  return stack.length === 1 ? stack[0]! : null;
}

/**
 * Find where a quoted run of any kind that opens at `start` closes: single-quoted (an `E'…'` one honouring
 * backslash escapes), double-quoted, or dollar-quoted.
 *
 * @param text the whole line
 * @param start the index to look at
 * @returns `"none"` when no quoted run opens there, the index just past its close, or `null` when it never
 *   closes
 */
function quotedRunEnd({ start, text }: { start: number; text: string }): number | "none" | null {
  const char = text[start];
  if (char === "$") {
    return dollarQuotedEnd({ start, text });
  }
  if (char !== "'" && char !== '"') {
    return "none";
  }
  const backslashEscapes = char === "'" && isEscapeStringPrefix({ start, text });
  return quotedEnd({ backslashEscapes, start, text });
}

/**
 * Split one level at its top-level separators.
 *
 * @param fragments one level's fragments
 * @returns the operands in order, and whether every separator was ` AND ` (at least one, none ` OR `)
 */
function splitLevel({ fragments }: { fragments: readonly Fragment[] }): Level {
  const operands: Fragment[][] = [[]];
  const operators: string[] = [];
  for (const fragment of fragments) {
    if (fragment.kind !== "text") {
      operands.at(-1)!.push(fragment);
      continue;
    }
    // `split` with a capturing group alternates text and the captured operator: [text, op, text, op, text].
    fragment.text.split(SEPARATOR).forEach((part, index) => {
      if (index % 2 === 1) {
        operators.push(part);
        operands.push([]);
      } else if (part !== "") {
        operands.at(-1)!.push({ kind: "text", text: part });
      }
    });
  }
  return { andChain: operators.length > 0 && operators.every((operator) => operator === "AND"), operands };
}

/**
 * The AND-only level an operand's one group holds, when the operand is that group and nothing else.
 *
 * @param operand one operand's fragments
 * @returns the group's split level when it is an AND chain, or `null`
 */
function innerAndChain({ operand }: { operand: readonly Fragment[] }): Level | null {
  const [only, ...rest] = operand;
  if (only?.kind !== "group" || rest.length > 0) {
    return null;
  }
  const level = splitLevel({ fragments: only.fragments });
  if (!level.andChain) {
    return null;
  }
  return level;
}

/**
 * Render a fragment back to text, canonicalising every group inside it.
 *
 * @param fragment the fragment
 * @returns its text
 */
function renderFragment({ fragment }: { fragment: Fragment }): string {
  if (fragment.kind === "group") {
    return `(${renderLevel({ fragments: fragment.fragments })})`;
  }
  return fragment.text;
}

/**
 * Render one level, splicing every AND-only sole-group operand into it when the level is itself an AND chain.
 *
 * @param fragments the level's fragments
 * @returns the level's text, every nested group canonicalised
 */
function renderLevel({ fragments }: { fragments: readonly Fragment[] }): string {
  const verbatim = (): string => fragments.map((fragment) => renderFragment({ fragment })).join("");
  const level = splitLevel({ fragments });
  if (!level.andChain) {
    return verbatim();
  }
  const operands: (readonly Fragment[])[] = [];
  let spliced = false;
  for (const operand of level.operands) {
    const inner = innerAndChain({ operand });
    if (inner === null) {
      operands.push(operand);
      continue;
    }
    // A loop, never `push(...inner.operands)`: a spread passes each operand as an argument, and 150,000 of them
    // threw `RangeError`.
    for (const innerOperand of inner.operands) {
      operands.push(innerOperand);
    }
    spliced = true;
  }
  if (!spliced) {
    return verbatim();
  }
  const joined = operands.flatMap((operand, index): readonly Fragment[] => {
    if (index === 0) {
      return operand;
    }
    return [{ kind: "text", text: AND }, ...operand];
  });
  return renderLevel({ fragments: joined });
}

/**
 * Canonicalise one Postgres-deparsed catalog line's AND chains, so `(a AND b) AND c`, `a AND (b AND c)` and
 * `a AND b AND c` all print as the last.
 *
 * @param text one catalog line, as `pg_get_constraintdef` and its siblings print it
 * @returns the line with every nested AND chain spliced into its parent, or the line unchanged when its
 *   quotes or parentheses do not balance
 */
export function flattenAndChains({ text }: { text: string }): string {
  const fragments = parseFragments({ text });
  if (fragments === null) {
    return text;
  }
  return renderLevel({ fragments });
}
