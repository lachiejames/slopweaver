/**
 * Three values a Slack side row stores, read out of a record's id, its payload and its attributes.
 *
 * A leaf of {@link ./project.js}, whose `slackRow` assembles the row: the reaction total, the message's
 * own timestamp and its thread root, each choosing between what the id carried and what the payload did.
 */
import { isRecord } from "#lib/parsers.js";

import { str } from "./bagReaders.js";
import type { SlackTimestamps } from "./slackIds.js";

/**
 * How many reactions a Slack payload records, across every distinct emoji on the message.
 *
 * @param raw the Slack message payload
 * @returns the total count, zero when the message carries none
 */
export function slackReactionCount({ raw }: { raw: Readonly<Record<string, unknown>> | undefined }): number {
  const reactions = raw?.["reactions"];
  if (!Array.isArray(reactions)) {
    return 0;
  }
  let total = 0;
  for (const reaction of reactions) {
    const count = isRecord(reaction) ? reaction["count"] : undefined;
    total += typeof count === "number" ? count : 0;
  }
  return total;
}

/**
 * The message's own timestamp: its id's when the id is a message layout, else the payload's.
 *
 * Written as an `if` chain rather than a `??` ladder because each arm is a different fact about the
 * record and the substitution has to be legible — `.claude/rules/typescript-patterns.md`.
 *
 * @param fromId what the record's own id carried, when it carried anything
 * @param raw the record's provider payload, already redacted
 * @param sourceId the id itself, the last resort for a Slack row with neither
 * @returns the timestamp to store
 */
export function slackMessageTs({
  fromId,
  raw,
  sourceId,
}: {
  fromId: SlackTimestamps | null;
  raw: Readonly<Record<string, unknown>> | undefined;
  sourceId: string;
}): string {
  if (fromId !== null) {
    return fromId.messageTs;
  }
  const fromPayload = str({ bag: raw, key: "ts" });
  if (fromPayload !== null) {
    return fromPayload;
  }
  return sourceId;
}

/**
 * The root of the thread this row sits in, or nothing when it sits in no thread.
 *
 * A top-level message's id gives its own timestamp as the thread root, which is what Slack means by it —
 * `thread_ts` is only ABSENT on a message with no replies, and `content_slack.thread_ts` stays nullable
 * for exactly that. So the id's answer is used only where the payload already agreed there is a thread,
 * and a top-level message with no replies still stores `null` rather than gaining a thread it never had.
 *
 * @param fromId what the record's own id carried, when it carried anything
 * @param raw the record's provider payload, already redacted
 * @param attrs the record's projected attributes, the older place a thread id was written
 * @returns the thread root, or nothing when this row is not in a thread
 */
export function slackThreadTs({
  fromId,
  raw,
  attrs,
}: {
  fromId: SlackTimestamps | null;
  raw: Readonly<Record<string, unknown>> | undefined;
  attrs: Readonly<Record<string, unknown>> | undefined;
}): string | null {
  const declared = str({ bag: raw, key: "thread_ts" });
  const fromAttrs = str({ bag: attrs, key: "threadTs" });
  const inThread = declared !== null || fromAttrs !== null;
  if (fromId !== null && inThread) {
    return fromId.threadTs;
  }
  if (declared !== null) {
    return declared;
  }
  return fromAttrs;
}
