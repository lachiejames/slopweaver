/**
 * The patch id of what a branch contributes to its base — the identity of the code being merged that survives a
 * rebase onto a base the branch does not overlap.
 *
 * Measured in a scratch repository, base moved by a commit the branch does not overlap: the head SHA changes,
 * `HEAD^{tree}` changes (the new base's files are in it), the text of `git diff base...head` changes (`index`
 * lines and hunk headers), and `git patch-id --verbatim` of that diff HOLDS. Reproduce with `git rebase` onto a
 * moved base and compare `git diff $(git merge-base <base> HEAD)...HEAD | git patch-id --verbatim`.
 *
 * No description publishes it: a C3 body carries no grade and no anchor (`AGENTS.md` rule 7). `github push` prints
 * it so a session can record what its own evidence was gathered against.
 */

/**
 * The id in `git patch-id`'s output, or null when it printed none.
 *
 * Git emits `<patch-id> <commit-id>` per patch, with an all-zero commit id when the input came from stdin
 * rather than a revision walk — so the first token of the first line is the value, and the second is noise
 * that has been mistaken for it. Empty output is a real, expected answer: a branch contributing no diff at
 * all has no patch to identify, and null says so rather than an empty string that would compare equal to a
 * body declaring nothing.
 *
 * @param output whatever `git patch-id --verbatim` wrote to stdout
 * @returns the lowercased patch id, or null when the output holds none
 */
export function patchIdFrom({ output }: { output: string }): string | null {
  const first = output.trim().split("\n")[0];
  if (first === undefined) {
    return null;
  }
  const token = first.trim().split(/\s+/)[0];
  return token !== undefined && /^([0-9a-f]{40}|[0-9a-f]{64})$/i.test(token) ? token.toLowerCase() : null;
}
