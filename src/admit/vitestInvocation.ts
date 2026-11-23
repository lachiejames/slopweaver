/**
 * How a `vitest` run reads its own tail, for `./wholeTreeCheck.ts`: which runs are a whole test LANE — CI's
 * `unit` shards, `subprocess` and `integration` jobs — and which are the files a seat touched. Pure: words in, a
 * description out.
 *
 * ## The criterion
 *
 * A run is a whole lane when **no filter narrows it**, or when a filter names a lane's whole root rather than
 * something under it. A filter is every word that is neither an option nor an option's value. Vitest reads a
 * filter as a SUBSTRING of a test file's path, so `src/__tests__/unit/admit` and `github/merge` are both
 * narrowed runs, and `-t <name>` alone is not: it still collects and transforms every file in the lane.
 *
 * MEASURED from a week of seat transcripts (the run's page carries the counts): a three-directory
 * `vitest` beside `yarn lint` in one background shell was what the DM-rule seat held at 10:1xZ while the load
 * average stood at 60.85. `testing.md` already said "run only the files you touched"; nothing enforced it.
 *
 * **Only inside a Slopweaver checkout** (`./runDirectory.ts`'s `ownsScriptNames`, the same test a script name
 * gets): the lanes named here are this repository's CI jobs. Another repository's package suite —
 * `npx vitest run --project unit` in an acme-admin package — is that repository's own practice, and this gate
 * does not decide it.
 *
 * ## What it cannot see
 *
 * Paths are judged by their text, never the filesystem, exactly as the rest of the gate reads them: a filter
 * that happens to match the whole lane by substring (`test`, `ts`) reads as narrowed. An option is read the way
 * vitest's own parser reads it (`./vitestOptions.ts`), so its value is never mistaken for a filter. An
 * `--exclude` narrows nothing here: an exclusion glob matching every file runs no test and is still refused, since
 * telling what a glob leaves would mean reading the tree. No seat wrote that shape in
 * the week the run's page counts, and the hatch covers it.
 *
 * A computed list — `$(git diff --name-only …)`, `$f` — is a filter, the lint-staged shape the owner asked to
 * keep local, though an EMPTY one runs the whole lane. Refusing it was measured, and
 * declined: 203 seat runs in the week would have been refused across 73 seats, and none of them ran a lane —
 * median 10.5s against 200s for a real one, every run past 90s explained by other work in the same call.
 * Reproduce with the run's replay of the crawl, filtered to runs whose only filter is one expansion.
 */

import { posix } from "node:path";

import { ownsScriptNames } from "./runDirectory.js";
import { optionName, optionValueWords, switchedOff } from "./vitestOptions.js";

/** The package scripts that run `vitest` over a whole lane unless a filter they are handed narrows it. */
const TEST_SCRIPTS: ReadonlySet<string> = new Set([
  "test:unit",
  "test:subprocess",
  "test:integration",
  "test:subprocess:coverage",
  "test:integration:coverage",
]);

/** The options whose value narrows the run to one directory, read as a filter. `-r` is `--root`'s short form. */
const SCOPE_OPTIONS: readonly string[] = ["--dir", "--root", "-r"];

/** The subcommands that run tests; the first filter-position word is dropped when it is one of them. */
const RUN_SUBCOMMANDS: ReadonlySet<string> = new Set(["run", "watch", "dev", "bench"]);

/** The subcommands that run no test at all, or run only what a change touched. */
const NOT_A_LANE_COMMANDS: ReadonlySet<string> = new Set(["list", "init", "related"]);

/**
 * The options that run no test at all, or run only what a change touched, by the camelCase name vitest's CLI
 * parser (cac) reads either spelling as. `standalone`, `clearCache` and `listTags` are every option whose own
 * description in vitest 4.1.11 says it runs no test (`grep -n "without running tests\|instead of running tests\|without running any tests"
 * node_modules/vitest/dist/chunks/cac.*.js`), since reviews found them one at a time.
 */
