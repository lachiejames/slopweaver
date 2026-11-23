/**
 * Shell BRACKET scanning shared by `./shellLexing.ts`, `./shellSegments.ts` and `./shellSpans.ts`: where a
 * `(…)`, `$[…]` or `${…}` group closes, and the command substitution — `$(…)`, backticks, `<(…)`/`>(…)` —
 * opening at a position.
 *
 * Pure, no I/O. Quote-aware and escape-aware, never a shell: a `case` pattern's bare `)` inside a substitution
 * closes that substitution early, a limit every consumer names.
 */
import { ansiCQuoted } from "./heredocDelimiter.js";

/** Which quote, if any, is open at a scan position. */
export type OpenQuote = "'" | '"' | undefined;

/**
 * The index of the `)` closing a group opened just before `from` — quote-aware, escape-aware, and nesting.
 *
 * @param text the text being scanned
 * @param from the first index inside the group
 * @returns the closing index, or -1 when the group never closes
 */
export function closingParen({ text, from }: { text: string; from: number }): number {
  return closingBracket({ close: ")", from, open: "(", text });
}

/**
 * The index of the `close` ending a group opened just before `from` — quote-aware, escape-aware, and nesting
 * on `open`: the `]` of a legacy `$[…]` arithmetic, which nests on a bare `[`, and the `}` of a `${…}`
 * expansion, which nests only on `${` — `x=1; echo ${x:-{a}b}` prints `1b}`.
 *
 * @param text the text being scanned
 * @param from the first index inside the group
 * @param open the text that nests one level deeper
 * @param close the character that closes one level
 * @returns the closing index, or -1 when the group never closes
 */
export function closingBracket({
  text,
  from,
  open,
  close,
}: {
  text: string;
  from: number;
  open: string;
  close: string;
}): number {
  const scan: { depth: number; quote: OpenQuote } = { depth: 1, quote: undefined };
  let index = from;
  while (index < text.length) {
    const advance = stepParen({ close, index, open, scan, text });
    if (advance === 0) return index;
    index += advance;
  }
  return -1;
}

/** One character of the {@link closingBracket} walk. @returns the characters consumed, or 0 at the closing one */
function stepParen({
  text,
  index,
  scan,
  open,
  close,
}: {
  text: string;
  index: number;
  scan: { depth: number; quote: OpenQuote };
  open: string;
  close: string;
}): number {
  const ch = text[index]!;
  if (ch === "\\" && scan.quote !== "'") return 2;
  if (scan.quote !== undefined) {
    if (ch === scan.quote) scan.quote = undefined;
    return 1;
  }
  if (ch === "'" || ch === '"') {
    scan.quote = ch;
    return 1;
  }
  if (ch === "$" && text[index + 1] === "'") return ansiCQuoted({ at: index + 2, command: text }).end - index;
  if (text.startsWith(open, index)) {
    scan.depth += 1;
    return open.length;
  }
  if (ch !== close) return 1;
  scan.depth -= 1;
  return scan.depth === 0 ? 0 : 1;
}

/**
 * The command substitution opening at `text[index]`, if one does in this quote context: `$(…)` (not the
 * arithmetic `$((…))`) and backticks anywhere but a single-quoted run, and process substitution `<(…)` /
 * `>(…)` only outside quotes. An unclosed one runs to the end of the text.
 *
 * @param text the text being scanned
 * @param index the position to test
 * @param quote the quote open at that position
 * @returns the substituted command line and the index just past the substitution, or `undefined`
 */
export function substitutionAt({
  text,
  index,
  quote,
}: {
  text: string;
  index: number;
  quote: OpenQuote;
}): { readonly inner: string; readonly end: number } | undefined {
  if (quote === "'") return undefined;
  const dollar = text.startsWith("$(", index) && !text.startsWith("$((", index);
  const process = quote === undefined && (text.startsWith("<(", index) || text.startsWith(">(", index));
  if (dollar || process) {
    const close = closingParen({ from: index + 2, text });
    const stop = close === -1 ? text.length : close;
    return { end: Math.min(stop + 1, text.length), inner: text.slice(index + 2, stop) };
  }
  if (text[index] === "`") {
    return backtickAt({ index, text });
  }
  return undefined;
}

/**
 * A legacy backtick substitution: it closes at the first UNESCAPED backtick, and inside it a backslash escapes
 * only `` ` ``, `$` and `\`, which is how `echo \`yarn typecheck\`` nests one (bash(1) § Command Substitution;
 * a review found the first escaped backtick read as the close).
 *
 * @param text the text being scanned
 * @param index the opening backtick
 * @returns the substituted command line, those escapes removed, and the index just past the close
 */
function backtickAt({ text, index }: { text: string; index: number }): {
  readonly inner: string;
  readonly end: number;
} {
  let at = index + 1;
  while (at < text.length && text[at] !== "`") {
    at += text[at] === "\\" ? 2 : 1;
  }
  const stop = Math.min(at, text.length);
  const inner = text.slice(index + 1, stop).replace(/\\([$`\\])/gu, "$1");
  return { end: Math.min(stop + 1, text.length), inner };
}
