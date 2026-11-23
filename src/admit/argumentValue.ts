/**
 * Reading ONE argument's literal VALUE, for `./rawTools.ts` — the single-argument half of shell lexing,
 * kept apart from `./shellLexing.ts` because the two answer different questions over the same syntax. That
 * module cuts a whole command line into words and remembers, per word, whether quoting or an expansion was
 * used; this one walks the front of a single argument and returns the string a shell would actually hand
 * the program, which is what a classifier has to judge a `query=` field or a `-c` payload on.
 *
 * Pure, no I/O. It resolves quoting and escapes — an ANSI-C `$'…'` run's escapes included — and nothing else.
 * A caller judging a value that must be fully static asks {@link usesShellExpansion} first and refuses to
 * analyse on any `$` or backtick; this module never attempts to evaluate an expansion.
 */

import { ansiCQuoted, DOUBLE_QUOTE_ESCAPES } from "./heredocDelimiter.js";

/**
 * Whether `text` contains a `$` or a backtick anywhere — any shell expansion or command substitution
 * mechanism (`$VAR`, `$(cmd)`, `` `cmd` ``, ANSI-C `$'…'`, locale `$"…"`). Any of these means the actual
 * runtime value cannot be known from the static command text at all, so it is reason enough to stop
 * analysing the query field entirely rather than attempt to resolve it.
 *
 * @param text the text to check
 * @returns whether it contains shell expansion syntax
 */
export function usesShellExpansion({ text }: { text: string }): boolean {
  return /[$`]/.test(text);
}

/** The common shape every quote-state step returns, so the loop driving them stays a flat dispatch. */
interface ShellWordStep {
  readonly ended: boolean;
  readonly quote: "'" | '"' | undefined;
  readonly literal: string;
  readonly consumedNext: boolean;
}

const NOT_ENDED_NO_QUOTE = { ended: false, quote: undefined } as const;

/** One step inside a single-quoted run: no escapes at all, only the matching quote closes it. */
function stepSingleQuoted({ ch }: { ch: string }): ShellWordStep {
  return ch === "'"
    ? { ...NOT_ENDED_NO_QUOTE, consumedNext: false, literal: "" }
    : { ...NOT_ENDED_NO_QUOTE, consumedNext: false, literal: ch, quote: "'" };
}

/**
 * One step inside a double-quoted run: a backslash before `"`, `\`, `$` or a backtick is an escape (the shell's
 * own set, `DOUBLE_QUOTE_ESCAPES`), a backslash-newline is a POSIX line CONTINUATION removed entirely (found by an
 * adversarial review pass — treating it as a literal backslash left a `\`-then-newline sitting between two halves
 * of a word the shell actually joins with nothing at all), and everything else is literal.
 */
function stepDoubleQuoted({ ch, next }: { ch: string; next: string | undefined }): ShellWordStep {
  if (ch === '"') {
    return { ...NOT_ENDED_NO_QUOTE, consumedNext: false, literal: "" };
  }
  if (ch === "\\" && next === "\n") {
    return { ...NOT_ENDED_NO_QUOTE, consumedNext: true, literal: "", quote: '"' };
  }
  if (ch === "\\" && next !== undefined && DOUBLE_QUOTE_ESCAPES.has(next)) {
    return { ...NOT_ENDED_NO_QUOTE, consumedNext: true, literal: next, quote: '"' };
  }
  return { ...NOT_ENDED_NO_QUOTE, consumedNext: false, literal: ch, quote: '"' };
}

/**
 * One step outside any quote: whitespace ends the word, a quote character opens a new run, and — same
 * reasoning as {@link stepDoubleQuoted} — a backslash-newline is a removed line continuation rather than a
 * literal escape of the newline character.
 */
function stepUnquoted({ ch, next }: { ch: string; next: string | undefined }): ShellWordStep {
  if (ch === "\\" && next === "\n") {
    return { consumedNext: true, ended: false, literal: "", quote: undefined };
  }
  if (/\s/.test(ch)) {
    return { consumedNext: false, ended: true, literal: "", quote: undefined };
  }
  if (ch === "'" || ch === '"') {
    return { consumedNext: false, ended: false, literal: "", quote: ch };
  }
  if (ch === "\\" && next !== undefined) {
    return { consumedNext: true, ended: false, literal: next, quote: undefined };
  }
  return { consumedNext: false, ended: false, literal: ch, quote: undefined };
}

/** Dispatch one character to the step function for the current quote state. */
function shellWordStep({
  ch,
  next,
  quote,
}: {
  ch: string;
  next: string | undefined;
  quote: "'" | '"' | undefined;
}): ShellWordStep {
  if (quote === "'") return stepSingleQuoted({ ch });
  if (quote === '"') return stepDoubleQuoted({ ch, next });
  return stepUnquoted({ ch, next });
}

/**
 * Read ONE shell word out of the front of `text`, concatenating adjacent quoted and unquoted runs exactly
 * as a shell would, so a keyword cannot be hidden by splitting it across a quote boundary. Stops at the
 * first unquoted whitespace. An ANSI-C `$'…'` run is DECODED with the same `ansiCQuoted` the command lexer
 * uses, so `$'\x67cloud'` is the word `gcloud` here exactly as it is to bash and to `./shellLexing.ts`; a
 * locale `$"…"` run is double quoting.
 *
 * @param text the argument text to read from, starting at the word
 * @returns the word's literal value, with quoting and escapes resolved
 */
export function extractShellWord({ text }: { text: string }): string {
  let value = "";
  let quote: "'" | '"' | undefined;
  for (let i = 0; i < text.length; i += 1) {
    const dollarQuote = quote === undefined && text[i] === "$" ? text[i + 1] : undefined;
    if (dollarQuote === "'") {
      const decoded = ansiCQuoted({ at: i + 2, command: text });
      value += decoded.text;
      i = decoded.end - 1;
      continue;
    }
    if (dollarQuote === '"') {
      quote = '"';
      i += 1;
      continue;
    }
    const step = shellWordStep({ ch: text[i]!, next: text[i + 1], quote });
    if (step.ended) break;
    value += step.literal;
    quote = step.quote;
    if (step.consumedNext) i += 1;
  }
  return value;
}

/**
 * Strip one surrounding quote pair from a `-c` payload, so the shell line inside can be re-split.
 *
 * Only a matched pair, and only the outermost one: anything else is left exactly as it is and classified as
 * written. Guessing at partial quoting would change the text being judged, and a classifier that judges text
 * the shell would not run is worse than one that misses a shape.
 *
 * @param text the raw argument text following `-c`
 * @returns the payload with one matched outer quote pair removed, or the text unchanged
 */
export function unquoteShellPayload({ text }: { text: string }): string {
  const first = text[0];
  if ((first === "'" || first === '"') && text.length >= 2 && text.endsWith(first)) {
    return text.slice(1, -1);
  }
  return text;
}
