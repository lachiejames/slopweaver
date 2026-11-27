/**
 * The salvage's history refusal: a commit reaching any root commit the remote's live trunk does not is never pushed.
 *
 * **The refusal this exists for is a push of ANOTHER history to the remote.** A checkout can hold a branch of a
 * history the remote never had — this repository keeps its pre-cut history on an `archive` remote beside the public
 * `origin`, and `git merge-base origin/main archive/main` exits 1. Salvaging a tree on such a branch would push that
 * whole history, organisation names and all, to the public repository as one `salvage/…` branch.
 *
 * **Sharing a merge base is not the test, because it is too weak.** A branch cut from the trunk that then merged the
 * archive in still has a merge base with the trunk, and pushing it sends the archive whole. The test is the ROOT set:
 * every commit with no parent that the sha reaches must be a root of the trunk too. Any foreign history brings a root
 * of its own, so it fails however it was joined on.
 *
 * **The trunk is what the remote says its HEAD is NOW**, asked with `ls-remote -- <url> HEAD`, never the local
 * `refs/remotes/<remote>/HEAD`: that symref is a file anything can re-point at `archive/main`. The url asked is bound
 * ONCE, by `./salvageDestination`'s `resolveBoundUrl`, before the trunk is read, and the push refuses unless the
 * destination it resolves is that same url. A remote that cannot be asked, or a trunk commit not fetched here yet,
 * fails closed.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { GithubPushEdges } from "../admit/githubPush.js";
import { err, ok, type Result } from "../lib/result.js";
import { resolveBoundUrl } from "./salvageDestination.js";
import { HOOKS_OFF } from "./salvageHooksOff.js";
import { type SalvageTrunkError, SalvageTrunkErrors } from "./salvageTrunkErrors.js";

/**
 * Every ancestry read: replace refs and the commit-graph file off, because either could invent or hide a parent the
 * commits do not carry. A grafts file can too, and git has no per-command flag for it, so a repository carrying one
 * declines outright ({@link graftsAbsent}). A shallow boundary is left on, because it can only cost a decline, never
 * a pass: a boundary commit reads as a root, so the sha's root set grows by every boundary it reaches, and one the
 * trunk does not also reach is a foreign root.
 */
const ANCESTRY: readonly string[] = [...HOOKS_OFF, "--no-replace-objects", "-c", "core.commitGraph=false"];

/** What the history check accepted: the HEAD, the live trunk it was judged against, and the url that trunk came from. */
export interface CheckedHistory {
  readonly head: string;
  readonly trunk: string;
  readonly url: string;
}

/**
 * The tree's HEAD, checked to reach no root commit the remote's live trunk lacks, or why a salvage must decline it.
 *
 * Asked FIRST, before the capture clears an index bit or anything else writes, so a tree of another history is left
 * exactly as found. The capture then re-reads HEAD before its first write and must find this same sha, or declines.
 *
 * @param deps the git edges
 * @param path the worktree to ask in
 * @param remote the remote whose live trunk the history must stay within
 * @returns what was checked, or the typed decline that keeps the tree
 */
export function trunkHistoryHead({
  deps,
  path,
  remote,
}: {
  deps: GithubPushEdges;
  path: string;
  remote: string;
}): Result<CheckedHistory, SalvageTrunkError> {
  let head = "";
  try {
    head = deps.readGit({ args: [...HOOKS_OFF, "rev-parse", "HEAD"], cwd: path }).trim();
  } catch (error: unknown) {
    return err(SalvageTrunkErrors.headUnreadable({ cause: error }));
  }
  if (head === "") {
    return err(SalvageTrunkErrors.headUnreadable({ cause: new Error("it answered nothing") }));
  }
  const bound = resolveBoundUrl({ deps, path, remote });
  if (bound.isErr()) {
    return err(SalvageTrunkErrors.destinationUnbound({ destination: bound.error }));
  }
  const url = bound.value;
  const trunk = liveTrunk({ deps, path, remote, url });
  if (trunk.isErr()) {
    return err(trunk.error);
  }
  return rootsWithinTrunk({ deps, path, remote, sha: head, trunk: trunk.value }).map(() => ({
    head,
    trunk: trunk.value,
    url,
  }));
}

/**
 * The commit `url` says its HEAD is right now — exactly one, or a read failure.
 *
 * @param deps the git edges
 * @param path the worktree to ask in
 * @param remote the remote, for the decline
 * @param url the bound url to ask
 * @returns the trunk sha, or why it could not be read
 */
function liveTrunk({
  deps,
  path,
  remote,
  url,
}: {
  deps: GithubPushEdges;
  path: string;
  remote: string;
  url: string;
}): Result<string, SalvageTrunkError> {
  let listing: string;
  try {
    listing = deps.readGit({ args: [...HOOKS_OFF, "ls-remote", "--", url, "HEAD"], cwd: path });
  } catch (error: unknown) {
    return err(SalvageTrunkErrors.trunkUnreadable({ cause: error, remote }));
  }
  // Not `./salvageScan`'s `remoteTips`: that module reaches `./pruneSalvage`, which imports this one.
  const tips = listing
    .split("\n")
    .map((line) => /^([0-9a-f]{40}|[0-9a-f]{64})\tHEAD$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[1]!);
  if (tips.length !== 1) {
    const answered = new Error(`ls-remote named ${String(tips.length)} HEAD commit(s)`);
    return err(SalvageTrunkErrors.trunkUnreadable({ cause: answered, remote }));
  }
  return ok(tips[0]!);
}

