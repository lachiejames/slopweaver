/**
 * Where a package runner runs a bin from — `npx -y playwright`, `pnpm --filter web dlx @playwright/cli`, `yarn
 * playwright test` — read off one command's words for the browser-launch walk (`./browserLaunchArgv.ts`), which
 * judges whether the bin found there launches a browser. Every candidate is returned, not one guess: an option
 * neither table below knows may or may not take a value, and an extra candidate only ever costs a refusal.
 */
import { programName } from "./pythonWrappers.js";

/** Package runners that run their first operand as a package's bin: `npx playwright`, `bunx @playwright/cli`. */
const DIRECT_RUNNERS: ReadonlySet<string> = new Set(["bunx", "npx", "pnpx"]);

/** Package managers whose `dlx`/`exec`/`x` subcommand runs a package bin: `pnpm dlx`, `yarn exec`, `bun x`. */
const MANAGER_RUNNERS: ReadonlySet<string> = new Set(["bun", "npm", "pnpm", "yarn"]);

/**
 * The manager subcommands that run a package bin — `run` included: `yarn run`/`bun run` fall through to a bin, and
 * `yarn run playwright --cdp=…` attached unrefused.
 */
const MANAGER_RUN_SUBCOMMANDS: ReadonlySet<string> = new Set(["dlx", "exec", "run", "x"]);

/** Package-manager options that take the next word as their value. */
const MANAGER_VALUED_OPTIONS: ReadonlySet<string> = new Set([
  "--cwd",
  "--dir",
  "--filter",
  "--loglevel",
  "--prefix",
  "--reporter",
  "--workspace",
  "-C",
  "-F",
  "-w",
]);

/** Package-manager options known to take no value, so the word after one is never read as its value. */
const MANAGER_FLAG_OPTIONS: ReadonlySet<string> = new Set([
  "--frozen-lockfile",
  "--ignore-scripts",
  "--immutable",
  "--json",
  "--offline",
  "--prefer-offline",
  "--quiet",
  "--recursive",
  "--silent",
  "--verbose",
  "-q",
  "-r",
  "-s",
]);

/** Options a direct runner (`npx`, `bunx`) is known to read a value for. */
const RUNNER_VALUED_OPTIONS: ReadonlySet<string> = new Set(["-p", "--package"]);

/** Direct-runner options known to take no value. */
const RUNNER_FLAG_OPTIONS: ReadonlySet<string> = new Set([
  "--bun",
  "--ignore-existing",
  "--no",
  "--no-install",
  "--quiet",
  "--silent",
  "--yes",
  "-q",
  "-y",
]);

/** Which options one runner's table knows to take a value, and which to take none. */
interface OptionTable {
  readonly valued: ReadonlySet<string>;
  readonly flags: ReadonlySet<string>;
}

/** One place a runner may run a bin from, and that bin's package name. */
export interface RunnerTarget {
  readonly at: number;
  readonly name: string;
}

/**
 * A package spec as written (`@playwright/cli@0.1.2`, `playwright@latest`) reduced to the package name.
 *
 * @param text the spec
 * @returns the name without its version, lowercased
 */
export function packageName({ text }: { text: string }): string {
  const versionAt = text.indexOf("@", text.startsWith("@") ? 1 : 0);
  return (versionAt === -1 ? text : text.slice(0, versionAt)).toLowerCase();
}

/**
 * Every index a run of options from `start` may end at — the word a command runs. An option the table knows takes
 * its value or none; one it does not may do either (`npx -w web playwright open`), so the word
 * after it is a candidate AND the walk reads on past it as that option's value. An `--option=value` carries its own.
 *
 * @param words the command's words
 * @param start the index of the first word that may be an option
 * @param table the runner's known valued options and flags
 * @returns each candidate index, in order
 */
function wordsPastOptions({
  start,
  table,
  words,
}: {
  start: number;
  table: OptionTable;
  words: readonly string[];
}): readonly number[] {
  const candidates: number[] = [];
  let at = start;
  while (at < words.length) {
    const word = words[at]!;
    if (word === "--" || !word.startsWith("-")) {
      candidates.push(word === "--" ? at + 1 : at);
      break;
    }
    const unknown = !table.valued.has(word) && !table.flags.has(word) && !word.includes("=");
    if (unknown) {
      candidates.push(at + 1);
    }
    at += table.valued.has(word) || unknown ? 2 : 1;
  }
  return candidates.filter((candidate) => candidate < words.length);
}

/**
 * Each candidate bin past a run of runner options, with its package name.
 *
 * @param start the index of the first word that may be an option
 * @param table the runner's known valued options and flags
 * @returns each candidate target
 */
function targetsFrom({
  start,
  table,
  words,
}: {
  start: number;
  table: OptionTable;
  words: readonly string[];
}): readonly RunnerTarget[] {
  return wordsPastOptions({ start, table, words }).map((at) => ({ at, name: packageName({ text: words[at]! }) }));
}

