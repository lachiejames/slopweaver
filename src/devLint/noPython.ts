/**
 * The no-python gate — machine-enforces the rule: work done with Python is done in
 * typed, tested TypeScript exposed as a `slopweaver` verb instead, every time. The rule's rationale and why the
 * DEBT list exists are in `docs/doctrine-rationale/no-python.md` § The
 * no-Python rule.
 *
 * ## The criterion
 *
 * Over every `.ts`, `.md`, `.sh` and `.py` file, plus every EXTENSIONLESS one (a script names its
 * interpreter in a shebang, not in a suffix), under `src/`, `eval/`, `hooks/` and `skills/` — tests included,
 * because a comment in a test tree that tells an agent to run Python is still that instruction — a HIT is:
 *
 * - a `.py` file (one hit, whatever it holds);
 * - a first-line shebang whose program is a Python interpreter, in any file the scope above selects — a
 *   `.bash`, `.zsh` or other suffixed script is NOT selected, so its shebang is not read;
 * - in TypeScript, a literal command handed to a `child_process` or `execa` binding imported in that file and
 *   NOT rebound anywhere in it — a program literal naming the interpreter, or a shell-command literal
 *   carrying one at command position;
 * - in a TypeScript COMMENT, a Markdown file or a shell comment, an interpreter word at command position with
 *   invocation evidence; in a shell command line, the word at command position alone.
 *
 * String literals that are not handed to a process binding — test fixtures carrying a command as DATA, an
 * expected value in `.toBe(…)` — are outside it by construction, and so is prose naming the language. The
 * recognisers, and the shapes they deliberately do not claim, are in `./noPythonCommands.ts`.
 *
 * In a shell file, and inside a Markdown code FENCE, a heredoc BODY is data whatever it holds, and its
 * terminator follows the shell's own rule — the delimiter alone on the line, tab-indentation allowed only for
 * `<<-` — because a body line that merely contains the delimiter does not end it. Outside a fence, prose
 * mentioning an opener opens nothing, or one `<<EOF` in a sentence would silence every instruction after it.
 * Each of those, and the quote state carried between lines, is a Codex counterexample this gate was BROKEN on
 * before it shipped, not a shape reasoned about in advance.
 *
 * Twelve rounds of that found no instance in this tree — every counterexample was a file the reviewer wrote —
 * and the shell lane holds two scripts, neither naming Python. So the remaining residue is STATED
 * rather than chased: a variable or alias expanded at run time, a local wrapper around a launcher, a command
 * assembled from parts, and a quoted string spanning lines of PROSE. A block confirms you were wrong; its
 * absence means nothing.
 *
 * One limitation is a CHOICE, not residue. A complete backticked invocation sitting inside narrative — a
 * sentence reporting that some job ran the interpreter with a flag — reads as an instruction here, because
 * telling that from a command a reader is meant to run needs natural-language judgement, and this criterion
 * is positional on purpose. The DEBT list is what absorbs such a line: recorded once, with what converting it
 * owes. Naming the interpreter without its arguments falls outside, and THIS PARAGRAPH is the proof — it
 * tripped the gate while describing the behaviour, until it was written the way it recommends.
 *
 * ## No marker, and a debt list rather than an allowlist
 *
 * There is no exemption marker. A false positive is retired by SHARPENING the criterion. The instructions
 * that stood when the gate landed are recorded in `./noPythonDebt.ts`, keyed by exact path and trimmed line
 * text with an occurrence count, so a second identical instruction is fresh and a converted one is STALE —
 * and stale fails as loudly as fresh, which is what keeps the list shrinking.
 */

import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import {
  isPythonShebang,
  pythonCommandColumns,
  quoteAfter,
  type ShellQuote,
  shebangProgram,
} from "./noPythonCommands.js";
import { NO_PYTHON_DEBT } from "./noPythonDebt.js";
import { hitAt, type PythonHit } from "./noPythonHit.js";
import { scanTypeScript } from "./noPythonTypeScript.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { gateOutcome, lintGateRefusal } from "./refusal/render.js";
import { repoRoot, type ScanScope, scopedScanFiles, isScannablePath as scopeIsScannablePath } from "./scanScope.js";

/** One recorded instruction that stood when the gate landed, and what converting it owes. */
export interface PythonDebt {
  readonly path: string;
  /** The exact trimmed physical line, as {@link PythonHit.matchedLine} reports it. */
  readonly matchedLine: string;
  /** How many hits that line carries. */
  readonly count: number;
  /** What replacing the instruction with a typed route actually requires. */
  readonly owes: string;
}

