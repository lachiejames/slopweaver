/**
 * Which tree a pass record may claim to have read — the rules, with no filesystem under them.
 *
 * Split out of `./orchestrate.ts` because the two arms had drifted apart while looking symmetrical, and the
 * difference was invisible where it lived: private to an effectful module with no test of its own. The plan
 * arm brackets its freeze and compares three readings ({@link stableTree}); the review arm called
 * `capturePassTree` once, INSIDE the per-property pass, and recorded whatever that read.
 *
 * **The asymmetry that is NOT a defect, stated first so it is not "fixed" later.** A plan pass reads the tree
 * itself, so its provenance is the tree at its own start. A review pass reads a DIFF frozen once for the
 * whole fan-out, byte-identically — so its provenance is the tree the DIFF came from, shared by every
 * property, and never the tree standing when that property's slot happened to open.
 */

import type { CodexPassTree } from "./types.js";

/**
 * Attach the frozen snapshot commit to a captured tree, when both are there.
 *
 * Neither half is guaranteed: tree capture is best-effort, and a pass that could not be snapshotted read the
 * live tree. Recording one without the other would claim provenance nobody took.
 *
 * @param captured the tree the record will carry, or undefined when there is none to carry
 * @param snapshotCommit the unreachable commit of the frozen copy, when one was made
 * @returns the tree with its snapshot commit, the bare tree, or undefined
 */
export function withSnapshotCommit({
  captured,
  snapshotCommit,
}: {
  captured: CodexPassTree | undefined;
  snapshotCommit: string | undefined;
}): CodexPassTree | undefined {
  if (captured === undefined || snapshotCommit === undefined) {
    return captured;
  }
  return { ...captured, snapshotCommit };
}

/**
 * The tree a PLAN pass read, or `undefined` when the three readings of it disagree.
 *
 * THREE readings, not two, and the third is what makes this sound. Bracketing the freeze with a `before` and
 * an `after` catches a checkout that moved and stayed moved — but a Codex review supplied the case it cannot
 * see: a writer that resets to B, lets the snapshot happen, and restores A leaves both endpoint captures
 * reading A while the frozen copy holds B. Two agreeing endpoints prove nothing about the middle.
 *
 * So what the SNAPSHOT HOLDS must agree too. That reading is not an endpoint — it is the content the pass will
 * actually open — so an A→B→A dance shows up as a frozen copy holding tree(B) against a live tree(A), and the
 * tree is recorded as uncaptured. `recordPassKey` cannot key a plan record with no tree, so a pass whose
 * provenance is ambiguous is never anyone's duplicate. A head that moved and came back also leaves the same
 * head over different content, which is why both fields are compared rather than the head alone.
 *
 * **The third reading is a CONTENT TREE, because a fingerprint of the copy was unsatisfiable on a dirty tree.**
 * It used to compare a `captureTreeFingerprint` of the snapshot worktree against `before.fingerprint`, and
 * those two digest different decompositions of the tree: the live digest is over `(HEAD^{tree}, the dirty
 * patch)` while inside the copy HEAD IS the snapshot commit and the worktree is clean, so the same call there
 * digests `(contentTree, "")`. They agree only when the patch is empty. MEASURED in a throwaway
 * repository: clean, both read the same fingerprint over one tree; one edit later, the live fingerprint
 * (that tree + 333 dirty bytes) differs from the copy's (a different content tree + 0). So that clause rejected EVERY dirty tree, the artifact recorded no tree, `freshnessOf`
 * read `unknown`, `unknown` is not `stale`, and `planFailures` — which wants a plan both STALE and READY —
 * could never be satisfied by a plan pass run from a dirty checkout. Which is nearly every plan pass: the
 * snapshot exists so the agent keeps writing.
 *
 * Comparing git's own content address of both sides holds dirty or clean, and it is STRICTLY STRONGER on the
 * one axis that looked like a loss: a scratch index built from `read-tree HEAD` carries no skip-worktree bit,
 * so it addresses content `git diff` will not report (`contentTreeSha`, `./snapshot.ts`). What it gives up is
 * one EXPLANATION — a content-tree mismatch has no `dirtyBytes`/`treeSha` decomposition to narrate — and no
 * detection at all. Both addresses are taken by the CALLER — `orchestrate.ts`'s `liveContentTreeOf` and
 * `TreeSnapshot.contentTree` — and named in prose rather than linked, so this module still imports nothing
 * from `./snapshot.ts` and still has no filesystem under it.
 *
 * @param before the capture taken immediately before the snapshot
 * @param after the capture taken immediately after it
 * @param snapshotContentTree git's content address of what the frozen copy holds, or undefined when no copy
 *   was made — never undefined when one was, because it is a byproduct of a `write-tree` that already
 *   succeeded
 * @param liveContentTree git's content address of the live tree, taken after the freeze, or undefined when it
 *   could not be taken
 * @returns `before` when every available reading agrees, otherwise undefined
 */
