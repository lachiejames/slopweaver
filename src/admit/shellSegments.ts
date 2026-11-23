/**
 * Split a raw shell command line into its individual segments, and recognise an env-var override scoped to
 * one of those segments. Shared by every guard that must judge a COMPOUND command segment-by-segment rather
 * than reading the whole token stream as one command — {@link ../mainCheckoutCommandTarget.js}'s cwd
 * resolution and {@link ../rawTools.js}'s raw-bypass classifier both build on this.
 *
 * This module owns none of git's own token semantics (that lives in `commandTokens.js`, and neither it nor
 * `rawTools.js` is a dependency of this module, to keep both directions of the import graph acyclic) — it only knows how a shell line is
 * cut into segments by `&&`/`||`/`|`/`;`/newline, and how an env-var assignment's scope tracks across those
 * separators.
 *
 * The splitter IS quote-aware: a separator character sitting inside a single- or double-quoted run (or
 * escaped by a bare backslash outside any quote) is part of that run's literal text, never a real shell
 * separator. This closes a gap the naive whitespace-blind version of this splitter used to leave open —
 * found live when a `gh api graphql` query's own multi-line document body (a real newline inside a quoted
 * `-f query='…'`) was misread as two separate command segments, each individually misclassified. This is
 * still deliberately a narrow static resolver, not a shell interpreter: shell expansion, grouped commands
 * (`( … )`, `{ … }`), and a `$'…'` ANSI-C-quoted run's own escape rules remain outside its scope and fail
 * open — the guards built on it are workflow safety nets, not security boundaries.
 *
 * ## Two splitters, and why the older callers stay on the first
 *
 * {@link commandSegments} (for `./pythonInvocation.ts`) is also comment-, heredoc- and
 * substitution-aware. A Codex planning pass ran {@link shellSegments} and measured all three leaks: `cat >
 * x.md <<'EOF'` with an interpreter line in its BODY emits that line as a command, a `true #` comment holding
 * one emits a fake command, and `echo $(true; …)` cuts the substitution in half. A guard refusing by first
 * word needs all three closed.
 *
 * The existing callers are NOT moved, on purpose. The same pass showed the main-checkout guards and the
 * supervisor-send guard only see a command a heredoc feeds to `bash` (`bash <<'EOF'\ngit switch topic\nEOF`)
 * BECAUSE the flat stream emits that body's lines as segments. Moving any of them onto
 * {@link commandSegments} needs an executable-body traversal in that caller, which is its own change.
 */
import { exportStep, NO_EXPORT, type SegmentOverrideOp } from "./exportScope.js";
import { ansiCQuoted, heredocLine } from "./heredocDelimiter.js";
import { ASSIGNMENT, localOverride } from "./prefixOverride.js";
import { type OpenQuote, substitutionAt } from "./shellBrackets.js";
import { arithmeticEnd, type HeredocOperator, heredocOperatorAt, opensComment } from "./shellSpans.js";
import { foregroundCommand } from "./shellWalk.js";

export type ShellSeparator = "&&" | "||" | "|" | ";" | "\n";

export interface ShellSegment {
  readonly command: string;
  readonly separatorAfter: ShellSeparator | undefined;
}

/** One heredoc's body, attached to the segment whose `<<` opened it. */
interface HeredocBody {
  /** The terminator word, with any quoting removed. */
  readonly delimiter: string;
  /** Every line between the operator's line and the terminator, raw, joined with `\n`. */
  readonly body: string;
  /** Whether the delimiter was quoted or backslashed, which turns expansion off inside the body. */
  readonly quoted: boolean;
  /** `<<-`: leading tabs were stripped when looking for the terminator line. */
  readonly stripTabs: boolean;
  /** The descriptor the body is redirected to — 0 unless written `3<<EOF`. */
  readonly descriptor: number;
  /** False when the body never terminated or its delimiter was `$'…'` or `$"…"`, so where bash ends it is not known. */
  readonly readable: boolean;
}

/** A {@link commandSegments} segment: the flat fields plus the heredoc bodies its own operators opened. */
export interface CommandSegment extends ShellSegment {
  readonly heredocs: readonly HeredocBody[];
}