/** A debt entry that fires fewer times than it records, and how many times it did fire. */
export interface StalePythonDebt {
  readonly entry: PythonDebt;
  readonly observed: number;
}

/** Shells whose extensionless scripts are read line by line as shell. */
const SHELL_PROGRAMS: ReadonlySet<string> = new Set(["bash", "dash", "ksh", "sh", "zsh"]);

/**
 * Every hit in a file read line by line — Markdown as instruction text, a shell script as commands with its
 * `#` comment lines as instruction text.
 *
 * @param path the repo-relative path
 * @param lines the file's physical lines
 * @param shell whether non-comment lines are shell commands
 * @returns the hits, in line order
 */
function scanLines({
  path,
  lines,
  shell,
}: {
  path: string;
  lines: readonly string[];
  shell: boolean;
}): readonly PythonHit[] {
  const hits: PythonHit[] = [];
  let state: LineState = { fenced: false, heredocs: [], open: undefined };
  for (const [index, line] of lines.entries()) {
    const step = scanLine({ index, line, shell, state });
    for (const column of step.columns) {
      hits.push(hitAt({ column, context: { lines, path }, kind: "instruction", line: index }));
    }
    state = step.state;
  }
  return hits;
}

/** An open heredoc body: the word that ends it, and whether `<<-` lets its line be tab-indented. */
interface OpenHeredoc {
  readonly delimiter: string;
  readonly stripTabs: boolean;
}

/** What a file's earlier lines leave open for the next: a quote, a heredoc body, or a Markdown code fence. */
interface LineState {
  readonly open: ShellQuote | undefined;
  /** Every heredoc still pending, in the order the shell will read their bodies. */
  readonly heredocs: readonly OpenHeredoc[];
  /** Inside a ``` or ~~~ fence, where Markdown is showing commands rather than describing them. */
  readonly fenced: boolean;
}

/** A Markdown code fence, opening or closing. */
const FENCE_LINE = /^\s{0,3}(?:```|~~~)/;

/**
 * Whether a line ends an open heredoc. The delimiter must be the WHOLE line — a space-prefixed copy is body
 * text, which `/bin/sh` agrees with — and only `<<-` strips leading tabs.
 *
 * @param line the physical line
 * @param heredoc the open heredoc
 * @returns true when the body ends here
 */
function endsHeredoc({ line, heredoc }: { line: string; heredoc: OpenHeredoc }): boolean {
  const candidate = heredoc.stripTabs ? line.replace(/^\t+/, "") : line;
  return candidate === heredoc.delimiter;
}

/**
 * One line's hit columns, and the state it leaves for the next line.
 *
 * @param index the 0-based line number, so a first-line shebang is skipped
 * @param line the physical line
 * @param shell whether a non-comment line is a shell command
 * @param state what the previous lines left open
 * @returns the columns and the next state
 */
function scanLine({ index, line, shell, state }: { index: number; line: string; shell: boolean; state: LineState }): {
  readonly columns: readonly number[];
  readonly state: LineState;
} {
  const [pending, ...queued] = state.heredocs;
  if (pending !== undefined) {
    // One line ends at most ONE body, and the next pending heredoc's body starts on the line after it.
    const closed = endsHeredoc({ heredoc: pending, line });
    return { columns: [], state: { ...state, heredocs: closed ? queued : state.heredocs } };
  }
  if (!shell && FENCE_LINE.test(line)) {
    return { columns: [], state: { ...state, fenced: !state.fenced } };
  }
  // A `#` line inside a quote a previous line opened is part of that string, never a comment.
  const commentLine = state.open === undefined && line.trimStart().startsWith("#");
  const mode = shell && !commentLine ? "shell" : "instruction";
  const shebangLine = index === 0 && line.startsWith("#!");
  const columns = shebangLine ? [] : pythonCommandColumns({ line, mode, open: state.open });
  // A fenced Markdown block is SHOWING commands, so a heredoc opened in one hides its body the way a shell
  // script's does. Outside a fence, prose that merely mentions a `<<EOF` opens nothing — treating it as an
  // opener would silence every instruction after it until some line happened to equal the delimiter.
  if (mode === "instruction" && !state.fenced) {
    return { columns, state };
  }
  const heredocs = heredocDelimiters({ line, open: state.open });
  return {
    columns,
    state: { ...state, heredocs, open: quoteAfter({ open: state.open, stopAtComment: true, text: line }) },
  };
}