export function stableTree({
  after,
  before,
  liveContentTree,
  snapshotContentTree,
}: {
  after: CodexPassTree | undefined;
  before: CodexPassTree | undefined;
  liveContentTree: string | undefined;
  snapshotContentTree: string | undefined;
}): CodexPassTree | undefined {
  if (before === undefined || after === undefined) {
    return undefined;
  }
  if (before.headSha !== after.headSha || before.fingerprint !== after.fingerprint) {
    return undefined;
  }
  // No snapshot at all means the pass read the LIVE tree the two captures agree about — there is no third
  // reading, and nothing to disagree with. A snapshot that EXISTS is different, and this fails closed on it: a
  // live content tree that could not be taken is read as a disagreement rather than as "no third opinion",
  // because a Codex review built the case where excusing the first hides the second — a post-checkout hook
  // that both moves the snapshot to another commit AND breaks the reading has one cause for both.
  if (snapshotContentTree !== undefined && liveContentTree !== snapshotContentTree) {
    return undefined;
  }
  return before;
}

/**
 * The bracketed tree, but only when the DIFF observed the same HEAD the bracket did.
 *
 * The THIRD reading, which the review arm gets for free and was discarding. Two agreeing endpoint captures do
 * not prove the tree held still between them — a writer that commits and resets back leaves both endpoints
 * reading A while the read in the middle saw B, the same A→B→A dance {@link stableTree}'s content-tree
 * comparison exists to catch on the plan arm. Capturing a diff has no snapshot to address, but it has something
 * the plan arm does not: `captureReviewDiff` resolves its OWN `HEAD`, so the diff carries an observation taken
 * from INSIDE the bracket. Leaving it uncompared made a detectable divergence undetectable.
 *
 * Its own limit, stated rather than left to be discovered: a dance that changes only WORKING-TREE content under
 * an unchanged HEAD moves neither reading, so this closes the head-movement half and not the content half. No
 * reading available at diff-capture time sees that residue.
 *
 * @param diffHeadSha the HEAD the diff's own git invocations resolved
 * @param tree the bracketed capture, or undefined when the endpoints already disagreed
 * @returns the tree when both observations of HEAD agree, otherwise undefined
 */
export function treeAgreeingWithDiffHead({
  diffHeadSha,
  tree,
}: {
  diffHeadSha: string;
  tree: CodexPassTree | undefined;
}): CodexPassTree | undefined {
  if (tree === undefined) {
    return undefined;
  }
  return tree.headSha === diffHeadSha ? tree : undefined;
}

/**
 * The tree ONE review property records: the tree the DIFF came from, and nothing else.
 *
 * This is the fan-out hole, and the fix is a change of SUBJECT rather than a tighter check. A review's
 * verdict is about the diff it was handed, and that diff is frozen once, byte-identically, before any
 * property starts. So the only tree the record may name is the one the diff came from. Reading the live tree
 * when the property's own slot opens answers a different question — "what does the checkout look like now" —
 * which nothing about the pass depends on, and which drifts by exactly as long as the property spent queued
 * behind the concurrency cap.
 *
 * What made that a HOLE rather than a cosmetic wrong field is the DIRECTION it drifts. `codex status`'s review
 * floor (`./ledger.ts`'s `reviewFailures`) requires one CURRENT conclusive review — a positive requirement.
 * A property that waited out a sibling and then read the writer's newer tree recorded
 * exactly the provenance that floor asks for, over a diff captured before that commit existed: the gate
 * passed on a review that had never seen the code being landed. Its mirror was noise in the same fan-out,
 * where earlier properties recorded the older tree and read STALE, so one frozen diff produced rows of
 * contradictory freshness over identical bytes.
 *
 * **What this deliberately does NOT claim.** `snapshotCommit` still names THIS property's own frozen copy,
 * taken when its slot opened, and that copy may hold content the diff does not describe — a property waiting
 * behind a sibling reads surrounding code (a caller, whether a helper already exists) from a later tree. The
 * two fields say different true things and a reader can compare them: `tree` is what the verdict is ABOUT,
 * `snapshotCommit` is what the reviewer could see around it. Folding the second into a check on the first is
 * the obvious next move and is still NOT taken here, but the reason has CHANGED and the old one is gone: the
 * comparison {@link stableTree} uses now holds on a dirty tree, so no floor-nobody-can-meet argument survives.
 * What remains is that the two fields answer different questions by design, and a review whose surroundings
 * moved past its diff is not obviously wrong — it is the ordinary shape of a property that waited behind a
 * sibling. Deciding what a divergence there MEANS is its own row.
 *
 * @param diffTree the tree the diff came from, captured once for the whole fan-out and shared by every
 *   property — `undefined` when the checkout moved while the diff was being read, so no single tree
 *   describes it
 * @param snapshotCommit this property's own frozen copy's unreachable commit, when one was made
 * @returns the diff's tree carrying this property's snapshot commit, or undefined when nothing may be claimed
 */
export function reviewPassProvenance({
  diffTree,
  snapshotCommit,
}: {
  diffTree: CodexPassTree | undefined;
  snapshotCommit: string | undefined;
}): CodexPassTree | undefined {
  return withSnapshotCommit({ captured: diffTree, snapshotCommit });
}
