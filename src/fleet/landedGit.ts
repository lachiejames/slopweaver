/**
 * The git half of `fleet landed`: which commit main is in a checkout, and its first-parent history. Two read-only
 * invocations with a constant argv shape — no fetch, so what is read is main as this checkout last saw it, and the
 * report carries the commit it read so a stale one says so.
 *
 * **A worktree's HEAD is never read as main.** Every other git-log reader here falls back to `HEAD` when the base
 * ref is missing, which in a feature worktree prints the feature branch's own commits under the heading "landed".
 * With no `--ref`, `origin/main` is tried then `main`, and neither resolving is a refusal.
 */
import { execFileSync } from "node:child_process";

import { gitEnv } from "#lib/gitRepo.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { type LandedError, LandedErrors } from "./landedErrors.js";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/** The refs tried, in order, when none is named. */
export const DEFAULT_LANDED_REFS: readonly string[] = ["origin/main", "main"];

/** One git read in a checkout: its stdout, or the typed reason there is none. */
type LandedGitRead = (input: { dir: string; args: readonly string[] }) => Result<string, LandedError>;

/**
 * The typed failure a thrown git read becomes. A child killed at {@link GIT_READ_TIMEOUT_MS} is named as stopped,
 * never as an ordinary failure, because nothing it would have answered is known.
 *
 * @param cause what `execFileSync` threw — `code: "ETIMEDOUT"` when the bound killed it
 * @param command the git arguments, joined, for the message
 * @returns `GIT_TIMED_OUT` for a child stopped at its bound, else `GIT_FAILED`
 */
export function landedGitFailure({ cause, command }: { cause: unknown; command: string }): LandedError {
  if (isRecord(cause) && cause["code"] === "ETIMEDOUT") {
    return LandedErrors.gitTimedOut({ command, timeoutMs: GIT_READ_TIMEOUT_MS });
  }
  return LandedErrors.gitFailed({ cause, command });
}

/** One git invocation's stdout, or why it failed. */
const git: LandedGitRead = ({ dir, args }) => {
  try {
    return ok(
      execFileSync("git", ["-C", dir, ...args], {
        encoding: "utf8",
        env: gitEnv(),
        maxBuffer: 8 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        killSignal: "SIGKILL",
        timeout: GIT_READ_TIMEOUT_MS,
      }),
    );
  } catch (cause) {
    return err(landedGitFailure({ cause, command: args.join(" ") }));
  }
};

/**
 * The commit a ref names in a checkout, trying each candidate in order. A candidate whose read was stopped at its
 * bound ends the walk with that timeout: it is not known to be absent, so falling through to the next candidate,
 * or to a refusal saying none resolves, would report a guess.
 *
 * @param dir the checkout
 * @param refs the candidates, the first that resolves winning
 * @param read the git reader, a seam a test replaces with one whose child hangs
 * @returns the ref that resolved and its commit, a timed-out read, or a refusal naming every candidate
 */
export function resolveLandedRef({
  dir,
  refs,
  read = git,
}: {
  dir: string;
  refs: readonly string[];
  read?: LandedGitRead;
}): Result<{ ref: string; sha: string }, LandedError> {
  for (const ref of refs) {
    const resolved = read({ args: ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], dir });
    if (resolved.isOk()) {
      return ok({ ref, sha: resolved.value.trim() });
    }
    if (resolved.error.code === "GIT_TIMED_OUT") {
      return err(resolved.error);
    }
  }
  return err(LandedErrors.refUnresolved({ ref: refs.join(" or ") }));
}

/**
 * The newest first-parent commits of a commit, as `git log --format=%H%x09%cI%x09%s` prints them.
 *
 * @param dir the checkout
 * @param sha the commit to walk back from — the resolved one, so the report and the log name the same main
 * @param limit how many commits
 * @returns git's stdout
 */
export function readLandedLog({
  dir,
  sha,
  limit,
}: {
  dir: string;
  sha: string;
  limit: number;
}): Result<string, LandedError> {
  return git({ args: ["log", "--first-parent", "-n", String(limit), "--format=%H%x09%cI%x09%s", sha], dir });
}

/**
 * Every first-parent commit of a commit since an instant, in the same format as {@link readLandedLog} — the window
 * `handover steers` needs, which is bounded by the oldest steer rather than by a count.
 *
 * @param dir the checkout
 * @param sha the commit to walk back from
 * @param sinceIso the oldest commit instant wanted
 * @returns git's stdout
 */
export function readLandedLogSince({
  dir,
  sha,
  sinceIso,
}: {
  dir: string;
  sha: string;
  sinceIso: string;
}): Result<string, LandedError> {
  return git({ args: ["log", "--first-parent", `--since=${sinceIso}`, "--format=%H%x09%cI%x09%s", sha], dir });
}
