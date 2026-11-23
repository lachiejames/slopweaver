/**
 * How a package-manager front end reads its own words, for `./wholeTreeCheck.ts`: `yarn <script>`, `yarn run
 * <script>`, `yarn --cwd <dir> <script>`, `npx <bin>`, `corepack yarn …`. This module says which script runs,
 * in which directory, and which words the script receives; what the script MEANS stays in the classifier.
 *
 * `npm` is read by its own rules: its options count on EITHER side of the script, so
 * `npm run typecheck --prefix /repo` runs at `/repo`, and a script receives only the words after `--`, so
 * `npm run lint --only jsdoc-tags` is the whole lap with an npm config flag beside it.
 */
import type { ShellWord } from "./shellLexing.js";
import { changedDirectory } from "./shellWalk.js";

/** Package-manager front ends whose next word is a program or a script to resolve again. */
export const RUNNERS: ReadonlySet<string> = new Set(["yarn", "npx", "pnpm", "npm", "corepack"]);

/** Front-end words that stand between the runner and the script or program it runs, npm's `run` aliases included. */
const RUNNER_VERBS: ReadonlySet<string> = new Set([
  "run",
  "run-script",
  "rum",
  "urn",
  "exec",
  "x",
  "dlx",
  "workspaces",
  "foreach",
]);

/**
 * Front-end options that name the directory the script runs in, each consuming the next word: yarn's `--cwd`,
 * npm's `--prefix`, pnpm's `-C`/`--dir`. A review found `npm --prefix . run typecheck` read `.` as the
 * script.
 */
const RUNNER_DIRECTORY_FLAGS: ReadonlySet<string> = new Set(["--cwd", "--prefix", "-C", "--dir"]);

/**
 * Front-end words that consume the next word without moving the directory: options, and yarn's `workspace <name>`
 * subcommand (`yarn workspace slopweaver typecheck` once read `workspace` as the script). A named
 * workspace never moves the directory, so its typecheck is judged where the front end runs, the conservative side.
 */
const RUNNER_VALUE_FLAGS: ReadonlySet<string> = new Set(
  ["--workspace", "-w", "--filter", "-F", "--package", "-p", "--userconfig", "workspace"].concat([
    "--include",
    "--exclude",
    "--from",
    "-j",
    "--jobs",
  ]),
);

/** yarn's `workspaces foreach` modes that print what would run and run nothing (`yarn workspaces foreach --help`). */
const RUNNER_DRY_RUN: ReadonlySet<string> = new Set(["-n", "--dry-run"]);

/** A front end's own options that print and run nothing: `npx --version tsc` prints npm's version. */
const RUNNER_PRINTS: ReadonlySet<string> = new Set(["-v", "--version", "-h", "--help"]);

/** npm's and npx's options whose value is a whole command line: `npm exec -c '<line>'`, `npx --call=<line>`. */
const RUNNER_CALL_FLAGS: ReadonlySet<string> = new Set(["-c", "--call"]);

/**
 * The command line an `npm exec -c` / `npx -c` runs, which is a payload to walk like `bash -c` (`npm exec -c 'tsc -p .'`). Only npm and npx: pnpm's `-c` is a flag, and its `-C` a directory.
 *
 * @param args the words after the front end
 * @param program which front end
 * @returns the call's command line, or `undefined` when there is none
 */
export function runnerCall({ args, program }: { args: readonly ShellWord[]; program: string }): string | undefined {
  if (program !== "npm" && program !== "npx") {
    return undefined;
  }
  for (const [at, word] of args.entries()) {
    if (RUNNER_CALL_FLAGS.has(word.text)) {
      return args[at + 1]?.text;
    }
    if (word.text.startsWith("--call=")) {
      return word.text.slice("--call=".length);
    }
  }
  return undefined;
}

/** The script or program a front end runs, where, and what it is handed. */
export interface RunnerScript {
  /** The script or program word first, then every word after it. */
  readonly words: readonly ShellWord[];
  /** The words the script itself receives, which for npm are only those after `--`. */
  readonly scriptArgs: readonly ShellWord[];
  readonly cwd: string | undefined;
}

/**
 * Every script or program a front end could be running, one per reading of its options. An option this module
 * does not know may or may not take a value — npm alone has hundreds, `--loglevel silent` among them — so each one is read BOTH ways, valueless and consuming the next word, independently of the others
 * (`npm exec --loglevel silent --yes tsc`), and the classifier refuses when any reading is a whole-tree run. A list that one reading ends in costs a false refusal, never a bypass. A yarn
 * `workspaces foreach` dry run names nothing, since it runs nothing.
 *
 * @param args the words after the front end
 * @param program which front end, since npm hands a script its words differently
 * @param cwd the directory before it, when known
 * @returns the distinct readings, none when the front end names nothing
 */
