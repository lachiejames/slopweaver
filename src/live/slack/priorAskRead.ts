/**
 * Read an earlier ask whole — the thread its link names, a one-to-one DM's top level after it, and a channel's top
 * level after it — for `slack draft record --asked-before <permalink>` and the release that re-reads it
 * (`../../outbound/slack/priorAsk.ts`).
 *
 * Built on `./ownerReply.ts`'s `readCompleteThread`, so a bare reply link follows its root exactly as `slack
 * replied` does, and on the same DM top-level read, because in a DM the answer lands outside any thread. In a
 * channel a person also answers at the top level rather than in the thread, so
 * the channel's history after ours is read too and handed back APART from the thread, for
 * `../../outbound/slack/topLevelAnswer.ts` to judge. A GROUP DM is read the same way, since its id is a channel's
 * and an answer there lands at the top level too. A read that cannot complete is an error, never an empty
 * exchange: an earlier ask read as unanswered because the read failed is the re-ask this exists to stop.
 */
import { slackTsFromEpochMs, slackTsToEpochMs } from "#lib/slackTs.js";

import type { SlackApi } from "../../corpus/slack/fetch.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { PriorRead, PriorReadMessage } from "../../outbound/slack/priorAsk.js";
import { repeatTextOf } from "../../outbound/slack/repeatMatch.js";
import { dmTopLevelRaw, readCompleteThread } from "./ownerReply.js";
import { fetchCompleteSlackHistory } from "./pagination.js";
import type { SlackThreadTarget } from "./permalink.js";
import { compareSlackTimestamps } from "./selection.js";
import type { VisibleSlackMessage } from "./types.js";

/**
 * How far past ours a channel's top level is read: four calendar days, which holds the rule's one BUSINESS day
 * however a weekend and a daylight-saving change fall. Transport containment only; the rule's own horizon is
 * business time, applied by `../../outbound/slack/topLevelAnswer.ts`.
 */
const CHANNEL_READ_MS = 4 * 24 * 60 * 60 * 1000;

/**
 * How far past its bound the read reaches, now or the four-day cap. Slack's `latest` is exclusive, and a `ts`
 * carries microseconds a millisecond clock drops, so a bound AT now would miss a post at now itself.
 * Nothing exists after now to over-read, and the rule applies its own horizon to whatever is read.
 */
const NOW_PAD_MS = 1000;

/** A Slack `ts`'s two halves; the fraction is microseconds, at most six digits. */
const TS_PARTS = /^(\d+)\.(\d{1,6})$/u;

/**
 * The read's four-day cap, padded as now is, built off our own `ts` to the microsecond: a cap read off a
 * millisecond-rounded ask stops short of, or runs past, a post at its last microseconds.
 *
 * @param addressedTs our message's Slack ts
 * @returns the exclusive `latest` the cap names, or `undefined` when the ts is not one
 */
function capLatest({ addressedTs }: { addressedTs: string }): string | undefined {
  const parts = TS_PARTS.exec(addressedTs);
  if (parts === null) {
    return undefined;
  }
  const seconds = Number(parts[1]) + (CHANNEL_READ_MS + NOW_PAD_MS) / 1000;
  return `${String(seconds)}.${parts[2]!.padEnd(6, "0")}`;
}

/** The most history pages that read walks; a page is up to 999 messages, so a busier window fails closed. */
const CHANNEL_MAX_PAGES = 5;

/**
 * A message's words as a repeat-check reads them; a message carrying only files has none, which is absence by
 * design rather than a failed read.
 */
function wordsOf({ message }: { message: Parameters<typeof repeatTextOf>[0]["message"] }): string {
  const text = repeatTextOf({ message });
  if (text === undefined) {
    return "";
  }
  return text;
}

/**
 * A projected thread message as the judgement reads it.
 *
 * @param message one message of the thread
 * @returns its `ts`, author, subtype and words
 */
function fromVisible({ message }: { message: VisibleSlackMessage }): PriorReadMessage {
  return {
    text: wordsOf({ message: { attachments: message.attachments, text: message.text } }),
    ts: message.ts,
    ...(message.author.userId === undefined ? {} : { userId: message.author.userId }),
    ...(message.author.botId === undefined ? {} : { botId: message.author.botId }),
    ...(message.subtype === undefined ? {} : { subtype: message.subtype }),
  };
}

/**
 * A raw `conversations.history` message as the judgement reads it, or `undefined` when it carries no `ts`.
 *
 * @param raw one message as Slack returned it
 * @returns its `ts`, author, subtype and words
 */
function fromRaw({ raw }: { raw: unknown }): PriorReadMessage | undefined {
  if (!isRecord(raw) || typeof raw["ts"] !== "string") {
    return undefined;
  }
  const { user, bot_id: botId, app_id: appId, subtype } = raw;
  return {
    text: wordsOf({ message: raw }),
    ts: raw["ts"],
    ...(typeof user === "string" ? { userId: user } : {}),
    ...(typeof botId === "string" ? { botId } : {}),
    ...(typeof appId === "string" ? { appId } : {}),
    ...(typeof subtype === "string" ? { subtype } : {}),
  };
}

