/**
 * What the prune asks a remote itself, over the wire, rather than this clone's memory of it.
 *
 * Split out of `pruneGit.ts` when that file passed the size ratchet: the working-tree reads and the remote
 * reads are separate concerns, and only this half leaves the machine.
 */

import type { GitRunner } from "./pruneGit.js";

/**
 * The ONE remote prune trusts as a backup and salvages to: every "is this pushed" read names it, and so does the
 * salvage push, so the remote that excuses a tree is the remote its work would be sent to.
 *
 * **Every other remote is ignored, and that is the safety rather than a narrowing.** A checkout can carry a remote
 * of a DIFFERENT history: this repository's own checkout keeps `archive`, the pre-cut history, beside `origin`, the
 * public one, and the two share no commit (`git merge-base origin/main archive/main` exits 1). Counted as a backup,
 * `archive` excused every old-history branch as pushed; and a tree excused as "on no remote" past the week is
 * salvaged to THIS remote, so the two reads must name the same one. A branch carried only by a second remote of the
 * same URL (`public`, here) reads as unpushed and is held, which is the conservative direction: URL equality is
 * configuration that can change.
 */
export const PRUNE_REMOTE = "origin";

/**
 * Whether {@link PRUNE_REMOTE}, asked over the wire NOW, still has a branch containing a commit.
 *
 * A remote-tracking ref is this clone's memory of a remote, not the remote: GitHub deletes a branch on merge
 * and `refs/remotes/origin/<branch>` keeps saying it carries the commit until a `fetch --prune`. The r2
 * Codex review removed a detached tree whose HEAD only such a stale ref held, so this asks the remote,
 * with `ls-remote`, for the branches the local refs name, and counts one only when its tip is here and
 * descends from the commit. A tip this clone has not fetched cannot be checked and does not count, and a
 * remote git could not reach answers nothing — both keep the tree, which the next run asks about again.
 * Only {@link PRUNE_REMOTE}'s refs are read: a branch on any other remote carries nothing here.
 *
 * @param git how to run git
 * @param headSha the commit that must still be carried
 * @param repoRoot the repository whose remote to ask
 * @returns true only when a live {@link PRUNE_REMOTE} branch contains `headSha`
 */
export function remoteStillCarries({
  git,
  headSha,
  repoRoot,
}: {
  git: GitRunner;
  headSha: string;
  repoRoot: string;
}): boolean {
  const refs = git({
    args: ["for-each-ref", "--contains", headSha, "--format=%(refname)", `refs/remotes/${PRUNE_REMOTE}/`],
    cwd: repoRoot,
  });
  if (refs === null) {
    return false;
  }
  const branches = branchesByRemote({ refs, remotes: PRUNE_REMOTE }).get(PRUNE_REMOTE);
  if (branches === undefined) {
    return false;
  }
  const listing = git({ args: ["ls-remote", PRUNE_REMOTE, ...branches], cwd: repoRoot });
  return (
    listing !== null &&
    liveTips({ branches, listing }).some(
      (tip) => git({ args: ["merge-base", "--is-ancestor", headSha, tip], cwd: repoRoot }) !== null,
    )
  );
}

/**
 * The remote branches a list of remote-tracking refs names, grouped by the remote that owns each.
 *
 * Pure. The longest remote name claims a ref first, so a remote named `a/b` takes `refs/remotes/a/b/x` before
 * a remote named `a` does, and a `<remote>/HEAD` symref is no branch.
 *
 * @param refs `for-each-ref --format=%(refname)` output, one full ref name per line
 * @param remotes `git remote` output, one name per line
 * @returns each remote's `refs/heads/<branch>` names
 */
export function branchesByRemote({
  refs,
  remotes,
}: {
  refs: string;
  remotes: string;
}): ReadonlyMap<string, readonly string[]> {
  const names = remotes
    .split("\n")
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .toSorted((left, right) => right.length - left.length);
  const out = new Map<string, string[]>();
  for (const ref of refs.split("\n")) {
    const short = ref.trim().slice("refs/remotes/".length);
    const remote = names.find((name) => short.startsWith(`${name}/`));
    if (remote === undefined || short === `${remote}/HEAD`) {
      continue;
    }
    const branch = `refs/heads/${short.slice(remote.length + 1)}`;
    const known = out.get(remote);
    if (known === undefined) {
      out.set(remote, [branch]);
    } else {
      known.push(branch);
    }
  }
  return out;
}

/**
 * The tips `ls-remote` reports for the asked branches, and only those.
 *
 * @param branches the `refs/heads/<branch>` names asked about
 * @param listing `ls-remote` output, `<sha> TAB <ref>` per line
 * @returns each asked branch's live tip sha
 */
function liveTips({ branches, listing }: { branches: readonly string[]; listing: string }): readonly string[] {
  return listing.split("\n").flatMap((line) => {
    const [tip, name] = line.split("\t");
    return tip !== undefined && name !== undefined && branches.includes(name) ? [tip] : [];
  });
}
