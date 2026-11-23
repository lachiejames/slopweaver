/**
 * One `conversations.history` page, projected — the pure half both live channel reads share: a parked draft's channel
 * tail (`./draftContext.ts`) and the console's channel window (`./channelView.ts`).
 *
 * Each row is projected under its OWN target, because a thread broadcast in the history is a reply whose thread is not
 * the row's own ts — the same move `./neighbourhood.ts`'s `projectChannelHistory` makes — and through
 * `./projection.ts`'s strict projector, so a malformed row refuses the read rather than vanishing from it.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { SlackProjectionError } from "./errors.js";
import type { SlackThreadTarget } from "./permalink.js";
import { projectSlackMessage } from "./projection.js";
import { compareSlackTimestamps } from "./selection.js";
import type { VisibleSlackMessage } from "./types.js";

/** One channel row: the message as projected, and the reply count only a history row carries. */
export interface ChannelRow {
  readonly message: VisibleSlackMessage;
  readonly replyCount: number;
}

/** Slack's `reply_count` on a history row: a non-negative integer, else zero — a row with no replies carries none. */
function replyCountOf({ raw }: { raw: unknown }): number {
  if (!isRecord(raw)) {
    return 0;
  }
  const count = raw["reply_count"];
  if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) {
    return count;
  }
  return 0;
}

/** The thread a history row sits in: its `thread_ts` when it is a broadcast reply, else its own `ts`. */
function rowThreadTs({ raw }: { raw: unknown }): string {
  if (!isRecord(raw)) {
    return "";
  }
  const thread = raw["thread_ts"];
  if (typeof thread === "string") {
    return thread;
  }
  const ts = raw["ts"];
  if (typeof ts === "string") {
    return ts;
  }
  return "";
}

/**
 * A channel's history rows, projected and put oldest first, the order Slack draws them.
 *
 * @param rows one `conversations.history` page, unparsed, newest first as Slack returns it
 * @param workspace the workspace origin off `auth.test`, which every permalink is built from
 * @returns each row projected, or the projection's refusal when a row is not one it can vouch for
 */
export function projectChannelRows({
  rows,
  channel,
  workspace,
}: {
  rows: readonly unknown[];
  channel: string;
  workspace: string;
}): Result<readonly ChannelRow[], SlackProjectionError> {
  const out: ChannelRow[] = [];
  for (const raw of rows) {
    const threadTs = rowThreadTs({ raw });
    const target: SlackThreadTarget = {
      addressedReply: false,
      addressedTs: threadTs,
      channel,
      threadTs,
      workspace,
    };
    const projected = projectSlackMessage({ raw, target });
    if (projected.isErr()) {
      return err(projected.error);
    }
    out.push({ message: projected.value, replyCount: replyCountOf({ raw }) });
  }
  return ok(out.toSorted((left, right) => compareSlackTimestamps({ left: left.message.ts, right: right.message.ts })));
}