const NOT_A_LANE_OPTIONS: ReadonlySet<string> = new Set([
  "h",
  "help",
  "v",
  "version",
  "changed",
  "related",
  "mergeReports",
  "standalone",
  "clearCache",
  "listTags",
]);

/**
 * Whether an option makes the run one that executes no lane. A no-test option handed `false` is switched off,
 * and the run is the whole lane it would have been without it.
 *
 * @param word one option of the tail
 * @param next the word after it
 * @returns true for a no-test option that is on
 */
function runsNoLane({ word, next }: { word: string; next: string | undefined }): boolean {
  return NOT_A_LANE_OPTIONS.has(optionName({ word })) && !switchedOff({ next, word });
}

/**
 * The directories a lane's whole collection lives under, and their ancestors. A filter equal to one of these,
 * after `./` and a trailing `/` are dropped, is the lane rather than a part of it. `site/__tests__/unit` and
 * `desktop/__tests__/unit` are roots of the unit lane's `include` too, and are deliberately NOT here: each is
 * its own small project's suite (the site's 102 files against `src`'s 3,279, `git ls-files <root> | grep -c
 * "\.test\.tsx\?$"`), the run a seat editing that project should make.
 *
 * `.` is the lane wherever it is typed, never the directory it names: vitest reads a filter as a SUBSTRING of
 * each file's path, and every test path holds a `.`. MEASURED at the checkout root, `vitest list
 * --config config/vitest/unit.ts . --filesOnly` lists 3,368 files, the same as no filter, and from
 * `src/__tests__/unit/admit` the lane's `include` globs resolve against that directory and list none either
 * way — so `.` there narrows to nothing it would not already run (a review read it as the one directory).
 */
const LANE_ROOTS: ReadonlySet<string> = new Set([
  "",
  ".",
  "src",
  "src/__tests__",
  "src/__tests__/unit",
  "src/__tests__/subprocess",
  "src/__tests__/integration",
]);

/**
 * What a `vitest` tail is narrowed by. A FILTER is every word that is neither an option nor an option's value,
 * but the FIRST such word when it is a run subcommand, as vitest's parser reads one: `run --config c run`
 * filters `run`. A SCOPE is the value of `--dir` or `--root`, which narrows the scan to
 * one directory ALONGSIDE the filters, never beside them: `--root ./tmp-probe` is a probe, and `--root . <file>`
 * is that one file. Nothing after a `--` is either: vitest's parser hands those words
 * to `options["--"]`, so `vitest run -- <file>` runs the whole lane (`parseCLI(["vitest", "run", "--",
 * "a.test.ts"])` gives `filter: []`). The subcommand and the no-test options are read in the same pass, so an
 * option's VALUE is never one of them: `-t related` is a name, not `vitest related`.
 *
 * @param args the words after `vitest`
 * @returns the filters and the scopes, each in order, and whether the run executes no lane at all
 */
function vitestNarrowing({ args }: { args: readonly string[] }): {
  readonly filters: readonly string[];
  readonly noLane: boolean;
  readonly scopes: readonly string[];
} {
  const positionals: string[] = [];
  const options: number[] = [];
  const scopes: string[] = [];
  for (let at = 0; at < args.length; at += 1) {
    const word = args[at]!;
    if (word === "--") {
      break;
    }
    if (word.startsWith("-")) {
      options.push(at);
      const read = optionRead({ next: args[at + 1], word });
      scopes.push(...read.scopes);
      at += read.skip;
    } else {
      positionals.push(word);
    }
  }
  const command = positionals[0];
  const noLaneOption = options.some((at) => runsNoLane({ next: args[at + 1], word: args[at]! }));
  return {
    filters: command !== undefined && RUN_SUBCOMMANDS.has(command) ? positionals.slice(1) : positionals,
    noLane: noLaneOption || (command !== undefined && NOT_A_LANE_COMMANDS.has(command)),
    scopes,
  };
}

