/**
 * Which `SessionStart` hooks a seat's boot RECORDED as never having run — read off the records Claude Code
 * writes, so a hook whose failure was recorded but delivered nothing is a counted, named failure rather than a
 * missing line of context. A hook whose command discards its own error (`slopweaver-init`) records nothing,
 * and is invisible here.
 *
 * ## Why this exists
 *
 * The `SessionStart` hooks that load the owner's profile and the open run's brief used to run
 * from the per-root plugin mirror, while `scripts/plugin-mirror-sync.sh` — a sibling in the SAME event, which
 * Claude Code starts in parallel — was still building it. On a fresh worktree the mirror's `current` did not
 * exist yet, so `/bin/sh` exited 127 before `scripts/hook.sh` ever ran, and the session was told nothing.
 * MEASURED: 119 of the 152 transcripts touched in the previous day carried one. Repro:
 *
 * ```bash
 * find ~/.claude/projects -maxdepth 2 -name '*.jsonl' -mtime -1 \
 *   -exec grep -l '"hookEvent":"SessionStart","stderr":"Failed with non-blocking status code: /bin/sh' {} + | wc -l
 * ```
 *
 * Both context hooks fail OPEN by design, so nothing about the session looks wrong. The registration test
 * (`unit/context/hookMirrorKey.test.ts`) proves the shape of `hooks.json`; this proves DELIVERY, off the
 * seat's own boot records, which is the half no test under `src/` can reach.
 *
 * ## The two shapes it counts
 *
 * ```json
 * {"type":"attachment","sessionId":"…","cwd":"…","timestamp":"…",
 *  "attachment":{"type":"hook_non_blocking_error","hookName":"SessionStart:startup","hookEvent":"SessionStart",
 *                "stderr":"Failed with non-blocking status code: /bin/sh: …/current/scripts/hook.sh: No such file or directory",
 *                "exitCode":127,"command":"…","durationMs":554}}
 * ```
 *
 * - **`exit-127`** — the shell could not find the command's first word (`scripts/hook.sh` for every entry
 *   here), so no hook code ran.
 * - **`no-target`** — `scripts/hook.sh` ran but its target was absent, which it reports as
 *   `hook.sh: <label> has no executable at <path>` and exits 0 (fail-open). Exit 0 is not delivery.
 *
 * Pure: text in, typed values out. The shell that walks files is `transcripts boot-hooks`.
 */

import { isRecord } from "../lib/parsers.js";

/*
 * A literal every line this reads must contain, checked before any parse — almost no line is a hook record.
 * The bare event name rather than the `"hookEvent":"SessionStart"` pair, so JSON spacing can never hide one.
 * It assumes the writer does not `\u`-escape ASCII, which `JSON.stringify` never does — the gate is what
 * keeps this probe from parsing every line of every transcript, and no writer here produces that shape.
 */
const GATE_LITERAL = '"SessionStart"';

/** The exit code a shell returns when a command's first word names nothing. */
const COMMAND_NOT_FOUND = 127;

/*
 * The WHOLE stderr of a `scripts/hook.sh` call whose target is not there, capturing `<label>`: it prints this
 * one line and starts nothing, so a record carrying anything more — or the phrase mid-line — had a target run.
 * Its `run_target` returns 0 after printing it, so the record is a success that Claude Code never prefixes
 * with "Failed with non-blocking status code:", and a prefixed copy is some target's own output.
 */
const NO_TARGET_LINE = /^hook\.sh: (\S+) has no executable at .+ — this hook ran no check at all\n?$/su;

/** The exit code `scripts/hook.sh` returns after reporting its target missing (`run_target`'s `return 0`). */
const NO_TARGET_EXIT = 0;

/**
 * `scripts/hook.sh`'s second argument — the literal label every `hooks.json` entry names itself by. Unanchored,
 * so the door-gated `PreToolUse` row's leading `SLOPWEAVER_HOOK_GIVE_UP=2` is read past rather than parsed.
 */
