/**
 * The real subprocess and environment edges worktree provisioning has: `yarn install`, `yarn build`,
 * resolving where the shared dependency tree lives, and resolving which repository a caller is standing in.
 *
 * Split out of `provision.ts` so the decision tree there imports seams rather than `node:child_process`, and
 * kept synchronous because `no-headless` bans the async `node:child_process` API repo-wide (AGENTS.md rule 2,
 * no allowlist) — the same constraint `cmux/worktree.ts` documents at length.
 */
import { type ExecFileSyncOptions, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, readFileSync, rmSync, statSync } from "node:fs";
import { constants, homedir } from "node:os";
import { dirname, join } from "node:path";

import { BUILT_ENTRYPOINT, DEFAULT_OUT } from "../builtCli/layout.js";
import { BUILD_MANIFEST_FILE } from "../builtCli/staleness.js";
import { gitEnv } from "../lib/gitRepo.js";
import { isRecord } from "../lib/parsers.js";
import { safeJsonParse } from "../lib/safeJson.js";

/**
 * How long an install may run before it is killed.
 *
 * Sized from the slowest measured run rather than the fastest, per `cmux/worktree.ts`'s own rule: on this
 * machine a warm-store install took 1m31s and the very first `nmMode: hardlinks-global` install
 * — the one that populates the store — took 6m34s (`time yarn install` in a fresh worktree). A colleague's
 * genuinely cold cache downloads ~2 GB on top of that.
 */
const INSTALL_TIMEOUT_MS = 20 * 60_000;

/** How long a git read may block. Reads here are one ref lookup — quick, or broken. */
const GIT_READ_TIMEOUT_MS = 20_000;

/** More stdout+stderr than yarn's own progress output produces, so an install never dies of ENOBUFS. */
const YARN_MAX_BUFFER = 32 * 1024 * 1024;

/** The last lines a failed command wrote, which is where yarn puts the reason. */
const DETAIL_TAIL_LINES = 5;

/** One captured stream as text, whichever of the two shapes `execFileSync` left on the thrown error. */
function streamText({ stream }: { stream: unknown }): string {
  if (typeof stream === "string") {
    return stream;
  }
  if (Buffer.isBuffer(stream)) {
    return stream.toString("utf8");
  }
  return "";
}

