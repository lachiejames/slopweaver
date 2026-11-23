/**
 * What a keep-alive shell's own command runs, read from its `ps` argv: the credential watch, and the read-only
 * filters it is piped through, or nothing it will vouch for. `./keepAliveWatchShells.ts` reads this to decide whether
 * a retired chair's shell runs only its keep-alive; the incident and the measurement are `./keepAliveSeatClose.ts`.
 *
 * Fail closed: a command is admitted only when every word of it parses, so any spelling this module does not know
 * reads as "not a keep-alive" and the chair stays open.
 *
 * Pure: the argv is the caller's.
 */

/** The filters a keep-alive's pipeline may name, as written in the command. */
export type KeepAliveFilterName = "grep" | "ugrep" | "tail" | "head";

/** A keep-alive shell's command, admitted: the filters its pipeline names, in order — none for a bare watch. */
export interface KeepAliveShellCommand {
  readonly filters: readonly KeepAliveFilterName[];
}

/**
 * Each admitted filter, with the executable names its process may carry. Claude Code's shell snapshot runs a written
 * `grep` as its own bundled `ugrep` (`ps` printed `ugrep -G … -v ^slopweaver:` under every chair's keep-alive shell).
 */
const FILTER_PROCESSES: ReadonlyMap<KeepAliveFilterName, readonly string[]> = new Map([
  ["grep", ["grep", "ugrep"]],
  ["head", ["head"]],
  ["tail", ["tail"]],
  ["ugrep", ["ugrep"]],
]);

/**
 * A row's executable name, as the tree would show it: the last path segment of its first token.
 *
 * @param argv the row's whole command line
 * @returns the executable's base name
 */
export function commandName({ argv }: { argv: string }): string {
  // `split` always yields at least one token.
  const first = argv.split(" ")[0]!;
  return first.slice(first.lastIndexOf("/") + 1);
}

/**
 * Whether a process named `name` may be the process of the written filter `filter`.
 *
 * @param filter the filter as the command wrote it
 * @param name the executable name the process table shows
 * @returns whether that process can be that filter
 */
export function filterRunsAs({ filter, name }: { filter: KeepAliveFilterName; name: string }): boolean {
  return FILTER_PROCESSES.get(filter)!.includes(name);
}

/**
 * Claude Code's Bash-tool shell, as `ps -o command=` printed each live keep-alive's: its snapshot sourced, its options
 * set, two names unaliased, then the command alone inside `eval '…'`, then its cwd recorded. Group 1 is that command,
 * still escaped: a quote inside it is written `'"'"'`, and any other quote breaks the match.
 *
 * `setopt` is matched with or without a leading `\builtin`. MEASURED: Claude Code 2.1.323 writes
 * `&& \builtin setopt NO_EXTENDED_GLOB …`, a form this pattern did not admit, so not one keep-alive shell on the
 * machine read as one — a bare watch included — and `session close-done` held 50 retired chairs as `screen busy`.
 * Re-check with `ps -o command= -p <a keep-alive shell's pid>`.
 */
const BASH_TOOL_SHELL =
  /^\S*\/(?:zsh|bash) -c source \S+ 2>\/dev\/null \|\| true && (?:\\builtin )?setopt [A-Z_ ]+ 2>\/dev\/null \|\| true(?: && \{ \\builtin unalias -- '\w+'; \\builtin unset -f -- '\w+'; \} >\/dev\/null 2>&1 \|\| true)* && eval '((?:[^']|'"'"')*)' < \/dev\/null && pwd -P >\| \S+$/u;

/** How the Bash tool writes one single quote inside its `eval '…'`: close, a double-quoted quote, reopen. */
const ESCAPED_QUOTE = `'"'"'`;

