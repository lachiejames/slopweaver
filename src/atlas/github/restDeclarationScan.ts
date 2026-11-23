/**
 * The declaration-text scanner the REST-surface extractor stands on: identifiers, brace-balanced blocks,
 * string literals and comments stepped over, the members of a block, and the field names declared in one.
 *
 * Split from `restSurface.ts`, which keeps what GitHub's description MEANS: the routes, their operations,
 * the parameter groups, the response schema and the summary. A leaf: it imports nothing, so nothing here
 * can reach back into the extractor.
 */

/** Characters that make up a TypeScript identifier — the only thing the scanners accept as a name. */
export const IDENTIFIER_CHARACTER = /[A-Za-z0-9_$]/;

/**
 * Read an identifier forward from an index.
 *
 * @param text the source
 * @param from the index to start at
 * @returns the identifier and the index just past it; the identifier is `""` when there is none
 */
function readIdentifier({ text, from }: { text: string; from: number }): { value: string; end: number } {
  let end = from;
  while (end < text.length && IDENTIFIER_CHARACTER.test(text.charAt(end))) {
    end += 1;
  }
  return { end, value: text.slice(from, end) };
}

/**
 * The body of the brace-balanced block that opens at `from`, and the index just past its closing brace.
 *
 * Balanced rather than "up to the next `}`" because every interesting block here nests: a path object
 * contains verb entries, an operation contains `parameters` and `responses`, and a schema contains inline
 * objects. String literals are stepped over so a brace inside a quoted key cannot unbalance the count.
 *
 * @param text the source
 * @param from the index of the opening brace
 * @returns the block's inner text and the index past its close, or `null` when it never closes
 */
export function readBlock({ text, from }: { text: string; from: number }): { body: string; end: number } | null {
  if (text.charAt(from) !== "{") {
    return null;
  }
  let depth = 0;
  let index = from;
  while (index < text.length) {
    const jump = skipInsignificant({ from: index, text });
    if (jump !== null) {
      index = jump;
      continue;
    }
    const character = text.charAt(index);
    if (character === "{") {
      depth += 1;
    }
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return { body: text.slice(from + 1, index), end: index + 1 };
      }
    }
    index += 1;
  }
  return null;
}

/**
 * Step over a quoted string, honouring backslash escapes.
 *
 * @param text the source
 * @param from the index of the opening quote
 * @returns the index just past the closing quote, or the end of the text when it never closes
 */
export function skipString({ text, from }: { text: string; from: number }): number {
  const quote = text.charAt(from);
  let index = from + 1;
  while (index < text.length) {
    const character = text.charAt(index);
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === quote) {
      return index + 1;
    }
    index += 1;
  }
  return text.length;
}

/**
 * The index just past any comment or whitespace beginning at `from`.
 *
 * Every scanner in this module calls this before looking at a character, because GITHUB'S OWN PROSE
 * contains braces. Measured on the shipped description: a summary such as "Add `{owner}` to the allow
 * list" desynchronises a depth counter that only counts `{` and `}`, and the symptom is silent — 556 of
 * about 1,100 paths were extracted and every one of them lost its operation block, while the parser
 * reported success. A scanner that reads a declaration file must skip what the compiler skips.
 *
 * @param text the source
 * @param from the index to start at
 * @returns the index of the next significant character
 */
export function skipTrivia({ text, from }: { text: string; from: number }): number {
  let index = from;
  while (index < text.length) {
    if (text.startsWith("/*", index)) {
      const close = text.indexOf("*/", index + 2);
      index = close < 0 ? text.length : close + 2;
      continue;
    }
    if (text.startsWith("//", index)) {
      const newline = text.indexOf("\n", index);
      index = newline < 0 ? text.length : newline + 1;
      continue;
    }
    return index;
  }
  return index;
}

/**
 * How far to jump past whatever is at `from`, when it is not significant.
 *
 * The one place `readBlock` above and `interfaceBody` below share: a comment is skipped, a string is stepped over
 * whole, and anything else returns `null` to mean "look at this character yourself". Extracting it is what
 * keeps each scanner to its own decision rather than re-deriving the same three cases — which is also how
 * the first version got the brace counting wrong in three places at once.
 *
 * @param text the source
 * @param from the index to look at
 * @returns the index to continue from, or `null` when the character at `from` is significant
 */