/** The quote state after one character, and how many characters it consumed. */
export type QuoteStep = { readonly quote: OpenQuote; readonly advance: number };

/**
 * Advance the quote-tracking state machine by one shell character, mirroring the quoting rules
 * `argumentValue.js`'s own `extractShellWord` already applies at the single-argument level: inside a single
 * quote nothing escapes (only the matching quote closes it); inside a double quote a backslash escapes the
 * very next character (consuming it, so an escaped separator or quote character inside is never
 * reconsidered); outside any quote, a quote character opens a new run and a bare backslash escapes the next
 * character the same way. A character consumed as part of an escape is never itself re-examined as a
 * potential separator or quote — that is what `advance: 2` guarantees to the caller's loop.
 *
 * @param command the full command text being scanned
 * @param index the position of the character to step over
 * @param quote the quote state entering this character
 * @returns the quote state after this character, and how many characters were consumed (1, or 2 for an escape)
 */
export function stepShellQuote({
  command,
  index,
  quote,
}: {
  command: string;
  index: number;
  quote: OpenQuote;
}): QuoteStep {
  const ch = command[index]!; // index < command.length ⇒ in-bounds, guaranteed by the caller's loop condition
  const escapes = index + 1 < command.length;
  if (quote !== undefined) return stepInsideQuote({ ch, escapes, quote });
  if (ch === "'" || ch === '"') {
    return { advance: 1, quote: ch };
  }
  // `$'…'` is stepped over whole: its `\'` does not close it, so `$'\''; a; b` is one word then two commands.
  if (ch === "$" && command[index + 1] === "'") {
    return { advance: ansiCQuoted({ at: index + 2, command }).end - index, quote: undefined };
  }
  if (ch === "\\" && escapes) {
    return { advance: 2, quote: undefined };
  }
  return { advance: 1, quote: undefined };
}

/** One character inside an open quote: only its own quote closes it, and only `"…"` honours a backslash. */
function stepInsideQuote({ ch, escapes, quote }: { ch: string; escapes: boolean; quote: "'" | '"' }): QuoteStep {
  if (quote === '"' && ch === "\\" && escapes) return { advance: 2, quote };
  return ch === quote ? { advance: 1, quote: undefined } : { advance: 1, quote };
}

/** The real shell separator starting at `command[index]`, only ever checked OUTSIDE any open quote. */
function separatorAt({ command, index }: { command: string; index: number }): ShellSeparator | undefined {
  const two = command.slice(index, index + 2);
  if (two === "&&" || two === "||") return two;
  const one = command[index];
  return one === "|" || one === ";" || one === "\n" ? one : undefined;
}

/**
 * Split on the deliberately narrow separator set every guard built on this module recognises, quote-aware.
 *
 * @param command the raw shell command line to split
 * @returns each segment paired with the real separator that follows it (`undefined` for the last one)
 */
export function shellSegments({ command }: { command: string }): readonly ShellSegment[] {
  const segments: ShellSegment[] = [];
  let start = 0;
  let quote: OpenQuote;
  let index = 0;
  while (index < command.length) {
    if (quote === undefined) {
      const sep = separatorAt({ command, index });
      if (sep !== undefined) {
        segments.push({ command: command.slice(start, index), separatorAfter: sep });
        index += sep.length;
        start = index;
        continue;
      }
    }
    const step = stepShellQuote({ command, index, quote });
    quote = step.quote;
    index += step.advance;
  }
  segments.push({ command: command.slice(start), separatorAfter: undefined });
  return segments;
}

/** A heredoc registered on one segment, waiting for the end of its operator's line. */
interface PendingHeredoc extends HeredocOperator {
  readonly segmentIndex: number;
}

/** Read one body from `at` up to its terminator line. @returns the body, where reading stopped, and whether it terminated */
function readBody({ command, at: from, heredoc }: { command: string; at: number; heredoc: PendingHeredoc }): {
  readonly body: HeredocBody;
  readonly end: number;
  readonly terminated: boolean;
} {
  const lines: string[] = [];
  let at = from;
  let terminated = false;
  while (at < command.length && !terminated) {
    const read = heredocLine({ at, command, fold: !heredoc.quoted });
    const line = read.line;
    at = read.end;
    terminated = (heredoc.stripTabs ? line.replace(/^\t+/, "") : line) === heredoc.delimiter;
    if (!terminated) lines.push(line);
  }
  const { delimiter, quoted, stripTabs, descriptor, dollarQuoted } = heredoc;
  const readable = terminated && !dollarQuoted;
  return { body: { body: lines.join("\n"), delimiter, descriptor, quoted, readable, stripTabs }, end: at, terminated };
}

