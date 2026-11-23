/**
 * Which word of a command segment is the program that actually runs — the wrapper and keyword grammar behind
 * `./pythonInvocation.ts`.
 *
 * Each wrapper carries a FINITE option table, because a generic "skip anything that starts with a dash" would
 * read `xargs -I python3 echo python3`'s replacement marker as the program and consume `timeout`'s duration as
 * a flag. An option a table does not list ends `resolveProgram` with no answer rather than a guess that might
 * consume a value; `resolvePrograms` then follows BOTH readings of it, standing alone and taking the next word,
 * so the Python gate refuses `env -P /bin python3` without guessing which. The package-runner table (`uv`, `poetry`, `pipx`, `pdm`, `hatch`,
 * `rye` followed by `run`) is ONE union of the options those tools share; their full grammars were not
 * verified, which is exactly why an unknown option is read both ways rather than skipped.
 *
 * Pure: words in, a resolution out.
 */
import type { ShellWord } from "./shellLexing.js";

/** One wrapper's option grammar. */
interface WrapperGrammar {
  /** Options that consume the following word (or an attached `--name=value` / `-Xvalue`). */
  readonly value: ReadonlySet<string>;
  /** Options that stand alone. */
  readonly boolean: ReadonlySet<string>;
  /** Options after which the words name a program without running it (`command -v`, `sudo -l`). */
  readonly lookup: ReadonlySet<string>;
  /** Options that make the runner execute Python by themselves (`uv run -m`). */
  readonly python: ReadonlySet<string>;
  /** Positional words before the program — `timeout`'s duration. */
  readonly operands: number;
  /** Whether a bare `-<digits>` is an option (`nice -5`). */
  readonly numeric: boolean;
}

/** A grammar built from option lists, every unlisted field empty. */
function grammar({
  value = [],
  boolean = [],
  lookup = [],
  python = [],
  operands = 0,
  numeric = false,
}: {
  value?: readonly string[];
  boolean?: readonly string[];
  lookup?: readonly string[];
  python?: readonly string[];
  operands?: number;
  numeric?: boolean;
}): WrapperGrammar {
  return {
    boolean: new Set(boolean),
    lookup: new Set(lookup),
    numeric,
    operands,
    python: new Set(python),
    value: new Set(value),
  };
}

const VERSION_HELP = ["--help", "--version"];

/** Every wrapper whose words hide the program, keyed by the wrapper's own name. */
const WRAPPERS: Readonly<Record<string, WrapperGrammar>> = {
  // macOS `arch [-arm64|-x86_64|…] [-arch <name>] [-d <env>] [-e <env=value>] prog [args]` runs prog
  // (`arch jq . tick.json` would otherwise reach jq unrefused).
  arch: grammar({
    boolean: ["-32", "-64", "-c", "-h", "-arm64", "-arm64e", "-x86_64", "-x86_64h", "-i386"],
    value: ["-arch", "-d", "-e"],
  }),
  builtin: grammar({}),
  caffeinate: grammar({ boolean: ["-d", "-i", "-m", "-s", "-u"], value: ["-t", "-w"] }),
  command: grammar({ boolean: ["-p"], lookup: ["-v", "-V"] }),
  env: grammar({
    boolean: ["-i", "--ignore-environment", "-0", "--null", "-v", "--debug", "-"],
    lookup: VERSION_HELP,
    value: ["-u", "--unset", "-C", "--chdir"],
  }),
  exec: grammar({ boolean: ["-c", "-l"], value: ["-a"] }),
  nice: grammar({ lookup: VERSION_HELP, numeric: true, value: ["-n", "--adjustment"] }),
  // zsh's precommand modifiers run the next word as the program, and zsh is the hook's own shell.
  nocorrect: grammar({}),
  noglob: grammar({}),
  nohup: grammar({ lookup: VERSION_HELP }),
  setsid: grammar({ boolean: ["-c", "-f", "-w", "--ctty", "--fork", "--wait"], lookup: VERSION_HELP }),
  stdbuf: grammar({ lookup: VERSION_HELP, value: ["-i", "-o", "-e", "--input", "--output", "--error"] }),
  sudo: grammar({
    boolean: ["-A", "-b", "-B", "-E", "-H", "-i", "-k", "-n", "-P", "-s", "-S"].concat(
      ["--askpass", "--background", "--bell", "--login", "--non-interactive", "--preserve-env"],
      ["--reset-timestamp", "--set-home", "--shell", "--stdin"],
    ),
    lookup: ["-l", "--list", "-v", "--validate", "-V", "--version", "-K", "--remove-timestamp", "-e", "--edit"],
    value: ["-u", "-g", "-h", "-p", "-C", "-D", "-r", "-t", "-U", "-T"].concat(
      ["--user", "--group", "--host", "--prompt", "--close-from", "--chdir", "--role", "--type", "--other-user"],
      ["--command-timeout"],
    ),
  }),
  time: grammar({ boolean: ["-p"] }),
  timeout: grammar({
    boolean: ["--foreground", "--preserve-status", "-v", "--verbose", "-f", "-p"],
    lookup: VERSION_HELP,
    operands: 1,
    value: ["-s", "--signal", "-k", "--kill-after"],
  }),
  xargs: grammar({
    boolean: ["-0", "-r", "-t", "-p", "-x", "-o", "-i", "-e", "-l"].concat([
      "--null",
      "--no-run-if-empty",
      "--verbose",
      "--interactive",
      "--exit",
      "--open-tty",
    ]),
    lookup: VERSION_HELP,
    // BSD/macOS `xargs` adds `-J`, `-R` and `-S` (`xargs -J % yarn typecheck`).
    value: ["-I", "-J", "-R", "-S", "-n", "-P", "-L", "-s", "-d", "-E", "-a"].concat([
      "--max-args",
      "--max-procs",
      "--delimiter",
      "--arg-file",
      "--max-lines",
      "--max-chars",
    ]),
  }),
};