/** The tail of the first captured stream that said anything, or the thrown message when none did. */
function detailFromStreams({ error, streams }: { error: unknown; streams: readonly unknown[] }): string {
  for (const stream of streams) {
    const text = streamText({ stream });
    if (text.trim().length > 0) {
      return text.trim().split("\n").slice(-DETAIL_TAIL_LINES).join(" · ");
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * A fresh `$0` for one supervisor run, which bash prefixes to a diagnostic of its own (`supervise-1a2b…: line 6: …`).
 * Random per run so a job cannot write that prefix by accident: a fixed name let a job's own `supervise: line 12: `
 * be erased as if bash had written it. Residue, stated: the name is in the supervisor's argv, so a job that reads
 * its parent's command line on purpose could still forge one.
 */
function supervisorName(): string {
  return `supervise-${randomBytes(8).toString("hex")}`;
}

/**
 * What the job wrote to stderr, with bash's `<name>: line N:` prefix taken off any line this run's supervisor wrote
 * itself, so a missing program reads `yarn: No such file or directory` rather than naming a line of the script.
 */
function jobStderr({ error, name }: { error: unknown; name: string }): string {
  const stderr = isRecord(error) ? streamText({ stream: error["stderr"] }) : "";
  return stderr.replace(new RegExp(`^${name}: line \\d+: `, "gm"), "");
}

/**
 * The signal a status past 128 conventionally stands for. The supervisor's `wait` reports a job killed by signal n as
 * 128 + n, so Node sees an ordinary exit and no `signal`; bash cannot tell that from a job that chose to exit 137
 * itself, so the note says what the status is consistent with rather than asserting a kill.
 */
function signalNote({ status }: { status: number }): string {
  const name = Object.entries(constants.signals).find(([, number]) => number === status - 128)?.[0];
  return name === undefined ? "" : `, as a job killed by ${name} does,`;
}

/**
 * The most useful text a failed supervised run left behind: the job's stderr when it wrote any, else the job's own
 * command and how it ended. Never the thrown message when the job ran — that is `Command failed: /bin/bash -c` and
 * the whole supervisor script, which says nothing about the job.
 */
function failureDetail({ command, error, name }: { command: string; error: unknown; name: string }): string {
  const stderr = jobStderr({ error, name });
  if (stderr.trim().length > 0) {
    return detailFromStreams({ error, streams: [stderr] });
  }
  if (isRecord(error) && typeof error["status"] === "number") {
    return `\`${command}\` exited ${error["status"]}${signalNote({ status: error["status"] })} with no text on stderr`;
  }
  if (isRecord(error) && typeof error["signal"] === "string") {
    return `\`${command}\` was stopped by ${error["signal"]} with no text on stderr`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** A run past its bound: that it was killed, then whatever the job had written to stderr before the bound fell. */
function timeoutDetail({
  command,
  error,
  name,
  timeoutMs,
}: {
  command: string;
  error: Record<string, unknown>;
  name: string;
  timeoutMs: number;
}): string {
  const bound = `\`${command}\` ran past ${timeoutMs}ms and was killed, with everything it started`;
  const stderr = jobStderr({ error, name });
  if (stderr.trim().length === 0) {
    return `${bound}, with no text on stderr`;
  }
  return `${bound}: ${detailFromStreams({ error, streams: [stderr] })}`;
}

/**
 * The shell {@link SUPERVISOR_SCRIPT} runs in. Bash by path, not `/bin/sh`: that is dash on a Linux runner and bash on
 * macOS, and job control is exactly where two shells differ, so the one measured is the one that runs.
 */
export const SUPERVISOR_SHELL = "/bin/bash";

/**
 * The shell program every yarn run goes through, so nothing the run started outlives the call that started it.
 *
 * `set -m` runs the command as a job in a process group of its own; the shell itself stays in the caller's group, so
 * a terminal Ctrl-C still reaches it. `set +m` straight after keeps that group but stops the shell printing a
 * job-done notice into stderr, which is where a failed run's reason is read from. `wait`'s own stderr goes to
 * `/dev/null` for the same reason: bash reports a job killed by a signal (a `<pid> Killed: 9` line) from inside
 * `wait`, and the job's stderr is its own inherited descriptor, untouched by that redirect.
 *
 * The fork itself runs with the shell's stderr on `/dev/null` and the caller's stderr parked on fd 3, and the job's
 * own `2>&3 3>&-` hands it back. Under `set -m` both the shell and the forked child call `setpgid`, and when the
 * child's call loses that race bash's child writes `<name>: child setpgid (N to N): Operation not permitted` to its
 * fd 2 BEFORE it applies the job's redirections, which was the job's stderr, so it became the reported failure
 * detail. The redirections run after that point, so the job, and bash's own `No such file or directory` for a
 * missing program, still write to the caller, and fd 3 is closed before the job execs. A caller whose own fd 2 is
 * CLOSED has nothing to park, and `3>&2` failing there would leave the job's `2>&3` failing too, so the job would
 * never run; the fallback parks `/dev/null` instead and the job runs with its stderr discarded. Measured under load average
 * ~25: 6 of 5,450 launches printed it, and every one whose group was recorded still had the job leading its own
 * group, the shell's own `setpgid` having placed it; 0 of 3,450 put the job anywhere else. Repro: run
 * {@link supervisorArgv} 3,000 times, eight at once, with the job `/bin/sh -c 'echo "$$ $(ps -o pgid= -p $$)"'`, and
 * count `setpgid` on stderr and pid ≠ pgid on stdout. Residue, stated: were BOTH calls ever to fail, the job would sit
 * outside the group the reap signals, and nothing would now say so; that was never observed.
 *
 * When the shell is sent TERM, INT or HUP, it sends TERM to the job's whole group, gives it the grace (the script's
 * first argument, in whole seconds) to empty, then SIGKILLs whatever is left. When the job exits by itself, it
 * SIGKILLs the group's stragglers at once. That is what makes a bound a bound: the native TypeScript 7 compiler
 * ignores SIGTERM and SIGINT, and SIGKILLing Yarn alone leaves that compiler running and
 * writing into the worktree after the call has already reported failure. The TERM and the grace come first because
 * a job may itself OWN a process group — `scripts/tsc-owner.sh` runs the compiler in a group of its own, out of
 * reach of a signal to this one — and it can only reap that group if it is asked to stop before it is killed.
 * {@link SUPERVISOR_GRACE_SECONDS} is longer than the grace that owner gives its compiler for exactly that reason.
 * Reaping on a NORMAL exit too means a failed run cannot leave a straggler writing behind its own failure either. A
 * SIGKILL is delivered asynchronously, so `reap` then collects the job itself and waits until no process of the
 * group is left before the shell exits; without that, the call could return while a member still existed. The wait
 * is bounded at 500 checks 10ms apart, since a process stuck in an uninterruptible kernel wait holds out even against
 * SIGKILL. "Left" means exited, not reaped: a straggler whose parent has already gone belongs to launchd, which reaps
 * it on its own schedule, and on Darwin `kill -0 -- -<pgid>` answers ESRCH for a group of only zombies while
 * `kill -0 <pid>` still reaches each one, so the call can return while a member's pid still answers signal zero
 * without that member running. `supervisedRun.test.ts`'s zombie case witnesses the per-pid half:
 * `yarn vitest run --config config/vitest/subprocess.ts src/__tests__/subprocess/worktree/supervisedRun.test.ts -t zombie`.
 *
 * The traps are installed BEFORE the job starts and reap by `$!`, which bash sets at the fork itself: a signal that
 * lands between the fork and any later line still finds the job's group, where a trap set after the launch would
 * leave a window in which the shell dies by default action and the job, in a group nothing signals, runs on. Each
 * signal exits with its own conventional status (TERM 143, INT 130, HUP 129).
 *
 * Residue, stated: a signal that lands before bash reaches its first trap kills the shell by that signal, not with
 * the status above. That window cannot be closed from inside a script, and nothing leaks through it, because the
 * job has not been forked yet. A caller SIGKILLed outright leaves the shell waiting on its job, which then runs to its
 * own end; that is true of a plain `execFileSync` too. The job is trusted not to signal the supervisor itself: one
 * that SIGKILLs its own `$PPID` ends the shell before `reap` can run, and its group runs on, exactly as
 * `scripts/tsc-owner.sh` trusts its command. A member that gains privilege the caller lacks (a setuid helper) cannot
 * be signalled at this privilege at all, and `kill -0` reads its EPERM as an empty group, so it outlives the reap
 * unreported. The caller's environment is trusted: a non-interactive bash sources `BASH_ENV` before this script
 * runs, so a file named there can end the supervisor before the job starts, as a hostile PATH could fake a tool.
 * A process the job moves into a session or group of its own
 * (`setsid`, a detached spawn) leaves the group this reaps, and whether a dependency's install script starts one is
 * not measured. Measured by the witnesses in `src/__tests__/subprocess/worktree/supervisedRun.test.ts`.
 */
export const SUPERVISOR_SCRIPT = [
  "grace=$1",
  "shift",
  "reap() {",
  '  if [ -z "$!" ]; then return; fi',
  '  if [ "$1" = term ]; then',
  '    kill -TERM -- "-$!" 2>/dev/null',
  '    kill -CONT -- "-$!" 2>/dev/null',
  "    tries=0",
  '    while kill -0 -- "-$!" 2>/dev/null && [ "$tries" -lt $((grace * 100)) ]; do sleep 0.01; tries=$((tries + 1)); done',
  "  fi",
  '  kill -KILL -- "-$!" 2>/dev/null',
  '  wait "$!" 2>/dev/null',
  "  tries=0",
  '  while kill -0 -- "-$!" 2>/dev/null && [ "$tries" -lt 500 ]; do sleep 0.01; tries=$((tries + 1)); done',
  "}",
  "trap 'reap term; exit 143' TERM",
  "trap 'reap term; exit 130' INT",
  "trap 'reap term; exit 129' HUP",
  "exec 3>&2 2>/dev/null || exec 3>/dev/null 2>/dev/null",
  "set -m",
  '"$@" 2>&3 3>&- &',
  "exec 2>&3 3>&-",
  "set +m",
  'wait "$!" 2>/dev/null',
  "status=$?",
  "reap kill",
  'exit "$status"',
].join("\n");

/**
 * How long, in whole seconds, a signalled supervisor lets its job's group empty after TERM before it SIGKILLs it.
 *
 * Longer than the worst case of `scripts/tsc-owner.sh` after TERM: its grace, which it refuses past five seconds, plus
 * a five-second wait for SIGKILL to land. So a bound that falls on a `yarn build` lets the owner finish reaping its
 * compiler's group before the owner itself is killed. The owner's cap names this constant; change both together.
 */
export const SUPERVISOR_GRACE_SECONDS = 15;

/**
 * The argument list that runs one program under {@link SUPERVISOR_SCRIPT} through {@link SUPERVISOR_SHELL}.
 *
 * The one place the script's positional contract is spelled — `$0` the run's name, `$1` the grace, then the job —
 * so every caller that supervises a job (the worktree's yarn runs, a handover `command:` probe) hands it the same
 * shape.
 *
 * @param args the program's own arguments
 * @param graceSeconds how long a signalled supervisor waits after TERM before it SIGKILLs the job's group
 * @param name the run's `$0`, which bash prefixes to a diagnostic of its own
 * @param program the executable to run as the supervised job
 * @returns the argv to hand {@link SUPERVISOR_SHELL}
 */
export function supervisorArgv({
  args,
  graceSeconds,
  name,
  program,
}: {
  args: readonly string[];
  graceSeconds: number;
  name: string;
  program: string;
}): readonly string[] {
  return ["-c", SUPERVISOR_SCRIPT, name, String(graceSeconds), program, ...args];
}

/**
 * Run one program under {@link SUPERVISOR_SCRIPT}, so a timeout, a signal or its own exit reaps everything it
 * started.
 *
 * @param cwd the directory the program runs in
 * @param graceSeconds how long the job's group gets after TERM before SIGKILL once the bound falls; a witness
 *   shortens it, every production caller leaves {@link SUPERVISOR_GRACE_SECONDS}
 * @param program the executable to run as the supervised job
 * @param args its arguments
 * @param timeoutMs the bound, past which the supervisor is sent SIGTERM and reaps the job's process group
 * @returns the failure detail, or `undefined` when the program exited 0
 */
export function runSupervised({
  args,
  cwd,
  graceSeconds = SUPERVISOR_GRACE_SECONDS,
  program,
  timeoutMs,
}: {
  args: readonly string[];
  cwd: string;
  graceSeconds?: number;
  program: string;
  timeoutMs: number;
}): string | undefined {
  const options: ExecFileSyncOptions = {
    cwd,
    encoding: "utf8",
    env: gitEnv(),
    maxBuffer: YARN_MAX_BUFFER,
    stdio: "pipe",
    timeout: timeoutMs,
  };
  const name = supervisorName();
  try {
    execFileSync(SUPERVISOR_SHELL, supervisorArgv({ args, graceSeconds, name, program }), options);
    return undefined;
  } catch (error: unknown) {
    const command = [program, ...args].join(" ");
    if (isRecord(error) && error["code"] === "ETIMEDOUT") {
      return timeoutDetail({ command, error, name, timeoutMs });
    }
    return failureDetail({ command, error, name });
  }
}

/** Run one yarn script in a directory, returning the failure detail or `undefined` when it succeeded. */
function runYarn({ cwd, kind }: { cwd: string; kind: "install" | "build" }): string | undefined {
  return runSupervised({ args: [kind], cwd, program: "yarn", timeoutMs: INSTALL_TIMEOUT_MS });
}

/**
 * Install one worktree's own dependencies from its own lockfile.
 *
 * Deliberately NOT `--immutable`, which is the one place this differs from `checkout sync`. A main checkout
 * must never quietly resolve a new dependency graph, so its install fails when the lockfile would move. A
 * worktree is where a branch ADDS a dependency, and refusing that is refusing the normal case.
 *
 * @param cwd the worktree to install in
 * @returns the failure detail, or `undefined` when the install succeeded
 */
export function runInstall({ cwd }: { cwd: string }): string | undefined {
  return runYarn({ cwd, kind: "install" });
}

/**
 * Run the repository's `build` script in one worktree.
 *
 * @param cwd the worktree to build in
 * @returns the failure detail, or `undefined` when the build succeeded
 */
export function runBuild({ cwd }: { cwd: string }): string | undefined {
  return runYarn({ cwd, kind: "build" });
}

/**
 * How long the built-CLI emit may run before it is killed.
 *
 * `dev build` measured ~8s on this machine, and it smoke-runs a verb before stamping its manifest. This is
 * sized far above that rather than near it: a provisioning run competes with every other seat on the box,
 * and a kill here costs the worktree its build for nothing.
 */
const DEV_BUILD_TIMEOUT_MS = 5 * 60_000;

/** Relative to a worktree root: the emitter's own entrypoint, and the tsx that runs it. */
const DEV_BUILD_ENTRY = "src/cli/index.ts";
const TSX_BIN = "node_modules/.bin/tsx";

/**
 * The package whose `dev build` this is. Mirrors `package.json`'s own `name`, and
 * `unit/worktree/devBuildShell.test.ts` reads that file to prove the two have not drifted apart.
 */
const EMITTER_PACKAGE = "slopweaver";

/**
 * Whether this resolved target can emit a built CLI at all.
 *
 * `worktree create --repo` and `cmux spawn` both reach repositories that are not this one, and the first two
 * questions here do not tell them apart — plenty of repositories have a `src/cli/index.ts` and a `tsx`. So
 * the third asks the target to SAY it is this package, and it is load-bearing in two directions rather than
 * being belt-and-braces. Without it, a foreign CLI is handed `dev build`, an argument list it never agreed
 * to: one that exits 0 on an unknown verb makes provisioning report an emit that never happened, and one
 * that exits NON-zero sends {@link discardBrokenBuild} at a `dist-cli` this emit did not write — which, for
 * a repository whose own `tsc` puts its output there, is `--build`'s successful artifact.
 *
 * That last consequence is why ownership is settled HERE rather than probed afterwards: the cleanup's whole
 * warrant is that the emitter which just cleared the manifest was ours, and only this check establishes it.
 *
 * @param path the worktree to look at
 * @returns whether {@link runDevBuild} could run there
 */
export function supportsDevBuild({ path }: { path: string }): boolean {
  return (
    existsSync(join(path, DEV_BUILD_ENTRY)) &&
    existsSync(join(path, TSX_BIN)) &&
    packageNamed({ name: EMITTER_PACKAGE, path })
  );
}

/** Whether a directory's `package.json` declares exactly this name — unreadable or unparseable is a no. */
function packageNamed({ name, path }: { name: string; path: string }): boolean {
  try {
    const text = readFileSync(join(path, "package.json"), "utf8");
    const parsed = safeJsonParse({ label: `${path}/package.json`, text });
    return isRecord(parsed) && parsed["name"] === name;
  } catch {
    return false;
  }
}

/**
 * The argv after `tsx` provisioning's emit runs. `--yield-to-lap`: a lap holds the compile lease for its whole run, so
 * an emit started outside one while it runs would wait 120 s for a refusal certain from the start; with the flag it
 * gives up after one second when the lease's holder is a live lap (`src/cli/commands/dev/buildOwner.ts`
 * § Yielding to a lap), and the worktree runs from source exactly as a refused build always left it.
 *
 * @returns the source entrypoint, the verb, and its flag
 */
export function worktreeDevBuildArgv(): readonly string[] {
  return [DEV_BUILD_ENTRY, "dev", "build", "--yield-to-lap"];
}

/**
 * Emit one worktree's built CLI by running the verb that owns the emit.
 *
 * Through the target's own `tsx` and SOURCE rather than through `bin/slopweaver`, for the reason
 * `checkouts/refMoveBuildRun.ts` gives about the same call: the launcher routes a built checkout to its
 * artifact, and the whole point of this invocation is to be the thing that writes that artifact.
 *
 * A zero exit is NOT the success condition. {@link supportsDevBuild} establishes that the emitter about to
 * run is this package's own, so an exit code here is at least a verdict on the right question — but `dev
 * build` can still exit 0 having written nothing a launcher would use, and "emitted" is a claim about the
 * artifact rather than about the process. So the artifact is what is asked: {@link builtCliPresent} puts the
 * same question `bin/slopweaver` asks before it will route to a build.
 *
 * @param cwd the worktree to emit in
 * @returns the failure detail, or `undefined` when the emit succeeded
 */
export function runDevBuild({ cwd }: { cwd: string }): DevBuildFailure | undefined {
  try {
    execFileSync(join(cwd, TSX_BIN), worktreeDevBuildArgv(), {
      cwd,
      encoding: "utf8",
      env: gitEnv(),
      maxBuffer: YARN_MAX_BUFFER,
      stdio: "pipe",
      timeout: DEV_BUILD_TIMEOUT_MS,
    });
  } catch (error: unknown) {
    return { detail: devBuildFailureDetail({ error }), left: discardBrokenBuild({ path: cwd }) };
  }
  if (builtCliPresent({ path: cwd })) {
    return undefined;
  }
  return { detail: missingArtifactDetail({ path: cwd }), left: discardBrokenBuild({ path: cwd }) };
}

/**
 * Whether a built CLI is really standing in a worktree — the two files, and only the two files, that
 * `bin/slopweaver` requires before it will run `dist-cli` instead of `tsx`.
 *
 * The launcher asks `-f` of both (`bin/slopweaver`'s `BUILT_MANIFEST`/`BUILT_ENTRY` test), so this asks
 * `isFile()` rather than existence: a DIRECTORY at either name satisfies `existsSync` and satisfies nothing
 * the launcher wants, which would let this report "emitted" over a worktree the launcher then runs from
 * source. Answering the launcher's own question is the whole point of the check.
 *
 * @param path the worktree to look in
 * @returns whether `bin/slopweaver` there would route to the build
 */
export function builtCliPresent({ path }: { path: string }): boolean {
  const builtRoot = join(path, DEFAULT_OUT);
  return (
    regularFile({ path: join(builtRoot, BUILD_MANIFEST_FILE) }) &&
    regularFile({ path: join(builtRoot, BUILT_ENTRYPOINT) })
  );
}

/** Whether a path is a regular file, following symlinks exactly as the launcher's `-f` test does. */
function regularFile({ path }: { path: string }): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** What to report when the emitter exited 0 and left no artifact behind — the state, not a guess at why. */
function missingArtifactDetail({ path }: { path: string }): string {
  return `the emitter exited 0 but wrote no ${join(DEFAULT_OUT, BUILD_MANIFEST_FILE)} and ${join(DEFAULT_OUT, BUILT_ENTRYPOINT)} in ${path} — is this repository's \`src/cli/index.ts\` a different CLI?`;
}

/**
 * What became of the built tree a failed emit left behind.
 *
 * `kept` is the one a caller must SAY out loud: the hazard below is still standing and only a hand can clear
 * it. `absent` and `removed` both leave a worktree that simply runs from source, and `guarded` leaves one
 * running the build it already had, under the staleness guard that has always policed it.
 */
export type DiscardOutcome = "absent" | "guarded" | "kept" | "removed" | "unreadable";

/**
 * A failed emit, and what it left on disk.
 *
 * `left` travels with `detail` rather than being folded into it because the two say different things to a
 * reader: `detail` is why the emit failed, and `left` decides whether "this worktree runs from source" is
 * true at all. `devBuild.ts`'s renderer branches on it instead of asserting the safe case.
 */
export interface DevBuildFailure {
  readonly detail: string;
  readonly left: DiscardOutcome;
}

/**
 * Remove the built tree a FAILED emit left behind, so nothing can run unguarded JavaScript out of it.
 *
 * The hazard is `dev build`'s own order, which is right for `dev build` and wrong to inherit here: it
 * `clearStamp`s the manifest BEFORE esbuild writes a byte and only re-stamps a successful build
 * (`cli/commands/dev/build.ts`), while `builtCli/guard.ts` answers `refuse: false` when it finds no manifest
 * at all — a source checkout has none either, and that one must be allowed to run. Compose the two over a
 * worktree that ALREADY held a good build and this provision's emit failed, and what is left is the previous
 * build's JavaScript with its provenance deleted: `bin/slopweaver` declines to route to it, but
 * `node dist-cli/cli/index.js` answers from stale code with nothing to refuse it. Demonstrated on this tree —
 * with the manifest present and one source byte changed the built CLI REFUSED, and with only the manifest
 * moved aside the same stale tree answered `slopweaver — 522 commands across 78 nouns`.
 *
 * Removing the tree makes "this worktree runs from source" the state that actually exists, and it never costs
 * a working build, because every path that reaches here has already had its manifest cleared by the emitter
 * it just ran.
 *
 * The removal CANNOT throw, which is the whole reason it is its own function: `rmSync`'s `force` suppresses a
 * missing path and nothing else, so an unwritable built directory raises `EPERM`/`ENOTEMPTY` — and an
 * exception from here would escape `runDevBuild`'s catch and turn provisioning's deliberately non-fatal emit
 * into a failed provision.
 *
 * @param path the worktree whose emit failed
 * @returns what happened to the built tree
 */
export function discardBrokenBuild({ path }: { path: string }): DiscardOutcome {
  const builtRoot = join(path, DEFAULT_OUT);
  // The subject is an UNGUARDED tree, never a failed attempt. A `dist-cli` still carrying its manifest is one
  // `builtCli/guard.ts` can refuse on its own, so it is not this function's business whatever went wrong —
  // and a failure that never STARTED the emitter (a `tsx` that is not executable, so `execFileSync` throws
  // EACCES before a byte is cleared) leaves exactly that: a stamped build this emit never touched. Removing
  // it would destroy a working artifact to tidy up after an attempt that did nothing.
  //
  // And a stamp that could not be READ is not an absent stamp. The same launch failure that leaves a build
  // untouched can be the reason its manifest is unreachable — a `dist-cli` linked into a directory with no
  // search permission answers EACCES to both — so collapsing that to "no manifest" is how a removal gets
  // licensed by the very fact that should have withheld it.
  const manifest = manifestState({ path: join(builtRoot, BUILD_MANIFEST_FILE) });
  if (manifest === "present") {
    return "guarded";
  }
  if (manifest === "unknown") {
    return "unreadable";
  }
  if (entryState({ path: builtRoot }) === "absent") {
    return "absent";
  }
  try {
    rmSync(builtRoot, { force: true, recursive: true });
  } catch {
    return "kept";
  }
  // Re-read rather than trusting a silent return: `force` swallows a missing path, so a removal that only
  // partly succeeded would otherwise report `removed` over whatever survived it. Only a PROVEN absence earns
  // the reassuring outcome — an entry we still cannot read is one we have not shown to be gone.
  return entryState({ path: builtRoot }) === "absent" ? "removed" : "kept";
}

/** What one `lstat` of a directory entry established — including that it established nothing. */
type EntryState = "absent" | "present" | "unknown";

/**
 * What a directory ENTRY is, asking about the entry rather than about what it resolves to.
 *
 * Two readings are wrong here and both were made. `existsSync` follows a symlink and answers `false` when the
 * target cannot be reached — so a `dist-cli` symlinked under a directory with no search permission reads as
 * absent while its JavaScript is still there for anything that CAN reach it; `lstatSync` answers about the
 * link itself, which is the thing being removed. And a `lstat` that THREW has not answered the question at
 * all: `ENOENT` and `ENOTDIR` are the only two errnos that mean nothing is there, while `EACCES` from a
 * worktree directory stripped of search permission means the entry may be standing and unreadable. Measured
 * before this distinction existed: `chmod 0600` the worktree, and a `dist-cli/cli/index.js` that outlived the
 * call was reported `absent`, which renders as "this worktree runs from source".
 */
function entryState({ path }: { path: string }): EntryState {
  try {
    lstatSync(path);
    return "present";
  } catch (error: unknown) {
    return notThereCode({ error }) ? "absent" : "unknown";
  }
}

/**
 * Whether a stamped build manifest is at a path — `present` only for a regular file, as the launcher's `-f`
 * asks, `absent` only where that is established, and `unknown` for a stat that answered nothing.
 */
function manifestState({ path }: { path: string }): EntryState {
  try {
    return statSync(path).isFile() ? "present" : "absent";
  } catch (error: unknown) {
    return notThereCode({ error }) ? "absent" : "unknown";
  }
}

/** Whether a thrown filesystem error is one of the two that actually establish an entry is not there. */
function notThereCode({ error }: { error: unknown }): boolean {
  const code = isRecord(error) ? error["code"] : undefined;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * The most useful text a failed emit left behind.
 *
 * Unlike a failed yarn run, `dev build` reports an unsuccessful SMOKE verdict on stdout — it is a finding
 * the verb printed, not a crash — so a stderr-only reading of a failure would lose the actual reason.
 *
 * @internal — exported for its own unit test; {@link runDevBuild} is the only production caller
 * @param error whatever `execFileSync` threw
 * @returns the detail the provision report carries
 */
export function devBuildFailureDetail({ error }: { error: unknown }): string {
  return detailFromStreams({ error, streams: isRecord(error) ? [error["stderr"], error["stdout"]] : [] });
}

/**
 * Where the plugin's SHARED dependency tree lives — the one `--deps shared` links to and the one
 * `bin/slopweaver` used to link unconditionally.
 *
 * Resolved exactly as the shell side resolves it (`bin/slopweaver`, `scripts/plugin-install-deps.sh`), so
 * the two never disagree about which directory is being talked about.
 *
 * @returns the absolute path of the shared `node_modules`
 */
export function sharedDepsRoot(): string {
  return join(pluginDataRoot(), "cli-deps", "node_modules");
}

/**
 * The plugin-data directory, in the shell side's precedence: the host's own `PLUGIN_DATA`, then the one Claude
 * Code exports, then the directory a plugin install uses when neither host names one. Explicit branches, so
 * which of the three answered is readable here rather than folded into one expression.
 */
function pluginDataRoot(): string {
  const hostData = process.env["PLUGIN_DATA"];
  if (hostData !== undefined) {
    return hostData;
  }
  const claudeCodeData = process.env["CLAUDE_PLUGIN_DATA"];
  if (claudeCodeData !== undefined) {
    return claudeCodeData;
  }
  return join(homedir(), ".claude", "plugins", "data", "slopweaver");
}

/**
 * The MAIN checkout of whatever repository a directory belongs to — never the linked worktree the caller
 * happens to be standing in.
 *
 * Resolved through `--git-common-dir`, which every linked worktree reports as the shared `.git` of its main
 * checkout, so a session inside `.claude/worktrees/<slug>` addresses the repository rather than itself. The
 * same canonicalisation `bin/slopweaver`'s own worktree-mismatch guard learned to use: comparing or deriving
 * paths from anything else silently breaks on the unresolved `/..` segments those variables carry.
 *
 * @param cwd the directory to resolve from
 * @returns the main checkout's absolute path, or `undefined` when `cwd` is not inside a git repository
 */
export function mainCheckoutRoot({ cwd }: { cwd: string }): string | undefined {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd,
      encoding: "utf8",
      env: gitEnv(),
      // git's own stderr is discarded with the error: a `cwd` outside any repository is a legitimate answer
      // this reports as `undefined`, so letting `fatal: not a git repository` reach the caller's terminal
      // would print an error for a case that is not one.
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_READ_TIMEOUT_MS,
    }).trim();
    return common.length === 0 ? undefined : dirname(common);
  } catch {
    return undefined;
  }
}
