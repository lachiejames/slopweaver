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
import { err, ok, type Result } from "../lib/result.js";
import { HOOKS_OFF } from "./salvagePush.js";

/** The tree's HEAD could not be read at all. */
interface TreeUnreadableError {
  readonly code: "TREE_UNREADABLE";
  readonly message: string;
}

/** git answered HEAD with nothing. */
interface HeadUnreadableError {
  readonly code: "HEAD_UNREADABLE";
  readonly message: string;
}

/** The HEAD shares no merge base with the remote's trunk, or that trunk could not be read. */
interface UnrelatedHistoryError {
  readonly code: "UNRELATED_HISTORY";
  readonly message: string;
  readonly remote: string;
}

/** Why a salvage declines before it writes anything, on the history check. */
export type SalvageTrunkError = HeadUnreadableError | TreeUnreadableError | UnrelatedHistoryError;

/** The one way each {@link SalvageTrunkError} is built, so its message is the decline a salvage prints. */
export const SalvageTrunkErrors = {
  headUnreadable: (): HeadUnreadableError => ({
    code: "HEAD_UNREADABLE",
    message: "its HEAD sha could not be read, so there is nothing to push",
  }),
  treeUnreadable: (): TreeUnreadableError => ({
    code: "TREE_UNREADABLE",
    message: "its working tree could not be read at apply time, so nothing was captured",
  }),
  unrelatedHistory: ({ remote }: { remote: string }): UnrelatedHistoryError => ({
    code: "UNRELATED_HISTORY",
    message: `its HEAD shares no history with ${remote}'s trunk (refs/remotes/${remote}/HEAD), or that trunk could not be read — nothing was pushed`,
    remote,
  }),
} as const;

/**
 * The tree's HEAD, checked to share history with the remote's trunk, or why a salvage must decline it.
 *
 * Asked FIRST, before the capture clears an index bit or anything else writes, so a tree of another history is left
 * exactly as found. The capture then re-reads HEAD and must find this same sha, or it declines too.
 *
 * @param deps the git edges
 * @param path the worktree to ask in
 * @param remote the remote whose trunk the history must share
 * @returns the checked HEAD sha, or the typed decline that keeps the tree
 */
export function trunkHistoryHead({
  deps,
  path,
  remote,
}: {
  deps: GithubPushEdges;
  path: string;
  remote: string;
}): Result<string, SalvageTrunkError> {
  let headSha = "";
  try {
    headSha = deps.readGit({ args: [...HOOKS_OFF, "rev-parse", "HEAD"], cwd: path }).trim();
  } catch {
    return err(SalvageTrunkErrors.treeUnreadable());
  }
  if (headSha === "") {
    return err(SalvageTrunkErrors.headUnreadable());
  }
  if (!sharesTrunkHistory({ deps, headSha, path, remote })) {
    return err(SalvageTrunkErrors.unrelatedHistory({ remote }));
  }
  return ok(headSha);
}

/**
 * Whether the commit a salvage would push shares any history with the remote's own trunk.
 *
 * The exact sha read is asked, never `HEAD`, so a tree moved since cannot answer for it. Replace refs, grafts and the
 * commit-graph file are switched off, as the branch deletion's ancestry check does, because each could invent a
 * parent the commits do not carry. A missing `<remote>/HEAD` throws like an unrelated history does, and both refuse:
 * a trunk that could not be read has not shown the history is shared.
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
