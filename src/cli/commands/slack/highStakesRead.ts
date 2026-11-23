/**
 * The live half of the high-stakes second-post check: the channel's last day, read under the token about to
 * send, reduced to the fleet's own top-level posts by `outbound/slack/highStakesChannel.ts`.
 *
 * It never answers `err`. A read that fails is `{ kind: "unread" }`, which the pure gate REFUSES on, so the
 * one shape a caller cannot get wrong is the one where a flaky read would otherwise wave a second post through.
 */
import { WebClient } from "@slack/web-api";
import { makeSlackApi } from "../../../corpus/slack/api.js";
import { optStr } from "../../../corpus/slack/shape.js";
import { safeProviderCall, scopeIdForToken } from "../../../lib/providerCall.js";
import { slackTsFromEpochMs } from "../../../lib/slackTs.js";
import { pidAlive } from "../../../live/listen/supervise/currentLiveness.js";
import {
  type FleetHistory,
  fleetTopLevelPostsWithin,
  HIGH_STAKES_WINDOW_MS,
  type ThreadAnchor,
  threadAnchorOf,
} from "../../../outbound/slack/highStakesChannel.js";
import {
  peekHighStakesClaim,
  releaseHighStakesClaim,
  takeHighStakesClaim,
} from "../../../outbound/slack/highStakesClaim.js";
import { readHighStakesConfig } from "../../../profileStore.js";
import type { HighStakesDeps } from "./highStakesGate.js";

/**
 * Pages of `conversations.history` read before the day is called unread: 1,000 top-level posts in 24 hours. A
 * channel busier than that is one this gate cannot vouch for, so it refuses rather than guess at the rest.
 */
const MAX_PAGES = 5;

/** The page size asked for; Slack's own recommended ceiling for `conversations.history`. */
const PAGE_SIZE = 200;

/**
 * The fleet's own top-level posts in a channel over the last day, live.
 *
 * The send token's own `auth.test` user joins the configured fleet ids, so an install that declared none still
 * counts what it posts under the identity about to post again.
 *
 * @param token the token this send will use
 * @param channel the high-stakes channel the send is aimed at
 * @param fleetUserIds the profile's ids for the owner and the bot
 * @param nowMs the instant the window ends at
 * @returns the fleet's posts inside the window, or why they could not be read
 */
async function liveFleetHistory({
  token,
  channel,
  fleetUserIds,
  nowMs,
}: {
  token: string;
  channel: string;
  fleetUserIds: readonly string[];
  nowMs: number;
}): Promise<FleetHistory> {
  // devlint: sdk-factory -- a one-shot auth.test plus a bounded history read, beside the read seam's workspace url
  const client = new WebClient(token);
  const scopeId = scopeIdForToken({ token });
  const [self, workspaceUrl] = await Promise.all([
    safeProviderCall({
      execute: () => client.auth.test(),
      operation: "slack.auth.test",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    }),
    makeSlackApi({ token }).workspaceUrl(),
  ]);
  if (self.isErr()) {
    return { kind: "unread", reason: `auth.test: ${self.error.message}` };
  }
  if (workspaceUrl === undefined) {
    return { kind: "unread", reason: "the workspace url could not be resolved" };
  }
  const oldest = slackTsFromEpochMs({ ms: nowMs - HIGH_STAKES_WINDOW_MS });
  const day = await readDay({ channel, client, oldest, scopeId });
  if (day.kind === "unread") {
    return day;
  }
  const ids = fleetIdsWithSelf({ fleetUserIds, selfUserId: optStr({ value: self.value.user_id }) });
  return {
    kind: "read",
    priors: fleetTopLevelPostsWithin({ channel, fleetUserIds: ids, nowMs, rawMessages: day.rawMessages, workspaceUrl }),
  };
}

/**
 * The PURE half of {@link liveFleetHistory}'s identity step: the configured fleet ids plus whoever the send
 * token says it is, once each. A token whose `auth.test` named nobody adds nobody.
 *
 * @param fleetUserIds the profile's ids for the owner and the bot
 * @param selfUserId whoever `auth.test` says the send token is, absent when Slack did not say
 * @returns every id whose top-level post counts as the fleet's
 */
export function fleetIdsWithSelf({
  fleetUserIds,
  selfUserId,
}: {
  fleetUserIds: readonly string[];
  selfUserId: string | undefined;
}): readonly string[] {
  if (selfUserId === undefined) {
    return fleetUserIds;
  }
  return [...new Set([...fleetUserIds, selfUserId])];
}

