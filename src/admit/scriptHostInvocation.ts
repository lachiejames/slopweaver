/**
 * How `node` and `tsx` read their own words, for `./wholeTreeCheck.ts`: which word is the script they run. The
 * script is the first word that is no option, but `node -r <preload>` and `tsx --tsconfig <path>` take values
 * whose grammar this does not model, so each spaced option is read BOTH ways, valueless and consuming the
 * word after it. A word after `-e`/`-p` is the evaluated program's data, never a script:
 * `node -e '…' node_modules/typescript/lib/tsc.js` prints a path and runs no compiler. A host's own subcommand
 * (`tsx watch <script>`, `node inspect <script>`) comes before the script, with options on either side of it.
 */

import type { ShellWord } from "./shellLexing.js";

/** `node` options whose value is the program to run, leaving every later word as that program's data. */
const EVAL_FLAGS: ReadonlySet<string> = new Set(["-e", "--eval", "-p", "--print", "-pe", "-ep"]);

/** Each host's subcommands that run the script after them (`tsx watch <script>`). */
const HOST_COMMANDS: Readonly<Record<string, readonly string[]>> = { node: ["inspect"], tsx: ["watch"] };

/**
 * The package script `node --run <script>` or `node --run=<script>` runs (Node 22+, pinned 24 in `.nvmrc`), with
 * the words after it — the same script `yarn <script>` would run. Read up to `--`, the
 * only point past which a word is certainly the script's own; a `--run` after a script file is a false refusal.
 *
 * @param args the words after `node`
 * @returns the script word first, then the words Node hands it, or `undefined` when there is no `--run`
 */
export function nodeRunScript({ args }: { args: readonly ShellWord[] }): readonly ShellWord[] | undefined {
  for (const [at, word] of args.entries()) {
    if (word.text === "--") {
      return undefined;
    }
    if (word.text === "--run" && at + 1 < args.length) {
      return withoutSeparator({ words: args.slice(at + 1) });
    }
    if (word.text.startsWith("--run=")) {
      return withoutSeparator({ words: [{ ...word, text: word.text.slice("--run=".length) }, ...args.slice(at + 1)] });
    }
  }
  return undefined;
}

/** A script and its words, less the `--` Node consumes after it: `node --run typecheck -- --help`. */
function withoutSeparator({ words }: { words: readonly ShellWord[] }): readonly ShellWord[] {
  return words[1]?.text === "--" ? [words[0]!, ...words.slice(2)] : words;
}

/**
 * Whether an option before the script names a module matching `pattern` — as a value, attached (`--require=<m>`,
 * `-r<m>`) or spaced. A preload runs whatever the rest of the line does: `node --require=<tsc.js> -e ''` runs
 * the compiler over the project. The scan ends at the evaluated program, `--`, or the
 * first word no option before it could have taken as a value, so a script's own argv stays data.
 *
 * @param args the words after `node` or `tsx`
 * @param pattern the module path being looked for
 * @returns whether an option names it
 */
export function optionNamesModule({ args, pattern }: { args: readonly string[]; pattern: RegExp }): boolean {
  for (const [at, word] of args.entries()) {
    const option = word.startsWith("-");
    if (word === "--" || EVAL_FLAGS.has(word.split("=")[0]!) || (!option && args[at - 1]?.startsWith("-") !== true)) {
      return false;
    }
    const values = option ? [word.slice(word.indexOf("=") + 1), word.slice(2)] : [word];
    if (values.some((value) => pattern.test(value))) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a literal `NODE_OPTIONS=<options>` among the words — an inline prefix or an `export` — has an option
 * naming a module matching `pattern`: Node reads that variable as options before its own argv, so
 * `NODE_OPTIONS=--require=<tsc.js> node -e ''` preloads the compiler.
 *
 * @param words one command list's words
 * @param pattern the module path being looked for
 * @returns whether the variable names it
 */
export function nodeOptionsNameModule({ words, pattern }: { words: readonly ShellWord[]; pattern: RegExp }): boolean {
  return words.some(
    (word) =>
      word.text.startsWith("NODE_OPTIONS=") &&
      optionNamesModule({ args: word.text.slice("NODE_OPTIONS=".length).split(/\s+/u), pattern }),
  );
}

/**
 * Every word that could be the script. An option's value is unmodelled, so a non-option word straight after a
 * spaced option may be its value OR the script, and the scan goes on past it; the first word that cannot be a value
 * is certainly the script and ends it. Reading each option both ways at once, not every option one way at a time,
 * is what finds `tsx --tsconfig tsconfig.json --no-cache src/cli/index.ts`.
 *
 * @param args the words after `node` or `tsx`
 * @param host the host's own name, which decides its subcommands
 * @returns the indexes of every possible script word, none when the run evaluates code or names no script
 */
export function scriptHostStarts({ args, host }: { args: readonly string[]; host: string }): readonly number[] {
  const end = optionsEnd({ args });
  const starts: number[] = [];
  let subcommand = false;
  for (let at = 0; at < end; at += 1) {
    const word = args[at]!;
    if (word.startsWith("-")) {
      continue;
    }
    const mayBeValue = mayTakeValue({ option: args[at - 1] });
    if (!subcommand && !mayBeValue && HOST_COMMANDS[host]?.includes(word) === true) {
      subcommand = true;
      continue;
    }
    starts.push(at);
    if (!mayBeValue) {
      return starts;
    }
  }
  if (args[end] === "--" && end + 1 < args.length) {
    starts.push(end + 1);
  }
  return starts;
}

/** Where the host's own words end: at the evaluated program's flag, or at `--`, or at the end. */
function optionsEnd({ args }: { args: readonly string[] }): number {
  const end = args.findIndex((word) => word === "--" || EVAL_FLAGS.has(word.split("=")[0]!));
  return end === -1 ? args.length : end;
}

/** Whether a word is a spaced option that could take the next word as its value. */
function mayTakeValue({ option }: { option: string | undefined }): boolean {
  return option !== undefined && option.startsWith("-") && !option.includes("=");
}
