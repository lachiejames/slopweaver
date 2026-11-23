/**
 * Which heredoc, if any, a command reads as STDIN: redirections applied left to right, a descriptor copy
 * followed back to what it copies. Split out of `./shellSegments.ts`, whose lexing it reads.
 */
import { type OpenQuote, substitutionAt } from "./shellBrackets.js";
import { stepShellQuote } from "./shellSegments.js";
import { arithmeticEnd, descriptorDigits, heredocOperatorAt, opensComment } from "./shellSpans.js";

/** One redirection: which descriptor it rebinds, whether it is a heredoc, and where it ends. */
interface Redirection {
  readonly descriptor: number;
  readonly heredoc: boolean;
  readonly end: number;
  /**
   * What a `<&N` or `>&N` copies onto {@link descriptor}: `N`, or `undefined` when an expansion picks it. `<&N-`
   * moves it.
   */
  readonly source?: { readonly descriptor: number | undefined; readonly moves: boolean } | undefined;
}

/** The two-character redirection operators, longest first where they share a prefix. */
const TWO_CHAR_REDIRECTIONS = new Set(["<>", "<&", ">>", ">&", ">|"]);

/**
 * The redirection starting at `command[index]`, never a process substitution (`<(`). An OUTPUT operator
 * counts too, because an explicit `0>` rebinds stdin just as `<` does — a Codex review measured
 * `bash <<'A' 0>/dev/null` reading no heredoc at all. A `<` defaults to descriptor 0 and a `>` to 1.
 *
 * @param command the full command text
 * @param index the position to test
 * @returns the redirection, or `undefined` when none starts here
 */
function redirectionAt({ command, index }: { command: string; index: number }): Redirection | undefined {
  const ch = command[index];
  if ((ch !== "<" && ch !== ">") || command[index + 1] === "(") {
    return undefined;
  }
  const operator = heredocOperatorAt({ command, index });
  if (operator !== undefined) {
    return { descriptor: operator.descriptor, end: operator.end, heredoc: true };
  }
  let width = 1;
  if (command.slice(index, index + 3) === "<<<") width = 3;
  else if (TWO_CHAR_REDIRECTIONS.has(command.slice(index, index + 2))) width = 2;
  // No digits written is absence by design: `<` then means descriptor 0, and `>` descriptor 1.
  let descriptor = ch === "<" ? 0 : 1;
  const written = descriptorDigits({ command, index });
  if (written !== undefined) descriptor = written;
  const duplicates = width === 2 && command[index + 1] === "&";
  const source = duplicates ? duplicatedDescriptor({ command, index: index + 2 }) : undefined;
  return { descriptor, end: index + width, heredoc: false, source };
}

/**
 * The descriptor a `<&` or `>&` copies: the digits after it, blanks allowed, then an optional `-` that MOVES it.
 * A lone `-` closes, and copies nothing. Any other word (`$((3))`, `$fd`) is chosen when bash expands it, so its
 * descriptor is `undefined`, unreadable rather than none (a counterexample).
 */
function duplicatedDescriptor({ command, index }: { command: string; index: number }): Redirection["source"] {
  const rest = command.slice(index);
  const digits = /^[ \t]*(\d+)(-?)(?=$|[\s;&|<>()])/.exec(rest);
  if (digits !== null) return { descriptor: Number(digits[1]), moves: digits[2] === "-" };
  if (/^[ \t]*(?:-(?=$|[\s;&|<>()])|$|[\n;&|()])/.test(rest)) return undefined;
  return { descriptor: undefined, moves: false };
}

/**
 * Which of a segment's heredocs its command reads as STDIN: the LAST redirection of descriptor 0 wins. So
 * `bash <<'A' <<'B'` reads `B`, `bash <<'A' </dev/null` and `bash <<'A'</dev/null` read no heredoc at all, and
 * `bash 3<<'A'` never reads `A` as its program. A copy follows the descriptor it copies at that point, left to
 * right as bash applies them, so `bash 3<<'A' <&3` DOES read `A` (a counterexample) while
 * `bash <&3 3<<'A'` does not. Heredocs are counted across every descriptor in source order, matching the order
 * {@link commandSegments} attaches their bodies.
 *
 * Text, not words, because the two redirections in `<<'A'</dev/null` are one whitespace-delimited word — the
 * counterexample a Codex review produced against the word-level version of this.
 *
 * @param command one segment's own command text
 * @returns the index into that segment's `heredocs` stdin reads, or `undefined` when stdin is not a heredoc
 */
