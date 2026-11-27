/**
 * The salvage's ancestry refusal: a commit sharing no history with the remote's own trunk is never pushed.
 *
 * **The refusal this exists for is a push of ANOTHER history to the remote.** A checkout can hold a branch of a
 * history the remote never had — this repository keeps its pre-cut history on an `archive` remote beside the public
 * `origin`, and `git merge-base origin/main archive/main` exits 1. Salvaging a tree on such a branch would push that
 * whole history, organisation names and all, to the public repository as one `salvage/…` branch. A commit with ANY
 * merge base with the trunk is this repository's work; one with none is not, and nothing a salvage does may send it.
 */
import type { GithubPushEdges } from "../admit/githubPush.js";
import { HOOKS_OFF } from "./salvagePush.js";

/**
 * Why a salvage must decline a commit that shares no history with the remote's trunk, or `null` when it shares some.
 *
 * Asked BEFORE any salvage name is probed or branch minted, so a tree of another history is left exactly as found.
 *
 * @param deps the git edges
 * @param headSha the commit the salvage branch would be minted at
 * @param path the worktree to ask in
 * @param remote the remote whose trunk the history must share
 * @returns the decline that keeps the tree, or `null` when the salvage may go on
 */
export function unrelatedHistoryDecline({
  deps,
  headSha,
  path,
  remote,
}: {
  deps: GithubPushEdges;
  headSha: string;
  path: string;
  remote: string;
}): string | null {
  if (sharesTrunkHistory({ deps, headSha, path, remote })) {
    return null;
  }
  return `its HEAD shares no history with ${remote}'s trunk (refs/remotes/${remote}/HEAD), or that trunk could not be read — nothing was pushed`;
}

/**
 * Whether the commit a salvage would push shares any history with the remote's own trunk.
 *
 * The exact sha the capture read is asked, never `HEAD`, so a tree moved since cannot answer for it. Replace refs,
 * grafts and the commit-graph file are switched off, as the branch deletion's ancestry check does, because each could
 * invent a parent the commits do not carry. A missing `<remote>/HEAD` throws like an unrelated history does, and both
 * refuse: a trunk that could not be read has not shown the history is shared.
 *
 * @param deps the git edges
 * @param headSha the commit the salvage branch would be minted at
 * @param path the worktree to ask in
 * @param remote the remote whose trunk the history must share
 * @returns true only when git printed a merge base
 */
function sharesTrunkHistory({
  deps,
  headSha,
  path,
  remote,
}: {
  deps: GithubPushEdges;
  headSha: string;
  path: string;
  remote: string;
}): boolean {
  try {
    const base = deps.readGit({
      args: [
        ...HOOKS_OFF,
        "--no-replace-objects",
        "-c",
        "core.commitGraph=false",
        "merge-base",
        headSha,
        `refs/remotes/${remote}/HEAD`,
      ],
      cwd: path,
    });
    return base.trim().length > 0;
  } catch {
    return false;
  }
}
