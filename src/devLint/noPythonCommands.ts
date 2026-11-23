/**
 * The pure recognisers behind the `no-python` gate: which spelling names a Python interpreter, where on a line
 * one sits at COMMAND position, and whether a shebang runs one.
 *
 * A grep for the word is an inventory, not a criterion. The tree names the interpreter in narrative ("a
 * multi-line python block"), in generated operation ids (`list-python-packages`), in a list of interpreters a
 * classifier deliberately left alone, and in test fixtures that carry a command as DATA. None of those is an
 * instruction to run Python, so the criterion here is positional: the interpreter word has to be where a shell
 * would execute it, and — in prose — carry the argument evidence of a real invocation.
 *
 * ## The two modes
 *
 * - **`shell`** — the text IS a command: a `.sh` line, or a literal handed to `exec`/`execSync`. Any
 *   interpreter word at command position is a hit.
 * - **`instruction`** — the text is a comment or Markdown that may SHOW a command. The word must be at command
 *   position AND be followed by an option (`-c`, `-m`, `-`), an input redirection (`<`, a heredoc), or a
 *   `*.py` path. That is the sharpening that keeps a backticked interpreter name in a list of interpreters
 *   outside the criterion, while the same name followed by `-c` and a program is inside it.
 *
 * ## What it deliberately does not claim
 *
 * This is a static tripwire over visible text, not a shell. It does not expand aliases or variables, follow a
 * wrapper function, read a heredoc body's semantics, or see a command assembled at run time. A bare interpreter
 * word with no argument evidence in prose is outside it. In `shell` mode a caller carries quote state from line
 * to line (`quoteAfter`); in `instruction` mode it restarts at each backtick span, so an apostrophe in prose
 * does not flip it — which means a quoted string spanning lines of PROSE can still expose its continuation.
 */

/** Words that hand the rest of the line to another command, so the word after them is at command position. */
const COMMAND_PREFIX_WORDS: ReadonlySet<string> = new Set([
  "!",
  "command",
  "do",
  "elif",
  "else",
  "env",
  "exec",
  "if",
  "nohup",
  "sudo",
  "then",
  "time",
  "until",
  "while",
  "xargs",
]);

/** Tool runners whose `run` subcommand executes the next word — `uv run <command>`. */
const RUN_SUBCOMMAND_TOOLS: ReadonlySet<string> = new Set(["pipenv", "poetry", "uv"]);

/** Operator suffixes after which the next word is a fresh command. `&&`/`||` end in `&`/`|`. */
const COMMAND_OPERATOR_SUFFIXES: readonly string[] = ["$(", "`", "(", "{", "|", ";", "&"];

/**
 * An interpreter word, optionally path-qualified and optionally wrapped in one matching quote. Group 1 is the
 * quote, group 2 the word. The lookbehind refuses a word glued to a longer identifier (`list-python-packages`,
 * `my_python3`), and the lookahead refuses one continuing into one (`python-report`, `python3x`).
 */
const INTERPRETER_WORD = /(?<![\w./-])(['"]?)((?:[\w.~/-]*\/)?python(?:3(?:\.\d+)?)?)\1(?![\w.-])/g;

/**
 * The characters a command word may follow directly: whitespace or an opening operator. Anything else glues
 * the word to what precedes it — `PYTHON=/usr/bin/python3` is a configuration VALUE, not a command.
 */
const WORD_BOUNDARY_BEFORE = /[\s`(|;&{]/;

/** An interpreter basename, anchored: `python`, `python3`, `python3.12`. Case-sensitive on purpose. */
const INTERPRETER_BASENAME = /^python(?:3(?:\.\d+)?)?$/;

/**
 * The argument evidence an `instruction`-mode hit needs right after the word: an option (`-c`, `--version`),
 * a redirection (`<`, `<<`, spaced or not), a `-` reading stdin from a heredoc, or a `*.py` path.
 *
 * A BARE `-` with nothing after it is deliberately not evidence. Prose names the shape that way when it
 * describes what a process did — "a bot turn's `python3 -` heredoc read the multi-gigabyte Slack compact.jsonl" is
 * the incident report behind this whole rule, and four such sentences stand in this tree. An instruction that
 * really reads stdin writes the redirection out, so requiring it costs nothing and keeps narrative outside.
 */
const INVOCATION_EVIDENCE = /^(?:\s*<|\s+-[A-Za-z-]|\s+-\s*<|\s+[^\s'"`]+\.py(?![\w-]))/;

/** A shell variable assignment used as a command prefix — `FOO=1 <command>`. */
const ASSIGNMENT_WORD = /^[A-Za-z_][A-Za-z0-9_]*=\S*$/;

/**
 * Whether a path or bare word names a Python interpreter.
 *
 * @param word a command word, possibly path-qualified (`/usr/bin/python3.12`)
 * @returns true when its basename is `python`, `python3` or `python3.N`
 */
export function isPythonInterpreter({ word }: { word: string }): boolean {
  const basename = word.slice(word.lastIndexOf("/") + 1);
  return INTERPRETER_BASENAME.test(basename);
}

/**
 * The quote a run of text leaves open, given the quote it started inside. A shell string can span lines, so a
 * caller reading a file line by line carries this from one line to the next.
 *
 * @param text the text to read
 * @param open the quote already open when the text starts, or `undefined`
 * @param stopAtComment ends the read at an unquoted `#` that starts a word, so an apostrophe in a shell
 *   comment (`echo ok # don't`) does not leave a quote open for the next line
 * @returns the quote still open at the end, or `undefined`
 */
export function quoteAfter({
  text,
  open,
  stopAtComment,
}: {
  text: string;
  open?: ShellQuote | undefined;
  stopAtComment?: boolean;
}): ShellQuote | undefined {
  let quote = open;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const startsWord = index === 0 || /\s/.test(text[index - 1]!);
    if (quote === undefined && char === "#" && startsWord && stopAtComment === true) {
      return undefined;
    }
    if (quote === undefined && (char === "'" || char === '"')) {
      quote = char;
    } else if (quote === '"' && char === "\\") {
      index += 1;
    } else if (char === quote) {
      quote = undefined;
    }
  }
  return quote;
}

