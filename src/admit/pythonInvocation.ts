/**
 * The Python half of the admit hook: refuse a Bash or Monitor command that runs a Python interpreter.
 *
 * ## Why this exists, and why it is not part of the raw-bypass walk
 *
 * The owner's rule: anything that would be done in Python is done as typed, tested TypeScript exposed through
 * the slopweaver CLI. A bot turn once read the Slack compact JSONL through a python heredoc. So an invocation
 * is refused whatever it does — a bare version check included — because this is a rule about which tool does
 * the work. It does not claim a computation or a network request happened.
 * `./rawTools.ts` judges reaches and returns the FIRST finding inside a wrapper, so a waived Python finding
 * sitting first there would hide a `curl` behind it. This walk is independent: `./hookPayload.ts` runs both,
 * `SLOPWEAVER_ALLOW_RAW` never opens this one, and `SLOPWEAVER_ALLOW_PYTHON` never opens the other.
 *
 * ## What counts as an invocation
 *
 * A segment's program — resolved past redirections, assignments, keywords and wrappers by
 * `./pythonWrappers.ts`' finite grammars — whose literal name is a Python interpreter (`python`, `python3`,
 * `python3.12`, `pythonw`, `pypy3`, `ipython`), quoted or not, by path or not; and `uv run -m`/`--script`.
 * The walk also opens, sharing ONE depth budget of {@link MAX_DEPTH}: a shell's `-c` payload (exactly that
 * word), the heredoc a shell reads as stdin (the LAST descriptor-0 redirection decides), `$(…)`, backticks,
 * `<(…)` and `>(…)`, the substitutions an unquoted heredoc body expands whoever reads it, `eval`, and every
 * `find -exec`/`-execdir`/`-ok`/`-okdir`. A script the command runs is opened through the injected reader at
 * most once per path: a `#!` naming Python is refused, a shell script is walked whole, and a `.py` path the
 * reader cannot open is refused by its EXTENSION — a fallback, not evidence of the interpreter.
 *
 * Data is not an invocation: a heredoc body `cat` reads, a quoted argument, a grep pattern, a commit message,
 * a `#` comment, `cat report.py`, `command -v python3`, `xargs -I python3 echo`, `find . -name python3`,
 * `bash -c 'echo ok' python3` (that is `$0`), `bash -n x.sh`, `PYTHON=/usr/bin/python3 node-gyp rebuild`.
 *
 * A wrapper option no grammar lists (`env -P /bin python3`) is read BOTH ways — standing alone and taking the
 * next word — and refused when either reading reaches Python. The trade, accepted: `env -P python3 ls` is
 * refused too, because the standalone reading runs `python3`; the hatch covers it.
 *
 * ## What it cannot see, stated
 *
 * An alias or function; a program word held in a variable or produced by a substitution (`$PY -c`,
 * `$(which python3) -V`); stdin a shell reads from a pipe (`echo 'python3 -V' | bash`); `env -S`; a wrapper
 * option its grammar does not list that takes more than one word; a script a script calls; a relative
 * script path after a `cd` in the same command; a package script (`yarn run x`) whose body runs Python; a
 * Python-based tool run by its own name (`pytest`, `pip`); `eval` words re-joined without their quoting; and
 * anything a tool runs transitively. **A refusal confirms you were about to use Python; its absence proves
 * nothing.**
 *
 * ## Residue in stdin selection, stated rather than discovered
 *
 * Which heredoc a shell reads as its program is decided by a static scan (`./shellSegments.ts`'s
 * `stdinHeredocIndex`). Three counterexample classes from review passes are closed and tested: two
 * redirections glued into one word (`<<'A'</dev/null`), an OUTPUT operator rebinding descriptor 0 (`0>`), and
 * a backslash-newline between a descriptor and its operator. The review kept finding further spellings of the
 * same shape — `{fd}<<`, an `exec` that rebinds stdin for LATER commands, a descriptor from a variable — and
 * this tree contains no instance of any of them. The loop was stopped there deliberately. A mis-selection
 * makes the walk refuse a body a shell would not have run, which is a false REFUSAL naming its own hatch, not
 * a silent admission; the opposite direction was the one worth paying for and is covered.
 */
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusal } from "../hatch/render.js";
import { resolvePrograms } from "./pythonWrappers.js";
import type { ScriptReader } from "./scriptWrapper.js";
import { bodySubstitutions, type ShellWord, shellWords, withoutRedirections } from "./shellLexing.js";
import { type CommandSegment, commandSegments, hasCommandSegmentOverride } from "./shellSegments.js";
import { stdinHeredocIndex } from "./stdinHeredoc.js";

/** The variable that opens this walk's hatch, ambient or as a per-segment `NAME=1` prefix. */
export const PYTHON_OVERRIDE_ENV = "SLOPWEAVER_ALLOW_PYTHON";