const COMMAND_LABEL = /scripts\/hook\.sh["']?\s+["']?\d+["']?\s+["']?([^\s"']+)/u;

/**
 * The `scripts/hook.sh` label a registered command names itself by.
 *
 * @param command the `hooks.json` command, verbatim
 * @returns the label, or `undefined` for a command that does not run through `scripts/hook.sh`
 */
export function hookLabel({ command }: { command: string }): string | undefined {
  return COMMAND_LABEL.exec(command)?.[1];
}

/*
 * The WHOLE stderr of a command line whose first word the invoking `sh` could not find — the host's own
 * prefix, then that shell's one sentence and nothing after it (bash says "No such file or directory", maybe
 * after "line <n>: ", dash "<n>: … not found"), capturing the path — spaces and newlines included, since a quoted plugin root may hold
 * either and still be one word. A target that ran and missed something prints under its OWN name,
 * or prints more, so neither matches. MEASURED: 1551 of 1551 recorded failures over 7 days were
 * exactly this line — `slopweaver transcripts boot-hooks --since 7d --limit 100000 --json`, each `stderr`.
 */
const SHELL_NOT_FOUND =
  /^(?:Failed with non-blocking status code: )?(?:\/bin\/)?sh: (?:(?:line )?\d+: )?(.+): (?:No such file or directory|(?:command )?not found)\n?$/su;

/** A `$` parameter name or special parameter, read from just after the `$`. */
const PARAMETER_NAME = /^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/u;

/*
 * Where a quoted run opening at `start` closes — `'…'` at its next quote, `"…"` at its next unescaped one —
 * or the end of the text when it never does.
 */
function quotedEnd({ text, start }: { text: string; start: number }): number {
  const quote = text[start];
  for (let index = start + 1; index < text.length; index += 1) {
    if (quote === '"' && text[index] === "\\") {
      index += 1;
    } else if (text[index] === quote) {
      return index;
    }
  }
  return text.length;
}

/*
 * Where a shell expansion starting at `start` ends — `${…}` and `$(…)` by bracket depth, skipping quoted runs
 * and escaped characters inside, `$NAME`, or a backtick pair — or `start` itself for a `$` that expands
 * nothing and stays literal. A `case` pattern, heredoc or comment inside a substitution can still unbalance
 * the count; no registered hook's first word holds one.
 */
function expansionEnd({ text, start }: { text: string; start: number }): number {
  if (text[start] === "`") {
    return backtickEnd({ text, start });
  }
  const opener = text[start + 1];
  if (opener === "{" || opener === "(") {
    return bracketEnd({ text, start });
  }
  const name = PARAMETER_NAME.exec(text.slice(start + 1));
  return name === null ? start : start + 1 + name[0].length;
}

/* Where a backtick substitution opening at `start` closes, past its next unescaped backtick. */
function backtickEnd({ text, start }: { text: string; start: number }): number {
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
    } else if (text[index] === "`") {
      return index + 1;
    }
  }
  return text.length;
}

/* Where a `${…}` or `$(…)` opening at `start` closes, by bracket depth over its unquoted, unescaped text. */
function bracketEnd({ text, start }: { text: string; start: number }): number {
  const opener = text[start + 1];
  const closer = opener === "{" ? "}" : ")";
  let depth = 0;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      index = quotedEnd({ text, start: index });
      continue;
    }
    depth += Number(char === opener) - Number(char === closer);
    if (depth === 0) {
      return index + 1;
    }
  }
  return text.length;
}

/* The first word's tokenizer state, which each step below advances past what it consumed. */
interface WordScan {
  readonly text: string;
  index: number;
  readonly pieces: string[];
  current: string;
  quote: "'" | '"' | undefined;
  // Whether any quoting has touched this word yet: a tilde expands only as the word's first, UNQUOTED
  // character, so `"~/run"` and `""~/run` name a literal `~`.
  quoted: boolean;
}

/* Inside '…' every character is literal up to the closing quote. */
function stepSingleQuoted({ scan }: { scan: WordScan }): void {
  const char = scan.text[scan.index]!;
  if (char === "'") {
    scan.quote = undefined;
  } else {
    scan.current += char;
  }
  scan.index += 1;
}

