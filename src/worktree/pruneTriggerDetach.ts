/**
 * How the unasked prune is started without its caller waiting: one `/bin/sh` that backgrounds the verb and
 * exits at once, the log it writes to, and the failures a trigger can answer. The claim that decides WHETHER
 * to launch is `./pruneTriggerLaunch.ts`.
 *
 * ## Why a shell `&`, and why that is not a headless anything
 *
 * `no-headless` bans the async `node:child_process` API repo-wide, so the launch is a `spawnSync` of
 * `/bin/sh`, which backgrounds the verb and exits at once. The verb is a Slopweaver command, never a model
 * (rule 2 bans a headless MODEL), and it reparents to PID 1 the instant that shell exits — exactly what any
 * `&` from an agent tool call does already (measured in `../cli/commands/turn/tickerOwner.ts`). Its death is
 * noticed rather than prevented, which is the property this repository asks of such a process: the apply
 * holds `worktree-prune-apply` with a lease, a dead holder's lock is taken over at once, and every
 * interpolated value reaches the shell as a positional argument, never as source text.
 */
import { type SpawnSyncOptions, spawnSync } from "node:child_process";
import { accessSync, closeSync, constants, fstatSync, openSync, renameSync, statSync } from "node:fs";

import { descriptorNeedsSeparator } from "#lib/appendSeparator.js";
import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeAll } from "#lib/writeAtomic.js";

/** The log is renamed aside past this size, so a launch an hour cannot grow it without bound. */
const LOG_ROTATE_BYTES = 8 * 1024 * 1024;

/** How long the launching shell may take to background the verb and exit — milliseconds, or it is broken. */
const LAUNCH_TIMEOUT_MS = 5_000;

/**
 * The one shell program the launch runs: `$1` is the log, `$2` the window's marker, the rest the argv to
 * background. Fixed text, so nothing a caller passes is ever parsed as shell, and every command word in it is
 * an absolute path or a reserved word, so no function imported from the environment can stand in for one.
 *
 * - The log is opened ONCE, by the FOREGROUND shell, onto descriptor 3 of a brace group whose only content is
 *   the backgrounded job, so the job inherits the open descriptor and never touches the log's path. A
 *   `>>"$log"` inside the job would open it by path in the forked child at some instant after the launch had
 *   answered, so a caller removing the log's directory then could have the child recreate the log under that
 *   removal: 12 and 24 of 300 launch-then-remove iterations failed ENOTEMPTY that way, each directory left
 *   holding exactly `log`. Reproduce with that by-path redirect restored:
 *   `yarn vitest run --config config/vitest/subprocess.ts src/__tests__/subprocess/worktree/pruneTriggerDetach.test.ts -t "removable the instant"`.
 * - A failed redirection on a compound command does not end a POSIX shell, so a log the shell cannot open
 *   falls through `||` to the same group on `/dev/null`, and the verb still runs. Two shapes that look simpler
 *   are each wrong: `exec 3>>"$log"` is a special builtin, whose failed redirection ENDS the shell before the
 *   job is backgrounded (so does a probe ahead of it, once the log turns unwritable between the two opens),
 *   and `command exec` is shadowed on `/bin/sh` by an imported function — reproduce with
 *   `env 'BASH_FUNC_command%%=() { echo pwned; }' /bin/sh -c 'command /usr/bin/true'`, which prints `pwned`.
 * - The background job hands the window BACK when the verb never started. The foreground has answered by
 *   then, so the job is the only one that can see its own exec fail: 126 is a launcher it could not execute,
 *   127 one that was not there — renamed away after the check, say. It deletes the marker by path, on
 *   purpose, so the next caller claims the window again; a removal only ever unlinks, so it cannot recreate
 *   anything under a caller's removal. Any other exit is the verb's own, and its window stands.
 */
const BACKGROUND_SCRIPT = (() => {
  const job = '{ "$@" >&3 2>&3 </dev/null 3>&-; case $? in 126|127) /bin/rm -f -- "$marker" ;; esac; } &';
  return `log=$1; marker=$2; shift 2; { ${job} } 3>>"$log" || { ${job} } 3>/dev/null`;
})();

/** A trigger that could not launch. */
export type PruneTriggerError =
  | { readonly code: "COMMAND_NOT_ABSOLUTE"; readonly message: string }
  | { readonly code: "COMMAND_NOT_EXECUTABLE"; readonly message: string }
  | { readonly code: "MARKER_UNWRITABLE"; readonly message: string }
  | { readonly code: "LAUNCH_FAILED"; readonly message: string };

/** Factories for {@link PruneTriggerError}. */
export const PruneTriggerErrors = {
  commandNotAbsolute: ({ command }: { command: string }): PruneTriggerError => ({
    code: "COMMAND_NOT_ABSOLUTE",
    message: `the unasked worktree prune runs only an absolute path, never a name the shell resolves: "${command}"`,
  }),
  commandNotExecutable: ({ command }: { command: string }): PruneTriggerError => ({
    code: "COMMAND_NOT_EXECUTABLE",
    message: `the unasked worktree prune's launcher is not an executable file: "${command}"`,
  }),
  launchFailed: ({ detail }: { detail: string }): PruneTriggerError => ({
    code: "LAUNCH_FAILED",
    message: `the unasked worktree prune could not be started: ${detail}`,
  }),
  markerUnwritable: ({ dir, cause }: { dir: string; cause: unknown }): PruneTriggerError => ({
    code: "MARKER_UNWRITABLE",
    message: `the prune trigger could not claim a marker in ${dir}: ${errorMessage({ error: cause })}`,
  }),
} as const;

