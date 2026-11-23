/**
 * The shared Git ancestry and private-fetch-ref primitives every base-freshness check builds on.
 *
 * Consolidated here because two call sites each carried their own copy with a different bug: `stack sync`'s
 * `isAncestor` passed raw revision strings to `git merge-base --is-ancestor`, which a same-named local
 * branch can shadow — this repo already defends against exactly that elsewhere (`stackSquash.ts`,
 * `pushCore.ts`) by suffixing every raw SHA with `^{commit}`, and this module applies the same defense.
 * `stackSquash.ts`'s `fetchBranchIntoPrivateRef` generated its ref name INSIDE itself and returned it only on
 * success, so a fetch that reported failure after Git had already updated the ref left an orphan nothing
 * could clean up. Here the caller allocates the ref before fetching, so cleanup always has a target.
 *
 * `isAncestor` strips every `GIT_*` environment variable before shelling out — measured live, pushing this
 * exact module's own PR: `yarn validate` runs as a `pre-push` git hook, which exports `GIT_DIR`/
 * `GIT_WORK_TREE` into every child process, and those override an explicit `cwd`. An unstripped call
 * resolved a completely different repository's objects and failed on revisions that could never exist
 * there — not a shallow-clone or shadowing case, an entirely wrong tree. See `src/__tests__/tempGitRepo.ts`'s
 * own header for the identical incident in test code; this is the same mechanism reached from production.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stripGitEnv } from "../../../codex/gitRun.js";
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type GithubVerbError, GithubVerbErrors } from "./errors.js";
import type { GithubPushDeps } from "./pushRun.js";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/** The two revisions an ancestry check compares. */
export interface GitAncestryInput {
  readonly ancestor: string;
  readonly descendant: string;
  readonly cwd: string;
}

/** The injectable shape of {@link isAncestor}, for a caller that wants to fake it in a unit test. */
export type IsAncestor = (input: GitAncestryInput) => Result<boolean, GithubVerbError>;

/**
 * Whether `ancestor` is a Git ancestor of `descendant`.
 *
 * Both revisions are suffixed `^{commit}` before being handed to `git`, which forces object resolution and
 * cannot be shadowed by a local branch that happens to share a 40-hex SHA's name. Exit 0 is `ok(true)`, exit
 * 1 is `ok(false)` (git's own "definitely not an ancestor, at least in the history this clone has" answer —
 * including a shallow clone's false negative, which is why every caller of this function must treat `false`
 * as an escapable finding, never an unescapable one), and every other exit is `err(...)` — an execution
 * fault must never read the same as a genuine "not an ancestor".
 *
 * @param ancestor the commit that must be reachable from `descendant`
 * @param descendant the commit to check ancestry from
 * @param cwd the repository to run git in
 * @returns whether `ancestor` is an ancestor of `descendant`, or why that could not be established
 */
export function isAncestor({ ancestor, descendant, cwd }: GitAncestryInput): Result<boolean, GithubVerbError> {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", `${ancestor}^{commit}`, `${descendant}^{commit}`], {
      cwd,
      env: stripGitEnv({ env: process.env }),
      stdio: "ignore",
      killSignal: "SIGKILL",
      timeout: GIT_READ_TIMEOUT_MS,
    });
    return ok(true);
  } catch (error: unknown) {
    if (isRecord(error) && error["status"] === 1) {
      return ok(false);
    }
    return err(GithubVerbErrors.ancestryFailed({ cause: error instanceof Error ? error.message : String(error) }));
  }
}

/**
 * The commit a ref resolves to in one repository.
 *
 * `^{commit}` for the same reason {@link isAncestor} uses it: it forces object resolution, so a 40-hex ref
 * cannot be shadowed by a local branch that happens to share its name. `GIT_*` is stripped for the incident
 * this module's header records.
 *
 * @param cwd the repository to resolve in
 * @param ref the ref, branch or SHA to resolve
 * @returns the commit SHA, or why it did not resolve
 */
export function resolveCommitSha({ cwd, ref }: { cwd: string; ref: string }): Result<string, GithubVerbError> {
  try {
    return ok(
      execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
        cwd,
        encoding: "utf8",
        env: stripGitEnv({ env: process.env }),
        stdio: ["ignore", "pipe", "pipe"],
        killSignal: "SIGKILL",
        timeout: GIT_READ_TIMEOUT_MS,
      }).trim(),
    );
  } catch (error: unknown) {
    return err(
      GithubVerbErrors.refUnresolved({ cause: error instanceof Error ? error.message : String(error), cwd, ref }),
    );
  }
}

