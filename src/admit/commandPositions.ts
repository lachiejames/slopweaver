/**
 * Where a command can START inside one command list, for `./wholeTreeCheck.ts`'s backstop: the first word, the
 * word after a shell keyword, a `case` pattern's `)`, an exec wrapper (past its own words) or a `find -exec`,
 * and a word opening a subshell. Bash has more such places than the segment walk models, and review found them
 * one at a time, across twelve passes. A name in ARGUMENT position is never a start: `pgrep -f
 * tsgolint` and `grep do tsc notes.txt` name a program without running it.
 */
import { ASSIGNMENT } from "./launchedText.js";
import { programName, standsAlone } from "./pythonWrappers.js";
import type { ShellWord } from "./shellLexing.js";

/**
 * Bash's reserved words a command follows, from `compgen -k`: `coproc yarn typecheck` runs it.
 * `time` is a wrapper below, since it takes options; `{` opens a command wherever it stands unquoted, so
 * `coproc NAME { …; }`, `function f { …; }` and `f(){ …;}` are read too. `coproc NAME cmd` runs `NAME`, not
 * `cmd` (bash 5.3: `coproc CHECK echo hi` prints `CHECK: command not found`), so nothing is skipped for a name.
 */
const SHELL_KEYWORDS: ReadonlySet<string> = new Set([
  "then",
  "do",
  "else",
  "elif",
  "if",
  "while",
  "until",
  "!",
  "{",
  "coproc",
]);

/** How one exec wrapper reads its own words before the command it runs. */
interface WrapperGrammar {
  /** Options that stand alone, so the next word is never their value; `-<digits>` too where `numeric`. */
  readonly flags: readonly string[];
  /** Whether a bare `-<digits>` is an option (`nice -5`). */
  readonly numeric: boolean;
  /** Options that consume the NEXT word as their value; an attached value (`-o0`, `--interval=1`) needs none. */
  readonly values: readonly string[];
  /** Positional operands before the command: `timeout 60 yarn`, `taskset 0x1 yarn`, `flock /tmp/l yarn`. */
  readonly operands: number;
  /** Options after which the words name a command without running it (`command -v`, `sudo -l`), as `./pythonWrappers.ts` reads them. */
  readonly lookups: readonly string[];
  /** The wrapper's own name, set where it is looked up, so `./pythonWrappers.ts`'s option table can be asked. */
  readonly name?: string;
}

/** A wrapper grammar with the given flags, value options, operands and lookups, each none by default. */
function takes({
  flags = [],
  lookups = [],
  numeric = false,
  operands = 0,
  values = [],
}: {
  flags?: readonly string[];
  lookups?: readonly string[];
  numeric?: boolean;
  operands?: number;
  values?: readonly string[];
}): WrapperGrammar {
  return { flags, lookups, numeric, operands, values };
}

/**
 * Exec wrappers: the first word after their own options and operands is a command. The set is DECLARED, and a
 * wrapper outside it is the tripwire's named gap rather than a defect — review found `env`, `stdbuf -o 0` and
 * `arch -arm64` one at a time, so the common Unix and macOS ones are listed here at once.
 */