/**
 * Where the launched verb's output goes: the log, unless something other than a regular file stands at that
 * path. The backgrounded child's `>>` would fail there before the verb ever ran, and the launching shell —
 * already exited — could not say so, leaving a claimed window with no prune in it.
 *
 * @param logPath the log the output belongs in
 * @returns that path when it is a regular file or absent, else `/dev/null`
 */
export function launchLogPath({ logPath }: { logPath: string }): string {
  try {
    const stat = statSync(logPath, { throwIfNoEntry: false });
    return stat === undefined || stat.isFile() ? logPath : "/dev/null";
  } catch {
    return "/dev/null";
  }
}

/**
 * Append one heading line to the log, renaming a full log aside first. A log that cannot be written costs the
 * heading, never the launch.
 *
 * @param line the heading, without its newline
 * @param logPath where the heading is appended; anything there but a regular file is left unwritten
 */
export function noteLaunch({ line, logPath }: { line: string; logPath: string }): void {
  try {
    const size = statSync(logPath, { throwIfNoEntry: false })?.size;
    if (size !== undefined && size > LOG_ROTATE_BYTES) {
      renameSync(logPath, `${logPath}.1`);
    }
    // Opened non-blocking and written only when it is a regular file: a FIFO with no reader at this path
    // would otherwise hold the capacity read or the hook forever, past any catch. The tail is probed
    // on the file this descriptor holds: the verb's own output may end mid-line, and the heading must not fuse onto it.
    const fd = openSync(logPath, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NONBLOCK);
    try {
      if (fstatSync(fd).isFile()) {
        const lead = descriptorNeedsSeparator({ fd, path: logPath }) ? "\n" : "";
        writeAll({ handle: fd, text: `${lead}${line}\n` });
      }
    } finally {
      closeSync(fd);
    }
  } catch {
    // The launch is what matters; the ledgers the verb itself writes still record it.
  }
}

/**
 * Whether `path` is a regular file this process may execute.
 *
 * @param path the command
 * @returns false for anything absent, unreadable, not a regular file, or without execute permission
 */
function executableFile({ path }: { path: string }): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Start `argv` in the background, its output appended to `logPath`, and return as soon as the launching shell
 * has exited — never when the command has.
 *
 * @param argv the command and its arguments
 * @param cwd where it runs — the state home in production, never the caller's worktree, which a process that
 *   outlives the caller would otherwise hold open as its working directory
 * @param env the child's environment
 * @param logPath where its stdout and stderr go; its stdin is `/dev/null`
 * @param markerPath the window's marker, deleted by the background job when the command could not be executed
 * @returns nothing on a clean launch, or why the shell failed
 */
export function launchDetached({
  argv,
  cwd,
  env,
  logPath,
  markerPath,
}: {
  argv: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  logPath: string;
  markerPath: string;
}): Result<void, PruneTriggerError> {
  // `"$@"` keeps every argument whole, but its FIRST word is still looked up as a builtin (`eval` parses the
  // rest as source) or as a function bash imported from a `BASH_FUNC_<name>%%` variable. A name containing a
  // slash is neither: the shell executes that file. So the command must be a path, never a bare name.
  const command = argv[0];
  if (command === undefined) {
    return err(PruneTriggerErrors.commandNotAbsolute({ command: "<no command>" }));
  }
  if (!command.startsWith("/")) {
    return err(PruneTriggerErrors.commandNotAbsolute({ command }));
  }
  // The exec happens in the BACKGROUND job, after the shell has answered success, so a command that cannot be
  // executed would read as launched while nothing ran. Checked here, where a refusal still reaches the caller
  // and hands the window back.
  if (!executableFile({ path: command })) {
    return err(PruneTriggerErrors.commandNotExecutable({ command }));
  }
  const script = [BACKGROUND_SCRIPT, "slopweaver-auto-prune", logPath, markerPath, ...argv];
  // A new session for the launching shell, so the job it backgrounds is outside the caller's process group
  // and a harness that kills that group once the hook exits cannot take the prune with it.
  // `spawnSync` honours `detached` — Node hands it to libuv as `UV_PROCESS_DETACHED`, and
  // `subprocess/worktree/pruneTriggerDetach.test.ts` reads the child's own process group — but its options
  // type omits the field, so it is declared here rather than written into the literal the call checks.
  const options: SpawnSyncOptions & { detached: boolean } = {
    cwd,
    detached: true,
    env,
    stdio: "ignore",
    timeout: LAUNCH_TIMEOUT_MS,
  };
  const result = spawnSync("/bin/sh", ["-c", ...script], options);
  if (result.error !== undefined) {
    return err(PruneTriggerErrors.launchFailed({ detail: result.error.message }));
  }
  if (result.status !== 0) {
    return err(PruneTriggerErrors.launchFailed({ detail: `the launching shell exited ${String(result.status)}` }));
  }
  return ok(undefined);
}
