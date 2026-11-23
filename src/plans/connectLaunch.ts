/**
 * Start a Connect's worker — `slopweaver plans connect-worker --id <id>` — in the background and return at once,
 * so the console's request answers in milliseconds while the sign-in waits on a person for minutes.
 *
 * ## Why a shell `&`, and why that is not a headless anything
 *
 * `no-headless` bans the async `node:child_process` API, so the launch is one `spawnSync` of `/bin/sh` that
 * backgrounds the verb and exits — `../worktree/pruneTriggerDetach.ts`'s shape, whose reasons are measured there.
 * The backgrounded process is a Slopweaver verb holding the provider's own sign-in open, never a model (rule 2 bans
 * a headless MODEL). Its death is noticed rather than prevented: the record carries a deadline, and a reader judges
 * an active record past it `INTERRUPTED` (`./connection.ts`).
 *
 * Every value reaches the shell as a positional argument, never as source text, and the command is an absolute
 * path checked executable here, where a refusal still reaches the caller.
 */
import { type SpawnSyncOptions, spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";

import { err, ok, type Result } from "#lib/result.js";

import { type PlanConnectionError, PlanConnectionErrors } from "./connectionErrors.js";

/** How long the launching shell may take to background the verb and exit. */
const LAUNCH_TIMEOUT_MS = 5_000;

/**
 * The one shell program: `$1` is the log, the rest the argv to background. Fixed text, the same shape as
 * `../worktree/pruneTriggerDetach.ts`'s.
 *
 * - The log is opened ONCE, by the FOREGROUND shell, onto descriptor 3 of a brace group whose only content is the
 *   backgrounded job, so the job inherits the open descriptor and never touches the log's path. A `>>"$log"` on
 *   the job would open the log by path in the forked child at some instant after this function had answered, so
 *   a caller removing the home then could have the child recreate the log under it: 18 of 300 launch-then-remove
 *   iterations failed ENOTEMPTY that way, each home left holding exactly a fresh `worker.log`. Reproduce by
 *   looping `launchConnectWorker` with a `#!/bin/sh\nexit 0` launcher then `rmSync(home, { recursive: true })`.
 * - A failed redirection on a compound command does not end a POSIX shell, so a log the shell cannot open falls
 *   through `||` to the same group on `/dev/null` and the worker still starts. `exec 3>>"$log"` is a special
 *   builtin whose failed redirection ENDS the shell before the job is backgrounded, and a probe ahead of it only
 *   narrows that to the log turning unwritable between the two opens. Reproduce with
 *   `/bin/sh -c 'exec 3>>/nonexistent/log; echo reached'`, which exits 1 and never prints `reached`.
 */
const BACKGROUND_SCRIPT = (() => {
  const job = '{ "$@" >&3 2>&3 </dev/null 3>&- & }';
  return `log=$1; shift; ${job} 3>>"$log" || ${job} 3>/dev/null`;
})();

/** Whether a path is a regular file this process may execute. */
function executableFile({ path }: { path: string }): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Background one Connect worker.
 *
 * @param launcher the absolute path of the `slopweaver` launcher to run
 * @param id the attempt the worker finishes
 * @param home the Slopweaver home, passed both as `--home` and as the worker's working directory
 * @param logPath where the worker's own output goes
 * @returns nothing once the launching shell has exited cleanly, or why it could not
 */
export function launchConnectWorker({
  home,
  id,
  launcher,
  logPath,
}: {
  home: string;
  id: string;
  launcher: string;
  logPath: string;
}): Result<void, PlanConnectionError> {
  if (!launcher.startsWith("/") || !executableFile({ path: launcher })) {
    return err(PlanConnectionErrors.launchFailed({ cause: `${launcher} is not an executable launcher` }));
  }
  const argv = [launcher, "plans", "connect-worker", "--id", id, "--home", home];
  // A new session, so a harness that kills the caller's process group cannot take the sign-in with it; see
  // `../worktree/pruneTriggerDetach.ts` for why the field is declared outside the literal.
  const options: SpawnSyncOptions & { detached: boolean } = {
    cwd: home,
    detached: true,
    env: { ...process.env, SLOPWEAVER_HOME: home },
    stdio: "ignore",
    timeout: LAUNCH_TIMEOUT_MS,
  };
  const result = spawnSync("/bin/sh", ["-c", BACKGROUND_SCRIPT, "slopweaver-plan-connect", logPath, ...argv], options);
  if (result.error !== undefined) {
    return err(PlanConnectionErrors.launchFailed({ cause: result.error.message }));
  }
  if (result.status !== 0) {
    return err(PlanConnectionErrors.launchFailed({ cause: `the launching shell exited ${String(result.status)}` }));
  }
  return ok(undefined);
}