export function stdinHeredocIndex({ command }: { command: string }): number | undefined {
  const scan: StdinScan = { descriptors: new Map(), done: false, heredocs: 0, quote: undefined };
  let index = 0;
  while (index < command.length && !scan.done) {
    index = stepStdinScan({ command, index, scan });
  }
  return scan.descriptors.get(0);
}

/**
 * How many heredoc operators a command's own text opens, counted exactly as {@link stdinHeredocIndex} counts them
 * — so a slice of one segment can be handed the bodies its own operators opened, in source order.
 *
 * @param command one segment's command text, or one slice of it
 * @returns the number of heredoc operators, on any descriptor
 */
export function heredocOperatorCount({ command }: { command: string }): number {
  const scan: StdinScan = { descriptors: new Map(), done: false, heredocs: 0, quote: undefined };
  let index = 0;
  while (index < command.length && !scan.done) {
    index = stepStdinScan({ command, index, scan });
  }
  return scan.heredocs;
}

/** The state one {@link stdinHeredocIndex} pass threads through its steps. */
interface StdinScan {
  quote: OpenQuote;
  heredocs: number;
  /** The heredoc each descriptor reads so far, `undefined` once anything else is bound to it. */
  readonly descriptors: Map<number, number | undefined>;
  done: boolean;
}

/** One scan step. @returns the index the next step starts at */
function stepStdinScan({ command, index, scan }: { command: string; index: number; scan: StdinScan }): number {
  const substitution = substitutionAt({ index, quote: scan.quote, text: command });
  if (substitution !== undefined) {
    return substitution.end;
  }
  if (scan.quote === undefined) {
    const skipped = stdinSpanEnd({ command, index, scan });
    if (skipped !== undefined) return skipped;
  }
  const step = stepShellQuote({ command, index, quote: scan.quote });
  scan.quote = step.quote;
  return index + step.advance;
}

/**
 * The index past an arithmetic span, a comment (which ends the command's words) or a redirection, applying
 * the redirection to `scan`.
 *
 * @returns the index past the span, or `undefined` when none opens at `index`
 */
function stdinSpanEnd({
  command,
  index,
  scan,
}: {
  command: string;
  index: number;
  scan: StdinScan;
}): number | undefined {
  const arithmetic = arithmeticEnd({ command, index });
  if (arithmetic !== undefined) return arithmetic;
  if (opensComment({ command, index })) {
    scan.done = true;
    return command.length;
  }
  const redirection = redirectionAt({ command, index });
  if (redirection === undefined) return undefined;
  if (redirection.heredoc) scan.heredocs += 1;
  let bound: number | undefined;
  if (redirection.heredoc) bound = scan.heredocs - 1;
  else if (redirection.source !== undefined) bound = copiedHeredoc({ scan, source: redirection.source.descriptor });
  scan.descriptors.set(redirection.descriptor, bound);
  // A move (`0<&3-`, a counterexample) copies, then closes what it copied from.
  const from = redirection.source?.moves === true ? redirection.source.descriptor : undefined;
  if (from !== undefined && from !== redirection.descriptor) scan.descriptors.set(from, undefined);
  return redirection.end;
}

/**
 * The heredoc a copy carries: the one its source descriptor holds, or — when an expansion picks the source —
 * the latest heredoc any descriptor still holds, so an unreadable copy fails closed.
 */
function copiedHeredoc({ scan, source }: { scan: StdinScan; source: number | undefined }): number | undefined {
  if (source !== undefined) return scan.descriptors.get(source);
  const held = [...scan.descriptors.values()].filter((heredoc) => heredoc !== undefined);
  return held.length === 0 ? undefined : Math.max(...held);
}