const WRAPPERS: Readonly<Record<string, WrapperGrammar>> = {
  // `arch -arm64 grep tsc notes.txt` runs grep, so the architecture flags stand alone.
  arch: takes({
    flags: ["-arm64", "-arm64e", "-x86_64", "-x86_64h", "-i386", "-32", "-64", "-c", "-h"],
    values: ["-arch", "-e"],
  }),
  builtin: takes({}),
  caffeinate: takes({ values: ["-t", "-w"] }),
  chroot: takes({ operands: 1, values: ["--userspec", "--groups"] }),
  chrt: takes({ operands: 1 }),
  command: takes({ lookups: ["-v", "-V"] }),
  cpulimit: takes({ values: ["-l", "--limit", "-p", "--pid", "-e", "--exe"] }),
  doas: takes({ values: ["-u", "-C", "-a"] }),
  env: takes({ values: ["-u", "--unset", "-C", "--chdir", "-S", "--split-string"] }),
  exec: takes({ values: ["-a"] }),
  flock: takes({ operands: 1, values: ["-w", "--timeout", "-E", "--conflict-exit-code"] }),
  gtimeout: takes({ operands: 1, values: ["-s", "--signal", "-k", "--kill-after"] }),
  ionice: takes({ values: ["-c", "--class", "-n", "--classdata", "-p", "--pid"] }),
  nice: takes({ numeric: true, values: ["-n", "--adjustment"] }),
  // zsh's precommand modifiers, as in `./pythonWrappers.ts`: `noglob watch '<line>'` runs watch.
  nocorrect: takes({}),
  noglob: takes({}),
  nohup: takes({}),
  prlimit: takes({ values: ["-p", "--pid"] }),
  runuser: takes({
    values: ["-u", "--user", "-g", "--group", "-G", "--supp-group", "-s", "--shell", "-w", "--whitelist-environment"],
  }),
  // BSD/macOS `script -q /dev/null jq -n 1` runs jq, the command after its transcript file.
  script: takes({ flags: ["-a", "-d", "-e", "-F", "-k", "-p", "-q", "-r"], operands: 1, values: ["-t", "-T"] }),
  setsid: takes({}),
  stdbuf: takes({ values: ["-i", "-o", "-e", "--input", "--output", "--error"] }),
  sudo: takes({
    lookups: ["-l", "--list", "-v", "--validate", "-V", "--version", "-K", "--remove-timestamp", "-e", "--edit"],
    values: ["-u", "-g", "-h", "-p", "-C", "-D", "-r", "-t", "-U", "-T", "--user", "--group", "--chdir"],
  }),
  taskset: takes({ flags: ["-a", "--all-tasks", "-c", "--cpu-list"], lookups: ["-p", "--pid"], operands: 1 }),
  time: takes({ values: ["-o", "--output", "-f", "--format"] }),
  timeout: takes({ operands: 1, values: ["-s", "--signal", "-k", "--kill-after"] }),
  unbuffer: takes({}),
  watch: takes({
    flags: ["-b", "--beep", "-c", "--color", "-d", "--differences", "-e", "--errexit", "-g", "--chgexit", "-t"].concat([
      "--no-title",
      "-x",
      "--exec",
      "-p",
      "--precise",
      "-w",
      "--no-wrap",
      "-r",
      "--no-rerun",
    ]),
    values: ["-n", "--interval", "-q", "--equexit"],
  }),
  xargs: takes({
    values: ["-I", "-J", "-R", "-S", "-L", "-n", "-P", "-s", "-E", "-d", "-a"].concat([
      "--max-args",
      "--max-procs",
      "--delimiter",
      "--arg-file",
      "--max-lines",
      "--max-chars",
    ]),
  }),
};

/** `env`'s options whose value is a whole command line of its own, split by `env` rather than the shell. */
const ENV_SPLIT: readonly string[] = ["-S", "--split-string"];

/**
 * Wrappers that hand an option's value to a shell as a command line: `runuser -c '<line>' <user>`, and
 * `flock <lock> -c '<line>'`.
 */
const USER_SHELLS: ReadonlySet<string> = new Set(["flock", "runuser", "su"]);

/** The options of {@link USER_SHELLS} whose value is that command line. */
const COMMAND_OPTIONS: readonly string[] = ["-c", "--command", "--session-command"];

/**
 * The command line a wrapper runs from an option's VALUE, which is a payload to walk rather than a word to judge:
 * `env -S "<line>"`, `runuser -c '<line>' <user>` or `su`, `watch '<line>'`, and the handler
 * `trap '<line>' DEBUG` runs before the next command.
 *
 * @param words the words from a command start, the wrapper (by any path) first
 * @returns the payload line, or `undefined` when these words carry none
 */
export function wrapperPayload({ words }: { words: readonly ShellWord[] }): string | undefined {
  const head = words[0]?.text;
  // By any path, in any case and by Homebrew's GNU name, as macOS runs it: `/opt/homebrew/bin/GENV -S …`.
  const name = head === undefined ? undefined : programName({ text: head }).toLowerCase();
  if (name !== undefined && USER_SHELLS.has(name)) {
    return commandOptionPayload({ words: words.slice(1) });
  }
  if (name === "watch") {
    return watchPayload({ words: words.slice(1) });
  }
  if (name === "trap") {
    return trapPayload({ words: words.slice(1) });
  }
  return name === "env" ? envSplitPayload({ words }) : undefined;
}