export function runnerScripts({
  args,
  cwd,
  program,
}: {
  args: readonly ShellWord[];
  cwd: string | undefined;
  program: string;
}): readonly RunnerScript[] {
  const readings: RunnerScript[] = [];
  for (const front of runnerFronts({ args, cwd })) {
    const own = args.slice(0, front.index).map((word) => word.text);
    const dryRun = own.includes("foreach") && own.some((text) => RUNNER_DRY_RUN.has(text));
    const prints = own.some((text) => RUNNER_PRINTS.has(text));
    const reading = runnerScript({ args, front, program });
    if (!dryRun && !prints && reading !== undefined) {
      readings.push(reading);
    }
  }
  return readings;
}

/**
 * Resolve the script or program behind a front end, in the directory it runs in, for one reading of its options.
 *
 * @param args the words after the front end
 * @param front where that reading left the directory, and where it says the script starts
 * @param program which front end, since npm hands a script its words differently
 * @returns what runs, or `undefined` when the front end names nothing
 */
function runnerScript({
  args,
  front,
  program,
}: {
  args: readonly ShellWord[];
  front: { cwd: string | undefined; index: number };
  program: string;
}): RunnerScript | undefined {
  const words = args.slice(front.index);
  if (words.length === 0) {
    return undefined;
  }
  const tail = words.slice(1);
  if (program !== "npm") {
    return { cwd: front.cwd, scriptArgs: tail, words };
  }
  const end = tail.findIndex((word) => word.text === "--");
  const options = end === -1 ? tail : tail.slice(0, end);
  const scriptArgs = end === -1 ? [] : tail.slice(end + 1);
  return { cwd: runnerFront({ args: options, cwd: front.cwd, scan: true }).cwd, scriptArgs, words };
}

/**
 * Every place a front end's own words could end. A non-option word straight after a spaced option may be that
 * option's value or the script, so it is a candidate and the read goes on past it; the first candidate no option
 * could have taken ends the read.
 *
 * @param args the words after the front end
 * @param cwd the directory before them, when known
 * @returns each candidate's directory and index, the last one past every word when the read runs out
 */
function runnerFronts({ args, cwd: from }: { args: readonly ShellWord[]; cwd: string | undefined }): readonly {
  cwd: string | undefined;
  index: number;
}[] {
  const fronts: { cwd: string | undefined; index: number }[] = [];
  let cwd = from;
  let index = 0;
  while (index < args.length) {
    const step = frontStep({ args, cwd, index, scan: false });
    if (step !== undefined) {
      ({ cwd, index } = step);
      continue;
    }
    fronts.push({ cwd, index });
    const option = args[index - 1]?.text;
    if (option === undefined || !option.startsWith("-") || option === "--" || option.includes("=")) {
      return fronts;
    }
    index += 1;
  }
  fronts.push({ cwd, index });
  return fronts;
}

/**
 * Read a front end's own options: where they move the directory, and where the script or program starts.
 *
 * @param args the words to read
 * @param cwd the directory before them, when known
 * @param scan read every word as a possible option rather than stopping at the first operand (npm's tail)
 * @returns the directory they leave, and the index of the first word that is not theirs
 */
function runnerFront({
  args,
  cwd: from,
  scan = false,
}: {
  args: readonly ShellWord[];
  cwd: string | undefined;
  scan?: boolean;
}): { cwd: string | undefined; index: number } {
  let cwd = from;
  let index = 0;
  while (index < args.length) {
    const step = frontStep({ args, cwd, index, scan });
    if (step === undefined) {
      break;
    }
    ({ cwd, index } = step);
  }
  return { cwd, index };
}

/**
 * Read one front-end option at `index`.
 *
 * @param args the words being read
 * @param cwd the directory so far, when known
 * @param index the word to read
 * @param scan whether an operand is skipped rather than ending the options
 * @returns the directory and index after it, or `undefined` when the word is the script
 */
function frontStep({
  args,
  cwd,
  index,
  scan,
}: {
  args: readonly ShellWord[];
  cwd: string | undefined;
  index: number;
  scan: boolean;
}): { cwd: string | undefined; index: number } | undefined {
  const word = args[index]!;
  const equals = word.text.indexOf("=");
  const name = equals === -1 ? word.text : word.text.slice(0, equals);
  if (RUNNER_DIRECTORY_FLAGS.has(name)) {
    const to = equals === -1 ? args[index + 1] : { ...word, text: word.text.slice(equals + 1) };
    return { cwd: changedDirectory({ from: cwd, to }), index: index + (equals === -1 ? 2 : 1) };
  }
  if (RUNNER_VALUE_FLAGS.has(name) && equals === -1) {
    return { cwd, index: index + 2 };
  }
  if (scan || word.text.startsWith("-") || RUNNER_VERBS.has(word.text)) {
    return { cwd, index: index + 1 };
  }
  return undefined;
}