/** The injectable shape of {@link countCommitsAhead}, for a caller that wants to fake it in a unit test. */
export type CountCommitsAhead = (args: { cwd: string; from: string; to: string }) => Result<number, GithubVerbError>;

/**
 * How many commits `to` carries that `from` does not — `git rev-list --count from..to`.
 *
 * Both revisions are suffixed `^{commit}` and `GIT_*` is stripped for the same two reasons {@link isAncestor}
 * states: a 40-hex SHA can be shadowed by a same-named local branch, and under a `pre-push` hook an
 * inherited `GIT_DIR` overrides an explicit `cwd`.
 *
 * @param cwd the repository to run git in
 * @param from the revision to count away from
 * @param to the revision whose extra commits are counted
 * @returns the count, or why it could not be taken
 */
export function countCommitsAhead({
  cwd,
  from,
  to,
}: {
  cwd: string;
  from: string;
  to: string;
}): Result<number, GithubVerbError> {
  try {
    const text = execFileSync("git", ["rev-list", "--count", `${from}^{commit}..${to}^{commit}`], {
      cwd,
      encoding: "utf8",
      env: stripGitEnv({ env: process.env }),
      stdio: ["ignore", "pipe", "pipe"],
      killSignal: "SIGKILL",
      timeout: GIT_READ_TIMEOUT_MS,
    }).trim();
    const count = Number.parseInt(text, 10);
    return Number.isNaN(count) ? err(GithubVerbErrors.revListUnparsed({ cwd, text })) : ok(count);
  } catch (error: unknown) {
    return err(
      GithubVerbErrors.commitsUncounted({
        cause: error instanceof Error ? error.message : String(error),
        cwd,
        from,
        to,
      }),
    );
  }
}

/**
 * Mint a unique private ref name, never `FETCH_HEAD` — a concurrent, unrelated fetch anywhere in the same
 * repository can silently overwrite `FETCH_HEAD` between writing and reading it.
 *
 * Minted by the CALLER, before any fetch runs, so a fetch that reports failure after Git has already
 * updated the destination still leaves a name cleanup can target — see the module doc.
 *
 * @returns a ref name under this tool's own private namespace
 */
export function newPrivateFetchRef(): string {
  return `refs/slopweaver/fetch/${randomUUID()}`;
}

/**
 * Fetch one branch's live tip into an already-named private ref.
 *
 * @param branch the branch to fetch
 * @param remote the configured Git remote
 * @param cwd the worktree to fetch into
 * @param ref the private ref to fetch into — minted by the caller via {@link newPrivateFetchRef} BEFORE this
 *   call, so it is known for cleanup regardless of whether this function succeeds
 * @param git the injectable Git primitives
 * @returns the fetched commit's exact SHA, or why it could not be fetched or resolved
 */
export function fetchBranchIntoPrivateRef({
  branch,
  remote,
  cwd,
  ref,
  git,
}: {
  readonly branch: string;
  readonly remote: string;
  readonly cwd: string;
  readonly ref: string;
  readonly git: GithubPushDeps;
}): Result<{ readonly sha: string }, GithubVerbError> {
  const fetched = git.writeGit({ args: ["fetch", remote, `refs/heads/${branch}:${ref}`], cwd });
  if (!fetched.isOk()) {
    return err(GithubVerbErrors.upstreamRefused({ operation: "fetch", reasons: [fetched.error] }));
  }
  try {
    return ok({ sha: git.readGit({ args: ["rev-parse", `${ref}^{commit}`], cwd }) });
  } catch (error: unknown) {
    return err(
      GithubVerbErrors.fetchedUnresolved({ cause: error instanceof Error ? error.message : String(error), ref }),
    );
  }
}

/**
 * Delete a private fetch ref, reporting failure rather than swallowing it.
 *
 * A caller that fetched successfully and then failed to clean up must not claim a clean measurement — see
 * every caller's own `finally`/cleanup handling for how this is surfaced.
 *
 * @param ref the private ref to delete
 * @param cwd the worktree the ref lives in
 * @param git the injectable Git primitives
 * @returns ok, or the exact ref and reason deletion failed
 */
export function deletePrivateRef({
  ref,
  cwd,
  git,
}: {
  readonly ref: string;
  readonly cwd: string;
  readonly git: GithubPushDeps;
}): Result<void, GithubVerbError> {
  const deleted = git.writeGit({ args: ["update-ref", "-d", ref], cwd });
  return deleted.isOk() ? ok(undefined) : err(GithubVerbErrors.privateRefUndeleted({ cause: deleted.error, ref }));
}