/**
 * Split a command line the way {@link shellSegments} does, and ALSO: skip a balanced command substitution
 * whole (its separators are its own), end a word-initial unquoted `#` comment at its newline, and attach each
 * heredoc body to the segment whose operator opened it instead of emitting its lines. A pending heredoc
 * survives later separators on the same line (`cat <<EOF; echo x\nbody\nEOF` attaches `body` to `cat`), and
 * an unterminated body runs to the end of the input, as bash reads it. Whether a body is a program (stdin of
 * `bash`) or data (`cat`) depends on that segment's own words, which only the caller has.
 *
 * @param command the raw shell command line to split
 * @returns each segment, its following separator, and the heredoc bodies it opened, in operator order
 */
export function commandSegments({ command }: { command: string }): readonly CommandSegment[] {
  const scan: SegmentScan = { bodies: [], command, cuts: [], pending: [], quote: undefined, start: 0 };
  let index = 0;
  while (index < command.length) {
    index = stepSegmentScan({ index, scan });
  }
  scan.cuts.push({ command: command.slice(scan.start), separatorAfter: undefined });
  return scan.cuts.map((cut, at) => ({ ...cut, heredocs: scan.bodies[at] ?? [] }));
}

/** The mutable state one {@link commandSegments} pass threads through its step functions. */
interface SegmentScan {
  readonly command: string;
  readonly cuts: { command: string; separatorAfter: ShellSeparator | undefined }[];
  readonly bodies: HeredocBody[][];
  pending: PendingHeredoc[];
  start: number;
  quote: OpenQuote;
}

/** One scan step. @returns the index the next step starts at */
function stepSegmentScan({ scan, index }: { scan: SegmentScan; index: number }): number {
  const substitution = substitutionAt({ index, quote: scan.quote, text: scan.command });
  if (substitution !== undefined) {
    return substitution.end;
  }
  if (scan.quote === undefined) {
    const skipped = unquotedSpanEnd({ index, scan });
    if (skipped !== undefined) return skipped;
    const sep = separatorAt({ command: scan.command, index });
    if (sep !== undefined) return cutAt({ index, scan, sep });
  }
  const step = stepShellQuote({ command: scan.command, index, quote: scan.quote });
  scan.quote = step.quote;
  return index + step.advance;
}

/**
 * The index past an unquoted span no separator inside may cut — arithmetic, a comment (up to, not over, its
 * newline, which still separates), or a heredoc operator, which is registered as pending on the way past.
 *
 * @returns the index past the span, or `undefined` when none opens at `index`
 */
function unquotedSpanEnd({ scan, index }: { scan: SegmentScan; index: number }): number | undefined {
  const { command } = scan;
  const arithmetic = arithmeticEnd({ command, index });
  if (arithmetic !== undefined) return arithmetic;
  if (opensComment({ command, index })) {
    const newline = command.indexOf("\n", index);
    return newline === -1 ? command.length : newline;
  }
  const operator = heredocOperatorAt({ command, index });
  if (operator === undefined) return undefined;
  scan.pending.push({ ...operator, segmentIndex: scan.cuts.length });
  return operator.end;
}

/** Cut a segment at a separator, reading every pending heredoc body when it is a newline. @returns the next index */
function cutAt({ scan, index, sep }: { scan: SegmentScan; index: number; sep: ShellSeparator }): number {
  scan.cuts.push({ command: scan.command.slice(scan.start, index), separatorAfter: sep });
  let at = index + sep.length;
  if (sep === "\n") {
    for (const pending of scan.pending) {
      const read = readBody({ at, command: scan.command, heredoc: pending });
      (scan.bodies[pending.segmentIndex] ??= []).push(read.body);
      at = read.end;
      if (!read.terminated) break;
    }
    scan.pending = [];
  }
  scan.start = at;
  return at;
}