/**
 * Whether this table declares an option of a wrapper as standing alone, a lookup included, so
 * `./commandPositions.ts` never reads it as taking the next word.
 *
 * @param option the option word as typed
 * @param wrapper the wrapper's own name, when there is one
 * @returns true when the option is declared to take no value
 */
export function standsAlone({ option, wrapper }: { option: string; wrapper: string | undefined }): boolean {
  const known = wrapper === undefined ? undefined : WRAPPERS[wrapper.toLowerCase()];
  return known !== undefined && (known.boolean.has(option) || known.lookup.has(option));
}

/** Package runners that take `run` and then a program. */
const RUNNER_TOOLS = new Set(["uv", "poetry", "pipx", "pdm", "hatch", "rye"]);

const RUNNER = grammar({
  boolean: ["--no-project", "--isolated", "--frozen", "--locked", "--no-sync", "--all-extras", "--all-packages"].concat(
    ["--no-dev", "-q", "-v", "--quiet", "--verbose", "--no-cache", "--no-interaction", "-n", "--ansi", "--no-ansi"],
    ["--no-plugins", "--active"],
  ),
  lookup: ["-l", "--list", ...VERSION_HELP],
  python: ["-m", "--module", "--script"],
  value: [
    "--with",
    "--with-editable",
    "--with-requirements",
    "--python",
    "-p",
    "--project",
    "--directory",
    "-C",
  ].concat(
    ["--env-file", "--group", "--extra", "--package", "--index", "--default-index", "--spec", "--pip-args"],
    ["--index-url", "--pyproject", "-P"],
  ),
});

/** Keywords a program can sit behind once a line is cut into segments. */
const STATEMENT_WORDS = new Set(["if", "then", "elif", "else", "do", "while", "until", "!", "{", "coproc"]);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** What resolving a segment's program found. */
export type ProgramResolution =
  /** The program word and its arguments. */
  | { readonly kind: "program"; readonly words: readonly ShellWord[] }
  /** A runner option that executes Python by itself, named by the words that did it. */
  | { readonly kind: "python-option"; readonly via: string }
  /**
   * A wrapper option no table lists (`env -P /bin`), so what the wrapper runs cannot be read; names the wrapper,
   * and carries the segment as each reading of that option would leave it, the wrapper's name still at its head.
   */
  | {
      readonly kind: "unknown-option";
      readonly via: string;
      readonly readings: readonly (readonly ShellWord[])[];
    }
  /** Nothing runs: only keywords, or a lookup such as `command -v`. */
  | { readonly kind: "none" };

/**
 * The outcome of parsing one wrapper's options; `unknown` is the index, counted from the wrapper's own name, of
 * the first option word its table does not list, and `head` how many words that name takes.
 */
