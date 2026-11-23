/**
 * Which checkout, and which branch of it, a `codex` verb reports on when the caller named neither.
 *
 * Both absences are supported invocations rather than missing values: no `--repo` means the checkout the verb
 * was run in, and no `--branch` means the branch that checkout has out. Each is spelled as an `if` that
 * RETURNS, once, so the five verbs that read them cannot drift apart on what an unnamed one means.
 */
import { currentBranch, resolveRepoRoot } from "../../../codex/gitDiff.js";
import type { IngestError } from "../../../lib/ingestError.js";
import type { Result } from "../../../lib/result.js";

/**
 * The directory a `codex` verb resolves its repository from.
 *
 * @param repo the `--repo` the caller passed, if any
 * @returns that directory, or the one the verb was run in when none was named
 */
export function repoDirOf({ repo }: { repo: string | undefined }): string {
  if (repo === undefined) {
    return process.cwd();
  }
  return repo;
}

/**
 * The root of the repository a `codex` verb reports on: the one holding `--repo`, else the one it was run in.
 *
 * @param repo the `--repo` the caller passed, if any
 * @returns the repository's top-level directory, or why `git` could not name one
 */
export function codexRepoRoot({ repo }: { repo: string | undefined }): Result<string, IngestError> {
  return resolveRepoRoot({ cwd: repoDirOf({ repo }) });
}

/**
 * The branch a `codex` verb reports on: the one `--branch` names, else the one the checkout has out.
 *
 * A `git` that could not answer reads the same as a detached HEAD — no branch to report on — which is what
 * every caller already refuses on.
 *
 * @param branchFlag the `--branch` the caller passed, if any
 * @param repoRoot the checkout whose current branch stands in for an unnamed one
 * @returns the branch, or `null` when none was named and HEAD is detached or unreadable
 */
export function reportedBranch({
  branchFlag,
  repoRoot,
}: {
  branchFlag: string | undefined;
  repoRoot: string;
}): string | null {
  if (branchFlag !== undefined) {
    return branchFlag;
  }
  const current = currentBranch({ cwd: repoRoot });
  if (current.isErr()) {
    return null;
  }
  return current.value;
}