/**
 * What a refused seat reaches for next, named in the refusal the way `./rawBash.ts` names one per class.
 *
 * MEASURED over one week: this gate refused 743 calls, the most of any class, and a sample of
 * the refused commands was mostly a multi-line regex edit or a JSON read — each refusal is a turn re-reading
 * the whole context, and a refusal that names no replacement buys a second guess (often `node -e`, which
 * the shell-script gate then refuses too). Re-measure: `slopweaver session spend --days 7`.
 */
const PYTHON_INSTEAD =
  "to edit a file use the Edit tool or the verb that owns it; to read JSON, use the verb's own flags or the Read tool (jq is banned too)";

/** The walk's decision. A block always names the invocation it refused and carries the rendered refusal. */
export type PythonVerdict =
  { readonly blocked: true; readonly invocation: string; readonly message: string } | { readonly blocked: false };

/** How many nested command sources (payloads, substitutions, heredocs, `eval`, `-exec`, a script) are opened. */
const MAX_DEPTH = 3;

const INTERPRETER = /^(?:python|pythonw|pypy|ipython)(?:\d+(?:\.\d+)*)?$/;
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const SHELL_VALUE_OPTIONS = new Set(["-o", "-O", "+o", "+O", "--rcfile", "--init-file"]);
// The long options after which a shell runs NOTHING — every other long option is read as running the input, so
// a valid one missing from any list (`--debugger`, `--protected`) can never hide a `-c` payload, and an invalid
// one costs only a refusal of a line bash would reject anyway.
const SHELL_INERT_LONG_OPTIONS = new Set(
  ["--help", "--version", "--dump-strings", "--dump-po-strings"].concat(["--rpm-requires", "--pretty-print"]),
);
const FIND_EXEC = new Set(["-exec", "-execdir", "-ok", "-okdir"]);
const EXEC_TERMINATORS = new Set([";", "+"]);

/** One Python invocation found, and whether an override covers the segment it sits in. */
interface Finding {
  readonly invocation: string;
  readonly covered: boolean;
}

/** What every step of the walk carries down. */
interface WalkContext {
  readonly depth: number;
  readonly covered: boolean;
  /** The script reader, or `undefined` once a script has been opened on this path (or none was given). */
  readonly readScript: ScriptReader | undefined;
}

/** What a shell runner will execute. */
export type ShellInput =
  | { readonly kind: "payload"; readonly line: string }
  | { readonly kind: "script"; readonly path: string }
  | { readonly kind: "stdin" }
  | { readonly kind: "none" };

/** The walk one level down, or `undefined` once the shared depth budget is spent. */
function deeper({ context }: { context: WalkContext }): WalkContext | undefined {
  return context.depth >= MAX_DEPTH ? undefined : { ...context, depth: context.depth + 1 };
}

/** The basename of a program word. */
function baseName({ word }: { word: string }): string {
  return word.split("/").pop()!;
}

/** The interpreter a `#!` line names, following `env` past its options (`-S` included) and assignments. */
function shebangInterpreter({ firstLine }: { firstLine: string }): string | undefined {
  if (!firstLine.startsWith("#!")) return undefined;
  const words = firstLine.slice(2).trim().split(/\s+/);
  let index = 0;
  if (baseName({ word: words[0]! }) === "env") {
    index = 1;
    while (index < words.length && (words[index]!.startsWith("-") || words[index]!.includes("="))) index += 1;
  }
  const interpreter = words[index];
  return interpreter === undefined ? undefined : baseName({ word: interpreter });
}

/**
 * Judge a script the command runs. `bash x.py` runs the file AS SHELL whatever its `#!` says; a directly
 * executed file runs its `#!` interpreter, or the shell when it has none (unless it is named `.py`).
 *
 * @param path the script path as written
 * @param context the walk state at the segment that runs it
 * @param viaShell whether a shell was given the file
 * @returns the findings
 */
function scriptFindings({
  path,
  context,
  viaShell,
}: {
  path: string;
  context: WalkContext;
  viaShell: boolean;
}): readonly Finding[] {
  const source = context.readScript?.({ path });
  if (source === undefined) {
    const byExtension = !viaShell && path.endsWith(".py");
    return byExtension ? [{ covered: context.covered, invocation: `${path} (a .py script)` }] : [];
  }
  const interpreter = viaShell ? undefined : shebangInterpreter({ firstLine: source.split("\n", 1)[0]! });
  if (interpreter !== undefined && INTERPRETER.test(interpreter)) {
    return [{ covered: context.covered, invocation: `${path} (#! ${interpreter})` }];
  }
  let runsAsShell = viaShell || !path.endsWith(".py");
  if (interpreter !== undefined) {
    runsAsShell = SHELLS.has(interpreter);
  }
  const next = deeper({ context });
  if (!runsAsShell || next === undefined) return [];
  return walkLine({ context: { ...next, readScript: undefined }, line: source });
}

