/**
 * Deleting the branch a removed tree had out — only at a tip the trunk carries.
 *
 * Split out of `pruneApply.ts` when that file passed the size ratchet. The tree removal and the branch deletion
 * are separate decisions with separate hazards: this half is the one where a wrong "yes" leaves a commit on no ref.
 */
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { heldBranchesAnywhere } from "../cmux/worktreeHeldBranch.js";
import { parseWorktreeListPorcelain } from "../cmux/worktreeList.js";
import { realGit } from "./pruneGit.js";
import { refusalOf } from "./pruneRefusal.js";
import { ORIGIN_HEAD, trunkRefOf } from "./pruneScan.js";

/**
 * Delete a branch ref only when the trunk provably carries its tip, and only at the tip that was checked.
 *
 * Not `git branch -d`, whose "merged" means merged into the branch's configured UPSTREAM when one resolves — and
 * the upstream is the repository's to configure. The r2 Codex review set `branch.<b>.remote=.` and
 * `branch.<b>.merge=refs/heads/<b>`, making the branch its own upstream, and `-d` deleted the only ref to a commit
 * the trunk did not carry. Overriding the upstream does not close it, measured on git 2.54.0: an empty
 * `-c branch.<b>.remote=` crashes git (SIGSEGV), `branch.<b>.merge` is multi-valued so an override appends behind
 * the repository's own, and any remote NAME is one the repository can define.
 *
 * So the question is asked directly. The trunk is read now, fully qualified, and both tips are pinned; the tip
 * must be an ancestor of the trunk's with replace refs ignored; no worktree may still have the branch out, which
 * is the one protection `-d` gave that a ref deletion does not; and the deletion is one `update-ref` transaction
 * that verifies `origin/HEAD` still names that trunk, that the trunk still holds its tip, and deletes the branch
 * only at its own, so any of the three moved since fails the whole transaction — the r1 Codex review retargeted
 * `origin/HEAD` between the read and the delete. `symref-verify` arrived in git 2.46; an older git refuses the
 * whole transaction and the branch is kept. A squash-merged branch is never an ancestor, so it keeps its
 * forty-byte ref, as it always did under `-d`.
 *
 * What it does not close, by construction: an object store that lies. The r1 fallback review planted a trunk
 * commit whose bytes do not hash to its name and whose parent is the branch tip, and the walk believed it, because
 * git rehashes only the two commits named on the command line. `git fsck --full` reports it as a hash-path
 * mismatch. Only something writing into `.git/objects` by hand can plant one, and that writer could delete the ref
 * directly; rehashing every commit on the trunk's path down to the tip would close it.
 *
 * @param branch the branch the removed tree had out
 * @param repoRoot the repository holding it
 * @returns whether the ref went, and why it was kept when it did not
 */
export function deleteBranchInTrunk({ branch, repoRoot }: { branch: string; repoRoot: string }): {
  deleted: boolean;
  declined: string | null;
} {
  const kept = ({ why }: { why: string }): { deleted: boolean; declined: string | null } => ({
    declined: why,
    deleted: false,
  });
  const trunk = trunkRefOf({ repoRoot });
  if (trunk === null) {
    return kept({ why: "the trunk ref could not be read" });
  }
  const branchRef = `refs/heads/${branch}`;
  if (trunk === branchRef || !allDirect({ refs: [trunk, branchRef], repoRoot })) {
    return kept({ why: "the trunk resolves to the branch itself, or either is a symbolic ref, or git could not say" });
  }
  if (!looseNameExact({ branchRef, repoRoot })) {
    return kept({ why: "the disk answers its loose ref with a file of another name, or could not say" });
  }
  const tip = realGit({ args: ["rev-parse", "--verify", "--quiet", `${branchRef}^{commit}`], cwd: repoRoot });
  const trunkTip = realGit({ args: ["rev-parse", "--verify", "--quiet", `${trunk}^{commit}`], cwd: repoRoot });
  if (tip === null || trunkTip === null || tip.length === 0 || trunkTip.length === 0) {
    return kept({ why: "its tip or the trunk's could not be read" });
  }
  // A rebase or bisect holds its branch while the tree is detached, and `update-ref` skips git's own refusal for it.
  if (heldOrCheckedOut({ branch, repoRoot }) !== false) {
    return kept({
      why: "another worktree has it checked out or a rebase or bisect there holds it, or the worktree list could not be read",
    });
  }
  // `merge-base --is-ancestor` prints nothing and exits 0 for yes, 1 for no; the runner reads any non-zero as null.
  // Parents come from the commits themselves: replace refs, grafts (`realGit`) and the commit-graph file can each
  // name others, and the r1 review's forged commit-graph parent made a divergent tip read as the trunk's ancestor.
  const inTrunk = realGit({
    args: ["--no-replace-objects", "-c", "core.commitGraph=false", "merge-base", "--is-ancestor", tip, trunkTip],
    cwd: repoRoot,
  });
  if (inTrunk === null) {
    return kept({ why: `its tip is not in ${trunk}, which a squash merge leaves it, or git could not say` });
  }
  // `symref-verify` needs `--no-deref`, which also deletes a symbolic branch ref rather than the branch it names.
  const refusal = refusalOf({
    args: ["update-ref", "--no-deref", "--stdin"],
    cwd: repoRoot,
    stdin: `symref-verify ${ORIGIN_HEAD} ${trunk}\nverify ${trunk} ${trunkTip}\ndelete ${branchRef} ${tip}\n`,
  });
  return refusal === null ? { declined: null, deleted: true } : kept({ why: refusal });
}