/** The manager subcommands that take npx's `-c`/`--call` command string: `npm exec -c`, `pnpm dlx -c`. */
const CALL_SUBCOMMANDS: ReadonlySet<string> = new Set(["dlx", "exec", "x"]);

/**
 * The command string a runner's `-c`/`--call` hands a shell — `npx --package=playwright -c 'playwright open …'` runs it
 *. Only the runner's own options are read: the first word that is no option ends them, since it is
 * the bin, and `yarn dlx prettier -c chromium` hands prettier its own `-c`. An option neither table
 * knows may take the word after it as its value (`npx -w web -c '…'`), so that one word is read past too.
 *
 * @param words one command's words, the runner first
 * @returns the command string, or `undefined` when the command is no runner or carries none
 */
export function runnerCallPayload({ words }: { words: readonly string[] }): string | undefined {
  const start = runnerOptionsStart({ words });
  return start === undefined ? undefined : callInRunnerOptions({ start, words });
}

/**
 * Where a runner's own options begin: after `npx`/`bunx`/`pnpx`, or after a manager's `dlx`/`exec`/`x`.
 *
 * @param words one command's words, the runner first
 * @returns the index, or `undefined` when the command is no runner or a manager runs no call subcommand
 */
function runnerOptionsStart({ words }: { words: readonly string[] }): number | undefined {
  const runner = packageName({ text: programName({ text: words[0]! }) });
  if (DIRECT_RUNNERS.has(runner)) {
    return 1;
  }
  if (!MANAGER_RUNNERS.has(runner)) {
    return undefined;
  }
  const subcommand = words.findIndex((word, at) => at > 0 && CALL_SUBCOMMANDS.has(word));
  return subcommand === -1 ? undefined : subcommand + 1;
}

/**
 * The `-c`/`--call` value among a runner's own options, read up to the bin or `--`.
 *
 * @param start the index of the runner's first option
 * @param words one command's words
 * @returns the command string, or `undefined` when the options carry none
 */
function callInRunnerOptions({ start, words }: { start: number; words: readonly string[] }): string | undefined {
  let mayBeValue = false;
  for (let at = start; at < words.length && words[at] !== "--"; at += 1) {
    const word = words[at]!;
    const call = callValue({ next: words[at + 1], word });
    if (call.found) {
      return call.value;
    }
    const isOption = word.startsWith("-");
    if (!isOption && !mayBeValue) {
      return undefined;
    }
    const valued = RUNNER_VALUED_OPTIONS.has(word);
    at += valued ? 1 : 0;
    mayBeValue = isOption && !valued && !RUNNER_FLAG_OPTIONS.has(word) && !word.includes("=");
  }
  return undefined;
}

/**
 * Whether one option word is `-c`/`--call` (its value the next word) or `--call=…` (its own).
 *
 * @param word the option word
 * @param next the word after it, when there is one
 * @returns whether it names the call, and its value
 */
function callValue({ next, word }: { next: string | undefined; word: string }): {
  found: boolean;
  value: string | undefined;
} {
  if (word === "-c" || word === "--call") {
    return { found: true, value: next };
  }
  if (word.startsWith("--call=")) {
    return { found: true, value: word.slice("--call=".length) };
  }
  return { found: false, value: undefined };
}

/**
 * Every place the package or bin a runner runs may sit, and its name: `npx -y playwright` is `playwright` at 2.
 *
 * @param words the command's words, the runner first
 * @returns each candidate target, or none when the command is no runner or names nothing
 */
export function runnerTargets({ words }: { words: readonly string[] }): readonly RunnerTarget[] {
  // `corepack yarn@4.18.1 dlx …` names its manager with a version (the r3 review).
  const runner = packageName({ text: programName({ text: words[0]! }) });
  const runnerTable = { flags: RUNNER_FLAG_OPTIONS, valued: RUNNER_VALUED_OPTIONS };
  if (MANAGER_RUNNERS.has(runner)) {
    // The manager's own options may come first: `pnpm --silent dlx …`, `yarn --cwd web playwright …` (the r3 review).
    const managerTable = { flags: MANAGER_FLAG_OPTIONS, valued: MANAGER_VALUED_OPTIONS };
    const subs = wordsPastOptions({ start: 1, table: managerTable, words });
    // `yarn playwright test` runs a bin by name; `yarn install` is the manager's own and names no package.
    const byName = runner === "npm" ? [] : subs.filter((sub) => !MANAGER_RUN_SUBCOMMANDS.has(words[sub]!));
    const named = byName.map((at) => ({ at, name: packageName({ text: words[at]! }) }));
    const runs = subs.filter((sub) => MANAGER_RUN_SUBCOMMANDS.has(words[sub]!));
    return [...named, ...runs.flatMap((sub) => targetsFrom({ start: sub + 1, table: runnerTable, words }))];
  }
  if (!DIRECT_RUNNERS.has(runner)) {
    return [];
  }
  return targetsFrom({ start: 1, table: runnerTable, words });
}