/** A heredoc opener: `<< EOF`, `<<'EOF'`, `<<-"EOF"`. A `<<<` here-string opens no body. */
const HEREDOC_OPENER = /(?<!<)<<(-?)(?!<)\s*(?:(['"])([^'"\n]+)\2|([A-Za-z_][\w.-]*))/g;

/**
 * Every UNQUOTED heredoc a line opens, in order, so each BODY — which is data, whatever it holds
 * — is read as data. An opener-shaped run inside a quote (`echo '<<EOF'`) opens nothing. The opener's own
 * command word is still scanned, which is where a Python heredoc is caught.
 *
 * @param line one shell line
 * @param open the quote already open when the line started
 * @returns each pending heredoc, in the order the shell reads their bodies; empty when the line opens none
 */
function heredocDelimiters({ line, open }: { line: string; open: ShellQuote | undefined }): readonly OpenHeredoc[] {
  const found: OpenHeredoc[] = [];
  for (const match of line.matchAll(HEREDOC_OPENER)) {
    const delimiter = match[3] ?? match[4];
    if (delimiter !== undefined && quoteAfter({ open, text: line.slice(0, match.index) }) === undefined) {
      found.push({ delimiter, stripTabs: match[1] === "-" });
    }
  }
  return found;
}

/**
 * Every hit in one file. Pure.
 *
 * @param path the repo-relative path, whose extension decides how the content is read
 * @param content the file's text
 * @returns each hit, in report order
 */
export function scanNoPython({ path, content }: { path: string; content: string }): readonly PythonHit[] {
  const lines = content.split("\n");
  const extension = extname(path);
  if (extension === ".py") {
    return [hitAt({ column: 0, context: { lines, path }, kind: "python-file", line: 0 })];
  }
  const firstLine = lines[0]!;
  if (isPythonShebang({ firstLine })) {
    return [hitAt({ column: 0, context: { lines, path }, kind: "python-shebang", line: 0 })];
  }
  if (extension === ".ts") {
    return scanTypeScript({ content, path });
  }
  if (extension === ".md") {
    return scanLines({ lines, path, shell: false });
  }
  const program = shebangProgram({ firstLine });
  const shellShebang = program !== undefined && SHELL_PROGRAMS.has(program.slice(program.lastIndexOf("/") + 1));
  if (extension === ".sh" || (extension === "" && shellShebang)) {
    return scanLines({ lines, path, shell: true });
  }
  return [];
}

/**
 * Split a scan's hits against the recorded debt: hits no entry records (or beyond an entry's count), entries
 * firing fewer times than they record, and entries that are malformed.
 *
 * @param hits every hit the scan produced
 * @param debt the recorded debt
 * @returns fresh hits, stale entries with their observed counts, and one message per malformed entry
 */
export function partitionPythonDebt({ hits, debt }: { hits: readonly PythonHit[]; debt: readonly PythonDebt[] }): {
  readonly fresh: readonly PythonHit[];
  readonly stale: readonly StalePythonDebt[];
  readonly invalid: readonly string[];
} {
  const keyOf = ({ path, matchedLine }: { path: string; matchedLine: string }): string =>
    JSON.stringify([path, matchedLine]);
  const invalid: string[] = [];
  const recorded = new Map<string, PythonDebt>();
  for (const entry of debt) {
    const label = `${entry.path}: ${entry.matchedLine}`;
    if (recorded.has(keyOf(entry))) {
      invalid.push(`${label} — recorded twice; merge the counts into one entry`);
    }
    if (!Number.isInteger(entry.count) || entry.count < 1) {
      invalid.push(`${label} — count ${String(entry.count)} is not a positive integer`);
    }
    if (entry.owes.trim() === "" || entry.matchedLine !== entry.matchedLine.trim()) {
      invalid.push(`${label} — needs a non-blank owes and a trimmed line`);
    }
    recorded.set(keyOf(entry), entry);
  }
  // `observed` holds a key only once a hit fires under it, so a key it lacks has fired zero times; and a hit
  // no entry records has no allowance at all, so its first firing is already fresh.
  const observed = new Map<string, number>();
  const fresh = hits.filter((hit) => {
    const key = keyOf(hit);
    const count = observed.has(key) ? observed.get(key)! + 1 : 1;
    observed.set(key, count);
    return !recorded.has(key) || count > recorded.get(key)!.count;
  });
  const stale = [...recorded.values()]
    .map((entry) => ({ entry, observed: observed.has(keyOf(entry)) ? observed.get(keyOf(entry))! : 0 }))
    .filter(({ entry, observed: seen }) => seen < entry.count);
  return { fresh, invalid, stale };
}

/**
 * The injected orchestration: read every path, scan, judge against the debt, print, and exit. A `.py` path that
 * cannot be read is still a hit — its name is the finding. A stale entry for an UNREADABLE path is not
 * reported, because an unread file's missing hits are not evidence the instruction went away.
 *
 * @param paths the in-scope repo-relative paths
 * @param readText reads one path, or throws
 * @param debt the recorded debt
 * @param writeOut where the clean line goes
 * @param writeError where findings and refusals go
 * @returns 0 only when the scan was complete and nothing was refused
 */
export function checkNoPython({
  paths,
  readText,
  debt,
  writeOut,
  writeError,
}: {
  paths: readonly string[];
  readText: (options: { path: string }) => string;
  debt: readonly PythonDebt[];
  writeOut: (text: string) => void;
  writeError: (text: string) => void;
}): number {
  const scan = scanTextFiles<PythonHit>({ paths, readText, scan: scanNoPython });
  const unreadablePaths = new Set(scan.unreadable.map((file) => file.path));
  const unreadPythonFiles = [...unreadablePaths]
    .filter((path) => extname(path) === ".py")
    .map((path) => hitAt({ column: 0, context: { lines: [""], path }, kind: "python-file", line: 0 }));
  const verdict = partitionPythonDebt({ debt, hits: [...scan.hits, ...unreadPythonFiles] });
  const stale = verdict.stale.filter(({ entry }) => !unreadablePaths.has(entry.path));
  const complete = reportScanIntegrity({
    label: "no-python",
    scanned: scan.scanned,
    unreadable: scan.unreadable,
    write: writeError,
  });
  for (const hit of verdict.fresh) {
    writeError(`  ${hit.path}:${String(hit.line)}:${String(hit.column + 1)}: ${hit.kind} — ${hit.matchedLine}\n`);
  }
  if (verdict.fresh.length > 0) {
    const detail = `${String(verdict.fresh.length)} Python invocation(s)`;
    writeError(`${lintGateRefusal({ declaration: lintDeclarationFor({ id: "no-python" }), detail })}\n`);
  }
  for (const { entry, observed } of stale) {
    writeError(`  ${entry.path}: records ${String(entry.count)}, fires ${String(observed)} — ${entry.matchedLine}\n`);
  }
  for (const message of verdict.invalid) {
    writeError(`  ${message}\n`);
  }
  if (stale.length + verdict.invalid.length > 0) {
    const detail = `${String(stale.length)} stale and ${String(verdict.invalid.length)} malformed DEBT entr(ies)`;
    writeError(`${lintGateRefusal({ declaration: lintDeclarationFor({ id: "no-python-debt" }), detail })}\n`);
  }
  const outcome = gateOutcome({
    refused: verdict.fresh.length + stale.length + verdict.invalid.length,
    unseen: complete ? 0 : 1,
  });
  if (outcome === "clean") {
    writeOut(`no-python: clean (${String(scan.scanned)} file(s) scanned, ${String(debt.length)} recorded in DEBT)\n`);
    return 0;
  }
  return 1;
}

/** This gate's declared scan predicate: four trees, four extensions plus extensionless scripts, tests included. */
const SCOPE: ScanScope = {
  extensions: [".ts", ".md", ".sh", ".py"],
  includeExtensionless: true,
  selfFiles: new Set(),
  trees: ["src/", "eval/", "hooks/", "skills/"],
};

/**
 * Whether a repo-relative path is in scope for this gate.
 *
 * @param path the repo-relative path
 * @returns true when the gate should scan it
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return scopeIsScannablePath({ path, scope: SCOPE });
}

/**
 * IO edge: list the files in scope, read them from the checkout and run {@link checkNoPython}.
 *
 * @returns the process exit code (0 clean, 1 refused, incomplete, or not a git checkout)
 */
export function runNoPython(): number {
  let root: string;
  let paths: readonly string[];
  try {
    root = repoRoot();
    paths = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("no-python: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  return checkNoPython({
    debt: NO_PYTHON_DEBT,
    paths,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    writeError: (text) => {
      process.stderr.write(text);
    },
    writeOut: (text) => {
      process.stdout.write(text);
    },
  });
}
