/**
 * The program text a stage LAUNCHES from its own words rather than names as its program — `env -S`'s split
 * string, `watch`'s and `eval`'s command line, a `trap` action, a `find` exec action, a shell's `-c` payload
 * inside another program's arguments, and the text a here-string feeds on stdin. `./rawBashStage.ts` walks
 * each one as a script of its own.
 *
 * Pure: words in, text out.
 */
import { clusterReaching, SHELLS, shellPayloadIndex } from "./programText.js";
import { programName } from "./pythonWrappers.js";
import { type ShellWord } from "./shellLexing.js";

/** A bare assignment word: `X=1`, an append `X+=1`, or an array element `a[0]=1`. */
export const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/;

/** A parameter expansion that assigns when the name is unset or empty: `${X:=v}`, `${X=v}`, `${a[0]:=v}`. */
const PARAMETER_ASSIGNMENT = /\$\{[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?:?=/;

/** Inside arithmetic, anything that stores: `=` and its compound forms (never `==` or `!=`), `++`, `--`. */
const ARITHMETIC_STORE = /(?<![=!])=(?!=)|\+\+|--/;

/**
 * What in a subscript may run a command once bash evaluates it again: a substitution, or a `$'…'`, `$"…"` or
 * backslash that decodes into one (`$'\x24(touch f)'`).
 */
const SUBSCRIPT_RUNS = /\$\(|`|\$['"]|\\/;

/**
 * Whether text read as an arithmetic expression stores into a variable. Fails closed: a `<=` is read as a store
 * too, since `<<=` is one.
 *
 * @param text the text bash evaluates arithmetically
 * @returns true when it holds `=` (never `==` or `!=`), `++` or `--`
 */
export function storesInArithmetic({ text }: { text: string }): boolean {
  return ARITHMETIC_STORE.test(text);
}

/**
 * Whether expanded text assigns a variable as it expands — `printf %s "${X:=ok}"` or `echo $((X=5))` creates
 * shell state inside one command. So does a parameter expansion's array subscript
 * or substring offset, both arithmetic: `"${a[x=7]}"` sets `x`.
 *
 * @param text a word's text, or an unquoted heredoc body, as the shell expands it
 * @returns true when a parameter or arithmetic expansion in it assigns, or a subscript runs a substitution
 */
export function assignsInExpansion({ text }: { text: string }): boolean {
  // Bash 5.3's `${ cmd; }` and `${| cmd; }` run a command in place; older shells
  // reject the spelling, so no parameter expansion is read as one.
  if (PARAMETER_ASSIGNMENT.test(text) || /\$\{[\s|]/.test(text)) return true;
  const arithmetic = text.search(/\$\(\(|\$\[/);
  if (arithmetic !== -1) {
    // Past its own opener, an arithmetic span's subscript re-expands a quoted substitution too:
    // `$((a['$(sleep 1)']))` runs it.
    const span = text.slice(arithmetic + 2);
    if (ARITHMETIC_STORE.test(span) || (span.includes("[") && SUBSCRIPT_RUNS.test(span))) return true;
  }
  const parameter = text.indexOf("${");
  if (parameter === -1) return false;
  const rest = text.slice(parameter);
  // A subscript is expanded again when evaluated, so a substitution quoted inside one still runs.
  return /[[:]/.test(rest) && (ARITHMETIC_STORE.test(rest) || SUBSCRIPT_RUNS.test(rest));
}

/**
 * The `-c` payload of a shell a program runs from its own arguments, quoted or not: `find . -exec 'sh' -c '…' \;`.
 * A read-only filter is never asked, so `grep bash -c notes.txt` counts lines rather than running anything.
 *
 * @param args the words after the program name
 * @returns the payload text, or `undefined` when no shell with a `-c` payload sits in them
 */
export function embeddedShellPayload({ args }: { args: readonly ShellWord[] }): string | undefined {
  const shell = args.findIndex((arg) => SHELLS.has(programName({ text: arg.text })));
  if (shell === -1) return undefined;
  const rest = args.slice(shell + 1);
  const payload = shellPayloadIndex({ args: rest });
  if (payload === undefined) return undefined;
  return rest[payload]?.text;
}

/** The `find` actions that run a command written in find's own arguments, up to a `;` or `+`. */
const FIND_EXEC = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

/**
 * The program text a `trap` installs, which bash runs as a command when the signal fires (`trap 'sleep 1'
 * EXIT`). A lone operand, `-` or an empty action resets or ignores a signal and installs nothing.
 *
 * @param args the words after the program name
 * @param name the resolved program name, so any program but `trap` installs nothing
 * @returns the action text, or `undefined` when nothing is installed
 */
export function trapAction({ args, name }: { args: readonly ShellWord[]; name: string }): string | undefined {
  if (name !== "trap") return undefined;
  let at = 0;
  while (at < args.length && /^-[lpP]+$/.test(args[at]!.text)) at += 1;
  if (args[at]?.text === "--") at += 1;
  const operands = args.slice(at);
  const action = operands[0]?.text;
  if (operands.length < 2 || action === "-" || action === "") return undefined;
  return action;
}

/**
 * Each command `find` runs through an exec action (`find . -exec sleep 1 \;` runs `sleep 1`), as its words.
 *
 * @param args the words after `find`
 * @returns each exec action's command words, an unterminated one included
 */
export function findCommands({ args }: { args: readonly ShellWord[] }): readonly (readonly ShellWord[])[] {
  const commands: ShellWord[][] = [];
  let current: ShellWord[] | undefined;
  for (const arg of args) {
    if (current === undefined) {
      if (FIND_EXEC.has(arg.text)) current = [];
    } else if (arg.text === ";" || arg.text === "+") {
      commands.push(current);
      current = undefined;
    } else {
      current.push(arg);
    }
  }
  // An exec action never terminated still names a command, and find is left to refuse it.
  if (current !== undefined) commands.push(current);
  return commands;
}

/** An `env` cluster that splits its value into a command line: `-S`, `-vS`, `-S'cmd'`. */
const ENV_SPLIT = clusterReaching({ swallows: "uC", target: "S" });

/** An `env` cluster ending in an option whose value is the next word: `-u NAME`, `-iC DIR`. */
const ENV_VALUE = /^-(?:(?![uCS])[A-Za-z0-9])*[uC]$/;

/**
 * The command line `env -S`/`--split-string` runs out of one string, when a stage's env has one. Found before
 * program resolution, because the wrapper grammar stops at an option it cannot size.
 *
 * @param words the stage's words, redirections removed
 * @returns the split string, or `undefined` when the stage is no `env` or its options split nothing
 */
export function envSplitString({ words }: { words: readonly ShellWord[] }): string | undefined {
  const start = words.findIndex((word) => !ASSIGNMENT.test(word.unquotedPrefix));
  if (start === -1 || programName({ text: words[start]!.text }) !== "env") return undefined;
  for (let index = start + 1; index < words.length; index += 1) {
    const text = words[index]!.text;
    if (text === "--" || !text.startsWith("-")) return undefined;
    const split = envSplitOption({ index, words });
    if (split !== undefined) return split.text;
    if (ENV_VALUE.test(text) || text === "--unset" || text === "--chdir") index += 1;
  }
  return undefined;
}

/**
 * The string an `env` option word splits into a command line — glued (`-Scmd`, `--split-string=cmd`) or the
 * next word (`-S cmd`) — or `undefined` when the word is no `-S`/`--split-string`.
 */
function envSplitOption({
  words,
  index,
}: {
  words: readonly ShellWord[];
  index: number;
}): { readonly text: string | undefined } | undefined {
  const text = words[index]!.text;
  if (text.startsWith("--split-string=")) return { text: text.slice("--split-string=".length) };
  const cluster = ENV_SPLIT.exec(text);
  const attached = cluster === null ? undefined : text.slice(cluster[0].length);
  if (text === "--split-string" || attached === "") return { text: words[index + 1]?.text };
  return attached === undefined ? undefined : { text: attached };
}

/**
 * The command line `watch` re-runs through `sh -c`, past its options and `-n`'s value.
 *
 * @param name the resolved program name, so any program but `watch` re-runs nothing
 * @param args the words after the program name
 * @returns the command line, or `undefined` when there is none
 */
export function watchedCommand({ name, args }: { name: string; args: readonly ShellWord[] }): string | undefined {
  if (name !== "watch") return undefined;
  let index = 0;
  while (index < args.length && args[index]!.text.startsWith("-")) {
    index += ["-n", "--interval", "-q", "--equexit"].includes(args[index]!.text) ? 2 : 1;
  }
  const command = args.slice(index).map((arg) => arg.text);
  return command.length === 0 ? undefined : command.join(" ");
}

/**
 * The command line `eval` runs, its arguments joined as bash joins them.
 *
 * @param name the resolved program name, so any program but `eval` runs nothing
 * @param args the words after the program name
 * @returns the joined command line, or `undefined` for no `eval` or an empty one
 */
export function evalText({ name, args }: { name: string; args: readonly ShellWord[] }): string | undefined {
  if (name !== "eval" || args.length === 0) return undefined;
  return args.map((arg) => arg.text).join(" ");
}

/**
 * The text a here-string (`<<< text`, `<<<text`) feeds a stage on stdin, when the stage has one.
 *
 * @param words the stage's words, redirections included
 * @returns the here-string's text, or `undefined` when the stage has none
 */
export function hereStringBody({ words }: { words: readonly ShellWord[] }): string | undefined {
  const index = words.findIndex((word) => /^\d*<<</.test(word.shape));
  if (index === -1) return undefined;
  const word = words[index]!;
  const attached = word.text.slice(word.text.indexOf("<<<") + 3);
  if (attached.length > 0) return attached;
  return words[index + 1]?.text;
}