/** Whether one segment's own command is an exact, argument-free `export NAME=1`. */
function isBareExportOverride({ command, name }: { command: string; name: string }): boolean {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  return tokens[0] === "export" && tokens.slice(1).includes(`${name}=1`);
}

/** Every token up to (not including) a trailing `#` comment -- a `#`-leading word ends the real command. */
function withoutTrailingComment({ tokens }: { tokens: readonly string[] }): readonly string[] {
  const commentStart = tokens.findIndex((t) => t.startsWith("#"));
  return commentStart === -1 ? tokens : tokens.slice(0, commentStart);
}

// `<>` (open for read+write) is a distinct two-character operator, not `<` with a stray `>` left over --
// it MUST be tried before the single-character `<` alternative or the regex engine matches the shorter one.
const REDIRECTION_OPERATOR = /^\d*(>>|<>|>|<)/;

/**
 * `tokens` with every redirection operator AND its target removed (`>file`, `> file`, `<>file`, `2>&1`,
 * ...) -- a redirection's own TARGET token is never a real word of the command, even when it happens to
 * look like an assignment itself (`> NAME=1` redirects to a file literally named `NAME=1`; that is never a
 * real assignment to `NAME`, so scanning it for operands would misread it as one).
 *
 * KNOWN, ACCEPTED RESIDUAL GAP, deeper than the quoted-string/comment ones already noted elsewhere in this
 * file: `tokens` themselves come from `command.trim().split(/\s+/)` (whitespace only), the SAME splitting
 * every function in this file already relies on. A real shell lexer treats `>`/`<`/`&`/`;`/`|` as
 * unconditional word boundaries even with NO surrounding whitespace, so `NAME=0>` (no space before `>`) is
 * lexically two words -- the assignment `NAME=0` and the operator `>` -- but arrives here as ONE glued token
 * this function's regex cannot split mid-token, since it only recognises an operator at a token's OWN
 * start. Solving this would mean rewriting the whole file's tokenisation strategy into a real shell lexer,
 * which this narrow static resolver deliberately is not (see the module doc) -- not something to patch
 * locally.
 */
function withoutRedirections({ tokens }: { tokens: readonly string[] }): readonly string[] {
  const kept: string[] = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (REDIRECTION_OPERATOR.test(token)) {
      const hasAttachedTarget = token.replace(REDIRECTION_OPERATOR, "").length > 0;
      index += hasAttachedTarget ? 1 : 2;
      continue;
    }
    kept.push(token);
    index += 1;
  }
  return kept;
}

/**
 * The last `NAME=<value>` operand among `tokens` (redirection targets already excluded), matched against
 * `1` -- or `undefined` when `name` is not among the operands at all.
 */
function lastOperandMatchesOne({ tokens, name }: { tokens: readonly string[]; name: string }): boolean | undefined {
  const operands = tokens.filter((t) => t.startsWith(`${name}=`));
  return operands.length === 0 ? undefined : operands[operands.length - 1] === `${name}=1`;
}

/**
 * What an `export ...` segment (the `export` keyword already consumed) does to `name` -- redirections are
 * stripped FIRST, so a `-n` flag is recognised regardless of where a redirection sits relative to it
 * (`export -n NAME >/dev/null` and `export >/dev/null -n NAME` are both valid, equivalent shell syntax).
 */
function exportStatementOp({ rest, name }: { rest: readonly string[]; name: string }): SegmentOverrideOp {
  const stripped = withoutRedirections({ tokens: rest });
  if (stripped[0] === "-n") return stripped.slice(1).includes(name) ? { kind: "unset" } : { kind: "unrelated" };
  const matchesOne = lastOperandMatchesOne({ name, tokens: stripped });
  return matchesOne === undefined ? { kind: "unrelated" } : { kind: "export-set", matchesOne };
}

/** What a bare, non-`export` assignment-only segment (`NAME=0`, redirections allowed) does to `name`. */
function bareAssignmentOp({ tokens, name }: { tokens: readonly string[]; name: string }): SegmentOverrideOp {
  const stripped = withoutRedirections({ tokens });
  if (stripped.length === 0 || !stripped.every((t) => ASSIGNMENT.test(t))) return { kind: "unrelated" };
  const matchesOne = lastOperandMatchesOne({ name, tokens: stripped });
  return matchesOne === undefined ? { kind: "unrelated" } : { kind: "bare-set", matchesOne };
}

