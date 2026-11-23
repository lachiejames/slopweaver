/**
 * `github stack push`'s amend pin: the tree it was invoked over, and the pure test of whether that is still
 * the tree its amend is about to commit.
 *
 * `stack push` amends the worktree into the current commit, and it does so AFTER every gate, the door and
 * the operation lock — which, under `--wait`, can block for as long as another stack operation holds it. A bare
 * `git add --all && git commit --amend` would ship whatever was on disk at THAT instant: an edit another
 * session, an editor or a formatter made mid-push would land in the pull request unreviewed.
 *
 * So the verb pins the tree its add WOULD stage at fact-read time (`captureStagedContentTree`,
 * `../../../codex/snapshot.ts`), and the amend compares the tree the real add DID stage against it before
 * committing. Git's tree id is the fingerprint because it already covers path, content, mode, type, deletion
 * and gitlink — a path→blob map rebuilt here would have to re-derive each of those and gets symlinks wrong.
 */

/** What the amend may commit: the tree pinned before the gates, or nothing at all on a dry run. */
export type StackPushAmendPin = { readonly kind: "dry-run" } | { readonly kind: "pinned"; readonly tree: string };

/** Named in place of a path when the trees differ but git listed none, so the refusal never reads empty. */
export const TREE_DRIFT_PATH_UNAVAILABLE = "<tree changed, path unavailable>";

/**
 * The paths that moved between the pinned tree and the one just staged, or none when the trees are the same.
 *
 * The tree ids decide; the listing only explains. `nulPaths` is `git diff --name-only -z` output, split on
 * NUL and never on a line, so a filename carrying a newline stays one path.
 *
 * @param pinnedTree the tree pinned before the gates ran
 * @param stagedTree the tree the real `git add --all` just staged
 * @param nulPaths the NUL-separated names git reported between the two
 * @returns the sorted, de-duplicated drifted paths, empty only when the two tree ids match
 */
export function stackPushTreeDrift({
  pinnedTree,
  stagedTree,
  nulPaths,
}: {
  pinnedTree: string;
  stagedTree: string;
  nulPaths: string;
}): readonly string[] {
  if (pinnedTree === stagedTree) {
    return [];
  }
  const paths = [...new Set(nulPaths.split("\0").filter((path) => path.length > 0))].toSorted();
  return paths.length === 0 ? [TREE_DRIFT_PATH_UNAVAILABLE] : paths;
}

/**
 * The paths `git add --all` would newly track into the amend that nobody chose, sorted.
 *
 * The amend stages the whole worktree, and an untracked path nobody staged is not a change anybody chose to
 * send. MEASURED: a fresh worktree's `node_modules` SYMLINK once rode into a pull request's
 * commit, because the ignore file's `node_modules/` matches a directory only. A path is chosen when HEAD's own
 * commit changed it or the index holds it: `git add -- <path>` is how a session says a new file is meant. A
 * path the index does NOT hold is unasked even when HEAD carries it byte for byte: `git rm --cached` staged it
 * out, and the whole-worktree add would put it straight back, which Codex's review reproduced.
 * Every input is `-z` output, split on NUL and never on a line.
 *
 * @param untrackedNul the paths the amend may commit: every path in the pinned tree, or untracked on a dry run
 * @param touchedNul the paths HEAD's own commit changed against its first parent
 * @param heldNul every path the index holds, intent-to-add entries included; a staged deletion holds none
 * @returns the new paths neither HEAD's own change nor the index chose; empty when the amend adds nothing unasked
 */
export function stackPushUnaskedUntracked({
  untrackedNul,
  touchedNul,
  heldNul,
}: {
  untrackedNul: string;
  touchedNul: string;
  heldNul: string;
}): readonly string[] {
  const split = ({ nul }: { nul: string }): readonly string[] => nul.split("\0").filter((path) => path.length > 0);
  const chosen = new Set([...split({ nul: touchedNul }), ...split({ nul: heldNul })]);
  return [...new Set(split({ nul: untrackedNul }))].filter((path) => !chosen.has(path)).toSorted();
}

/**
 * The refusal an unasked untracked path prints: which paths, that nothing was staged or sent, and both moves.
 *
 * @param paths the untracked paths, from {@link stackPushUnaskedUntracked}
 * @returns the refusal reason, one line
 */
export function stackPushUnaskedUntrackedReason({ paths }: { paths: readonly string[] }): string {
  return (
    `the amend would add untracked ${paths.length === 1 ? "path" : "paths"} the pull request never touched ` +
    `(${paths.join(", ")}) — nothing was staged, committed or sent. Stage one you mean to send with ` +
    "`git add -- <path>`; remove or ignore the rest, then run stack push again"
  );
}

/**
 * The refusal a drifted amend prints: what moved, that nothing was sent, and the one residue it leaves.
 *
 * @param paths the drifted paths, from {@link stackPushTreeDrift}
 * @returns the refusal reason, one line
 */
export function stackPushTreeDriftReason({ paths }: { paths: readonly string[] }): string {
  return (
    `the working tree changed while stack push ran (${paths.join(", ")}), so the amend would have shipped ` +
    "an edit nobody reviewed — nothing was committed or sent. `git add --all` has left the current tree " +
    "staged; read it with `git diff --cached`, then run stack push again over the tree you mean to send"
  );
}

/**
 * The refusal when the COMMIT, not the worktree, moved off the pin — a commit hook (a formatter re-staging
 * what it fixed, say) changed the index inside `commit --amend`, after the staged tree was checked.
 *
 * @param paths the paths the commit holds that the pin did not, from {@link stackPushTreeDrift}
 * @returns the refusal reason, one line
 */
export function stackPushCommitDriftReason({ paths }: { paths: readonly string[] }): string {
  return (
    `a commit hook changed the tree inside the amend (${paths.join(", ")}), so the commit is not the tree ` +
    "stack push was run over — nothing was sent. HEAD is already amended locally; read it with " +
    "`git show --stat HEAD`, then run stack push again to send it as it now stands"
  );
}

/**
 * The refusal when the amend rewrote a different commit than the one checked: the branch moved in the gap
 * between the HEAD re-read and `commit --amend`, so the new commit's parents, author or message are not the
 * checked commit's.
 *
 * @param headSha the commit stack push was run over and re-checked before staging
 * @param amendedSha the commit `commit --amend` actually produced
 * @returns the refusal reason, one line
 */
export function stackPushLineageReason({ headSha, amendedSha }: { headSha: string; amendedSha: string }): string {
  return (
    `the branch moved inside the amend, so ${amendedSha} rewrote a commit other than ${headSha} — nothing ` +
    "was sent. HEAD is already amended locally; read it with `git show --stat HEAD`, then run stack push " +
    "again to send it as it now stands"
  );
}