/**
 * What a shell runner executes, from its own option grammar: `-c` takes exactly the next word, `-n` executes
 * nothing, `-s` or `-` reads stdin, and otherwise the first operand is a script file, or stdin when there is
 * none. An unrecognised long option stops the resolution.
 *
 * @internal — also `./wholeTreeCheck.ts`, which follows a `bash -c` payload the same way.
 * @param args the runner's words after its name, redirections removed
 * @returns the input it runs
 */
export function shellInput({ args }: { args: readonly ShellWord[] }): ShellInput {
  const scan: ShellOptionScan = { index: 0, payload: undefined, readsStdin: false, stop: undefined };
  while (stepShellOption({ args, scan })) {
    // every step advances `scan.index` or sets `scan.stop`, which ends the walk
  }
  if (scan.stop === "none") return { kind: "none" };
  if (scan.stop === "payload") {
    return scan.payload === undefined ? { kind: "none" } : { kind: "payload", line: scan.payload };
  }
  const operand = args[scan.index];
  if (!scan.readsStdin && operand !== undefined) return { kind: "script", path: operand.text };
  return { kind: "stdin" };
}

/** The state one shell-runner option walk threads through its steps. */
interface ShellOptionScan {
  index: number;
  readsStdin: boolean;
  payload: string | undefined;
  stop: "payload" | "none" | undefined;
}

/** One option word. @returns whether the walk continues */
function stepShellOption({ args, scan }: { args: readonly ShellWord[]; scan: ShellOptionScan }): boolean {
  const word = args[scan.index];
  if (word === undefined || word.dynamic || !/^[-+]./.test(word.text)) {
    return false;
  }
  if (word.text === "--" || word.text === "-") {
    scan.readsStdin = scan.readsStdin || word.text === "-";
    scan.index += 1;
    return false;
  }
  if (SHELL_VALUE_OPTIONS.has(word.text)) {
    scan.index += 2;
    return true;
  }
  if (word.text.startsWith("--")) {
    if (SHELL_INERT_LONG_OPTIONS.has(word.text)) scan.stop = "none";
    scan.index += 1;
    return scan.stop === undefined;
  }
  return stepShellLetters({ args, scan, letters: word.text.slice(1) });
}

/** One cluster of single-letter shell options — `-n` runs nothing, `-c` takes a payload, `-s` reads stdin. */
function stepShellLetters({
  args,
  scan,
  letters,
}: {
  args: readonly ShellWord[];
  scan: ShellOptionScan;
  letters: string;
}): boolean {
  if (letters.includes("n")) {
    scan.stop = "none";
    return false;
  }
  if (letters.includes("c")) {
    scan.stop = "payload";
    scan.payload = args[scan.index + 1]?.text;
    return false;
  }
  scan.readsStdin = scan.readsStdin || letters.includes("s");
  scan.index += 1;
  return true;
}

/** A shell runner's findings: its payload, its script file, or the heredoc it reads as stdin. */
function shellFindings({
  args,
  stdinBody,
  context,
}: {
  args: readonly ShellWord[];
  stdinBody: string | undefined;
  context: WalkContext;
}): readonly Finding[] {
  const input = shellInput({ args });
  const next = deeper({ context });
  if (input.kind === "script") return scriptFindings({ context, path: input.path, viaShell: true });
  if (next === undefined) return [];
  if (input.kind === "payload") return walkLine({ context: next, line: input.line });
  if (input.kind === "stdin" && stdinBody !== undefined) return walkLine({ context: next, line: stdinBody });
  return [];
}

/** Every `find -exec`-style command's findings, each resolved as a program of its own. */
function findExecFindings({ args, context }: { args: readonly ShellWord[]; context: WalkContext }): readonly Finding[] {
  const next = deeper({ context });
  if (next === undefined) {
    return [];
  }
  const found: Finding[] = [];
  let index = 0;
  while (index < args.length) {
    if (!FIND_EXEC.has(args[index]!.text)) {
      index += 1;
      continue;
    }
    const stop = args.findIndex((word, at) => at > index && EXEC_TERMINATORS.has(word.text));
    const end = stop === -1 ? args.length : stop;
    found.push(...programFindings({ context: next, stdinBody: undefined, words: args.slice(index + 1, end) }));
    index = end + 1;
  }
  return found;
}

/**
 * What one resolved program runs, as findings.
 *
 * @param program the program word and its arguments
 * @param stdinBody the heredoc body the segment's stdin reads, if it reads one
 * @param context the walk state at this segment
 * @returns the findings
 */