/**
 * The line `watch` hands `sh -c`: its words after its own options, joined — `watch 'yarn typecheck'` runs the
 * lap every two seconds. With `-x`/`--exec` it runs them directly, which the start
 * grammar reads instead.
 */
function watchPayload({ words }: { words: readonly ShellWord[] }): string | undefined {
  const { values } = WRAPPERS["watch"]!;
  let at = 0;
  while (at < words.length && words[at]!.text.startsWith("-")) {
    const text = words[at]!.text;
    if (text === "-x" || text === "--exec") return undefined;
    at += values.includes(text) ? 2 : 1;
    if (text === "--") break;
  }
  const line = words.slice(at).map((word) => word.text);
  return line.length === 0 ? undefined : line.join(" ");
}

/**
 * The handler `trap` installs: its first operand, when a signal follows it. A lone operand is a signal to reset,
 * and `-` resets rather than runs; `-l` and `-p` only print.
 */
function trapPayload({ words }: { words: readonly ShellWord[] }): string | undefined {
  const at = words[0]?.text === "--" ? 1 : 0;
  const handler = words[at];
  if (handler === undefined || words.length - at < 2 || handler.text === "-" || /^-[lp]+$/u.test(handler.text)) {
    return undefined;
  }
  return handler.text;
}

/** The value of `-c`/`--command` among a user shell's words, which may sit before or after the user. */
function commandOptionPayload({ words }: { words: readonly ShellWord[] }): string | undefined {
  for (const [at, word] of words.entries()) {
    if (word.text === "--") {
      return undefined;
    }
    if (COMMAND_OPTIONS.includes(word.text)) {
      return words[at + 1]?.text;
    }
    const attached = COMMAND_OPTIONS.find((flag) => word.text.startsWith(flag.startsWith("--") ? `${flag}=` : flag));
    if (attached !== undefined && word.text.length > attached.length) {
      return word.text.slice(attached.length).replace(/^=/u, "");
    }
  }
  return undefined;
}

/** The command line an `env -S "<line>"` runs, with the words after it that `env` appends. */
function envSplitPayload({ words }: { words: readonly ShellWord[] }): string | undefined {
  for (const [at, word] of words.slice(1).entries()) {
    if (!word.text.startsWith("-")) {
      return undefined;
    }
    const attached = ENV_SPLIT.find(
      (flag) =>
        word.text.startsWith(`${flag}=`) || (flag === "-S" && word.text.length > 2 && word.text.startsWith(flag)),
    );
    // `env` appends the argv after the split string: `env -S yarn typecheck` runs `yarn typecheck`.
    if (attached !== undefined) {
      const rest = words.slice(at + 2).map((after) => after.text);
      return [envSplitText({ text: word.text.slice(attached.length).replace(/^=/u, "") }), ...rest].join(" ");
    }
    if (ENV_SPLIT.includes(word.text)) {
      const [split, ...rest] = words.slice(at + 2).map((after) => after.text);
      return split === undefined ? undefined : [envSplitText({ text: split }), ...rest].join(" ");
    }
  }
  return undefined;
}

/**
 * An `env -S` string with its own escapes applied: `\_` and the whitespace escapes separate arguments, and `\c`
 * ends the string — so `env -S 'yarn\_typecheck'` reads as the `yarn typecheck` it runs.
 */
function envSplitText({ text }: { text: string }): string {
  const escape = /\\(.)/gsu;
  for (const match of text.matchAll(escape)) {
    if (match[1] === "c") return envSplitText({ text: text.slice(0, match.index) });
  }
  return text.replace(escape, (whole, letter: string) => ("_tnfrv".includes(letter) ? " " : whole));
}

/** Keywords whose next word is a NAME, after which a bare `{` opens a body: `coproc C { …; }`, `function f { …; }`. */
const NAMING_KEYWORDS: ReadonlySet<string> = new Set(["coproc", "function"]);

/** `find` actions whose next word is a command, wherever they sit. */
const FIND_EXEC: ReadonlySet<string> = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

