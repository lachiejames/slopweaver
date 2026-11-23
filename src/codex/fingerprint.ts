/**
 * The tree fingerprint — one value that answers "is this the same code the pass judged?".
 *
 * ## Why not `HEAD`
 *
 * The obvious primitive is the HEAD sha, and it is wrong. Measured on the PR6 build: the agent edited
 * tracked files for the better part of an hour without committing once, so HEAD never moved while the tree
 * changed continuously. A pre-mortem launched at the start of that hour was reviewing files that no longer
 * existed by the time it returned, and a HEAD comparison would have called it current.
 *
 * So the fingerprint covers all three ways a tree can move:
 *
 *   1. a commit changes the files → the `HEAD^{tree}` object changes
 *   2. a tracked file is edited   → the `git diff HEAD` patch changes
 *   3. a new file appears         → the untracked patches change
 *
 * And one way it does NOT move, which is the point of using the tree object: rewording, squashing or
 * rebasing a commit leaves the files identical, so the fingerprint holds.
 *
 * Case 3 is the one that gets forgotten. `git stash create` — the tempting shortcut — silently omits
 * untracked files, which for a PR made mostly of new source files would fingerprint a tree that barely
 * resembles the real one. {@link ../codex/gitDiff} already solves this for review diffs by appending a
 * `--no-index` patch per untracked file, and this reuses that same combined text rather than inventing a
 * second, weaker notion of "the tree".
 *
 * Pure: the caller supplies the already-captured strings. No git, no filesystem, no clock.
 */

import { createHash } from "node:crypto";

/** How much of the digest is shown to a human. Enough to distinguish, short enough to sit in a table. */
const SHORT_CHARS = 12;

/**
 * A tree's identity at one moment, with the parts kept alongside the digest.
 *
 * The parts are retained deliberately: when a pass is rejected as stale, "the fingerprint differs" is not a
 * usable explanation, but "HEAD is the same and 3 tracked files differ" tells the reader what happened.
 */
export interface TreeFingerprint {
  /** The full sha256 hex digest over the committed TREE plus the working-tree patch. */
  readonly digest: string;
  /** Git's content-addressed tree object for `HEAD`. What the digest is actually built from. */
  readonly treeSha: string;
  /** The HEAD commit at capture. */
  readonly headSha: string;
  /** Bytes of combined working-tree patch — zero for a clean tree. */
  readonly dirtyBytes: number;
}

/**
 * Fingerprint a tree from its HEAD sha and its combined working-tree patch.
 *
 * ## Why the length prefix
 *
 * Concatenating the two inputs collides: `(headSha "AB", patch "")` and `(headSha "A", patch "B")` produce
 * the same bytes, so two genuinely different trees compare equal — the single outcome this must never
 * produce. A separator character looks like the fix and is not: with a `\n` between them,
 * `("A", "\nB")` and `("A\n", "B")` still collide. That one is unreachable *today* because a sha is hex,
 * but it is an unstated assumption holding up the whole staleness check, so the length prefix removes it
 * instead. Both cases are pinned in `fingerprint.test.ts`.
 *
 * Two earlier versions of this line were wrong and neither was caught by the gate. The first used a literal
 * NUL character typed into the source — invisible in an editor, enough to make git classify the file as
 * binary, and green through biome, oxlint, ESLint, tsc and 2,686 tests. It surfaced only because a Codex
 * review refused to read the diff. Stripping that NUL then silently left no separator at all.
 *
 * ## Why the TREE object, not the commit
 *
 * Git's tree object is content-addressed: two commits holding identical files share one tree sha. The
 * commit sha does not — it folds in the message, the parent and the timestamp. Hashing the commit made a
 * squash look like a code change, and this repo REQUIRES one commit off the base branch, so the mandated
 * workflow invalidated every pass on the branch immediately before the PR was opened. Caught by squashing
 * this change and watching six passes turn STALE while `HEAD^{tree}` stayed unchanged.
 *
 * `headSha` is still recorded, because "HEAD moved" is the useful thing to SAY to a reader. It just does
 * not decide anything.
 *
 * @param headSha the HEAD commit at capture, kept for explanation rather than comparison
 * @param treeSha git's tree object for that commit — the content-addressed part the digest rests on
 * @param dirtyPatch the combined tracked-plus-untracked patch against HEAD; empty string for a clean tree
 * @returns the fingerprint, carrying the digest and the parts that explain it
 */
export function treeFingerprint({
  headSha,
  treeSha,
  dirtyPatch,
}: {
  headSha: string;
  treeSha: string;
  dirtyPatch: string;
}): TreeFingerprint {
  return {
    digest: createHash("sha256")
      .update(`${String(treeSha.length)}:`)
      .update(treeSha)
      .update(dirtyPatch)
      .digest("hex"),
    dirtyBytes: Buffer.byteLength(dirtyPatch, "utf8"),
    headSha,
    treeSha,
  };
}

/**
 * Whether a tree is exactly as it was — the whole question a staleness check asks.
 *
 * @param before the fingerprint taken when the pass started
 * @param after the fingerprint now
 * @returns true when nothing changed, so a verdict recorded against `before` still describes the tree
 */
export function sameTree({ before, after }: { before: TreeFingerprint; after: TreeFingerprint }): boolean {
  return before.digest === after.digest;
}

/**
 * Why a tree is no longer the one that was judged, in words a reader can act on.
 *
 * Returns `undefined` when the trees match, so the caller branches on presence rather than on a boolean plus
 * a string that might disagree with it.
 *
 * @param before the fingerprint taken when the pass started
 * @param after the fingerprint now
 * @returns the explanation, or `undefined` when nothing moved
 */
export function treeDrift({ before, after }: { before: TreeFingerprint; after: TreeFingerprint }): string | undefined {
  if (sameTree({ after, before })) {
    return undefined;
  }
  if (before.treeSha !== after.treeSha) {
    return `the committed tree changed (HEAD ${shortDigest({ value: before.headSha })} → ${shortDigest({ value: after.headSha })})`;
  }
  return `HEAD unchanged but the working tree moved (${String(before.dirtyBytes)} → ${String(after.dirtyBytes)} bytes of uncommitted patch)`;
}

/**
 * Shorten a digest or sha for display. Never used for comparison — that always uses the full value.
 *
 * @param value the full digest or sha
 * @returns the shortened form, for display only — comparing these would collide
 */
export function shortDigest({ value }: { value: string }): string {
  return value.slice(0, SHORT_CHARS);
}
