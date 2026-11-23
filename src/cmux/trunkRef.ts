/**
 * The pure ref names and argv `./worktree.ts` builds before it shells out to git: which remote trunk lives on,
 * the private ref a fetch lands in, which branch a `--base` value names there, and the `worktree add` argv
 * that forks from it. No git, no filesystem, so each is unit-testable against a literal.
 */
import { randomUUID } from "node:crypto";

/** The remote this repository's fleet convention creates fresh handover branches from. */
export const TRUNK_REMOTE = "origin";

/**
 * Mint a unique private ref name, never `FETCH_HEAD` — a concurrent, unrelated `git fetch` anywhere in the
 * same shared `.git` (every worktree of this repository shares one) can silently overwrite `FETCH_HEAD`
 * between this module writing it and reading it back, exactly the shape `src/cli/commands/github/
 * gitAncestry.ts`'s `newPrivateFetchRef` guards the same way.
 *
 * @returns a ref name under this tool's own private namespace
 */
export function newPrivateFetchRef(): string {
  return `refs/slopweaver/fetch/${randomUUID()}`;
}

/**
 * The `git worktree add` argv for a brand-new branch forked from a freshly fetched ref.
 *
 * Pure and exported so a unit test can assert {@link fetchRef} — never the literal `FETCH_HEAD` — is what
 * ends up in the argv, without shelling out to git at all.
 *
 * @param path the exact directory to create the worktree at
 * @param branch the new branch name to create there
 * @param fetchRef the private ref (or resolved SHA) the branch is forked from
 * @returns the full `git worktree add` argv
 */
export function buildFreshBranchAddArgs({
  path,
  branch,
  fetchRef,
}: {
  path: string;
  branch: string;
  fetchRef: string;
}): readonly string[] {
  return ["worktree", "add", "--no-checkout", "-b", branch, path, fetchRef];
}

/**
 * Parse `git ls-remote --symref <remote> HEAD` output for the branch the remote's `HEAD` points at.
 *
 * Pure: takes the raw text a caller already read, so the live discovery this exists for — trunk is `main`
 * here but a different long-lived branch on at least one other repository this tool targets — is testable
 * against a literal fixture with no subprocess involved.
 *
 * @param text the exact stdout from `git ls-remote --symref <remote> HEAD`
 * @returns the remote's default branch name, or `undefined` when the remote reported none
 */
export function parseRemoteDefaultBranch({ text }: { text: string }): string | undefined {
  const defaultLine = text.split("\n").find((line) => line.startsWith("ref: refs/heads/") && line.endsWith("\tHEAD"));
  return defaultLine === undefined ? undefined : defaultLine.slice("ref: refs/heads/".length, -"\tHEAD".length);
}

/**
 * The branch name on {@link TRUNK_REMOTE} that a `--base` value names, so it can sit after `refs/heads/` in a
 * fetch refspec.
 *
 * `worktree create`'s own usage example is `--base origin/main`, and `worktree list`/`status` default their
 * base to that same remote-tracking spelling, but a verbatim value became `refs/heads/origin/main` and the
 * fetch failed with `couldn't find remote ref`. So the remote-tracking spellings
 * (`origin/<b>`, `refs/remotes/origin/<b>`) and the full local spelling (`refs/heads/<b>`) all resolve to
 * `<b>`; a bare branch name passes through unchanged. One prefix is stripped, never recursively, so a remote
 * branch literally named `origin/x` is still reachable as `refs/heads/origin/x`.
 *
 * @param base the value given as `--base`, or a handover doc's `baseBranch`
 * @returns the branch name the remote knows it by
 */
export function remoteBranchFromBase({ base }: { base: string }): string {
  const prefix = [`refs/remotes/${TRUNK_REMOTE}/`, `${TRUNK_REMOTE}/`, "refs/heads/"].find((candidate) =>
    base.startsWith(candidate),
  );
  return prefix === undefined ? base : base.slice(prefix.length);
}