/** Why a channel's top level after ours did not read whole; each one fails the whole read closed. */
type ChannelTopLevelError =
  | { readonly code: "CHANNEL_READ_UNBOUNDED"; readonly message: string; readonly addressedTs: string }
  | { readonly code: "CHANNEL_READ_INCOMPLETE"; readonly message: string; readonly cause: string }
  | { readonly code: "CHANNEL_MESSAGE_WITHOUT_TS"; readonly message: string; readonly count: number };

/** The one constructor of each {@link ChannelTopLevelError}. */
const ChannelTopLevelErrors = {
  incomplete: ({ cause }: { cause: string }): ChannelTopLevelError => ({
    cause,
    code: "CHANNEL_READ_INCOMPLETE",
    message: `the channel's top level after ours could not be read whole: ${cause}`,
  }),
  unbounded: ({ addressedTs }: { addressedTs: string }): ChannelTopLevelError => ({
    addressedTs,
    code: "CHANNEL_READ_UNBOUNDED",
    message: `the channel's top level after ${addressedTs} could not be bounded: the ask's ts or the clock is unreadable`,
  }),
  withoutTs: ({ count }: { count: number }): ChannelTopLevelError => ({
    code: "CHANNEL_MESSAGE_WITHOUT_TS",
    count,
    message: `the channel's top level returned ${String(count)} message(s) with no Slack ts`,
  }),
} as const;

/**
 * Every raw message as the judgement reads it, refusing the read when one carries no `ts`: an unplaceable message
 * may be the answer, so the read is not whole.
 *
 * @param rawMessages the messages as Slack returned them
 * @returns the messages, or why the read is not whole
 */
function projectedRaw({
  rawMessages,
}: {
  rawMessages: readonly unknown[];
}): Result<readonly PriorReadMessage[], ChannelTopLevelError> {
  const projected = rawMessages.map((raw) => fromRaw({ raw }));
  const kept = projected.filter((message): message is PriorReadMessage => message !== undefined);
  if (kept.length !== projected.length) {
    return err(ChannelTopLevelErrors.withoutTs({ count: projected.length - kept.length }));
  }
  return ok(kept);
}

/**
 * A CHANNEL's top-level messages after ours, for {@link CHANNEL_READ_MS} or until now. A one-to-one DM has none to
 * read here: its top level is the conversation itself, read by `dmTopLevelRaw`.
 *
 * @param target the thread the link resolved to
 * @param deps the Slack read seam and the clock
 * @returns the messages read, empty for a DM, or why the channel would not read whole
 */
async function channelTopLevel({
  target,
  deps,
}: {
  target: SlackThreadTarget;
  deps: { readonly api: Pick<SlackApi, "history">; readonly nowMs: () => number };
}): Promise<Result<readonly PriorReadMessage[], ChannelTopLevelError>> {
  if (target.channel.startsWith("D")) {
    return ok([]);
  }
  const askMs = slackTsToEpochMs({ ts: target.addressedTs });
  const cap = capLatest({ addressedTs: target.addressedTs });
  const nowMs = deps.nowMs();
  if (askMs === undefined || cap === undefined || nowMs < askMs) {
    return err(ChannelTopLevelErrors.unbounded({ addressedTs: target.addressedTs }));
  }
  const atNow = slackTsFromEpochMs({ ms: nowMs + NOW_PAD_MS });
  const history = await fetchCompleteSlackHistory({
    api: deps.api,
    channel: target.channel,
    latest: compareSlackTimestamps({ left: atNow, right: cap }) < 0 ? atNow : cap,
    maxPages: CHANNEL_MAX_PAGES,
    oldest: target.addressedTs,
  });
  if (history.isErr()) {
    return err(ChannelTopLevelErrors.incomplete({ cause: history.error.message }));
  }
  return projectedRaw({ rawMessages: history.value.rawMessages });
}

/**
 * Read the earlier ask a permalink names, whole.
 *
 * @param permalink our earlier message's Slack link
 * @param deps the Slack read seam, under the identity that asked, and the clock the DM read is bounded by
 * @returns the message the link addressed and every message read around it, or why the read did not complete
 */
export async function readPriorAsk({
  permalink,
  deps,
}: {
  permalink: string;
  deps: { readonly api: Pick<SlackApi, "replies" | "history">; readonly nowMs: () => number };
}): Promise<Result<PriorRead>> {
  const thread = await readCompleteThread({ api: deps.api, permalink });
  if (thread.isErr()) {
    return err(thread.error);
  }
  const { target, messages } = thread.value;
  const topLevel = await dmTopLevelRaw({ deps, target });
  if (topLevel.kind === "unreadable") {
    return err([topLevel.why]);
  }
  const read = [
    ...messages.map((message) => fromVisible({ message })),
    ...topLevel.rawMessages
      .map((raw) => fromRaw({ raw }))
      .filter((message): message is PriorReadMessage => message !== undefined),
  ];
  const unique = [...new Map(read.map((message) => [message.ts, message])).values()];
  const channel = await channelTopLevel({ deps, target });
  if (channel.isErr()) {
    return err([channel.error.message]);
  }
  const channelUnique = [...new Map(channel.value.map((message) => [message.ts, message])).values()];
  return ok({ addressedTs: target.addressedTs, channelTopLevel: channelUnique, messages: unique });
}