/**
 * Whether the repository carries no grafts file. One rewires the parents every ancestry read reports, so a foreign
 * commit grafted onto a trunk commit lists no root of its own and the root test would pass it; only the receiving
 * end's connectivity check would then stop the push. `rev-parse --git-path` names where git looks, `GIT_GRAFT_FILE`
 * and a linked worktree's common directory included.
 *
 * @param deps the git edges
 * @param path the worktree to ask in
 * @param sha the commit being judged, for a failed read
 * @returns ok when git would read no grafts, else the decline
 */
function graftsAbsent({
  deps,
  path,
  sha,
}: {
  deps: GithubPushEdges;
  path: string;
  sha: string;
}): Result<void, SalvageTrunkError> {
  let graftFile: string;
  try {
    graftFile = deps.readGit({ args: [...HOOKS_OFF, "rev-parse", "--git-path", "info/grafts"], cwd: path }).trim();
  } catch (error: unknown) {
    return err(SalvageTrunkErrors.historyUnreadable({ cause: error, sha }));
  }
  if (graftFile === "") {
    return err(SalvageTrunkErrors.historyUnreadable({ cause: new Error("git named no grafts path"), sha }));
  }
  return existsSync(resolve(path, graftFile)) ? err(SalvageTrunkErrors.grafted({ graftFile })) : ok(undefined);
}

/**
 * Whether every root commit `sha` reaches is a root of the trunk, in a repository carrying no grafts.
 *
 * The trunk's roots are listed first, so a trunk commit not fetched here is a read failure rather than a verdict.
 *
 * @param deps the git edges
 * @param path the worktree to ask in
 * @param remote the remote, for the decline
 * @param sha the commit whose history is judged
 * @param trunk the live trunk commit it is judged against
 * @returns ok when no root is foreign, else the read failure or the verdict
 */
function rootsWithinTrunk({
  deps,
  path,
  remote,
  sha,
  trunk,
}: {
  deps: GithubPushEdges;
  path: string;
  remote: string;
  sha: string;
  trunk: string;
}): Result<void, SalvageTrunkError> {
  const grafts = graftsAbsent({ deps, path, sha });
  if (grafts.isErr()) {
    return grafts;
  }
  const roots = ({ of }: { of: string }): readonly string[] =>
    deps
      .readGit({ args: [...ANCESTRY, "rev-list", "--max-parents=0", of], cwd: path })
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
  let trunkRoots: ReadonlySet<string>;
  try {
    trunkRoots = new Set(roots({ of: trunk }));
  } catch (error: unknown) {
    return err(SalvageTrunkErrors.trunkUnreadable({ cause: error, remote }));
  }
  let reached: readonly string[];
  try {
    reached = roots({ of: sha });
  } catch (error: unknown) {
    return err(SalvageTrunkErrors.historyUnreadable({ cause: error, sha }));
  }
  if (trunkRoots.size === 0) {
    return err(SalvageTrunkErrors.trunkUnreadable({ cause: new Error("git listed no root commit"), remote }));
  }
  if (reached.length === 0) {
    return err(SalvageTrunkErrors.historyUnreadable({ cause: new Error("git listed no root commit"), sha }));
  }
  const foreign = reached.filter((root) => !trunkRoots.has(root));
  return foreign.length > 0 ? err(SalvageTrunkErrors.foreignRoot({ remote, roots: foreign })) : ok(undefined);
}

/**
 * The exit status a failed git read carried, when it carried one.
 *
 * @param error what the read threw
 * @returns the status, or null for a read that was killed, timed out or never ran
 */
function exitStatus({ error }: { error: unknown }): number | null {
  if (typeof error === "object" && error !== null && "status" in error && typeof error.status === "number") {
    return error.status;
  }
  return null;
}

/**
 * The sha a salvage pushes, read now, held to DESCEND from the checked HEAD and to reach no root the trunk lacks.
 *
 * The capture's commit is a child of that HEAD, so a salvage that ran undisturbed always passes. One whose tree was
 * reset, re-pointed or merged into by another process after the check is pushing a commit nobody checked: a sibling
 * of the checked HEAD declines on descent, and a merge of another history declines on its roots. `merge-base
 * --is-ancestor` answers its verdict as exit 1; any other failure is a read that showed nothing, and says so.
 *
 * @param checked what the history check accepted
 * @param deps the git edges
 * @param path the worktree to read in
 * @param remote the remote, for the decline
 * @returns the sha to push, or why nothing is pushed
 */
export function pushableSha({
  checked,
  deps,
  path,
  remote,
}: {
  checked: CheckedHistory;
  deps: GithubPushEdges;
  path: string;
  remote: string;
}): Result<string, SalvageTrunkError> {
  let sha = "";
  try {
    sha = deps.readGit({ args: [...HOOKS_OFF, "rev-parse", "HEAD"], cwd: path }).trim();
  } catch (error: unknown) {
    return err(SalvageTrunkErrors.pushShaUnreadable({ cause: error }));
  }
  try {
    deps.readGit({ args: [...ANCESTRY, "merge-base", "--is-ancestor", checked.head, sha], cwd: path });
  } catch (error: unknown) {
    if (exitStatus({ error }) === 1) {
      return err(SalvageTrunkErrors.notDescendant());
    }
    return err(SalvageTrunkErrors.ancestryUnreadable({ cause: error, sha }));
  }
  return rootsWithinTrunk({ deps, path, remote, sha, trunk: checked.trunk }).map(() => sha);
}
