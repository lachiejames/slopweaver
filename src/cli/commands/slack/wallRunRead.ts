/**
 * Our consecutive run at the tail of a thread — the one read the wall check depends on, in its live and pure
 * halves.
 *
 * Split out of `./wiring.ts` because it is a concern of its own: every other function there assembles a
 * dependency from the profile or the identity map, while this one reads a thread and counts. The live half
 * is the three reads; the pure half is what a unit test holds down.
 */
import { WebClient } from "@slack/web-api";
import { makeSlackApi } from "../../../corpus/slack/api.js";
import { slackPermalink } from "../../../corpus/slack/curated.js";
import { optStr } from "../../../corpus/slack/shape.js";
import { isRecord } from "../../../lib/parsers.js";
import { safeProviderCall, scopeIdForToken } from "../../../lib/providerCall.js";
import { err, ok } from "../../../lib/result.js";
import { fetchCompleteSlackThread } from "../../../live/slack/pagination.js";
import {
  existingWallRun,
  type ThreadReplyIdentity,
  type WallActor,
  type WallRun,
} from "../../../outbound/slack/wallGate.js";
import { type SlackRead, SlackReadErrors } from "./readErrors.js";

/**
 * Our consecutive run at the tail of a thread, live, under the SAME token about to send.
 *
 * "Ours" is whatever `auth.test` says this exact token is — the bot's own user id for `--as bot`, the
 * operator's for `--as me` — so the wall check never has to know which lane called it. `err` is a soft
 * failure (the read failed, the identity call failed, or the workspace url could not be resolved): the
 * caller logs it and lets the send proceed unchecked rather than blocking every reply on a flaky read that
 * has nothing to do with the message being sent.
 *
 * @param token the token this send will use
 * @param channel the target channel
 * @param threadTs the thread root
 * @param actor which identity this send goes out under, which decides whether an earlier message from that
 *   identity extends the run or is the owner's own hand
 * @returns the run standing at the tail before this send, or why it could not be established
 */
export async function liveWallRun({
  token,
  channel,
  threadTs,
  actor,
}: {
  token: string;
  channel: string;
  threadTs: string;
  actor: WallActor;
}): Promise<SlackRead<WallRun>> {
  // devlint: sdk-factory -- a one-shot auth.test alongside the read seam, to know which replies are ours
  const client = new WebClient(token);
  const scopeId = scopeIdForToken({ token });
  const api = makeSlackApi({ token });
  const [self, fetched, workspaceUrl] = await Promise.all([
    safeProviderCall({
      execute: () => client.auth.test(),
      operation: "slack.auth.test",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    }),
    fetchCompleteSlackThread({ api, channel, threadTs }),
    api.workspaceUrl(),
  ]);
  if (!self.isOk()) {
    return err(SlackReadErrors.wallIdentityUnread({ reason: self.error.message }));
  }
  if (fetched.isErr()) {
    return err(SlackReadErrors.wallThreadUnread({ channel, reason: fetched.error.message }));
  }
  if (workspaceUrl === undefined) {
    return err(SlackReadErrors.wallWorkspaceUrlUnresolved());
  }
  return ok(
    wallRunFromRawMessages({
      actor,
      channel,
      rawMessages: fetched.value.rawMessages,
      selfUserId: optStr({ value: self.value.user_id }),
      threadTs,
      workspaceUrl,
    }),
  );
}

/**
 * The PURE half of {@link liveWallRun}: Slack's raw thread messages plus our own user id, reduced to the run
 * standing at the tail.
 *
 * Split out because everything above it is I/O and nothing here is, so the `actor` reaching
 * {@link existingWallRun} is provable by a unit test rather than by reading. A Codex review pass found the
 * mutant this closes: with the mapping inlined in the effectful function, hardcoding the actor to `bot`
 * typechecked and left every test in the touched files green while production refused every `--as me` drip
 * over the owner's own earlier replies.
 *
 * A message with no `ts`, or one that is not an object at all, is DROPPED rather than counted as someone
 * else's — it cannot be cited in the refusal, and a run broken by an unciteable message would produce
 * advice pointing at nothing.
 *
 * @param rawMessages every message `conversations.replies` returned, unparsed, in Slack's order
 * @param selfUserId whoever `auth.test` says this token is, absent when Slack did not say
 * @param channel the target channel, for the permalinks the refusal cites
 * @param workspaceUrl the workspace those permalinks are built against
 * @param threadTs the thread's root `ts`
 * @param actor which identity this send goes out under
 * @returns the run standing at the tail, before this send
 */
export function wallRunFromRawMessages({
  rawMessages,
  selfUserId,
  channel,
  workspaceUrl,
  threadTs,
  actor,
}: {
  rawMessages: readonly unknown[];
  selfUserId: string | undefined;
  channel: string;
  workspaceUrl: string;
  threadTs: string;
  actor: WallActor;
}): WallRun {
  const replies: readonly ThreadReplyIdentity[] = rawMessages.flatMap((raw) => {
    if (!isRecord(raw)) {
      return [];
    }
    const ts = optStr({ value: raw["ts"] });
    if (ts === undefined) {
      return [];
    }
    const author = optStr({ value: raw["user"] });
    return [
      {
        ours: selfUserId !== undefined && author === selfUserId,
        permalink: slackPermalink({ channelId: channel, ts, workspaceUrl }),
        ts,
      },
    ];
  });
  return existingWallRun({ actor, replies, threadTs });
}