/**
 * What the words so far hand the next one: a command start, the wrapper still reading its words, how many
 * operands it still takes, and whether the next word is the value of one of its options.
 */
interface Position {
  readonly start: boolean;
  readonly wrapper: WrapperGrammar | undefined;
  readonly operands: number;
  readonly value: boolean;
}

/**
 * Every index in one command list where a command starts, a subshell's leading `(` still on its word. A wrapper
 * option missing from its table may or may not take a value — `runuser -s <shell>` is such a case — so the words are read BOTH ways, valueless and consuming the next word, and a start under either reading
 * counts. An extra start costs a false refusal only where it lands on a watched program, never a bypass. A wrapper's
 * declared `flags` are never read as taking a value, which is what keeps `arch -arm64 grep tsc x` allowed; an
 * option neither table declares is the residue, and the hatch is the way past one.
 *
 * @param words one command list's words
 * @returns the start indexes in order
 */
export function commandStarts({ words }: { words: readonly ShellWord[] }): readonly number[] {
  const starts = new Set([...startsUnder({ greedy: false, words }), ...startsUnder({ greedy: true, words })]);
  return [...starts].toSorted((a, b) => a - b);
}

/**
 * The command starts under one reading of wrapper options the table does not know.
 *
 * @param words one command list's words
 * @param greedy read an unknown wrapper option as consuming the word after it
 * @returns the start indexes in order
 */
function startsUnder({ greedy, words }: { greedy: boolean; words: readonly ShellWord[] }): readonly number[] {
  const starts: number[] = [];
  let position: Position = { operands: 0, start: true, value: false, wrapper: undefined };
  let find: FindState = "none";
  for (const [at, word] of words.entries()) {
    const here = position.start || (!word.quoted && word.text.startsWith("("));
    if (here) {
      starts.push(at);
    }
    const reading = findBefore({ find, here, word });
    const inFind = reading === "expression";
    find = findAfter({ find: reading, previous: words[at - 1], word });
    const option = wrapperWord({ greedy, position, word });
    if (option === undefined) {
      const keyword = words[at - 2];
      const named = keyword !== undefined && NAMING_KEYWORDS.has(keyword.text);
      position = nextPosition({ inFind, here, named, previous: words[at - 1], word });
    } else {
      position = option;
    }
  }
  return starts;
}

/**
 * Where `find`'s own grammar is: its expression opens an action's command, and resumes after that action's `;`
 * or `{} +`. A later action follows the first one's command, while an `-exec` inside an action's argv is data
 *.
 */
type FindState = "none" | "expression" | "action";