/** The two quotes a shell word can sit inside. */
export type ShellQuote = "'" | '"';

/**
 * Whether the text before a word leaves that word open — outside any quote. A `$(` opened inside double
 * quotes is executable, so it re-opens the position.
 *
 * @param prefix the line text before the word, already cut back to the scan's own start
 * @param open the quote open when the line started
 * @returns true when the word is not quoted data
 */
function isUnquoted({ prefix, open }: { prefix: string; open?: ShellQuote | undefined }): boolean {
  const quote = quoteAfter({ open, text: prefix });
  return quote === undefined || (quote === '"' && prefix.endsWith("$("));
}

/**
 * Whether a word preceded by `prefix` sits where a shell would execute it: at the start, after an operator, or
 * after any run of command-prefix words, tool `run` subcommands and variable assignments that themselves sit
 * at command position.
 *
 * @param prefix the text before the word on its line
 * @returns true when the word is at command position
 */
function isCommandPosition({ prefix }: { prefix: string }): boolean {
  let rest = prefix.trimEnd();
  for (;;) {
    if (rest === "" || COMMAND_OPERATOR_SUFFIXES.some((suffix) => rest.endsWith(suffix))) {
      return true;
    }
    const words = rest.split(/\s+/);
    const last = words.at(-1)!;
    const beforeLast = words.at(-2);
    let consumed: number;
    if (last === "run" && beforeLast !== undefined && RUN_SUBCOMMAND_TOOLS.has(beforeLast)) {
      consumed = rest.length - rest.lastIndexOf(beforeLast);
    } else if (COMMAND_PREFIX_WORDS.has(last) || ASSIGNMENT_WORD.test(last)) {
      consumed = last.length;
    } else {
      return false;
    }
    rest = rest.slice(0, rest.length - consumed).trimEnd();
  }
}

/**
 * The 0-based columns on one line where a Python interpreter word sits at command position — in `instruction`
 * mode, only those also followed by invocation evidence.
 *
 * @param line one physical line, comment leader already removed by the caller or not — a leading `*`, `//` or
 *   `#` is treated as the start of the line
 * @param mode `shell` when the line is a command, `instruction` when it is prose or a comment that may show one
 * @returns each column, in order; two invocations on one line are two columns
 */
export function pythonCommandColumns({
  line,
  mode,
  open,
}: {
  line: string;
  mode: "shell" | "instruction";
  open?: ShellQuote | undefined;
}): readonly number[] {
  // Every string matches this pattern (all of it is optional), so the match is never null.
  const leader = /^\s*(?:\/\/+|\/\*+|\*+|#+)?\s*/.exec(line)![0];
  const columns: number[] = [];
  for (const match of line.matchAll(INTERPRETER_WORD)) {
    const column = match.index;
    // A word at column 0 has no character before it, and the start of the line is a word boundary in itself;
    // any later column is inside the line, so the character before it is there.
    const bounded = column === 0 || WORD_BOUNDARY_BEFORE.test(line[column - 1]!);
    if (column < leader.length || !bounded) {
      continue;
    }
    const scanStart = mode === "instruction" ? line.lastIndexOf("`", column - 1) + 1 : leader.length;
    const prefix = line.slice(Math.max(scanStart, leader.length), column);
    // A backtick span starts its own quote state; only a shell line inherits the previous line's.
    const inherited = mode === "shell" && scanStart <= leader.length ? open : undefined;
    // The word's OWN quotes are part of the match, so `prefix` still carries the enclosing quote state: a
    // quoted command word never waives it. `echo "text; 'python3' -V"` echoes text, and is not an invocation.
    const trailing = line.slice(column + match[0].length);
    const evidenced = mode === "shell" || INVOCATION_EVIDENCE.test(trailing);
    if (isUnquoted({ open: inherited, prefix }) && evidenced && isCommandPosition({ prefix })) {
      columns.push(column);
    }
  }
  return columns;
}

/**
 * Whether a file's first line is a shebang that runs Python — directly (`#!/usr/bin/python3`) or through
 * `env`, options and assignments included (`#!/usr/bin/env -S python3 -u`).
 *
 * @param firstLine the file's first physical line
 * @returns true when the program the kernel runs is a Python interpreter
 */
export function isPythonShebang({ firstLine }: { firstLine: string }): boolean {
  const program = shebangProgram({ firstLine });
  return program !== undefined && isPythonInterpreter({ word: program });
}

/**
 * The program a shebang line runs, with `env` and its options and assignments stepped over.
 *
 * @param firstLine the file's first physical line
 * @returns the program word, or `undefined` when the line is not a shebang or names nothing
 */
export function shebangProgram({ firstLine }: { firstLine: string }): string | undefined {
  if (!firstLine.startsWith("#!")) {
    return undefined;
  }
  const words = firstLine
    .slice(2)
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  const [first, ...rest] = words;
  if (first === undefined) {
    return undefined;
  }
  if (first.slice(first.lastIndexOf("/") + 1) !== "env") {
    return first;
  }
  return rest.find((word) => !word.startsWith("-") && !ASSIGNMENT_WORD.test(word));
}
