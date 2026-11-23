/**
 * The read a `github thread reply` takes before it writes: refuse when this identity already answered the
 * thread since anybody else last spoke there (`outbound/github/threadRepeat.ts`).
 */

import { hatchFor } from "../../../hatch/lookup.js";
import { hatchOpen } from "../../../hatch/open.js";
import { hatchRefusal } from "../../../hatch/render.js";
import { priorSelfReply } from "../../../outbound/github/threadRepeat.js";
import type { GithubThreadApi } from "../../../outbound/github/threads.js";

/** The register row a reply's repeat check reads. */
const REPEAT_HATCH_ID = "repeat-thread-reply";

/**
 * Read the thread a reply is about to land in, and refuse a repeat. An unreadable thread refuses too: "could
 * not check" is not "checked and clear". An open hatch is asked first, so the thread is never read.
 *
 * @param api the thread read
 * @param threadId the review thread about to be replied into
 * @param hatchIsOpen whether the journalled `repeat-thread-reply` hatch is open for this session
 * @returns the four-line refusal, or `undefined` when the reply may go
 */
export async function threadRepeatRefusal({
  api,
  threadId,
  hatchIsOpen,
}: {
  api: GithubThreadApi;
  threadId: string;
  hatchIsOpen: boolean;
}): Promise<string | undefined> {
  if (hatchIsOpen) {
    return undefined;
  }
  const hatch = hatchFor({ id: REPEAT_HATCH_ID });
  const read = await api.comments({ threadId });
  if (read.isErr()) {
    return hatchRefusal({
      detail: `thread ${threadId} could not be read to check for an earlier reply: ${read.error.message}`,
      hatch,
    });
  }
  const prior = priorSelfReply(read.value);
  if (prior === undefined) {
    return undefined;
  }
  return hatchRefusal({
    detail:
      `@${read.value.viewer} already replied in thread ${threadId} at ${prior.createdAt}, ` +
      `and nobody has commented since: ${prior.url}`,
    hatch,
  });
}

/**
 * Whether the journalled `repeat-thread-reply` hatch is open for this session, right now.
 *
 * @param home the state home the grant journal lives under
 * @returns true when this session holds a live grant for it
 */
export function repeatThreadReplyHatchOpen({ home }: { home: string }): boolean {
  return hatchOpen({ env: process.env, home, id: REPEAT_HATCH_ID, nowIso: new Date().toISOString() });
}