/** A plain `zsh -c <command>` whose command carries no shell syntax at all — group 1 is the command. */
const PLAIN_SHELL = /^\S*\/(?:zsh|bash) -c ([^;&|<>`$()'"\\{}*?[\]~#!\n]*)$/u;

/**
 * One environment assignment ahead of a command: `SLOPWEAVER_CLI_DIR` or `CMUX_WORKSPACE_ID` only, the two the boot
 * chain writes, so nothing like `NODE_OPTIONS` loads other code into the watch, and no shell syntax in its value.
 * `watchStage` binds `SLOPWEAVER_CLI_DIR` to the program's own tree (Codex review r2).
 */
const ENV_ASSIGNMENT = /^(?:SLOPWEAVER_CLI_DIR|CMUX_WORKSPACE_ID)=[^;&|<>`$()'"\\\s]*$/u;

/** The one redirect a keep-alive may carry: its stderr joined to the pipe, right before the first `|`. */
const JOIN_STDERR = "2>&1";

/** One word of a shell command: its text, whether any of it was quoted, and whether it is an operator. */
interface ShellWord {
  readonly text: string;
  readonly quoted: boolean;
  readonly operator: boolean;
}

/** One lexical piece of a command: a run of blanks, a `|`, the `2>&1` join, single-quoted text, or plain characters. */
interface ShellToken {
  readonly kind: "space" | "pipe" | "join" | "quoted" | "plain";
  readonly length: number;
  readonly text: string;
}

/**
 * Each token a command may carry after the join, tried in order; a `|` doubled into `||` matches none. A plain run
 * holds no character the shell expands, globs, redirects or splits commands on.
 */
const TOKEN_PATTERNS: readonly (readonly ["space" | "pipe" | "quoted" | "plain", RegExp])[] = [
  ["space", /^\s+/u],
  ["pipe", /^\|(?!\|)/u],
  ["quoted", /^'[^']*'/u],
  ["plain", /^[A-Za-z0-9_./=:^@%+,-]+/u],
];

/**
 * The token at the start of `rest`, or `undefined` for anything else — an unclosed quote included. `2>&1` is a token
 * only where no word has started, so a word fused to it (`x2>&1`) refuses.
 */
function nextToken({ rest, started }: { rest: string; started: boolean }): ShellToken | undefined {
  if (!started && rest.startsWith(JOIN_STDERR)) {
    return { kind: "join", length: JOIN_STDERR.length, text: JOIN_STDERR };
  }
  for (const [kind, pattern] of TOKEN_PATTERNS) {
    const matched = pattern.exec(rest)?.[0];
    if (matched !== undefined) {
      return { kind, length: matched.length, text: kind === "quoted" ? matched.slice(1, -1) : matched };
    }
  }
  return undefined;
}

/**
 * Split a command into words, admitting only plain characters, single-quoted text, the `|` operator and `2>&1`.
 * Anything else the shell would act on — `;`, `&`, `$`, a backtick, a double quote, a redirect to a file, a glob —
 * refuses the whole command, so what reads clean here runs nothing but its words.
 */
function shellWords({ command }: { command: string }): readonly ShellWord[] | undefined {
  const words: ShellWord[] = [];
  let word: PendingWord | undefined;
  for (let at = 0; at < command.length;) {
    const token = nextToken({ rest: command.slice(at), started: word !== undefined });
    if (token === undefined) {
      return undefined;
    }
    at += token.length;
    word = applyToken({ token, word, words });
  }
  return word === undefined ? words : [...words, { operator: false, ...word }];
}

/** The word being read, before a blank or an operator ends it. */
interface PendingWord {
  readonly text: string;
  readonly quoted: boolean;
}

/**
 * Apply one token: text extends the pending word; a blank or `|` ends it into `words`; an operator is pushed after.
 * The join never ends a word, because it is a token only where none has started.
 */
function applyToken({
  token,
  word,
  words,
}: {
  token: ShellToken;
  word: PendingWord | undefined;
  words: ShellWord[];
}): PendingWord | undefined {
  if (token.kind === "quoted" || token.kind === "plain") {
    const quoted = token.kind === "quoted" || word?.quoted === true;
    return word === undefined ? { quoted, text: token.text } : { quoted, text: word.text + token.text };
  }
  if (word !== undefined) {
    words.push({ operator: false, ...word });
  }
  if (token.kind !== "space") {
    words.push({ operator: true, quoted: false, text: token.text });
  }
  return undefined;
}

/** Split words into pipeline stages on each `|`; `undefined` when a stage is empty. */
function pipelineStages({ words }: { words: readonly ShellWord[] }): readonly (readonly ShellWord[])[] | undefined {
  const stages: ShellWord[][] = [[]];
  for (const word of words) {
    if (word.operator && word.text === "|") {
      stages.push([]);
    } else {
      stages.at(-1)!.push(word);
    }
  }
  return stages.some((stage) => stage.length === 0) ? undefined : stages;
}

/**
 * Whether the first stage is `[NAME=value …] <path>/slopweaver claude watch [--wait]`, with `2>&1` at its end only
 * when a pipe follows.
 */
function watchStage({ stage, piped }: { stage: readonly ShellWord[]; piped: boolean }): boolean {
  const last = stage.at(-1)!;
  const joined = last.operator && last.text === JOIN_STDERR;
  const words = joined && piped ? stage.slice(0, -1) : stage;
  if (words.some((word) => word.operator)) {
    return false;
  }
  const firstCommand = words.findIndex((word) => word.quoted || !ENV_ASSIGNMENT.test(word.text));
  if (firstCommand === -1) {
    return false;
  }
  const [program, ...rest] = words.slice(firstCommand);
  const verb = rest.map((word) => word.text).join(" ");
  const named = !program!.quoted && commandName({ argv: program!.text }) === "slopweaver";
  // The launcher runs `$SLOPWEAVER_CLI_DIR/src/cli/index.ts`, so a CLI dir other than the program's own tree loads other code.
  const ownTree = words
    .slice(0, firstCommand)
    .filter((word) => word.text.startsWith("SLOPWEAVER_CLI_DIR="))
    .every((word) => `${word.text.slice("SLOPWEAVER_CLI_DIR=".length)}/bin/slopweaver` === program!.text);
  return (
    named &&
    ownTree &&
    rest.every((word) => !word.quoted) &&
    (verb === "claude watch" || verb === "claude watch --wait")
  );
}

/** A grep or ugrep option a keep-alive filter may carry: a cluster of match-mode flags that read nothing else. */
const GREP_OPTION = /^-[vinEFGwx]+$/u;

/** A count a `head` or `tail` may be given as its own word after `-n`: `20`, or `+20` from the start. */
const LINE_COUNT = /^\+?\d+$/u;

/** A line-count option written as one word: `-20`, `-n20`, `-n+20`, `--lines=20`. */
const LINE_COUNT_OPTION = /^(?:-\d+|-n\+?\d+|--lines=\+?\d+)$/u;

/**
 * Whether a grep or ugrep stage's arguments are match-mode flags then exactly one pattern, and nothing after it. An
 * ALLOWLIST, never a denylist: ugrep alone has `--filter` (runs a utility per file), `--save-config` (writes a file),
 * `-r` and file operands (reads the disk), so any option or operand not named here refuses (Codex review r1).
 */
function grepArguments({ args }: { args: readonly ShellWord[] }): boolean {
  const pattern = args.findIndex((word) => !(word.text === "--line-buffered" || GREP_OPTION.test(word.text)));
  return pattern !== -1 && pattern === args.length - 1 && !args[pattern]!.text.startsWith("-");
}

/** Whether a head or tail stage's arguments are at most one line count and nothing else: no file, no following. */
function lineCountArguments({ args }: { args: readonly ShellWord[] }): boolean {
  if (args.length === 0) {
    return true;
  }
  if (args.length === 1) {
    return LINE_COUNT_OPTION.test(args[0]!.text);
  }
  return args.length === 2 && args[0]!.text === "-n" && LINE_COUNT.test(args[1]!.text);
}

/**
 * Whether a filter's arguments keep it a filter that reads only the watch's output and ends with it, by an allowlist
 * per filter: `grepArguments`, `lineCountArguments`.
 */
function readOnlyArguments({ filter, args }: { filter: KeepAliveFilterName; args: readonly ShellWord[] }): boolean {
  if (filter === "grep" || filter === "ugrep") {
    return grepArguments({ args });
  }
  return lineCountArguments({ args });
}

/** Whether a word names one of the admitted filters. */
function isFilterName(text: string): text is KeepAliveFilterName {
  return [...FILTER_PROCESSES.keys()].some((filter) => filter === text);
}

/** The filter a later stage runs: one admitted filter called bare by name, read-only arguments, no operator. */
function filterStage({ stage }: { stage: readonly ShellWord[] }): KeepAliveFilterName | undefined {
  const [program, ...args] = stage;
  if (program!.quoted || program!.operator || args.some((word) => word.operator) || !isFilterName(program!.text)) {
    return undefined;
  }
  return readOnlyArguments({ args, filter: program!.text }) ? program!.text : undefined;
}

/**
 * What a shell's own command runs, when it is the keep-alive: `[NAME=value …] <path>/slopweaver claude watch
 * [--wait]`, as standing-sessions.md tells a chair to start it, optionally followed by `2>&1` and a pipeline of
 * read-only filters (`grep`, `ugrep`, `head`, `tail`) called by name. Work a shell runs in its OWN process — a builtin
 * loop, `zselect`, a `sleep` it `exec`s later — starts no child and can sleep in `S` exactly as a shell waiting on its
 * watch does, so its command string is the only place it shows; a `;`, `&`, `$`, a redirect to a file, any other
 * program, or any filter argument outside `readOnlyArguments`' allowlist (a file operand, `tail -f`, `ugrep --filter`)
 refuses.
 *
 * The filters are admitted because the supervisor boot chain starts every background job through a prefix ending
 * `2>&1 | grep -v '^slopweaver:'`: MEASURED (`ps -o command= -p <a keep-alive shell's pid>`), all 53 live keep-alive
 * shells on the machine were written that way, so a bare-only rule held every retired chair. A filter reads the watch's output, starts
 * nothing, and ends when the watch does.
 *
 * @param argv the shell's whole command line, as `ps` prints it
 * @returns the filters the pipeline names, in order (none for a bare watch), or `undefined` when it is not a keep-alive
 */
export function parseKeepAliveShellCommand({ argv }: { argv: string }): KeepAliveShellCommand | undefined {
  // `ps` pads the last column with trailing spaces (processes.ts § decodeClaudeWatch).
  const line = argv.trimEnd();
  const matched = BASH_TOOL_SHELL.exec(line) === null ? PLAIN_SHELL.exec(line) : BASH_TOOL_SHELL.exec(line);
  const escaped = matched?.[1];
  if (escaped === undefined) {
    return undefined;
  }
  const words = shellWords({ command: escaped.replaceAll(ESCAPED_QUOTE, "'") });
  const stages = words === undefined ? undefined : pipelineStages({ words });
  if (stages === undefined || !watchStage({ piped: stages.length > 1, stage: stages[0]! })) {
    return undefined;
  }
  const filters = stages.slice(1).map((stage) => filterStage({ stage }));
  if (filters.some((filter) => filter === undefined)) {
    return undefined;
  }
  return { filters: filters.filter((filter) => filter !== undefined) };
}