/**
 * What one `conversations.history` page says to do next. Pure.
 *
 * `has_more` with no cursor is a page Slack says is not the last and gives no way past, so the day is
 * `truncated` rather than read: the posts it withholds are the NEWEST-first tail's older end, where a fleet post
 * from this morning would sit.
 *
 * @param hasMore Slack's `has_more` on the page
 * @param nextCursor Slack's `response_metadata.next_cursor`, absent or empty when it sent none
 * @returns done, the cursor to read next, or truncated
 */
export function historyPageStep({
  hasMore,
  nextCursor,
}: {
  hasMore: boolean | undefined;
  nextCursor: string | undefined;
}): { readonly kind: "done" } | { readonly kind: "next"; readonly cursor: string } | { readonly kind: "truncated" } {
  if (hasMore !== true) {
    return { kind: "done" };
  }
  if (nextCursor === undefined || nextCursor === "") {
    return { kind: "truncated" };
  }
  return { cursor: nextCursor, kind: "next" };
}

/**
 * Whether a `--thread-ts` is a real top-level message in the channel, live: one `conversations.history` read
 * anchored on it, judged by `threadAnchorOf`. A failed read is `unread`, which the gate treats as top-level.
 *
 * @param token the token this send will use
 * @param channel the high-stakes channel's id
 * @param threadTs the thread the send says it replies into
 * @returns present, absent, or why it could not be read
 */
async function liveThreadAnchor({
  token,
  channel,
  threadTs,
}: {
  token: string;
  channel: string;
  threadTs: string;
}): Promise<ThreadAnchor> {
  // devlint: sdk-factory -- one anchored history read, beside liveFleetHistory's own
  const client = new WebClient(token);
  const read = await safeProviderCall({
    execute: () =>
      client.conversations.history({ channel, inclusive: true, latest: threadTs, limit: 1, oldest: threadTs }),
    operation: "slack.conversations.history",
    provider: "slack",
    retryMode: "transient",
    scopeId: scopeIdForToken({ token }),
  });
  if (read.isErr()) {
    return { kind: "unread", reason: `conversations.history: ${read.error.message}` };
  }
  if (read.value.messages === undefined) {
    return { kind: "absent" };
  }
  return threadAnchorOf({ rawMessages: read.value.messages, threadTs });
}

/**
 * The gate's reads and its channel claim, wired to the real profile, home and Slack — one bag every send lane
 * spreads in.
 *
 * @returns the live high-stakes dependencies
 */
export function liveHighStakesDeps(): HighStakesDeps {
  return {
    channelClaim: ({ channel, home, nowIso, take }) =>
      take
        ? takeHighStakesClaim({ alive: pidAlive, channel, home, nowIso, pid: process.pid })
        : peekHighStakesClaim({ alive: pidAlive, channel, home, nowIso }),
    fleetHistory: liveFleetHistory,
    highStakes: ({ home }) => readHighStakesConfig({ home }),
    releaseChannelClaim: releaseHighStakesClaim,
    threadAnchor: liveThreadAnchor,
  };
}

/**
 * Every message in the channel since `oldest`, a page at a time up to {@link MAX_PAGES}.
 *
 * @param client the client under the send token
 * @param channel the channel id
 * @param oldest the Slack `ts` the window opens at
 * @param scopeId the workspace the quota is counted against
 * @returns the raw messages, or why the day could not be read whole
 */
async function readDay({
  client,
  channel,
  oldest,
  scopeId,
}: {
  client: WebClient;
  channel: string;
  oldest: string;
  scopeId: string;
}): Promise<
  | { readonly kind: "read"; readonly rawMessages: readonly unknown[] }
  | { readonly kind: "unread"; readonly reason: string }
> {
  const rawMessages: unknown[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const read = await safeProviderCall({
      execute: () =>
        client.conversations.history({
          channel,
          limit: PAGE_SIZE,
          oldest,
          ...(cursor !== undefined ? { cursor } : {}),
        }),
      operation: "slack.conversations.history",
      provider: "slack",
      retryMode: "transient",
      scopeId,
    });
    if (read.isErr()) {
      return { kind: "unread", reason: `conversations.history: ${read.error.message}` };
    }
    if (read.value.messages !== undefined) {
      rawMessages.push(...read.value.messages);
    }
    const step = historyPageStep({
      hasMore: read.value.has_more,
      nextCursor: optStr({ value: read.value.response_metadata?.next_cursor }),
    });
    if (step.kind === "done") {
      return { kind: "read", rawMessages };
    }
    if (step.kind === "truncated") {
      return { kind: "unread", reason: "Slack said more of the day remains and gave no cursor to read it by" };
    }
    cursor = step.cursor;
  }
  return { kind: "unread", reason: `more than ${String(MAX_PAGES * PAGE_SIZE)} posts in the last day` };
}
