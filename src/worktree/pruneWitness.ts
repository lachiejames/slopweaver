/**
 * The three witnesses a removal rests on when a tree's own branch or a remote holds its work, each an exact
 * reading of the scan's facts with no `null` let through. `pruneClassify.ts` reads them; they live apart so
 * the hold contract there stays one screen.
 */
import type { WorktreeFacts } from "./pruneClassify.js";

/**
 * Whether this is a detached HEAD whose own commit a named remote-tracking ref still carries.
 *
 * The witness behind the `detached` class. It is read by ONE hold rule — the one that would otherwise hold
 * every detached HEAD outright — and by the classifier's shape decision. The merge-state and unbacked-count rules used
 * to consult it too, as the narrowest way to say "this question cannot be asked of a tree with no branch";
 * they now say that directly, which is both what they meant and what keeps them correct once the week-old
 * waiver lets a NON-recreatable detached tree reach them.
 *
 * @param facts the gathered facts
 * @returns true only when the tree is detached, present, and its commit is contained by a remote ref
 */
export function recreatableDetached({ facts }: { facts: WorktreeFacts }): boolean {
  return facts.branch === null && !facts.missing && facts.headSha !== null && facts.headOnRemoteRef !== null;
}

/**
 * Whether everything in this tree is on its own remote branch, so a run is resumable without it.
 *
 * Every clause is an exact reading, never a `null` let through: the tree is clean, hides no edit, carries
 * no commit a remote lacks, and its branch has its own remote branch at or ahead of it.
 *
 * @param facts the gathered facts
 * @returns true only when removing the tree could lose nothing its remote branch does not hold
 */
export function resumableFromItsBranch({ facts }: { facts: WorktreeFacts }): boolean {
  return (
    facts.branch !== null &&
    facts.branchOnOwnRemote === true &&
    facts.dirtyCount === 0 &&
    facts.hiddenFromStatus === 0 &&
    facts.unbackedCommits === 0
  );
}

/**
 * Whether every commit this tree's HEAD reaches is on the branch's own remote branch, dirt aside.
 *
 * The witness behind finishing a PUSHED gutted tree (owner: a tree is held only for uncommitted or
 * unpushed work). A deletion-only tree loses no byte HEAD lacks, and this says HEAD's commits are all on
 * `origin/<branch>`; the branch ref is KEPT besides, exactly as for `pushed`. Nothing hidden from status, since
 * a hidden edit is content HEAD does not hold. Every clause is an exact reading, never a `null` let through.
 *
 * @param facts the gathered facts
 * @returns true only when the branch's own remote branch carries every commit and nothing is hidden
 */
export function headOnOwnRemote({ facts }: { facts: WorktreeFacts }): boolean {
  return (
    facts.branch !== null &&
    facts.branchOnOwnRemote === true &&
    facts.hiddenFromStatus === 0 &&
    facts.unbackedCommits === 0
  );
}
