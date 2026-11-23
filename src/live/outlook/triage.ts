/**
 * `outlook triage` — the inbox's newest messages grouped by sender, newest group first. Headers only: the
 * listing selects no body, so triage reads who sent what and when, never what it said.
 *
 * A sender is keyed by address, case-insensitively, and shown by the name on its newest message. A message
 * with no sender address (some system mail) is grouped under its display name instead, and one with neither
 * under `(unknown sender)`, so nothing in the inbox drops out of the count.
 *
 * Deliberately not Gmail's triage: no `--write`, no pinning, no Queue card. Those are cross-provider Queue
 * work deferred from this door, named on its follow-up card.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { OutlookApi } from "./apiCore.js";
import { type OutlookError } from "./errors.js";
import { listOutlookMessages, type OutlookMessageSummary } from "./messages.js";

/** One sender's messages. */
export interface OutlookSenderGroup {
  readonly key: string;
  readonly name: string | null;
  readonly address: string | null;
  readonly count: number;
  readonly unread: number;
  readonly newestIso: string | null;
  readonly messages: readonly {
    readonly id: string;
    readonly subject: string | null;
    readonly receivedIso: string | null;
    readonly isRead: boolean;
  }[];
}

/** What `outlook triage` answers. */
export interface OutlookTriage {
  readonly groups: readonly OutlookSenderGroup[];
  readonly messages: number;
  /** True when the inbox holds more than `limit` messages, so the grouping covers only the newest. */
  readonly more: boolean;
}

/** How a message's sender is keyed: its address lower-cased, else its name, else a fixed placeholder. */
function senderKey({ message }: { message: OutlookMessageSummary }): string {
  const { from } = message;
  if (from?.address != null) {
    return from.address.toLowerCase();
  }
  if (from?.name != null) {
    return `name:${from.name}`;
  }
  return "(unknown sender)";
}

/**
 * Group messages by sender, newest group first; within a group, newest first. Pure.
 *
 * @param messages the listing, in any order
 * @returns one group per sender
 */
export function groupBySender({
  messages,
}: {
  messages: readonly OutlookMessageSummary[];
}): readonly OutlookSenderGroup[] {
  const received = (message: OutlookMessageSummary): string => {
    // An undated message (an unsent draft) sorts as the oldest; an early return, because the ternary spelling
    // is what `prefer-nullish-coalescing` rewrites into the `??` that `no-silent-fallback` refuses.
    if (message.receivedIso === null) {
      return "";
    }
    return message.receivedIso;
  };
  const newestFirst = messages.toSorted((a, b) => received(b).localeCompare(received(a)) || a.id.localeCompare(b.id));
  const groups = new Map<string, OutlookMessageSummary[]>();
  for (const message of newestFirst) {
    const key = senderKey({ message });
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [message]);
    } else {
      group.push(message);
    }
  }
  return [...groups.entries()].map(([key, members]) => {
    const newest = members[0]!;
    return {
      address: newest.from === null ? null : newest.from.address,
      count: members.length,
      key,
      messages: members.map((member) => ({
        id: member.id,
        isRead: member.isRead,
        receivedIso: member.receivedIso,
        subject: member.subject,
      })),
      name: newest.from === null ? null : newest.from.name,
      newestIso: newest.receivedIso,
      unread: members.filter((member) => !member.isRead).length,
    };
  });
}

/**
 * Read the inbox's newest messages and group them by sender.
 *
 * @param limit how many of the newest inbox messages to group, 1..100
 * @returns the grouping, or why the inbox could not be read
 */
export async function triageOutlook({
  api,
  limit,
}: {
  api: OutlookApi;
  limit: number;
}): Promise<Result<OutlookTriage, OutlookError>> {
  const listing = await listOutlookMessages({
    api,
    folderId: "inbox",
    limit,
    query: undefined,
    unreadOnly: false,
  });
  if (listing.isErr()) {
    return err(listing.error);
  }
  return ok({
    groups: groupBySender({ messages: listing.value.messages }),
    messages: listing.value.messages.length,
    more: listing.value.more,
  });
}
