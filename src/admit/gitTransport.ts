/**
 * The two git process edges every push-shaped verb reads and writes through — `readGit` and `writeGit` —
 * with the environment they share and the bounds they carry.
 *
 * Its own module because the seam is real: this module is how git is RUN, `./githubPush.ts` is the
 * gate-then-push-then-read-back ordering every governed push goes through, and
 * `cli/commands/github/pushPrimitives.ts` is what the verbs do with both, plus the production wiring.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { stripGitEnv } from "../codex/gitRun.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { type GitWriteError, GitWriteErrors } from "./gitTransportErrors.js";

/**
 * How much output one read holds in memory at once.
 *
 * Node's default for a captured child is 1 MiB and the failure past it is ENOBUFS — a THROW, which a caller
 * that wraps this in a `try` reads as "the repository could not be read" rather than as "the answer did not
 * fit". MEASURED: the worktree capture's whole-index listing is just over a megabyte in the acme-admin monorepo,
 * just past that default, so every worktree there declined its salvage on a read that had actually worked.
 * Reproduce the size:
 *
 * ```bash
 * git -C ~/dev/acme-admin ls-files -v -z | wc -c
 * ```
 *
 * 32 MiB matches the bound `src/worktree/pruneScan.ts` already applies to the same listing, and stays a
 * bound rather than an invitation: a size that comes from the data still has a ceiling.
 */
const READ_MAX_BYTES = 32 * 1024 * 1024;

/**
 * How long one {@link readGit} may take — a local read or an `ls-remote` over the transport. Each answers in
 * well under a second on a healthy repository; what one can wait on is a prompt the session cannot see,
 * because ssh asks for a passphrase on `/dev/tty` rather than the piped stdin. Two minutes matches the bound
 * `src/worktree/pruneGit.ts` and `src/worktree/salvageScan.ts` already put on the same reads, is far past a
 * cold `ls-remote`, and ends a read that would otherwise block the event loop for good. SIGKILL, because a
 * child that traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/**
 * How long one streamed {@link writeGit} — a push or a fetch — may run before it is stopped. Two parts, added.
 * A plain `git push` runs the repository's own pre-push hook INSIDE this child (`cli/commands/github/stackSubmitRun.ts` sends one
 * without `--no-verify`), and that hook ran 444s and 1314s on two healthy runs (`cli/commands/github/stackPushSend.ts`, measured), so it gets the thirty minutes `cli/commands/github/prePushGateRun.ts`'s `HOOK_TIMEOUT_MS` gives the same hook run
 * on its own. On top, twenty minutes for the transfer: a big branch or a first fetch into a fresh private ref
 * takes minutes over a slow link. Past fifty the push reports a named timeout instead of holding the session
 * on a prompt or a stalled transport forever.
 */
const GIT_WRITE_TIMEOUT_MS = (30 + 20) * 60_000;

/**
 * Read-only Git call with argv isolation, and with `GIT_*` stripped so `cwd` alone decides the repository.
 *
 * The stripping is not defensive tidying: measured, `yarn validate` runs as a `pre-push` hook,
 * which exports `GIT_DIR`/`GIT_WORK_TREE` into every child, and those OVERRIDE an explicit `cwd`. Every
 * `GithubPushDeps` consumer reads through this one function — the branch and SHA `github push` reports, the
 * private ref every base-freshness and merge-guard fetch resolves — so under the hook each of them answered
 * about whichever repository `GIT_DIR` named. That is the same failure class the merge guard's own base
 * resolution was fixed for; `readPatchId` and `gitAncestry.ts` already record it from their own incidents.
 * `GIT_SSH_COMMAND` is put back because `ls-remote` runs over the transport and that variable selects a
 * credential, never a repository.
 *
 * @param cwd the repository to read
 * @param args git's argv, without the `git`
 * @returns git's stdout, trimmed
 */
export function readGit({ cwd, args }: { cwd: string; args: readonly string[] }): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: transportGitEnv(),
    killSignal: "SIGKILL",
    maxBuffer: READ_MAX_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: GIT_READ_TIMEOUT_MS,
  }).trim();
}

/**
 * Write call whose output stays visible to the session that asked for it.
 *
 * `stdio: "inherit"` is the point — a fetch or push must be seen happening rather than stared at. The cost
 * is measured: if the parent's stdout is a PIPE that closes before git finishes (an agent harness
 * time-slicing a long command is the case that found this), git's next write earns a SIGPIPE and the push
 * dies having done nothing. Hence the signal-naming in {@link writeGitOutcome}: three nine-minute runs were
 * spent on `git exited without a status`, which named neither the signal nor the fact that the remote had not
 * refused anything.
 *
 * @param cwd the repository to run in
 * @param args git's argv, without the `git`
 * @returns ok when git exited 0, else the one line naming how it ended
 */
