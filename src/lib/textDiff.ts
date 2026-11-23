/**
 * A unified diff between two strings — the before-image a destructive write has to show first.
 *
 * ## Why this is a library rather than a hand-rolled comparison
 *
 * The repository already had a diff helper (`../codex/diff.ts`) and it is the wrong one: it builds `git diff`
 * COMMANDS over tracked files, and what is needed here is a patch between two arbitrary strings, neither of
 * which is on disk. Hand-rolling a longest-common-subsequence is exactly the sort of infrastructure the house
 * rule says to take from a battle-tested package, so `diff` is pinned and used.
 *
 * ## What the caller is meant to do with it
 *
 * `update --form` replaces the whole description, and GitHub keeps no history of what was there. So the bytes
 * this patch describes are the bytes about to be lost permanently. It is printed to stderr BEFORE the door,
 * with the outcome kept on stdout, so a caller piping the result still gets clean machine output while a human
 * watching the terminal still sees what they are about to destroy.
 *
 * Whitespace is significant and nothing is coloured: a diff whose meaning depends on a terminal's colour
 * support is not evidence.
 */
import { createTwoFilesPatch } from "diff";

/** The labels a body patch carries, so a reader can tell which side is live. */
const CONTEXT_LINES = 3;

/**
 * A unified patch between two strings.
 *
 * An ABSENT body and an EMPTY one are given different labels rather than both rendering as nothing, because
 * "the pull request has no description" and "the description is the empty string" are different facts and the
 * patch is the only place a reader would notice the difference.
 *
 * @param before the current bytes, or undefined when there are none at all
 * @param after the bytes that would replace them
 * @param what a short noun naming what is being diffed, used in the patch headers
 * @returns a unified patch, or undefined when the two sides are identical
 */
export function unifiedPatch({
  before,
  after,
  what,
}: {
  before: string | undefined;
  after: string;
  what: string;
}): string | undefined {
  if (before === after) {
    return undefined;
  }
  const to = `${what} (replacement)`;
  // Two explicit calls rather than coalescing an absent body to "". The empty string is a real possible VALUE
  // here, so defaulting to it would erase the distinction the labels exist to draw.
  if (before === undefined) {
    return createTwoFilesPatch(`${what} (absent)`, to, "", after, undefined, undefined, { context: CONTEXT_LINES });
  }
  return createTwoFilesPatch(`${what} (live)`, to, before, after, undefined, undefined, { context: CONTEXT_LINES });
}