/**
 * One option word: the directory a scope option carries, and how many following words are its value.
 *
 * @param word the option as written
 * @param next the word after it, which a value option consumes
 * @returns the scopes it contributes and the words to skip
 */
function optionRead({ word, next }: { word: string; next: string | undefined }): {
  readonly scopes: readonly string[];
  readonly skip: number;
} {
  const attached = SCOPE_OPTIONS.find((option) => word.startsWith(`${option}=`));
  if (attached !== undefined) {
    return { scopes: [word.slice(attached.length + 1)], skip: 0 };
  }
  if (SCOPE_OPTIONS.includes(word)) {
    return { scopes: next === undefined ? [] : [next], skip: 1 };
  }
  return { scopes: [], skip: optionValueWords({ next, word }) };
}

/**
 * A checkout's root read off a path inside it: the `slopweaver` directory, or a seat's worktree under it —
 * the two layouts every one of the week's 21,667 seat Bash calls ran in. The LAST `slopweaver` component is the
 * checkout, since no directory inside the tree carries that name and an earlier one is only where it was cloned:
 * `/Users/slopweaver/projects/slopweaver` is rooted at the second.
 */
const CHECKOUT_ROOT = /^(.*\/slopweaver(?:\/\.claude\/worktrees(?:\.noindex)?\/[^/]+)?)(?:\/|$)/u;

/** The options naming vitest's config file. */
const CONFIG_OPTIONS: ReadonlySet<string> = new Set(["--config", "-c"]);

/** A lane config's absolute path; what sits above `config/vitest/` is the checkout it belongs to. */
const LANE_CONFIG = /^(.*)\/config\/vitest\/[^/]+$/u;

/**
 * The `--config` value a `vitest` tail carries, before any `--`.
 *
 * @param args the words after `vitest`
 * @returns the config path as written, or `undefined` when the run names none
 */
function configValue({ args }: { args: readonly string[] }): string | undefined {
  const end = args.indexOf("--");
  const words = end === -1 ? args : args.slice(0, end);
  const at = words.findIndex((word) => CONFIG_OPTIONS.has(word) || word.startsWith("--config="));
  const option = words[at];
  return option?.includes("=") === true ? option.slice(option.indexOf("=") + 1) : words[at + 1];
}

/** The lanes, each named by its config file and collected under `src/__tests__/<lane>/`. */
const LANES: readonly string[] = ["unit", "subprocess", "integration"];

/**
 * What EVERY test path of the lane a run's config names holds, so that a filter inside any one of them is the
 * whole lane: vitest reads a filter as a SUBSTRING. MEASURED at the checkout root, `vitest list
 * --config config/vitest/unit.ts <f> --filesOnly` lists all 3,368 files for `__tests__/unit`, `unit`, `test`,
 * `.test.ts` and `tests__/u`, against 1 for `process` and 81 for `admit`. An unnamed or unknown
 * config is read as any lane.
 *
 * @param config the `--config` value, when the run names one
 * @returns the substrings every path of the lane shares
 */
function sharedByEveryPath({ config }: { config: string | undefined }): readonly string[] {
  const named = config === undefined ? undefined : /(?:^|\/)config\/vitest\/([^/]+)\.ts$/u.exec(config)?.[1];
  const lanes = named !== undefined && LANES.includes(named) ? [named] : LANES;
  return [".test.ts", ...lanes.map((lane) => `src/__tests__/${lane}/`)];
}

/**
 * A relative filter inside what every path of the lane holds, so it selects the whole lane.
 *
 * @param filter the filter as written
 * @param shared the substrings from {@link sharedByEveryPath}
 * @returns true when the filter narrows nothing
 */
function coversEveryPath({ filter, shared }: { filter: string; shared: readonly string[] }): boolean {
  const text = posix.normalize(filter).replace(/\/+$/u, "");
  if (text === "" || text.startsWith("/") || text.startsWith("..")) {
    return false;
  }
  return shared.some((part) => part.includes(text));
}

