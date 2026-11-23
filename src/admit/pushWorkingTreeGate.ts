/**
 * The effectful half of the push-time working-tree gate: read `git status --porcelain`, judge it with
 * `./prePushWorkingTree.ts`, and hand back one refusal a caller can print.
 *
 * Its own module because both push paths consult it — `github push`'s `inspectGithubPushPlan`, so the verb
 * (including `--dry-run`) refuses before it claims it would push anything, and `./githubPush.ts`'s
 * `pushAndVerify`, which is the choke point every `stack push`/`adopt`/`sync` and a worktree salvage reach the
 * transport through.
 */
import { err, ok, type Result } from "../lib/result.js";
import { type GithubPushDoorError, GithubPushDoorErrors } from "./githubPushErrors.js";
import { prePushWorkingTreeRefusal } from "./prePushWorkingTree.js";

/**
 * Whether the working tree is the same subject as the commit a push would send.
 *
 * A pre-push gate reads the FILES ON DISK; `git push` sends the COMMIT. When those differ, a green gate is
 * about code that stays behind — measured, where a typecheck fix sat uncommitted on top of a
 * red commit. A `git status` that cannot be read refuses too: "clean" is a claim, not a default.
 *
 * @param readGit the caller's own isolated Git reader, so `cwd` alone decides the repository
 * @param repoRoot the repository root the push is about
 * @returns nothing when the tree matches HEAD, or the refusal to print
 */
export function refuseDirtyWorkingTree({
  readGit,
  repoRoot,
}: {
  readGit: (args: { cwd: string; args: readonly string[] }) => string;
  repoRoot: string;
}): Result<void, GithubPushDoorError> {
  let statusPorcelain: string;
  try {
    statusPorcelain = readGit({ args: ["status", "--porcelain"], cwd: repoRoot });
  } catch (error: unknown) {
    return err(
      GithubPushDoorErrors.workingTreeUnread({ cause: error instanceof Error ? error.message : String(error) }),
    );
  }
  const refusal = prePushWorkingTreeRefusal({ statusPorcelain });
  return refusal.length === 0 ? ok(undefined) : err(GithubPushDoorErrors.workingTreeDirty({ refusal }));
}
