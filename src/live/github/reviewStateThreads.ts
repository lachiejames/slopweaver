/**
 * The review threads on a pull-request node, as `./reviewState.ts`'s reads decode them.
 *
 * Its own module because a thread is the one part of the read the landing's walkthrough step leans on for
 * who resolved it, and `./reviewState.ts` is the whole read's assembly rather than the place a thread's
 * shape is decided.
 */

import type { PrReviewThread } from "./reviewState.js";
import { isBotActor, login, nodesOf, str, totalCountOf } from "./reviewStateConnection.js";

/**
 * The review threads on a pull-request node, each attributed to whoever wrote its FIRST comment.
 *
 * The last comment falls back to the OPENER when the tail page is empty, which is what a thread with no
 * replies actually is — not an absence. Reading it as one would make every unanswered thread look like a
 * thread whose last speaker could not be determined, and the disposition turns on exactly that field.
 *
 * @param node the pull-request node carrying `reviewThreads`
 * @returns every thread the node carried
 */
export function threadsOf({ node }: { node: Record<string, unknown> }): readonly PrReviewThread[] {
  return nodesOf({ connection: node["reviewThreads"] }).map((thread) => {
    const opener = nodesOf({ connection: thread["opener"] })[0];
    const tail = nodesOf({ connection: thread["tail"] });
    const last = tail.length === 0 ? opener : tail[tail.length - 1];
    const lineValue = thread["line"];
    const resolver = login({ value: thread["resolvedBy"] });
    return {
      commentCount: Math.max(totalCountOf({ connection: thread["tail"] }), opener === undefined ? 0 : 1),
      id: str({ value: thread["id"] }),
      isOutdated: thread["isOutdated"] === true,
      isResolved: thread["isResolved"] === true,
      lastCommentAtIso: str({ value: last?.["createdAt"] }),
      lastCommentBody: str({ value: last?.["body"] }),
      lastCommentLogin: login({ value: last?.["author"] }),
      line: typeof lineValue === "number" ? lineValue : 0,
      openedAtIso: str({ value: opener?.["createdAt"] }),
      openedByLogin: login({ value: opener?.["author"] }),
      ...(isBotActor({ value: opener?.["author"] }) ? { openedByBot: true as const } : {}),
      openerBody: str({ value: opener?.["body"] }),
      path: str({ value: thread["path"] }),
      ...(resolver === "" ? {} : { resolvedByLogin: resolver }),
    };
  });
}