function resolvedFindings({
  program,
  stdinBody,
  context,
}: {
  program: readonly ShellWord[];
  stdinBody: string | undefined;
  context: WalkContext;
}): readonly Finding[] {
  const head = program[0]!;
  const name = baseName({ word: head.text });
  const args = program.slice(1);
  if (head.dynamic) return [];
  if (INTERPRETER.test(name)) {
    return [
      {
        covered: context.covered,
        invocation: program
          .slice(0, 3)
          .map((word) => word.text)
          .join(" ")
          .slice(0, 80),
      },
    ];
  }
  if (SHELLS.has(name)) return shellFindings({ args, context, stdinBody });
  if (name === "find") return findExecFindings({ args, context });
  if (name === "eval") {
    const next = deeper({ context });
    return next === undefined ? [] : walkLine({ context: next, line: args.map((word) => word.text).join(" ") });
  }
  if (head.text.includes("/") || head.text.endsWith(".py")) {
    return scriptFindings({ context, path: head.text, viaShell: false });
  }
  return [];
}

/**
 * Resolve a word list's program past redirections and wrappers, then judge it — every reading of a wrapper
 * option no table lists, so `env -P /bin python3` is refused whichever way `-P` parses.
 */
function programFindings({
  words,
  stdinBody,
  context,
}: {
  words: readonly ShellWord[];
  stdinBody: string | undefined;
  context: WalkContext;
}): readonly Finding[] {
  return resolvePrograms({ words: withoutRedirections({ words }) }).flatMap((resolution) => {
    if (resolution.kind === "python-option") return [{ covered: context.covered, invocation: resolution.via }];
    if (resolution.kind === "none") return [];
    return resolvedFindings({ context, program: resolution.words, stdinBody });
  });
}

/** One segment's findings: what its substitutions and unquoted heredoc bodies expand, then its program. */
function segmentFindings({ segment, context }: { segment: CommandSegment; context: WalkContext }): readonly Finding[] {
  const { words, substitutions } = shellWords({ text: segment.command });
  const next = deeper({ context });
  const expanded = segment.heredocs
    .filter((heredoc) => !heredoc.quoted)
    .flatMap((heredoc) => bodySubstitutions({ body: heredoc.body }));
  const nested =
    next === undefined
      ? []
      : [...substitutions, ...expanded].flatMap((inner) => walkLine({ context: next, line: inner }));
  const stdinIndex = stdinHeredocIndex({ command: segment.command });
  const stdinBody = stdinIndex === undefined ? undefined : segment.heredocs[stdinIndex]?.body;
  return [...nested, ...programFindings({ context, stdinBody, words })];
}

/**
 * Every Python invocation in one command line, each marked with whether an override covers it — the line's
 * own `SLOPWEAVER_ALLOW_PYTHON=1` prefix or export for that segment, or one inherited from the segment that
 * opened this line (the authorisation rule this walk chooses, not a claim about shell expansion timing).
 *
 * @param line the command line — a whole command, a `-c` payload, a substitution, a heredoc body or a script
 * @param context the walk state entering this line
 * @returns the findings, in order
 */
function walkLine({ line, context }: { line: string; context: WalkContext }): readonly Finding[] {
  return commandSegments({ command: line }).flatMap((segment, segmentIndex) => {
    const covered =
      context.covered || hasCommandSegmentOverride({ command: line, name: PYTHON_OVERRIDE_ENV, segmentIndex });
    return segmentFindings({ context: { ...context, covered }, segment });
  });
}

/**
 * Decide whether a shell command runs Python, and refuse it unless the hatch covers that invocation. The
 * ambient `allowPython` only ever ADDS to the inline hatch: nothing in the command can close it.
 *
 * @param command the raw Bash or Monitor command
 * @param allowPython whether `SLOPWEAVER_ALLOW_PYTHON=1` is set in the hook's own environment
 * @param readScript reads a script the command runs, already bound to the call's `cwd`; omit to judge a
 *   script by its `.py` extension alone
 * @returns a block carrying the rendered refusal, or an allow
 */
export function classifyPythonCommand({
  command,
  allowPython,
  readScript,
}: {
  command: string;
  allowPython: boolean;
  readScript?: ScriptReader;
}): PythonVerdict {
  if (allowPython) {
    return { blocked: false };
  }
  const findings = walkLine({ context: { covered: false, depth: 0, readScript }, line: command });
  const uncovered = findings.find((finding) => !finding.covered);
  if (uncovered === undefined) {
    return { blocked: false };
  }
  return {
    blocked: true,
    invocation: uncovered.invocation,
    message: hatchRefusal({
      detail: `\`${uncovered.invocation}\` — ${PYTHON_INSTEAD}`,
      hatch: hatchFor({ id: "python" }),
    }),
  };
}
