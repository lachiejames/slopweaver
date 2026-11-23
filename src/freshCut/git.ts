/**
 * The one way a fresh cut runs git: argv arrays, no shell, every `GIT_*` variable from the caller stripped, the
 * user's global and system config switched off, and a bound on every run.
 *
 * The config is switched off because a cut is signed as the owner's GitHub no-reply identity and nothing else: a
 * global `user.email`, `commit.gpgSign`, `core.hooksPath`, an `init.templateDir` or a filter definition would each
 * leak something of this machine into a commit meant for the public, or run code that was never asked for. The
 * source repository's OWN config still applies to the reads, because that is where its object format and its
 * worktrees are declared. Writes happen only in the new repository; nothing here writes into the source.
 */
import { execFileSync } from "node:child_process";
import { stripGitEnv } from "../codex/gitRun.js";
import { err, ok, type Result } from "../lib/result.js";

/**
 * How long one git run may take before it is killed. The slowest is the repack that copies the whole tree's objects
 * into the new repository, seconds for this repository's ~22,000 files (repro: `time slopweaver fresh-cut produce
 * --commit <sha> --out <new-dir>`); ten minutes ends a run wedged on a lock or a prompt nobody can see. SIGKILL, because a
 * child that traps SIGTERM would outlive the bound.
 */
const GIT_TIMEOUT_MS = 10 * 60_000;

/** The most output one git run may hand back. Above it the run fails rather than truncating a listing. */
const MAX_GIT_BUFFER = 512 * 1024 * 1024;

/** Config pinned on every run, so nothing global decides what the cut contains or runs. */
const PINNED_CONFIG: readonly string[] = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "commit.gpgSign=false",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.quotepath=false",
  // No reflog: one would record this machine's fallback `user@host` identity for each ref update in the cut.
  "-c",
  "core.logAllRefUpdates=false",
];

/**
 * The environment every fresh-cut git run gets: the caller's minus every `GIT_*`, global and system config off,
 * replacement objects and lazy fetching off, no prompt, then the variables this run states.
 *
 * @param extraEnv the variables this run needs (an identity, a date, an alternate object directory)
 * @returns the environment
 */
function freshCutGitEnv({ extraEnv }: { extraEnv: Readonly<Record<string, string>> }): Record<string, string> {
  return {
    ...stripGitEnv({ env: process.env }),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_LFS_SKIP_SMUDGE: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_TERMINAL_PROMPT: "0",
    ...extraEnv,
  };
}

/** Why one git run failed: its exit status (null when it never exited normally) and the first line of stderr. */
export interface GitRunFailure {
  readonly status: number | null;
  readonly cause: string;
}

/**
 * Run one git command and hand back its stdout as bytes.
 *
 * @param cwd the repository to run in
 * @param args the git argv, after the pinned config
 * @param input what to write to stdin, for `cat-file --batch`
 * @param extraEnv variables this run states on top of {@link freshCutGitEnv}
 * @returns stdout, or the exit status and first stderr line of the failure
 */
export function runFreshCutGit({
  cwd,
  args,
  input,
  extraEnv = {},
}: {
  cwd: string;
  args: readonly string[];
  input?: string;
  extraEnv?: Readonly<Record<string, string>>;
}): Result<Buffer, GitRunFailure> {
  try {
    return ok(
      execFileSync("git", [...PINNED_CONFIG, ...args], {
        cwd,
        env: freshCutGitEnv({ extraEnv }),
        ...(input === undefined ? {} : { input }),
        killSignal: "SIGKILL",
        maxBuffer: MAX_GIT_BUFFER,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: GIT_TIMEOUT_MS,
      }),
    );
  } catch (error) {
    return err(gitRunFailure({ error }));
  }
}

/**
 * Pure: the status and first stderr line of a thrown `execFileSync` error. Exported only so a unit test can pin it.
 *
 * @internal
 * @param error what `execFileSync` threw
 * @returns the failure, never the whole stderr
 */
export function gitRunFailure({ error }: { error: unknown }): GitRunFailure {
  if (typeof error !== "object" || error === null) {
    return { cause: String(error), status: null };
  }
  const status = "status" in error && typeof error.status === "number" ? error.status : null;
  const stderr = "stderr" in error && Buffer.isBuffer(error.stderr) ? error.stderr.toString("utf8").trim() : "";
  const firstLine = stderr.split("\n")[0];
  if (firstLine !== undefined && firstLine.length > 0) {
    return { cause: firstLine, status };
  }
  return { cause: error instanceof Error ? error.message : "git failed with no message", status };
}

/**
 * Run one git command and hand back its stdout as trimmed text.
 *
 * @param cwd the repository to run in
 * @param args the git argv
 * @param extraEnv variables this run states
 * @returns trimmed stdout, or the failure
 */
export function freshCutGitText({
  cwd,
  args,
  extraEnv = {},
}: {
  cwd: string;
  args: readonly string[];
  extraEnv?: Readonly<Record<string, string>>;
}): Result<string, GitRunFailure> {
  return runFreshCutGit({ args, cwd, extraEnv }).map((bytes) => bytes.toString("utf8").trim());
}