function skipInsignificant({ text, from }: { text: string; from: number }): number | null {
  const skipped = skipTrivia({ from, text });
  if (skipped !== from) {
    return skipped;
  }
  return isQuote({ character: text.charAt(from) }) ? skipString({ from, text }) : null;
}

/**
 * Whether a character opens a string literal.
 *
 * The BACKTICK is in the set, and it was missing once. A template literal is a perfectly ordinary way to
 * write a string in a declaration file, and a review's counterexample put `get: operations["ghost/op"]`
 * inside one — which the scanners walked straight through, so the parser reported a route the description
 * does not declare.
 *
 * @param character the character to judge
 * @returns whether it opens a string
 */
export function isQuote({ character }: { character: string }): boolean {
  return character === '"' || character === "'" || character === "`";
}

/**
 * The text of one top-level `export interface <name> {` block.
 *
 * Scanned rather than found with `indexOf`, and the difference is not style: a declaration file may contain
 * the words `export interface paths {` inside a comment or a string, and a review's counterexample put a
 * whole fake `paths` interface inside a template literal. `indexOf` found the fake one first and the parser
 * reported its routes as GitHub's.
 *
 * @param text the whole declaration file
 * @param name the interface to find
 * @returns its body, or `null` when the file declares no such interface
 */
export function interfaceBody({ text, name }: { text: string; name: string }): string | null {
  const anchor = `export interface ${name} {`;
  let index = 0;
  while (index < text.length) {
    const jump = skipInsignificant({ from: index, text });
    if (jump !== null) {
      index = jump;
      continue;
    }
    if (text.startsWith(anchor, index)) {
      const block = readBlock({ from: index + anchor.length - 1, text });
      return block === null ? null : block.body;
    }
    index += 1;
  }
  return null;
}

/**
 * Every member key at depth 0 of a block, paired with the block that follows it.
 *
 * The three interfaces `restSurface.ts` reads are keyed the same way — a path, an operation id, a schema name —
 * so one scanner serves all of them. **Both spellings are admitted**, and that is not tidiness: a path and
 * an operation id always carry a `/` so TypeScript must quote them, while a schema name is quoted only when
 * it has to be. Reading quoted keys alone silently loses every schema whose name is a bare identifier —
 * measured on the shipped description, `installation` among them, which resolved to a schema reference and
 * then to zero response fields while the parser reported success.
 *
 * @param body the block body to scan
 * @returns each key and its own block body, in declaration order
 */
export function blockMembers({ body }: { body: string }): readonly { key: string; block: string }[] {
  const members: { key: string; block: string }[] = [];
  let index = 0;
  let depth = 0;
  while (index < body.length) {
    const skipped = skipTrivia({ from: index, text: body });
    if (skipped !== index) {
      index = skipped;
      continue;
    }
    const character = body.charAt(index);
    if (character === "{" || character === "}") {
      depth += character === "{" ? 1 : -1;
      index += 1;
      continue;
    }
    if (depth !== 0) {
      index += 1;
      continue;
    }
    const member = readMemberAt({ body, from: index });
    if (member === null) {
      index += 1;
      continue;
    }
    members.push({ block: member.block, key: member.key });
    index = member.end;
  }
  return members;
}

/**
 * One whole member — its key and its block — starting at an index, or `null` when none starts there.
 *
 * @param body the block body
 * @param from the index to read at
 * @returns the key, its block body and the index just past it
 */
function readMemberAt({
  body,
  from,
}: {
  body: string;
  from: number;
}): { key: string; block: string; end: number } | null {
  const read = readMemberKey({ body, from });
  if (read === null) {
    return null;
  }
  const opens = nextBrace({ body, from: read.end });
  if (opens < 0) {
    return null;
  }
  const block = readBlock({ from: opens, text: body });
  return block === null ? null : { block: block.body, end: block.end, key: read.key };
}

/**
 * One member key at an index, quoted or bare.
 *
 * @param body the block body
 * @param from the index to read at
 * @returns the key and the index just past it, or `null` when no key starts here
 */
function readMemberKey({ body, from }: { body: string; from: number }): { key: string; end: number } | null {
  const character = body.charAt(from);
  if (isQuote({ character })) {
    const close = skipString({ from, text: body });
    return { end: close, key: body.slice(from + 1, close - 1) };
  }
  if (!IDENTIFIER_CHARACTER.test(character)) {
    return null;
  }
  const read = readIdentifier({ from, text: body });
  return read.value.length === 0 ? null : { end: read.end, key: read.value };
}

