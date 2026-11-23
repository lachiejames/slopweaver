/**
 * Which code an unasked prune runs, and the environment it runs under. Split from `./pruneTriggerLaunch.ts`, which
 * claims the window and starts the child: this half only decides what that child executes.
 */
import { accessSync, constants, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { LAUNCHER_RELATIVE_PATH } from "#lib/pluginRoot.js";

import { guardBuiltTree } from "../builtCli/guard.js";
import { DEFAULT_OUT } from "../builtCli/layout.js";

/** Which code an unasked prune runs: the trunk's main checkout, or — only when that cannot run — this build. */
export interface PruneLauncherChoice {
  /** The launcher the detached shell executes. */
  readonly path: string;
  /** The tree whose code it runs, the launcher's own root, named to the child explicitly ({@link pruneLaunchEnv}). */
  readonly cliDir: string;
  readonly source: "bundled-fallback" | "main-checkout";
}

/**
 * Choose the code an unasked prune runs.
 *
 * **The FIRST declared main checkout, never the build of whichever session's tool call fired the trigger.** MEASURED
 * in `$SLOPWEAVER_HOME/worktree-bundles/auto-prune.log`: nine hourly firings removed nothing because the
 * firing seat's own build was stale — "slopweaver <any verb> blocked because the built CLI in this checkout no longer
 * describes the source beside it" (`grep -c "blocked because the built CLI" auto-prune.log`) — and the rest ran
 * whatever prune code that seat was 4 to 30 commits behind on. The main checkout is the one tree no session edits,
 * kept on the trunk by `checkout sync`. A later declared checkout is never searched: the first is the declared
 * authority. Either way the code dir is the launcher's own root, so the log's line names the code that runs.
 *
 * **A stale build there falls back, rather than refusing every hour.** `checkout sync` moves the main checkout's source
 * and rebuilds no CLI, so its build can stand stale indefinitely, and every firing would refuse before the verb ran
 * The first of the two with a FRESH build runs; when neither has one, the main checkout's
 * still does, so its refusal lands in the log as the visible reason rather than being swallowed.
 *
 * @param mainCheckouts the declared main checkouts, in profile order
 * @param fallbackRoot this build's own tree, whose launcher runs only when the first checkout's cannot run
 * @param executable whether a path is a regular file this process may execute
 * @param fresh whether a tree's built CLI still describes its source, so its launcher runs the verb at all
 * @returns the launcher, the code directory it is told to run, and which of the two it is
 */
export function choosePruneLauncher({
  mainCheckouts,
  fallbackRoot,
  executable,
  fresh,
}: {
  mainCheckouts: readonly { readonly path: string }[];
  fallbackRoot: string;
  executable: (input: { path: string }) => boolean;
  fresh: (input: { root: string }) => boolean;
}): PruneLauncherChoice {
  const bundled: PruneLauncherChoice = {
    cliDir: fallbackRoot,
    path: join(fallbackRoot, LAUNCHER_RELATIVE_PATH),
    source: "bundled-fallback",
  };
  const first = mainCheckouts[0];
  // A relative path would pass `executable` against this process's cwd and then be refused by `launchDetached`,
  // which runs only an absolute command — a logged launch that never starts.
  if (first === undefined || !isAbsolute(first.path)) {
    return bundled;
  }
  const main: PruneLauncherChoice = {
    cliDir: first.path,
    path: join(first.path, LAUNCHER_RELATIVE_PATH),
    source: "main-checkout",
  };
  if (!executable({ path: main.path })) {
    return bundled;
  }
  const bundledRuns = executable({ path: bundled.path }) && fresh({ root: bundled.cliDir });
  if (!fresh({ root: main.cliDir }) && bundledRuns) {
    return bundled;
  }
  return main;
}

/**
 * Whether a tree's built CLI still describes the source beside it — the same judgement its launcher's guard makes
 * before any verb runs (`../builtCli/guard.ts`). A tree with no build at all runs from source, so it counts as fresh;
 * a manifest that cannot be read or parsed does not, since nothing then says the build is current.
 *
 * @param root the checkout whose `dist-cli` is judged
 * @returns false when that build would refuse or cannot be judged
 */
export function freshBuild({ root }: { root: string }): boolean {
  try {
    return !guardBuiltTree({ builtRoot: join(root, DEFAULT_OUT), hatchOpen: false }).refuse;
  } catch {
    return false;
  }
}

/**
 * The environment the launched prune runs under: the caller's, its state home, and every variable `bin/slopweaver`
 * reads its code root from pinned to the chosen tree. The launcher prefers an inherited `PLUGIN_ROOT` or
 * `CLAUDE_PLUGIN_ROOT` over its own path (`hooks/lib/resolve-root.sh`) and `SLOPWEAVER_CLI_DIR` over both, so a
 * hook's or a stale seat's value left in place would outrank the launcher the log says ran. `CLAUDE_PLUGIN_ROOT` is dropped and the other two set, which leaves no inherited root to win.
 * `BASH_ENV` and `ENV` are dropped too: the launcher is a bash script, and bash sources either before the script's
 * first line, so an inherited startup file could export a root back in after this pins it.
 *
 * @param base the caller's environment, copied and never mutated
 * @param home the state home, passed as `SLOPWEAVER_HOME`
 * @param cliDir the tree whose code runs
 * @returns a fresh environment for the child
 */
export function pruneLaunchEnv({
  base,
  home,
  cliDir,
}: {
  base: NodeJS.ProcessEnv;
  home: string;
  cliDir: string;
}): NodeJS.ProcessEnv {
  const {
    BASH_ENV: _bashEnv,
    CLAUDE_PLUGIN_ROOT: _claudeRoot,
    ENV: _shellEnv,
    PLUGIN_ROOT: _root,
    SLOPWEAVER_CLI_DIR: _cliDir,
    ...rest
  } = base;
  return { ...rest, PLUGIN_ROOT: cliDir, SLOPWEAVER_CLI_DIR: cliDir, SLOPWEAVER_HOME: home };
}

/**
 * Whether `path` is a regular file this process may execute.
 *
 * @param path the launcher to check
 * @returns true only for an executable regular file; anything unreadable is false
 */
export function executableFile({ path }: { path: string }): boolean {
  try {
    if (!statSync(path).isFile()) {
      return false;
    }
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