/* A quote that opens or closes a quoted run; `false` when the character is not one. */
function stepQuote({ scan }: { scan: WordScan }): boolean {
  const char = scan.text[scan.index];
  const opens = char === '"' || (char === "'" && scan.quote === undefined);
  if (!opens) {
    return false;
  }
  const opener: "'" | '"' = char === '"' ? '"' : "'";
  scan.quote = scan.quote === opener ? undefined : opener;
  scan.quoted = true;
  scan.index += 1;
  return true;
}

/* A backslash: an escape outside quotes, inside "…" only before its own specials; `false` for any other character. */
function stepBackslash({ scan }: { scan: WordScan }): boolean {
  if (scan.text[scan.index] !== "\\") {
    return false;
  }
  const next = scan.text[scan.index + 1];
  const escapes = scan.quote === undefined || (next !== undefined && '$`"\\\n'.includes(next));
  // A line continuation is removed before the word is read at all, so it quotes nothing.
  const continuation = next === "\n";
  if (!continuation) {
    scan.quoted = true;
  }
  if (escapes && next !== undefined && !continuation) {
    scan.current += next;
  }
  if (!escapes) {
    scan.current += "\\";
  }
  scan.index += escapes ? 2 : 1;
  return true;
}

/* How long a tilde-prefix at the scan's position is — to the first slash or the word's end — or 0 for none. */
function tildeLength({ scan }: { scan: WordScan }): number {
  const wordStart = scan.pieces.length === 0 && scan.current === "" && scan.quote === undefined && !scan.quoted;
  if (scan.text[scan.index] !== "~" || !wordStart) {
    return 0;
  }
  // It expands only if none of it is quoted.
  const prefix = /^~[^/\s"'\\]*(?=$|[/\s])/u.exec(scan.text.slice(scan.index));
  return prefix === null ? 0 : prefix[0].length;
}

/* An expansion or tilde-prefix, closing the current piece and skipping it; `false` when none starts here. */
function stepExpansion({ scan }: { scan: WordScan }): boolean {
  const char = scan.text[scan.index];
  const expands = char === "$" || char === "`";
  const end = expands ? expansionEnd({ start: scan.index, text: scan.text }) : scan.index + tildeLength({ scan });
  if (end <= scan.index) {
    return false;
  }
  scan.pieces.push(scan.current);
  scan.current = "";
  scan.index = end;
  return true;
}

/*
 * The command's FIRST word as its literal pieces, split wherever the shell would expand something — a `$` or
 * backtick expansion, or an unquoted leading `~` or `~user` — since the record keeps every one unexpanded. POSIX quoting is removed on the way: '…' is literal, "…" honours
 * only its own backslash escapes, a bare backslash escapes the next character. `undefined` for no first word,
 * or for quoting that never closes — the shell refuses that line outright rather than exiting 127.
 */
function firstWordPieces({ command }: { command: string }): readonly string[] | undefined {
  const scan: WordScan = {
    current: "",
    index: 0,
    pieces: [],
    quote: undefined,
    quoted: false,
    text: command.trimStart(),
  };
  while (scan.index < scan.text.length && (scan.quote !== undefined || !/\s/u.test(scan.text[scan.index]!))) {
    if (scan.quote === "'") {
      stepSingleQuoted({ scan });
    } else if (!stepQuote({ scan }) && !stepBackslash({ scan }) && !stepExpansion({ scan })) {
      scan.current += scan.text[scan.index]!;
      scan.index += 1;
    }
  }
  scan.pieces.push(scan.current);
  const empty = scan.pieces.length === 1 && scan.current === "";
  return scan.quote !== undefined || empty ? undefined : scan.pieces;
}

/*
 * Whether a path the shell could not find is the command's own FIRST word: every literal piece in order, each
 * expansion between them standing for any text, as a glob would. A record with no command names no first
 * word, so nothing on it can be judged unstarted. This is a matcher for the shapes above, not a shell, and
 * it errs one way only: grammar it does not model — an alias, a function, a changed IFS, a glob that matched
 * something, a substitution it cannot balance — reads as a first word the path does not fit, so the record
 * is UNDER-reported, never a hook that ran counted as unstarted. Every entry this repository registers, and
 * every record measured on this machine, is inside what it models.
 */
function namesFirstWord({ command, path }: { command: string; path: string }): boolean {
  const pieces = firstWordPieces({ command });
  if (pieces === undefined) {
    return false;
  }
  const first = pieces[0]!;
  const last = pieces.at(-1)!;
  if (pieces.length === 1) {
    return path === first;
  }
  const end = path.length - last.length;
  if (end < first.length || !path.startsWith(first) || !path.endsWith(last)) {
    return false;
  }
  let cursor = first.length;
  for (const piece of pieces.slice(1, -1)) {
    const at = path.indexOf(piece, cursor);
    if (at === -1 || at + piece.length > end) {
      return false;
    }
    cursor = at + piece.length;
  }
  return true;
}

/**
 * How a boot hook failed to run — see the file header for each.
 *
 * @internal
 */
export type BootHookFailureKind = "exit-127" | "no-target";

/** One `SessionStart` hook call recorded as never having run its hook. */
export interface BootHookFailure {
  /** Which of the two shapes it was. */
  readonly kind: BootHookFailureKind;
  /** `hookName` — the event with the matcher that selected it, e.g. `SessionStart:startup`. */
  readonly hookName: string;
  /** The session id the line carried, or "" when it named none. */
  readonly sessionId: string;
  /** The session's working directory, or "". */
  readonly cwd: string;
  /** The line's ISO instant, or "". */
  readonly timestamp: string;
  /** The `hooks.json` command, verbatim, or "" — what names WHICH entry this was. */
  readonly command: string;
  /** The stderr Claude Code recorded, verbatim. */
  readonly stderr: string;
  /** The 1-based line it was read from, so an answer can point at its own evidence. */
  readonly lineNumber: number;
}

/**
 * A string field off a decoded object, or "" when it is absent or not a string.
 *
 * @param on the decoded object
 * @param key the field to read
 * @returns the value, or ""
 */
function str({ on, key }: { on: Record<string, unknown>; key: string }): string {
  const value = on[key];
  return typeof value === "string" ? value : "";
}

/*
 * Which failure shape an attachment is, or `undefined` for a SessionStart hook that ran.
 *
 * `exit-127` needs an exit code of 127 and a stderr that is nothing but the invoking shell's not-found sentence
 * naming the recorded command's own FIRST word — any plugin's entry, not only this repository's. A 127 alone
 * is not enough: `scripts/hook.sh` propagates its target's status, so a target that ran and then failed to
 * find an inner helper exits 127 too, and that hook ran. The one shape it still misreads is a target that
 * runs a bare `sh` on some OTHER missing file that the first word's pattern also fits (any path ending
 * `/scripts/hook.sh` for every entry here) and prints nothing else: the record keeps `${PLUGIN_ROOT}`
 * unexpanded, so the two lines are identical, and no hook here does that.
 *
 * `no-target` needs exit 0 and the whole stderr to be `scripts/hook.sh`'s line naming the SAME label the
 * registered command does, since the label is a literal there: a target that ran and nested its own `hook.sh`
 * call prints a different one. A target that ran and printed exactly that line, alone, under its own entry's label is
 * indistinguishable from it, and no hook here does that.
 *
 * A record missing its command or exit code identifies no registered entry, so neither shape is read off it:
 * every one measured carried both (`transcripts boot-hooks --since 1d --json`, 340 of 340).
 */
function kindOf({ attachment }: { attachment: Record<string, unknown> }): BootHookFailureKind | undefined {
  const stderr = str({ key: "stderr", on: attachment });
  const command = str({ key: "command", on: attachment });
  const exitCode = attachment["exitCode"];
  const missingPath = SHELL_NOT_FOUND.exec(stderr)?.[1];
  if (exitCode === COMMAND_NOT_FOUND && missingPath !== undefined && namesFirstWord({ command, path: missingPath })) {
    return "exit-127";
  }
  const missingLabel = NO_TARGET_LINE.exec(stderr)?.[1];
  if (exitCode !== NO_TARGET_EXIT || missingLabel === undefined) {
    return undefined;
  }
  return hookLabel({ command }) === missingLabel ? "no-target" : undefined;
}

/**
 * Decode one raw transcript line as a `SessionStart` hook recorded as never having run.
 *
 * @param line the raw line, exactly as `./source.ts` yielded it
 * @param lineNumber its 1-based position, carried onto the result
 * @returns the failure, or `undefined` when the line is anything else — including a boot hook that ran
 */
export function readBootHookFailure({
  line,
  lineNumber,
}: {
  line: string;
  lineNumber: number;
}): BootHookFailure | undefined {
  if (!line.includes(GATE_LITERAL)) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !isRecord(parsed["attachment"])) {
    return undefined;
  }
  const attachment = parsed["attachment"];
  if (attachment["hookEvent"] !== "SessionStart") {
    return undefined;
  }
  const kind = kindOf({ attachment });
  if (kind === undefined) {
    return undefined;
  }
  return {
    command: str({ key: "command", on: attachment }),
    cwd: str({ key: "cwd", on: parsed }),
    hookName: str({ key: "hookName", on: attachment }),
    kind,
    lineNumber,
    sessionId: str({ key: "sessionId", on: parsed }),
    stderr: str({ key: "stderr", on: attachment }),
    timestamp: str({ key: "timestamp", on: parsed }),
  };
}