/**
 * The checkout root a run resolves its scopes against. A `--config` naming a lane config shows it in ANY
 * layout, because vitest resolves that path against the run's directory: `--config config/vitest/unit.ts` from
 * `…/slopweaver/worktrees/seat` is that seat. Without one, {@link CHECKOUT_ROOT} reads
 * the run's directory.
 *
 * @param config the `--config` value, when the run names one
 * @param cwd the directory the run is in, when known
 * @returns the checkout root, or `undefined` when neither the config nor the directory shows one
 */
function checkoutRoot({ config, cwd }: { config: string | undefined; cwd: string | undefined }): string | undefined {
  if (cwd === undefined) {
    return undefined;
  }
  const shown = config === undefined ? undefined : LANE_CONFIG.exec(posix.resolve(cwd, config))?.[1];
  if (shown !== undefined) {
    return shown;
  }
  return CHECKOUT_ROOT.exec(cwd)?.[1];
}

/**
 * A `--root` or `--dir` value as the lane it scopes. A scope names a DIRECTORY, never a substring, so it is
 * resolved against the run's directory and compared with the checkout's root when the path shows one:
 * `--root .` from `src/__tests__/unit/admit` scopes the run to that directory, while from the root it is the
 * lane. A path showing no root, or a scope outside it, falls back to
 * {@link namesLaneRoot}'s reading of the text.
 *
 * @param scope the directory as written
 * @param cwd the directory the run is in, when known
 * @param root the checkout's root, from {@link checkoutRoot}
 * @returns true when the scope is a whole lane
 */
function scopesLane({
  scope,
  cwd,
  root,
}: {
  scope: string;
  cwd: string | undefined;
  root: string | undefined;
}): boolean {
  if (cwd === undefined || root === undefined) {
    return namesLaneRoot({ cwd, filter: scope, root });
  }
  const within = posix.relative(root, posix.resolve(cwd, scope));
  return within.startsWith("..") ? namesLaneRoot({ cwd, filter: scope, root }) : LANE_ROOTS.has(within);
}

/** An absolute path ending in the tests tree or one of its lanes. */
const TESTS_TAIL = /\/src\/__tests__(?:\/(?:unit|subprocess|integration))?$/u;

/**
 * A filter written as a lane's root: relative, or absolute. An absolute filter inside the checkout its run's
 * directory shows is compared with that checkout's root, so the run's own directory named absolutely from
 * `src/__tests__/unit/admit` stays that directory. A filter that
 * climbs out of its directory is read as though it climbed to the checkout's root, the conservative reading
 * `./runDirectory.ts` gives a `..` word: from `config/`, `--root ..` is the whole lane,
 * while `../src/__tests__/unit/admit` stays narrowed. The text says how far it climbed but never where the
 * root is, so the same filter from the root itself reads as a lane too; the hatch covers that. An absolute
 * ancestor of the run's directory climbs out just as `..` does, so it is the checkout root too. Any other absolute
 * filter outside the run's directory is read by its tail: one ending in `src/__tests__` or a lane under it is
 * that lane from wherever it is typed, since only a Slopweaver checkout reaches here.
 *
 * @param filter the filter as written
 * @param cwd the directory the run is in, when known
 * @param root the checkout's root, from {@link checkoutRoot}
 * @returns true when the filter names a whole lane
 */
function namesLaneRoot({
  filter,
  cwd,
  root,
}: {
  filter: string;
  cwd: string | undefined;
  root: string | undefined;
}): boolean {
  const within = root === undefined || !filter.startsWith("/") ? undefined : posix.relative(root, filter);
  if (within !== undefined && !within.startsWith("..")) {
    return LANE_ROOTS.has(within);
  }
  let path = filter;
  if (cwd !== undefined && path.startsWith(`${cwd}/`)) {
    path = path.slice(cwd.length + 1);
  } else if (cwd !== undefined && (path === cwd || cwd.startsWith(`${path.replace(/\/+$/u, "")}/`))) {
    path = "";
  }
  const climbedOut = posix
    .normalize(path)
    .replace(/^(?:\.\.(?:\/|$))+/u, "")
    .replace(/\/+$/u, "");
  return LANE_ROOTS.has(climbedOut) || (climbedOut.startsWith("/") && TESTS_TAIL.test(climbedOut));
}