/**
 * What one segment's own command does to `name`, distinguishing a REAL `export` (which sets the export
 * attribute itself) from a bare assignment (which only takes effect if `name` already carries that
 * attribute from an earlier `export` in scope -- a fresh, never-exported `NAME=1` is just a local shell
 * variable, invisible to a later command's environment). `unset NAME` and `export -n NAME` both clear the
 * attribute outright (`-n` removes the export property without unsetting the value, but once not exported
 * the value can never reach a later command either). A `NAME=0 cmd` prefix is "unrelated" -- that scopes
 * the reassignment to `cmd`'s own environment only, never the enclosing shell's variable. Tolerant of a
 * trailing `#` comment, and of multiple operands for the same variable in one export/assignment -- the LAST
 * operand wins, matching real shell assignment order (`export NAME=1 NAME=0` ends with `NAME=0`).
 *
 * @param command the segment's own command text
 * @param name the environment variable name whose exact value must be `1`
 * @returns the operation this segment performs on `name`, or "unrelated" if it does not touch `name` at all
 */
function segmentOverrideOp({ command, name }: { command: string; name: string }): SegmentOverrideOp {
  const tokens = withoutTrailingComment({ tokens: command.trim().split(/\s+/).filter(Boolean) });
  if (tokens.length === 0) return { kind: "unrelated" };
  if (tokens[0] === "unset") return tokens.slice(1).includes(name) ? { kind: "unset" } : { kind: "unrelated" };
  if (tokens[0] === "export") return exportStatementOp({ name, rest: tokens.slice(1) });
  return bareAssignmentOp({ name, tokens });
}

/** Whether an exact `export NAME=1` is followed immediately by one command in this invocation. */
function exportedOverride({ segments, name }: { segments: readonly ShellSegment[]; name: string }): boolean {
  if (segments.length !== 2 || segments[1]!.command.trim().length === 0) return false;
  const first = segments[0]!;
  if (first.separatorAfter !== "&&" && first.separatorAfter !== ";" && first.separatorAfter !== "\n") return false;
  return isBareExportOverride({ command: first.command, name });
}

/**
 * Whether this segment carries no command a shell would actually run — blank, or a bare `#` comment line.
 *
 * KNOWN, ACCEPTED RESIDUAL GAP, same class as this module's own documented one for quoted strings: `#`
 * itself only starts a comment when SHELL_SEPARATOR hasn't already split the line on a `;`/`&&`/`|`
 * character that happens to sit INSIDE that comment's own text (`true # ; export NAME=1` splits into a
 * fake `export NAME=1` segment, which this function cannot then recognise as commented-out). Solving that
 * would mean this narrow static resolver becoming a real shell tokenizer, which it deliberately is not —
 * see the module doc. Only a segment that IS ENTIRELY a comment (this function's actual job) is handled.
 * {@link commandSegments} does not have this gap; the flat {@link shellSegments} still does.
 */
function isTransparentSegment({ command }: { command: string }): boolean {
  const trimmed = command.trim();
  return trimmed.length === 0 || trimmed.startsWith("#");
}

/**
 * Whether entering `segments[index]` crosses a pipe -- walking back over any transparent gap segment
 * first, since a newline (optionally preceded by a `#` comment) immediately after `|` is shell
 * line-continuation, not a fresh statement: `a | # note\nb` splits into `["a", "# note", "b"]` (the comment
 * sitting between the `|` and `\n` separator matches), and the pipe boundary that matters is the one before
 * that gap, not the no-op segment's own separator. A `|` hidden inside a quoted string or a comment's own
 * text is a pre-existing, documented limitation of this narrow static resolver (see the module doc), not
 * something this walk attempts to solve.
 */
function precededByPipe({ segments, index }: { segments: readonly ShellSegment[]; index: number }): boolean {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (segments[i]!.separatorAfter === "|") return true;
    if (!isTransparentSegment({ command: segments[i]!.command })) return false;
  }
  return false;
}