/** The find state a word is read in: a `find` at a command start opens its own expression. */
function findBefore({ find, here, word }: { find: FindState; here: boolean; word: ShellWord }): FindState {
  const bare = word.text.replace(/^\(+/u, "");
  return here && programName({ text: bare }).toLowerCase() === "find" ? "expression" : find;
}

/** The find state after a word: an action word opens an action, and its terminator closes it. */
function findAfter({
  find,
  previous,
  word,
}: {
  find: FindState;
  previous: ShellWord | undefined;
  word: ShellWord;
}): FindState {
  if (find === "expression" && !word.dynamic && FIND_EXEC.has(word.text)) {
    return "action";
  }
  const closes = word.text === ";" || (word.text === "+" && previous?.text === "{}");
  return find === "action" && closes ? "expression" : find;
}

/**
 * Where a wrapper stands once it has read one more of its own words: the command starts after its last operand.
 *
 * @param wrapper the wrapper's grammar
 * @param operands how many operands it still takes
 * @returns what that hands the next word
 */
function wrapperAt({ operands, wrapper }: { operands: number; wrapper: WrapperGrammar }): Position {
  return { operands, start: operands === 0, value: false, wrapper };
}

/**
 * A wrapper's own option, an option's value or an operand: the command is still to come.
 *
 * @param greedy whether an option missing from the wrapper's table consumes the next word
 * @param word the word just read
 * @param position what the word before it handed this one
 * @returns what this word hands the next, or `undefined` when it is the command itself
 */
function wrapperWord({
  greedy,
  position,
  word,
}: {
  greedy: boolean;
  position: Position;
  word: ShellWord;
}): Position | undefined {
  const { operands, wrapper } = position;
  if (wrapper === undefined) {
    return undefined;
  }
  if (position.value) {
    return wrapperAt({ operands, wrapper });
  }
  if (!word.quoted && wrapper.lookups.includes(word.text)) {
    return { operands: 0, start: false, value: false, wrapper: undefined };
  }
  if (!word.quoted && word.text.startsWith("-")) {
    const value = wrapper.values.includes(word.text) || (greedy && mayTakeValue({ word: word.text, wrapper }));
    return value ? { operands, start: false, value, wrapper } : wrapperAt({ operands, wrapper });
  }
  if (operands > 0) {
    return wrapperAt({ operands: operands - 1, wrapper });
  }
  return undefined;
}

/**
 * Whether an option the table does not list as taking a value might take one: not `--`, not `--name=value`,
 * not a listed short option with its value attached (`xargs -n1`), and not an option `./pythonWrappers.ts`
 * declares standing alone (`xargs -0`). Without that, `xargs -n1 grep tsc` reads `tsc` as the command.
 *
 * @param word the option as typed
 * @param wrapper the wrapper reading it
 * @returns true when the value-taking reading should consume the next word
 */
function mayTakeValue({ word, wrapper }: { word: string; wrapper: WrapperGrammar }): boolean {
  const attached = !word.startsWith("--") && word.length > 2 && wrapper.values.includes(word.slice(0, 2));
  const declared = wrapper.flags.includes(word) || (wrapper.numeric && /^-\d+$/u.test(word));
  const alone = attached || declared || standsAlone({ option: word, wrapper: wrapper.name });
  return word !== "--" && !word.includes("=") && !alone;
}

/**
 * What one word hands the next: a keyword, a `case` pattern, a wrapper or a `find -exec` makes it a command
 * start. Quoted words are data, never grammar.
 *
 * @param word the word just read
 * @param inFind whether `find` has led this list, whose actions — chained ones too — open a command
 * @param here whether it stood at a command start itself
 * @param named whether it follows the name a `coproc` or `function` keyword gives, where a `{` opens the body
 * @param previous the word before it, which is `in` ahead of a `case` statement's first pattern
 * @returns what this word hands the next
 */
function nextPosition({
  inFind,
  here,
  named,
  previous,
  word,
}: {
  inFind: boolean;
  here: boolean;
  named: boolean;
  previous: ShellWord | undefined;
  word: ShellWord;
}): Position {
  // An action opens a command only in `find`'s own words: `grep -- -exec yarn x` runs grep.
  // Quoting reaches `find` as the same argument, so `"-exec"` opens one too.
  const action = inFind && !word.dynamic && FIND_EXEC.has(word.text);
  if (word.quoted) {
    return { operands: 0, start: action, value: false, wrapper: undefined };
  }
  const text = word.text.replace(/^\(+/u, "");
  // `case x in x)`: a pattern follows `in`, or a previous arm's `;;`, which opens its own segment.
  const pattern = text.endsWith(")") && (here || previous?.text === "in");
  // A brace group opens a command as a bare `{` where a command starts or after a function head, or attached to
  // one (`f(){ yarn typecheck;}`), never as data: `grep foo{ tsc x` and `grep { tsc x` run grep.
  const group = text === "{" && (here || named || previous?.text.endsWith("()") === true);
  // `FOO=1 script -q /dev/null jq` runs script: an assignment prefix hands the start on.
  const keyword = (here && (SHELL_KEYWORDS.has(text) || ASSIGNMENT.test(text))) || group || text.endsWith("(){");
  // By any path, in any case and by Homebrew's GNU name, as macOS runs it: `/usr/bin/SUDO /usr/bin/SU -c …`.
  const name = programName({ text }).toLowerCase();
  const found = here ? WRAPPERS[name] : undefined;
  const wrapper = found === undefined ? undefined : { ...found, name };
  const operands = wrapper === undefined ? 0 : wrapper.operands;
  const wraps = wrapper !== undefined && operands === 0;
  return { operands, start: action || pattern || keyword || wraps, value: false, wrapper };
}
