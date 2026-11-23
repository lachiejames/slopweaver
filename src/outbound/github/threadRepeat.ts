/**
 * Whether this identity already answered a review thread since anybody else last spoke in it.
 *
 * Measured on one pull request: each of a reviewer's three threads carried three replies under the owner's name,
 * sent hours apart by sessions that never read the thread first. The replies were reworded
 * rather than copied, so no byte or first-line match would have caught them (the Slack guard,
 * `corpus/slack/writeGuardRepeat.ts`, matches words). The rule here is about TURN, not text: once this
 * identity has replied, the next word in that thread is the reviewer's.
 */

import type { ReviewThreadComment } from "./threads.js";

/**
 * The reply this identity already left since the last comment by anyone else, or `undefined` when the
 * thread's last word is somebody else's.
 *
 * The opening comment is never a reply, so a thread this identity opened and nobody has answered holds no
 * prior reply until a second self-comment exists. A comment with no author (a deleted account) is somebody
 * else's. Logins compare case-insensitively, as GitHub treats them.
 *
 * @param viewer the login of the token about to reply
 * @param comments the thread's comments, oldest first
 * @returns the latest of this identity's replies since the other side last spoke, if there is one
 */
export function priorSelfReply({
  viewer,
  comments,
}: {
  viewer: string;
  comments: readonly ReviewThreadComment[];
}): ReviewThreadComment | undefined {
  const self = viewer.toLowerCase();
  const isSelf = (comment: ReviewThreadComment): boolean => comment.author?.toLowerCase() === self;
  const lastOther = comments.findLastIndex((comment) => !isSelf(comment));
  const boundary = Math.max(lastOther, 0);
  const latest = comments.findLastIndex((comment, index) => index > boundary && isSelf(comment));
  return latest === -1 ? undefined : comments[latest];
}