/**
 * The `vitest` tail as a whole test lane, or `undefined` when a filter or a scope narrows it to what a seat
 * touched.
 *
 * @param args the words after `vitest` (for a `test:*` package script, the words the script is handed)
 * @param label how the refusal names the command
 * @param cwd the directory the run is in, when known
 * @returns how a refusal names the whole-lane run they are, or `undefined` when they are local work
 */
export function vitestLane({
  args,
  label,
  cwd,
}: {
  args: readonly string[];
  label: string;
  cwd: string | undefined;
}): string | undefined {
  const { filters, noLane, scopes } = vitestNarrowing({ args });
  const config = configValue({ args });
  const root = checkoutRoot({ config, cwd });
  if (noLane || scopes.some((scope) => !scopesLane({ cwd, root, scope }))) {
    return undefined;
  }
  const named = filters.length === 0 ? scopes : filters;
  if (named.length === 0) {
    return `${label} (a whole test lane, no file named)`;
  }
  const shared = sharedByEveryPath({ config });
  const lane = named.find(
    (filter) => namesLaneRoot({ cwd, filter, root }) || (filters.length > 0 && coversEveryPath({ filter, shared })),
  );
  return lane === undefined ? undefined : `${label} over ${lane} (a whole test lane)`;
}

/**
 * A `vitest` program run as a whole test lane — only in a Slopweaver checkout, and never when `xargs` hands it
 * the files at run time (the lint-staged shape, as for `oxlint`).
 *
 * @param args the words after `vitest`
 * @param cwd the directory the run is in, when known
 * @param fed whether an `xargs` in the same command list feeds it operands
 * @returns how a refusal names the whole-lane run, or `undefined` when it is local work
 */
export function vitestRunLane({
  args,
  cwd,
  fed,
}: {
  args: readonly string[];
  cwd: string | undefined;
  fed: boolean;
}): string | undefined {
  return fed || !ownsScriptNames({ cwd }) ? undefined : vitestLane({ args, cwd, label: "vitest" });
}

/**
 * A package script that runs a test lane (`yarn test:unit`), judged over the words it is handed — never when
 * `xargs` hands it the files at run time. The caller has already established that the
 * script name carries this repository's meaning where it runs. A LEADING `--` is the runner's separator, which
 * Yarn and npm drop before the script sees it, so `yarn test:unit -- <file>` is a targeted run.
 *
 * @param script the script's name
 * @param args the words the script is handed
 * @param cwd the directory the run is in, when known
 * @param fed whether an `xargs` in the same command list feeds it operands
 * @returns how a refusal names the whole-lane run, or `undefined` for any other script or a narrowed run
 */
export function testScriptLane({
  script,
  args,
  cwd,
  fed,
}: {
  script: string;
  args: readonly string[];
  cwd: string | undefined;
  fed: boolean;
}): string | undefined {
  if (!TEST_SCRIPTS.has(script) || fed) {
    return undefined;
  }
  // Every lane script is `vitest run --config …`, so what it is handed follows a subcommand already read.
  const handed = args[0] === "--" ? args.slice(1) : args;
  // Yarn runs a script from the package's directory, never the caller's: `cd config && yarn test:unit x` finds
  // `config/vitest/unit.ts`, so a scope resolves against the checkout root.
  const root = cwd === undefined ? undefined : CHECKOUT_ROOT.exec(cwd)?.[1];
  const label = `yarn ${script}`;
  const run = ["run", "--config", `config/vitest/${script.slice("test:".length)}.ts`, ...handed];
  if (root === undefined) {
    return vitestLane({ args: run, cwd, label });
  }
  return vitestLane({ args: run, cwd: root, label });
}
