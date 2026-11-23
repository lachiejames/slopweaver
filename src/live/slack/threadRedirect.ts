/**
 * The one redirect a bare reply link earns: `slack read-thread`'s live read and the owner's reply read both
 * follow a link that names a reply, rather than its thread, to the thread's real root.
 */
import { isRecord } from "../../lib/parsers.js";
import type { SlackThreadTarget } from "./permalink.js";

/**
 * Where the thread REALLY is, when the link pointed at a reply and said nothing about its parent.
 *
 * MEASURED against the live API: `conversations.replies` called with a REPLY's timestamp returns exactly
 * ONE message — the reply — carrying a `thread_ts` that names the actual root. It does not return the
 * thread. (This finally settles an assumption the planning passes carried but never verified.)
 *
 * The link that lands here is not exotic. A `thread_broadcast` — a reply the author also sent to the
 * channel — appears at channel top level, and copying its link yields a bare permalink with no
 * `?thread_ts=`. Pasting it is completely ordinary, and refusing it means the reader gets nothing when
 * Slack has just told us exactly where to look.
 *
 * Followed at most ONCE, and only when the response is the tell-tale single foreign-threaded message, so
 * this can neither loop nor paper over a genuinely inconsistent page. Exported for `./readThread.ts` and
 * `./ownerReply.ts`, whose `readCompleteThread` the console voice's live read (`src/talk/slackAfter.ts`) calls.
 *
 * @param rawMessages the rows from the first fetch
 * @param target the thread we asked for
 * @returns the corrected target, or undefined when the first answer was already the right thread
 */
export function redirectedTarget({
  rawMessages,
  target,
}: {
  rawMessages: readonly unknown[];
  target: SlackThreadTarget;
}): SlackThreadTarget | undefined {
  const [only] = rawMessages;
  if (rawMessages.length !== 1 || !isRecord(only)) {
    return undefined;
  }
  const root = only["thread_ts"];
  if (typeof root !== "string" || root.length === 0 || root === target.threadTs) {
    return undefined;
  }
  // The link still ADDRESSED the message the user pasted; only the thread to fetch changes.
  return { ...target, addressedReply: true, threadTs: root };
}