/**
 * Whether any worktree has a branch checked out, or a rebase or bisect anywhere in the repository holds it. Every
 * listed tree counts, snapshot-pool slots included, and the holds are read from every admin directory rather than
 * through a listed path, which hid a slot's bisect and one of two records naming a path.
 *
 * It answers at the moment it reads. A checkout, rebase or bisect started between this read and the `update-ref`
 * is not seen, exactly as main's checked-out test never saw one: git takes no lock a reader could
 * hold across both, and the transaction's own verifies cover refs, never a worktree's state files.
 *
 * @param branch the branch about to be deleted
 * @param repoRoot the repository holding it
 * @returns true when something holds it, `null` when git could not say
 */
function heldOrCheckedOut({ branch, repoRoot }: { branch: string; repoRoot: string }): boolean | null {
  const text = realGit({ args: ["worktree", "list", "--porcelain"], cwd: repoRoot });
  // Untrimmed bar git's own newline: a directory name may end in a space.
  const printed = realGit({
    args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    cwd: repoRoot,
    untrimmed: true,
  });
  if (text === null || printed === null) {
    return null;
  }
  if (parseWorktreeListPorcelain({ text }).some((worktree) => worktree.branch === branch)) {
    return true;
  }
  const held = heldBranchesAnywhere({ repository: { commonDir: printed.replace(/\n$/u, ""), cwd: repoRoot } });
  if (held === null) {
    return null;
  }
  return held.includes(branch);
}

/**
 * Whether the disk holds a branch's loose ref under exactly its name, or holds no loose file for it at all.
 *
 * Git reads a loose ref before a packed one, and a folding filesystem answers one name with another's file: the r3
 * fallback reviews packed the branch at an unpushed commit, wrote a twin at a trunk commit, and every read of the
 * branch saw the trunk's, so the ancestry check passed and the delete took the packed entry too, leaving the commit
 * on no ref. A plain case twin did it first; a final sigma, a long s and a `refs/HEADS/` directory did it again past
 * a `toLowerCase` comparison, because the disk folds differently. `git branch -d` on main lost the commit each time.
 * So the disk is asked rather than imitated: every component must be listed in its directory byte for byte, or the
 * path must not exist — a reftable repository has no loose files and passes.
 *
 * @param branchRef the fully-qualified branch about to be deleted
 * @param repoRoot the repository holding it
 * @returns false when a component resolves under another name, or the disk could not be read
 */
function looseNameExact({ branchRef, repoRoot }: { branchRef: string; repoRoot: string }): boolean {
  const common = realGit({ args: ["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd: repoRoot });
  if (common === null || common.length === 0) {
    return false;
  }
  let dir = common;
  for (const part of branchRef.split("/")) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch (error) {
      return nothingThere({ error });
    }
    if (!names.includes(part)) {
      try {
        lstatSync(join(dir, part));
        return false;
      } catch (error) {
        return nothingThere({ error });
      }
    }
    dir = join(dir, part);
  }
  return true;
}

/**
 * Whether a filesystem error says the path is simply not there, rather than unreadable.
 *
 * @param error what `readdirSync` or `lstatSync` threw
 * @returns true for a missing entry or a file where a directory was expected
 */
function nothingThere({ error }: { error: unknown }): boolean {
  const code = error instanceof Error && "code" in error ? error.code : null;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Whether every named ref exists and holds an object rather than naming another ref.
 *
 * `verify` and `delete` match a symbolic ref by the object it resolves to, so the transaction cannot tell. The r3
 * Codex review chained `origin/HEAD` → `origin/main` → the branch, so every tip check passed against the branch
 * itself; `symbolic-ref` follows that chain to its end, which is why the caller also refuses a trunk that IS the
 * branch. The read sits just before the transaction; a ref turned symbolic between the two is the residue, and a
 * symbolic BRANCH then deleted is only a name, its referent untouched.
 *
 * @param refs fully-qualified refs, each read exactly
 * @param repoRoot the repository holding them
 * @returns true only when git listed every one with no symbolic target
 */
function allDirect({ refs, repoRoot }: { refs: readonly string[]; repoRoot: string }): boolean {
  const listing = realGit({ args: ["for-each-ref", "--format=%(refname)%00%(symref)", ...refs], cwd: repoRoot });
  if (listing === null) {
    return false;
  }
  const targets = new Map(listing.split("\n").map((line) => [line.split("\0")[0], line.split("\0")[1]] as const));
  return refs.every((ref) => targets.get(ref) === "");
}
