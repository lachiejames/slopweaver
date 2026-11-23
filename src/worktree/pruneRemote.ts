/**
 * What the prune asks a remote itself, over the wire, rather than this clone's memory of it.
 *
 * Split out of `pruneGit.ts` when that file passed the size ratchet: the working-tree reads and the remote
 * reads are separate concerns, and only this half leaves the machine.
 */

import type { GitRunner } from "./pruneGit.js";

/**
 * Whether a remote, asked over the wire NOW, still has a branch containing a commit.
 *
 * A remote-tracking ref is this clone's memory of a remote, not the remote: GitHub deletes a branch on merge
 * and `refs/remotes/origin/<branch>` keeps saying it carries the commit until a `fetch --prune`. The r2
 * Codex review removed a detached tree whose HEAD only such a stale ref held, so this asks each remote,
 * with `ls-remote`, for the branches the local refs name, and counts one only when its tip is here and
 * descends from the commit. A tip this clone has not fetched cannot be checked and does not count, and a
 * remote git could not reach answers nothing — both keep the tree, which the next run asks about again.
 *
 * @param git how to run git
 * @param headSha the commit that must still be carried
 * @param repoRoot the repository whose remotes to ask
 * @returns true only when a live remote branch contains `headSha`
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
    args: ["for-each-ref", "--contains", headSha, "--format=%(refname)", "refs/remotes/"],
    cwd: repoRoot,
  });
  const remotes = git({ args: ["remote"], cwd: repoRoot });
  if (refs === null || remotes === null) {
    return false;
  }
  return [...branchesByRemote({ refs, remotes })].some(([remote, branches]) => {
    const listing = git({ args: ["ls-remote", remote, ...branches], cwd: repoRoot });
    return (
      listing !== null &&
      liveTips({ branches, listing }).some(
        (tip) => git({ args: ["merge-base", "--is-ancestor", headSha, tip], cwd: repoRoot }) !== null,
      )
    );
  });
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
