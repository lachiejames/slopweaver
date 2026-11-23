/**
 * One hunk of a pull request's patch judged against its base tip's lines — the hunk half of `./diffOnBaseJudge.ts`,
 * whose header carries the whole conservative contract this implements. A hunk is on the base only when its whole
 * post-image appears exactly once, both on the base and in the head's own copy at the line its header names, its
 * pre-image appears nowhere outside that one place, and no line it deletes survives outside it.
 */

import { bareLine, type Hunk } from "./diffOnBaseLines.js";

/** One hunk's answer, with where its post-image sits when it is on the base. */
export interface HunkAnswer {
  readonly verdict: "on-base" | "not-on-base" | "unknown";
  readonly at?: { readonly start: number; readonly end: number };
  readonly reason?: string;
}

/** Every index at which `needle` appears contiguously in `haystack`. */
function occurrences({ haystack, needle }: { haystack: readonly string[]; needle: readonly string[] }): number[] {
  const found: number[] = [];
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((line, offset) => haystack[start + offset] === line)) {
      found.push(start);
    }
  }
  return found;
}

/** The answer for a patch that does not place its change where the head's own copy has it. */
const MISPLACED: HunkAnswer = {
  reason: "GitHub's patch does not place the change where the pull request's own copy has it",
  verdict: "unknown",
};

/**
 * Judge a context-free deletion: every line it deletes gone is landed, the block still where it was is not, anything
 * else — the block elsewhere, or part of it left — is ambiguous. The head's own copy must have lost them
 * too, or GitHub's patch is not the pull request's file and its absence on the base proves nothing.
 */
function judgeDeletion({
  hunk,
  base,
  head,
  pre,
}: {
  hunk: Hunk;
  base: readonly string[];
  head: readonly string[];
  /** Where the hunk's pre-image sits on the base. */
  pre: readonly number[];
}): HunkAnswer {
  const leftIn = ({ lines }: { lines: readonly string[] }): boolean =>
    hunk.removed.some((line) => lines.some((held) => bareLine({ line: held }) === bareLine({ line })));
  if (leftIn({ lines: head })) {
    return { reason: "the pull request's own copy still holds a line it deletes", verdict: "unknown" };
  }
  // An empty new range's start names the head line it follows, so one past the head's end is not its file.
  if (hunk.newStart > head.length) {
    return MISPLACED;
  }
  if (!leftIn({ lines: base })) {
    return { verdict: "on-base" };
  }
  if (pre.length === 1 && pre[0] === hunk.oldStart - 1) {
    return { verdict: "not-on-base" };
  }
  return { reason: "a line it deletes is still in the file", verdict: "unknown" };
}

/** Judge a hunk whose whole post-image sits once on the base at `start`, its pre-image nowhere outside it. */
function judgeLanded({
  hunk,
  base,
  head,
  start,
}: {
  hunk: Hunk;
  base: readonly string[];
  head: readonly string[];
  start: number;
}): HunkAnswer {
  const end = start + hunk.post.length;
  // The pre-image can vanish because a NEIGHBOUR changed while the deleted line stayed put, so a deletion counts as
  // landed only when no line it deletes survives outside where the change landed. Any survivor, a blank line or an
  // unrelated `}` elsewhere included, reads `unknown` rather than risk a false `on-base`. A line
  // survives whether or not it still ends the file, so the no-newline marker is set aside here.
  const survivor = hunk.removed.some((line) =>
    base.some((held, index) => bareLine({ line: held }) === bareLine({ line }) && (index < start || index >= end)),
  );
  if (survivor) {
    return { reason: "a line it deletes is still in the file", verdict: "unknown" };
  }
  // A post-image the head holds twice may have stood on the base before this change ever existed, and a neighbour
  // edit can erase the pre-image it was meant to replace, so one copy on the base proves nothing.
  const inHead = occurrences({ haystack: head, needle: hunk.post });
  if (inHead.length !== 1) {
    return { reason: "the changed lines appear more than once in the pull request's own copy", verdict: "unknown" };
  }
  // GitHub draws the patch's new side from the head, so a post-image anywhere but where its header puts it means the
  // patch is not the pull request's own file.
  if (inHead[0] !== hunk.newStart - 1) {
    return MISPLACED;
  }
  return { at: { end, start }, verdict: "on-base" };
}

/** Judge a hunk that has not plainly landed, by how often its pre-image and post-image appear on the base. */
function judgeUnlanded({ preCount, postCount }: { preCount: number; postCount: number }): HunkAnswer {
  if (postCount === 0 && preCount > 0) {
    return { verdict: "not-on-base" };
  }
  if (postCount > 1) {
    return { reason: "the changed lines appear more than once in the file", verdict: "unknown" };
  }
  if (postCount === 1) {
    return { reason: "both the old and the new lines appear in the file", verdict: "unknown" };
  }
  return { reason: "the lines around the change are different on the base", verdict: "unknown" };
}

/**
 * Judge one hunk against the base file's lines, with the head's own copy to say whether its post-image is unique.
 *
 * @param base the base tip's file, one entry per line
 * @param head the pull request's own head copy of the file, one entry per line
 * @returns the hunk's verdict, where its post-image sits on the base when it is on it, and why when it is unknown
 */
export function judgeHunk({
  hunk,
  base,
  head,
}: {
  hunk: Hunk;
  base: readonly string[];
  head: readonly string[];
}): HunkAnswer {
  const pre = occurrences({ haystack: base, needle: hunk.pre });
  if (hunk.post.length === 0) {
    return judgeDeletion({ base, head, hunk, pre });
  }
  if (hunk.pre.length === 0) {
    // A context-free insertion into an existing file names no lines to place it by, so finding its text anywhere
    // would not show it landed where the patch put it.
    return { reason: "it inserts lines with no surrounding lines to place them by", verdict: "unknown" };
  }
  const post = occurrences({ haystack: base, needle: hunk.post });
  const onlyPost = post.length === 1 ? post[0] : undefined;
  if (onlyPost === undefined) {
    return judgeUnlanded({ postCount: post.length, preCount: pre.length });
  }
  // The pre-image may sit INSIDE the landed post-image (an insertion at a file's end leaves its context whole), but a
  // copy anywhere else means the old lines may still be where the change was meant to go.
  const postEnd = onlyPost + hunk.post.length;
  const preElsewhere = pre.some((at) => at < onlyPost || at + hunk.pre.length > postEnd);
  if (preElsewhere) {
    return judgeUnlanded({ postCount: post.length, preCount: pre.length });
  }
  return judgeLanded({ base, head, hunk, start: onlyPost });
}