export function writeGit({ cwd, args }: { cwd: string; args: readonly string[] }): Result<void, string> {
  // `stripGitEnv` for the same reason `readGit` above does it, reached here through a different door and
  // measured: `yarn validate` runs as a `pre-push` hook, which exports `GIT_DIR`/`GIT_WORK_TREE`,
  // and those override an explicit `cwd`. Every `fetchBranchIntoPrivateRef` in this repo fetches through
  // THIS function, so under the hook a fetch aimed at a temp repository landed in the slopweaver checkout
  // instead — the ref then failed to resolve where it was asked for, and the caller reported the base as
  // unfetchable. `GIT_SSH_COMMAND` is a transport setting rather than a repository selector, so it is put
  // back exactly as it was.
  const result = spawnSync("git", [...args], {
    cwd,
    env: transportGitEnv(),
    killSignal: "SIGKILL",
    stdio: "inherit",
    timeout: GIT_WRITE_TIMEOUT_MS,
  });
  return writeGitOutcome({ result });
}

/** A finished child's outcome, as `spawnSync` reports it — the fields {@link writeGitFailure} reads. */
interface FinishedChild {
  readonly error?: Error | undefined;
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
}

/**
 * How one finished {@link writeGit} child failed, typed — split out so the timeout branch is testable over a
 * plain result value, without a transport that hangs.
 *
 * @internal — exported so a unit test can hand it the result Node reports for a child killed at its bound.
 * @param result the finished child's outcome, read for `error`, `status` and `signal` only
 * @returns undefined when git exited 0, else the failure — a timeout by its bound, a signal by name, a refusal by
 *   its exit status
 */
export function writeGitFailure({ result }: { result: FinishedChild }): GitWriteError | undefined {
  // Node reports a child killed at its bound as `code: "ETIMEDOUT"` on `result.error`, ahead of the signal.
  if (isRecord(result.error) && result.error["code"] === "ETIMEDOUT") {
    return GitWriteErrors.timedOut({ timeoutMs: GIT_WRITE_TIMEOUT_MS });
  }
  if (result.error !== undefined) {
    return GitWriteErrors.unrunnable({ cause: result.error.message });
  }
  if (result.status === 0) {
    return undefined;
  }
  if (result.status === null) {
    return GitWriteErrors.killed({ signal: killingSignalName({ result }) });
  }
  return GitWriteErrors.exited({ status: result.status });
}

/**
 * What one finished {@link writeGit} child means, as the one line `writeGit`'s callers print.
 *
 * @internal — exported so a unit test can read the line a caller prints for each ending.
 * @param result the finished child's outcome, read for `error`, `status` and `signal` only
 * @returns ok when git exited 0, else the failure's message
 */
export function writeGitOutcome({ result }: { result: FinishedChild }): Result<void, string> {
  const failure = writeGitFailure({ result });
  return failure === undefined ? ok(undefined) : err(failure.message);
}

/**
 * The environment a git call over the transport gets: every `GIT_*` selector stripped so `cwd` alone decides
 * the repository, with `GIT_SSH_COMMAND` put back because it selects a credential, never a repository. A
 * salvage's secrets scan reads under this same environment, so an injected `GIT_CONFIG_*` cannot rewrite the
 * url it reads without rewriting the one it pushes to.
 *
 * @returns the environment, a fresh copy
 */
export function transportGitEnv(): Record<string, string> {
  const sshCommand = process.env["GIT_SSH_COMMAND"];
  const env = stripGitEnv({ env: process.env });
  if (sshCommand !== undefined) {
    env["GIT_SSH_COMMAND"] = sshCommand;
  }
  return env;
}

/**
 * How a refusal names the signal that killed a child with no exit status. Node reports `null` when the child
 * was not ended by a signal it could name, and that is a state to say, never a blank in the line.
 *
 * @param result the finished child's outcome, read for `signal` only
 * @returns the signal's name, or "an unnamed signal" when Node reported none
 */
export function killingSignalName({ result }: { result: { readonly signal: NodeJS.Signals | null } }): string {
  const signal = result.signal;
  if (signal === null) {
    return "an unnamed signal";
  }
  return signal;
}