type OptionWidth =
  number | "lookup" | { readonly unknown: number; readonly head: number } | { readonly python: string };

/** Whether an option word is accepted by `table`, in its spaced, `--name=value` or `-Xvalue` spelling. */
function optionKind({
  word,
  table,
}: {
  word: string;
  table: WrapperGrammar;
}): "value" | "boolean" | "attached" | undefined {
  if (table.value.has(word)) return "value";
  if (table.boolean.has(word) || (table.numeric && /^-\d+$/.test(word))) return "boolean";
  const equals = word.indexOf("=");
  const name = equals === -1 ? word : word.slice(0, equals);
  const attachedLong = word.startsWith("--") && equals > 0 && (table.value.has(name) || table.boolean.has(name));
  const attachedShort = !word.startsWith("--") && word.length > 2 && table.value.has(word.slice(0, 2));
  return attachedLong || attachedShort ? "attached" : undefined;
}

/**
 * How many leading words of `rest` are one wrapper's options and positional operands.
 *
 * @param rest the words after the wrapper's name
 * @param table the wrapper's grammar
 * @returns the width to skip, or why resolution stops
 */
function optionWidth({ rest, table }: { rest: readonly ShellWord[]; table: WrapperGrammar }): OptionWidth {
  let index = 0;
  while (index < rest.length) {
    const outcome = optionOutcome({ table, word: rest[index]! });
    if (outcome === "operand") break;
    if (outcome === "terminator") {
      index += 1;
      break;
    }
    if (outcome === "unknown") return { head: 0, unknown: index };
    if (typeof outcome !== "number") return outcome;
    index += outcome;
  }
  return index + table.operands;
}

/** What one option word is to a wrapper's grammar. @returns its width, or why the walk ends here */
function optionOutcome({
  word,
  table,
}: {
  word: ShellWord;
  table: WrapperGrammar;
}): number | "operand" | "terminator" | "lookup" | "unknown" | { readonly python: string } {
  if (word.text === "--") return "terminator";
  if (!word.text.startsWith("-") || word.dynamic) return "operand";
  if (table.lookup.has(word.text)) return "lookup";
  if (table.python.has(word.text)) return { python: word.text };
  const kind = optionKind({ table, word: word.text });
  if (kind === undefined) return "unknown";
  return kind === "value" ? 2 : 1;
}

/** GNU tools Homebrew installs under a `g` prefix beside the BSD ones: `gsed`, `gsort`, `gtimeout`. */
// Case-insensitive, as macOS resolves the path: `/opt/homebrew/bin/GTIMEOUT` runs `gtimeout`.
const GNU_PREFIXED = /^g(?:sed|sort|tee|sleep|timeout|env|nice|stdbuf|xargs|find|nohup)$/i;

/**
 * The name a program word runs under: its last path component, with Homebrew's GNU `g` prefix dropped, so
 * `/usr/bin/env` is `env` and `/opt/homebrew/bin/gsort` is `sort`.
 *
 * @param text the program word as written
 * @returns the name the wrapper and program tables are keyed by
 */
export function programName({ text }: { text: string }): string {
  const name = text.slice(text.lastIndexOf("/") + 1);
  return GNU_PREFIXED.test(name) ? name.slice(1) : name;
}

/** How many leading words are one prefix (keyword, assignment, wrapper), or why resolution stops. */
function prefixWidth({ words }: { words: readonly ShellWord[] }): OptionWidth {
  const head = words[0]!.text;
  if (STATEMENT_WORDS.has(head) || ASSIGNMENT.test(head)) return 1;
  const name = programName({ text: head });
  if (RUNNER_TOOLS.has(name) && words[1]?.text === "run") {
    return shifted({ by: 2, width: optionWidth({ rest: words.slice(2), table: RUNNER }) });
  }
  // `/usr/bin/env` is `env` and `gtimeout` is `timeout`: a wrapper named by its path or GNU name runs the same grammar.
  // macOS resolves a path case-insensitively, so `/usr/bin/XARGS` is `xargs` too.
  const table = WRAPPERS[name.toLowerCase()];
  if (table === undefined || words[0]!.dynamic) return 0;
  return shifted({ by: 1, width: optionWidth({ rest: words.slice(1), table }) });
}

/**
 * A width, or an unknown option's index, counted from the wrapper's own name rather than its first option;
 * `head` is how many words name the wrapper itself (`uv run` is two).
 */