/**
 * The identifiers declared at depth 0 of a block — a schema's own field names, or a parameter group's.
 *
 * Optional members (`name?: T`) are returned under their bare name: whether a field is optional is a fact
 * about the call, and this kind answers "does this name exist at all".
 *
 * @param body the block body to scan
 * @returns the member names, sorted and de-duplicated
 */
export function memberNames({ body }: { body: string }): readonly string[] {
  const names = new Set<string>();
  const cursor = { atLineStart: true, depth: 0, index: 0 };
  while (cursor.index < body.length) {
    stepMemberScan({ body, cursor, names });
  }
  return [...names].toSorted();
}

/** Where a member scan has got to: the index, the nesting depth, and whether a name could start here. */
interface MemberCursor {
  index: number;
  depth: number;
  atLineStart: boolean;
}

/**
 * How a character changes the nesting depth: an opener, a closer, or neither.
 *
 * @returns `1` for an opener, `-1` for a closer, `0` for anything else
 */
export function depthDelta({ character }: { character: string }): number {
  if (character === "{" || character === "[" || character === "(") {
    return 1;
  }
  return character === "}" || character === "]" || character === ")" ? -1 : 0;
}

/**
 * Advance a member scan by one step, collecting a name when the cursor is where one may start.
 *
 * Split out of {@link memberNames} because the loop is bookkeeping — depth, line starts, string literals —
 * around one interesting case, and inlining the two makes neither readable.
 *
 * @param body the block body being scanned
 * @param cursor where the scan has got to; mutated
 * @param names the accumulator
 */
function stepMemberScan({ body, cursor, names }: { body: string; cursor: MemberCursor; names: Set<string> }): void {
  const skipped = skipTrivia({ from: cursor.index, text: body });
  if (skipped !== cursor.index) {
    cursor.index = skipped;
    cursor.atLineStart = true;
    return;
  }
  const character = body.charAt(cursor.index);
  const delta = depthDelta({ character });
  if (delta !== 0) {
    cursor.depth += delta;
    cursor.index += 1;
    cursor.atLineStart = false;
    return;
  }
  if (isQuote({ character })) {
    const close = skipString({ from: cursor.index, text: body });
    if (cursor.depth === 0 && cursor.atLineStart) {
      collectMemberName({ body, close, names, quoted: body.slice(cursor.index + 1, close - 1) });
    }
    cursor.index = close;
    cursor.atLineStart = false;
    return;
  }
  if (character === "\n") {
    cursor.index += 1;
    cursor.atLineStart = true;
    return;
  }
  if (character === " " || character === "\t") {
    cursor.index += 1;
    return;
  }
  if (cursor.depth === 0 && cursor.atLineStart && IDENTIFIER_CHARACTER.test(character)) {
    const read = readIdentifier({ from: cursor.index, text: body });
    collectMemberName({ body, close: read.end, names, quoted: read.value });
    cursor.index = read.end;
  } else {
    cursor.index += 1;
  }
  cursor.atLineStart = false;
}

/** Admit a scanned name only when a `:` or `?:` actually follows it, so a keyword is not read as a field. */
function collectMemberName({
  body,
  close,
  names,
  quoted,
}: {
  body: string;
  close: number;
  names: Set<string>;
  quoted: string;
}): void {
  let index = close;
  while (index < body.length && (body.charAt(index) === " " || body.charAt(index) === "\t")) {
    index += 1;
  }
  const next = body.charAt(index);
  const declares = next === ":" || (next === "?" && body.charAt(index + 1) === ":");
  if (declares && quoted.length > 0) {
    names.add(quoted);
  }
}

/**
 * The index of the `{` opening a member's own block, skipping the `?:`/`:` and any comment between.
 *
 * @param body the block body
 * @param from the index just past the member's name
 * @returns the index of the opening brace, or `-1` when the member carries no block
 */
export function nextBrace({ body, from }: { body: string; from: number }): number {
  let index = from;
  while (index < body.length) {
    const skipped = skipTrivia({ from: index, text: body });
    if (skipped !== index) {
      index = skipped;
      continue;
    }
    const character = body.charAt(index);
    if (character === "{") {
      return index;
    }
    if (character === ":" || character === "?" || character === " " || character === "\n" || character === "\t") {
      index += 1;
      continue;
    }
    return -1;
  }
  return -1;
}
