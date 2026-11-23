/**
 * The live read of an earlier ask, shared by the two wirings that need it: `slack draft record`
 * (`./draftWiring.ts`), which reads it before a row parks, and the release (`./writeWiring.ts`), which reads it
 * again before the approved words go out. A read only — `conversations.replies`, plus a DM's
 * `conversations.history` — under the token of the identity that asked.
 */
import { makeSlackApi } from "../../../corpus/slack/api.js";
import type { SlackApi } from "../../../corpus/slack/fetch.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { readPriorAsk } from "../../../live/slack/priorAskRead.js";
import { type AskedBeforeError, AskedBeforeErrors } from "../../../outbound/slack/askedBeforeErrors.js";
import type { PriorRead } from "../../../outbound/slack/priorAsk.js";

/** The seam: read the earlier ask a permalink names, whole, or the typed reason it would not read. */
export type ReadPriorAsk = (args: { permalink: string; token: string }) => Promise<Result<PriorRead, AskedBeforeError>>;

/**
 * The read over a given Slack client, failing closed: an incomplete read and a thrown transport error are both an
 * unreadable prior, never an unanswered one.
 *
 * @param makeApi the client for a token — the real one in {@link liveReadPriorAsk}, a fake in a test
 * @param nowMs the clock a DM's top-level read is bounded by
 * @returns the seam
 */
export function readPriorAskVia({
  makeApi,
  nowMs,
}: {
  makeApi: (args: { token: string }) => Pick<SlackApi, "replies" | "history">;
  nowMs: () => number;
}): ReadPriorAsk {
  return async ({ permalink, token }) => {
    try {
      const read = await readPriorAsk({ deps: { api: makeApi({ token }), nowMs }, permalink });
      if (read.isErr()) {
        return err(AskedBeforeErrors.priorUnreadable({ cause: read.error.join("; "), permalink }));
      }
      return ok(read.value);
    } catch (error) {
      return err(AskedBeforeErrors.priorUnreadable({ cause: error, permalink }));
    }
  };
}

/** The real read, under the asking identity's own token. */
export const liveReadPriorAsk: ReadPriorAsk = readPriorAskVia({ makeApi: makeSlackApi, nowMs: () => Date.now() });