/**
 * Whether a failure's own record falls inside a window.
 *
 * A record with no readable timestamp is KEPT: it cannot be placed outside the window, and dropping it would
 * turn a host that stopped stamping lines into a probe that passes everything.
 *
 * @param failure the decoded failure
 * @param sinceMs the window's start, or `undefined` for none
 * @param untilMs the window's end, or `undefined` for none
 * @returns false only when the record is provably before `sinceMs` or after `untilMs`
 */
export function inWindow({
  failure,
  sinceMs,
  untilMs,
}: {
  failure: BootHookFailure;
  sinceMs: number | undefined;
  untilMs: number | undefined;
}): boolean {
  const at = Date.parse(failure.timestamp);
  if (Number.isNaN(at)) {
    return true;
  }
  if (sinceMs !== undefined && at < sinceMs) {
    return false;
  }
  return untilMs === undefined || at <= untilMs;
}

/**
 * One seat whose boot left at least one hook unrun.
 *
 * @internal
 */
export interface BootHookSeat {
  /** The session id, or "" when no line named one. */
  readonly sessionId: string;
  /** The seat's working directory, as its lines carried it. */
  readonly cwd: string;
  /** Every failure the seat recorded, in file order. */
  readonly failures: readonly BootHookFailure[];
}

/** The verdict over every transcript walked. */
export interface BootHookReading {
  /** How many transcripts were read. A reading over none is not a clean bill. */
  readonly sessionsWalked: number;
  /** Every failure, across every seat. */
  readonly failures: number;
  /** One row per seat with a failure, the seat with the most first. */
  readonly seats: readonly BootHookSeat[];
}

/*
 * The first non-empty value, or "" when every line of a seat named none — absence by design, since a
 * transcript line need not carry either field.
 */
function firstNamed({ values }: { values: readonly string[] }): string {
  for (const value of values) {
    if (value.length > 0) {
      return value;
    }
  }
  return "";
}

/**
 * Fold every walked transcript's failures into one verdict.
 *
 * @param perSession one list per transcript walked — an EMPTY list is a seat that booted clean, and still
 *   counts toward `sessionsWalked`
 * @returns the reading
 */
export function bootHookReading({
  perSession,
}: {
  perSession: readonly (readonly BootHookFailure[])[];
}): BootHookReading {
  const seats = perSession
    .filter((failures) => failures.length > 0)
    .map((failures): BootHookSeat => ({
      cwd: firstNamed({ values: failures.map((failure) => failure.cwd) }),
      failures,
      sessionId: firstNamed({ values: failures.map((failure) => failure.sessionId) }),
    }))
    .toSorted((left, right) => right.failures.length - left.failures.length);
  return {
    failures: seats.reduce((sum, seat) => sum + seat.failures.length, 0),
    seats,
    sessionsWalked: perSession.length,
  };
}