/**
 * Whether a bare `export NAME=1` earlier in the same invocation is still in scope at `index` — walked segment by
 * segment through {@link exportStep} (`./exportScope.ts`), which carries the rules: what persists, what a pipe or a
 * background `&` forks away, and what a short-circuit may have skipped.
 */
function exportActiveAt({
  segments,
  index,
  name,
}: {
  segments: readonly ShellSegment[];
  index: number;
  name: string;
}): boolean {
  let state = NO_EXPORT;
  for (let i = 0; i < index; i += 1) {
    const segment = segments[i]!;
    const own = segmentOverrideOp({ command: foregroundCommand({ command: segment.command }), name });
    const op = precededByPipe({ segments, index: i }) ? "piped" : own;
    state = exportStep({ entry: segments[i - 1]?.separatorAfter, exit: segment.separatorAfter, op, state });
  }
  return state.active;
}

/**
 * The override at one segment: its own prefix decides when it touches `name` at all, and only a prefix
 * that leaves `name` alone falls back to an export still in scope.
 */
function overrideAt({
  segments,
  segmentIndex,
  name,
}: {
  segments: readonly ShellSegment[];
  segmentIndex: number;
  name: string;
}): boolean {
  const segment = segments[segmentIndex];
  if (segment === undefined) return false;
  const local = localOverride({ command: segment.command, name });
  if (local !== "inherit") return local === "allow";
  return exportActiveAt({ index: segmentIndex, name, segments });
}

/**
 * Recognise an explicit override scoped to this Bash invocation, matching both guard escape hatches.
 *
 * @param command the raw Bash tool command
 * @param name the environment variable name whose exact value must be `1`
 * @returns whether the command starts with `NAME=1 command`, `env NAME=1 command`, or `export NAME=1`
 */
export function hasInlineEnvironmentOverride({ command, name }: { command: string; name: string }): boolean {
  const segments = shellSegments({ command });
  return (
    (segments.length === 1 && localOverride({ command: segments[0]!.command, name }) === "allow") ||
    exportedOverride({ name, segments })
  );
}

/**
 * Recognise an override scoped to ONE segment of a compound command — its own `NAME=1`/`env NAME=1` prefix,
 * or a preceding bare `export NAME=1` still in scope at that position — rather than requiring the override
 * to cover the entire invocation. A `NAME=1 cmd` prefix is a POSIX temporary assignment scoped to the ONE
 * simple command it prefixes; this checks that scope directly instead of the whole command's shape, so an
 * unrelated second segment (a trailing `echo`, a second command after a newline) no longer breaks the match
 * for the segment that actually carries it. Safe to relax this way here (unlike a whole-command boolean)
 * for any caller that already judges each segment's own risk independently — an override on one segment can
 * never authorise another. The segment's own prefix is decided first: `NAME=0 cmd` or `env -u NAME cmd`
 * after an `export NAME=1` is NOT armed.
 *
 * @param command the full raw Bash tool command, so preceding segments can be re-derived the same way
 * @param segmentIndex the position of the segment being evaluated, from {@link shellSegments}
 * @param name the environment variable name whose exact value must be `1`
 * @returns whether this specific segment is covered by an active override
 */
export function hasSegmentInlineEnvironmentOverride({
  command,
  segmentIndex,
  name,
}: {
  command: string;
  segmentIndex: number;
  name: string;
}): boolean {
  return overrideAt({ name, segmentIndex, segments: shellSegments({ command }) });
}

/**
 * {@link hasSegmentInlineEnvironmentOverride} over {@link commandSegments}' indices, for a caller that walks
 * that splitter. An index from one splitter must never be resolved against the other.
 *
 * @param command the command line the index was taken from — a nested payload's own text, never its parent's
 * @param segmentIndex the position among {@link commandSegments}' segments
 * @param name the environment variable name whose exact value must be `1`
 * @returns whether this specific segment is covered by an active override
 */
export function hasCommandSegmentOverride({
  command,
  segmentIndex,
  name,
}: {
  command: string;
  segmentIndex: number;
  name: string;
}): boolean {
  return overrideAt({ name, segmentIndex, segments: commandSegments({ command }) });
}