function shifted({ width, by }: { width: OptionWidth; by: number }): OptionWidth {
  if (typeof width === "number") return width + by;
  if (typeof width === "object" && "unknown" in width) return { head: by, unknown: width.unknown + by };
  return width;
}

/**
 * The two word lists an unlisted option at `at` could leave the wrapper `words[0..head)` to resolve: the option
 * standing alone, and the option consuming the word after it. A `--name=value` spelling has carried its own
 * value, so it has only the first.
 *
 * The options already parsed before `at` are DROPPED rather than kept: the option walk is stateless, so they
 * cannot change how the words after them read, and keeping them made every reading a distinct subsequence —
 * MEASURED, `sudo` with thirteen `-Z <boolean>` pairs took 24ms and roughly tripled every two pairs, enough
 * to hang the hook on sudo's thirty-odd booleans. Every reading is now the wrapper's head plus a suffix.
 */
function unknownReadings({
  words,
  at,
  head,
}: {
  words: readonly ShellWord[];
  at: number;
  head: number;
}): readonly (readonly ShellWord[])[] {
  const wrapper = words.slice(0, head);
  const alone = [...wrapper, ...words.slice(at + 1)];
  const option = words[at]!.text;
  const carriesValue = option.startsWith("--") && option.includes("=");
  return carriesValue || at + 1 >= words.length ? [alone] : [alone, [...wrapper, ...words.slice(at + 2)]];
}

/**
 * Resolve the program a segment runs: peel a subshell's `(`, then keywords, assignments and wrappers, each by
 * its own grammar.
 *
 * @param words the segment's words, redirections already removed
 * @returns the program and its arguments, a Python-running runner option, a wrapper option no table lists, or
 *   nothing
 */
export function resolveProgram({ words }: { words: readonly ShellWord[] }): ProgramResolution {
  let rest = words;
  while (rest.length > 0) {
    const peeled = peeledSubshell({ words: rest });
    if (peeled !== undefined) {
      rest = peeled;
      continue;
    }
    const width = prefixWidth({ words: rest });
    if (width === "lookup") return { kind: "none" };
    if (typeof width === "object" && "unknown" in width) {
      return {
        kind: "unknown-option",
        readings: unknownReadings({ at: width.unknown, head: width.head, words: rest }),
        via: rest[0]!.text,
      };
    }
    if (typeof width === "object") return { kind: "python-option", via: `${rest[0]!.text} run ${width.python}` };
    if (width === 0) return { kind: "program", words: rest };
    rest = rest.slice(width);
  }
  return { kind: "none" };
}

/** A resolution that reached an answer rather than an option no table lists. */
export type SettledResolution = Exclude<ProgramResolution, { readonly kind: "unknown-option" }>;

/**
 * Every program a segment could run, reading each wrapper option no table lists BOTH ways — standing alone and
 * consuming the next word — so a gate whose subject is one program refuses when either reading reaches it,
 * and never on a line where neither does. Each distinct word list is resolved once, so a run of unlisted
 * options costs one pass per surviving list rather than one per path.
 *
 * @param words the segment's words, redirections already removed
 * @returns each distinct settled resolution, in the order first reached
 */
export function resolvePrograms({ words }: { words: readonly ShellWord[] }): readonly SettledResolution[] {
  const settled = new Map<string, SettledResolution>();
  const seen = new Set<string>();
  const pending: (readonly ShellWord[])[] = [words];
  while (pending.length > 0) {
    const next = pending.shift()!;
    const key = next.map((word) => word.text).join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    const resolution = resolveProgram({ words: next });
    if (resolution.kind === "unknown-option") {
      pending.push(...resolution.readings);
      continue;
    }
    const settledKey = resolution.kind === "program" ? resolution.words.map((word) => word.text).join("\u0000") : "";
    settled.set(`${resolution.kind}\u0001${settledKey}`, resolution);
  }
  return [...settled.values()];
}

/** `words` with a subshell's leading `(` peeled off the first word, or `undefined` when there is none. */
function peeledSubshell({ words }: { words: readonly ShellWord[] }): readonly ShellWord[] | undefined {
  const head = words[0]!;
  if (!head.text.startsWith("(") || head.quoted) {
    return undefined;
  }
  const peeled = head.text.replace(/^\(+/, "");
  return peeled.length === 0 ? words.slice(1) : [{ ...head, text: peeled }, ...words.slice(1)];
}
