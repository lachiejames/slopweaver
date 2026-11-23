/**
 * The three steps that make up ONE install of a checkout, and the reason they are one module rather than
 * three call sites: every one of them has been forgotten somewhere at least once, and each omission is
 * invisible until something downstream breaks.
 *
 * 1. `yarn install --immutable` — installs exactly what the lockfile says and FAILS if the lockfile would
 *    have to change, so an unattended install can never quietly resolve a new dependency graph. This is the
 *    deliberate divergence from `../worktree/shell.ts`'s same-named runner, which uses a plain `yarn install`
 *    because a WORKTREE is where a branch adds a dependency and refusing that would refuse the normal case.
 * 2. {@link ../checkouts/installMark.js}'s mark — yarn writes NOTHING when an install changes nothing, so
 *    without the mark the freshness gauge reports STALE immediately after the install it just asked for.
 * 3. {@link unshareExecInodes} — yarn has just re-linked every file in the tree to its own global content
 *    store, and `../worktree/execInodes.ts` carries the measurement showing that one in-place write to one of
 *    those inodes leaves a native binary PERMANENTLY unexecutable in every checkout on the machine at once.
 *
 * Step 2 lives in its own module because it is pure-ish and shared with worktree provisioning; steps 1 and 3
 * live here so that a second caller — `./refMoveInstallCli.ts`, the git hook — is a thin shell over the same
 * code `../cli/commands/checkout/syncRun.ts` runs, rather than a second implementation that can drift.
 */
import { type ExecFileSyncOptionsWithStringEncoding, execFileSync } from "node:child_process";

import { cachePaths } from "../cacheHome.js";
import { gitEnv } from "../lib/gitRepo.js";
import { isRecord } from "../lib/parsers.js";
import { tallyExecInodes } from "../worktree/execInodes.js";
import { privatiseExecInodes } from "../worktree/execInodesApply.js";

/**
 * Run one command to completion, returning its stdout and THROWING on a non-zero exit, a timeout or a launch
 * failure — the contract `execFileSync` keeps, and the seam a test replaces so no `yarn` process starts. One
 * object, because a declared function type takes one parameter. Its options REQUIRE a `timeout`: a synchronous
 * child blocks the event loop, so the bound passed here is the only thing that can end a hung install.
 */
export type ImmutableInstallCommand = (input: {
  file: string;
  args: readonly string[];
  options: ExecFileSyncOptionsWithStringEncoding & { readonly timeout: number };
}) => string;

/**
 * The production {@link ImmutableInstallCommand}: a synchronous child process, exactly as the install always ran,
 * with the required `timeout` restated so the sync-child-timeout gate, which reads syntax, sees the bound.
 */
const runYarnInstall: ImmutableInstallCommand = ({ file, args, options }) =>
  execFileSync(file, args, { ...options, timeout: options.timeout });

/** How long the install may run before it is killed. A first install on a cold cache is minutes, not seconds. */
const INSTALL_TIMEOUT_MS = 15 * 60_000;

/** The last lines a failed command wrote, which is where yarn puts the reason. */
const DETAIL_TAIL_LINES = 5;

/**
 * The most useful text a failed install left behind — its stderr when there is one, else the thrown message —
 * opened by a line naming the bound when the child was killed at {@link INSTALL_TIMEOUT_MS}, so a hung install
 * that wrote an ordinary-looking error first never reads like one that exited on it.
 */
function installFailureDetail({ error }: { error: unknown }): string {
  const detail = installErrorText({ error });
  if (isRecord(error) && error["code"] === "ETIMEDOUT") {
    return `yarn install was still running after ${String(INSTALL_TIMEOUT_MS / 60_000)} minutes, so it was stopped · ${detail}`;
  }
  return detail;
}

/** What a failed install wrote: the last lines of its stderr when there are any, else the thrown message. */
function installErrorText({ error }: { error: unknown }): string {
  const stderr = isRecord(error) ? error["stderr"] : undefined;
  if (typeof stderr === "string" && stderr.trim().length > 0) {
    return stderr.trim().split("\n").slice(-DETAIL_TAIL_LINES).join(" · ");
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run `yarn install --immutable` in one checkout, returning its own failure text rather than throwing.
 *
 * @param cwd the checkout to install in
 * @param runCommand what starts `yarn`; a child process unless a test supplies a fake
 * @returns undefined on success, or the failure detail
 */
export function runImmutableInstall({
  cwd,
  runCommand = runYarnInstall,
}: {
  cwd: string;
  runCommand?: ImmutableInstallCommand;
}): string | undefined {
  try {
    runCommand({
      args: ["install", "--immutable"],
      file: "yarn",
      options: {
        cwd,
        encoding: "utf8",
        env: gitEnv(),
        stdio: "pipe",
        timeout: INSTALL_TIMEOUT_MS,
      },
    });
    return undefined;
  } catch (error: unknown) {
    return installFailureDetail({ error });
  }
}

/**
 * Take the checkout's native binaries back off yarn's shared inodes, and say what that moved.
 *
 * Part of the install rather than a thing to remember: yarn has just re-linked every file in this tree to
 * its own content store, and `../worktree/execInodes.ts` carries the measurement showing that one in-place
 * write to one of those inodes leaves the binary PERMANENTLY unexecutable in every checkout on the machine
 * at once.
 *
 * @param root the checkout that was just installed
 * @param cacheRoot the cache root whose exec store the binaries move into; this process's own when omitted
 * @returns the one clause to print
 */
export function unshareExecInodes({ root, cacheRoot }: { root: string; cacheRoot?: string }): string {
  const { execStore } = cachePaths(cacheRoot === undefined ? {} : { root: cacheRoot });
  const report = privatiseExecInodes({ apply: true, execStore, root });
  const tally = tallyExecInodes({ report });
  const failed = tally.failed.count > 0 ? `, ${String(tally.failed.count)} FAILED` : "";
  return (
    `exec inodes: ${String(tally.relinked.count)} native binary(ies) relinked off yarn's shared store, ` +
    `${String(tally["already-private"].count)} already private${failed}`
  );
}
