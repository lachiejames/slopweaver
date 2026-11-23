/**
 * The audit half of the repeat rule: every repeat already standing in Slack under one identity, grouped by
 * place, with the copy to keep and the copies to delete. Pure — the messages are read by
 * `cli/commands/slack/repeatsRun.ts` and handed in.
 *
 * It judges with `./repeatMatch.ts`, the same matcher the send guard refuses with, so "what the audit calls a
 * repeat" and "what a send is refused for" cannot drift apart. Two windows, stated rather than implied:
 *
 * - a GROUP (the near-duplicate rule: "same digest, or same first line in the same place within a day")
 *   joins two messages with the same digest inside {@link REPEAT_WINDOW_DAYS}, or the same counted first line
 *   inside one day;
 * - `wouldRefuse` lists every message the SEND guard would have refused — both rules over the full
 *   {@link REPEAT_WINDOW_DAYS} — which is how a legitimate recurring post is found before the guard ships.
 *
 * **Which copy is kept.** The earliest among those carrying the most files: "keep the earliest complete copy".
 * A copy somebody else has replied under is never offered for deletion, because deleting a parent strands the
 * replies; it is marked `review` instead.
 */
import { DAY_MS, findRepeat, REPEAT_WINDOW_DAYS, type RepeatPrior } from "./repeatMatch.js";

/** Whose name a message went out under. */
export type RepeatActor = "me" | "bot";

/** One of this identity's own messages, as the audit reads it. */
export interface AuditMessage extends RepeatPrior {
  readonly actor: RepeatActor;
  /** How many files ride on the message. */
  readonly fileCount: number;
  /** Whether somebody other than this identity has replied under it. */
  readonly othersReplied: boolean;
}

/** What to do with one member of a group. */
type AuditVerdict = "keep" | "delete" | "review";

/** One member of a repeat group. */
interface AuditMember {
  readonly message: AuditMessage;
  readonly verdict: AuditVerdict;
  /** The exact command that deletes it, present on a `delete`. */
  readonly deleteCommand?: string | undefined;
}

/** One set of messages that repeat each other in one place. */
interface RepeatGroup {
  readonly actor: RepeatActor;
  readonly channel: string;
  readonly threadTs?: string | undefined;
  /** The rule that first joined the group: `digest` when any pair matched whole, else `first-line`. */
  readonly rule: "digest" | "first-line";
  readonly firstLine: string;
  /** Earliest first. */
  readonly members: readonly AuditMember[];
}

/** A message the send guard would have refused, and the prior it would have named. */
interface WouldRefuse {
  readonly message: AuditMessage;
  readonly rule: "digest" | "first-line";
  readonly prior: RepeatPrior;
}

/** The whole audit. */
export interface RepeatAudit {
  readonly days: number;
  readonly messagesRead: number;
  readonly placesRead: number;
  readonly groups: readonly RepeatGroup[];
  readonly wouldRefuse: readonly WouldRefuse[];
  /** Every place that could not be read completely, with why. An audit with any is incomplete. */
  readonly unread: readonly string[];
}

/** The key a place is grouped by: identity, channel and thread. */
function placeKey({ message }: { message: AuditMessage }): string {
  if (message.threadTs === undefined) {
    return `${message.actor} ${message.channel} -`;
  }
  return `${message.actor} ${message.channel} ${message.threadTs}`;
}

/** Messages bucketed by place, each bucket earliest first. */
function byPlace({ messages }: { messages: readonly AuditMessage[] }): readonly (readonly AuditMessage[])[] {
  const places = new Map<string, AuditMessage[]>();
  for (const message of messages) {
    const key = placeKey({ message });
    const bucket = places.get(key);
    if (bucket === undefined) {
      places.set(key, [message]);
    } else {
      bucket.push(message);
    }
  }
  return [...places.values()].map((bucket) => bucket.toSorted((left, right) => left.tsMs - right.tsMs));
}

/** Union-find root, with path halving. */
function rootOf({ parent, index }: { parent: number[]; index: number }): number {
  let at = index;
  while (parent[at] !== at) {
    const up = parent[at]!;
    parent[at] = parent[up]!;
    at = up;
  }
  return at;
}

/**
 * The command that deletes one message under the identity that posted it.
 *
 * @param message the message to delete
 * @returns the exact `slack delete` invocation
 */
function deleteCommandOf({ message }: { message: AuditMessage }): string {
  return `slopweaver slack delete --as ${message.actor} --channel ${message.channel} --ts ${message.ts}`;
}

/**
 * Keep the earliest of the copies carrying the most files; delete the rest, or mark one somebody else replied
 * under for review.
 *
 * @param members one group's messages, earliest first
 * @returns every member with its verdict, earliest first
 */
function keepAndDelete({ members }: { members: readonly AuditMessage[] }): readonly AuditMember[] {
  const mostFiles = Math.max(...members.map((message) => message.fileCount));
  const kept = members.find((message) => message.fileCount === mostFiles)!;
  return members.map((message) => {
    if (message === kept) {
      return { message, verdict: "keep" };
    }
    if (message.othersReplied) {
      return { message, verdict: "review" };
    }
    return { deleteCommand: deleteCommandOf({ message }), message, verdict: "delete" };
  });
}

/** The groups inside ONE place, by union of every matching pair. */
function groupsInPlace({ place }: { place: readonly AuditMessage[] }): readonly RepeatGroup[] {
  const parent = place.map((_, index) => index);
  const digestJoined = new Set<number>();
  place.forEach((later, laterIndex) => {
    const earlier = place.slice(0, laterIndex);
    for (const [earlierIndex, prior] of earlier.entries()) {
      const match = findRepeat({
        digestWindowMs: REPEAT_WINDOW_DAYS * DAY_MS,
        firstLineWindowMs: DAY_MS,
        nowMs: later.tsMs,
        outgoing: later.identity,
        priors: [prior],
      });
      if (match === undefined) {
        continue;
      }
      parent[rootOf({ index: laterIndex, parent })] = rootOf({ index: earlierIndex, parent });
      if (match.rule === "digest") {
        digestJoined.add(laterIndex);
      }
    }
  });
  const buckets = new Map<number, number[]>();
  place.forEach((_, index) => {
    const root = rootOf({ index, parent });
    const bucket = buckets.get(root);
    if (bucket === undefined) {
      buckets.set(root, [index]);
      return;
    }
    bucket.push(index);
  });
  return [...buckets.values()]
    .filter((indices) => indices.length > 1)
    .map((indices) => {
      const members = indices.map((index) => place[index]!);
      const first = members[0]!;
      return {
        actor: first.actor,
        channel: first.channel,
        firstLine: first.firstLine,
        members: keepAndDelete({ members }),
        rule: indices.some((index) => digestJoined.has(index)) ? "digest" : "first-line",
        threadTs: first.threadTs,
      };
    });
}

/**
 * Every message the send guard would have refused: each one checked against the earlier messages in its
 * place under both rules over the full window.
 *
 * @param place one place's messages, earliest first
 * @returns the refusals, in time order
 */
function refusalsInPlace({ place }: { place: readonly AuditMessage[] }): readonly WouldRefuse[] {
  const refused: WouldRefuse[] = [];
  place.forEach((message, index) => {
    const match = findRepeat({
      digestWindowMs: REPEAT_WINDOW_DAYS * DAY_MS,
      firstLineWindowMs: REPEAT_WINDOW_DAYS * DAY_MS,
      nowMs: message.tsMs,
      outgoing: message.identity,
      priors: place.slice(0, index),
    });
    if (match !== undefined) {
      refused.push({ message, prior: match.prior, rule: match.rule });
    }
  });
  return refused;
}

/**
 * The whole audit over every message read.
 *
 * @param messages every own message read, any order, both identities
 * @param days the window the read covered
 * @param placesRead how many places were read completely
 * @param unread every place that could not be read, with why
 * @returns the groups, the would-refuse list and the read's own coverage
 */
export function repeatAudit({
  messages,
  days,
  placesRead,
  unread,
}: {
  messages: readonly AuditMessage[];
  days: number;
  placesRead: number;
  unread: readonly string[];
}): RepeatAudit {
  const places = byPlace({ messages });
  return {
    days,
    groups: places.flatMap((place) => groupsInPlace({ place })),
    messagesRead: messages.length,
    placesRead,
    unread,
    wouldRefuse: places.flatMap((place) => refusalsInPlace({ place })),
  };
}

/** One member as a text line. */
function memberLine({ member }: { member: AuditMember }): string {
  const { message, verdict } = member;
  const files = message.fileCount > 0 ? ` · ${String(message.fileCount)} file(s)` : "";
  const replied = message.othersReplied ? " · others replied" : "";
  return `    ${verdict.padEnd(6)} ${new Date(message.tsMs).toISOString()} ${message.permalink}${files}${replied}`;
}

/**
 * The audit for a person to read: each group with its members and verdicts, then the would-refuse list.
 *
 * @returns the lines to print
 */
export function renderRepeatsText({ audit }: { audit: RepeatAudit }): readonly string[] {
  const lines = [
    `slack repeats: ${String(audit.groups.length)} group(s) over ${String(audit.days)} day(s) — ` +
      `${String(audit.messagesRead)} own message(s) in ${String(audit.placesRead)} place(s)`,
  ];
  for (const group of audit.groups) {
    const thread = group.threadTs === undefined ? "" : ` thread ${group.threadTs}`;
    lines.push(`  ${group.actor} · ${group.channel}${thread} · ${group.rule} · "${group.firstLine.slice(0, 90)}"`);
    lines.push(...group.members.map((member) => memberLine({ member })));
    lines.push(
      ...group.members.flatMap((member) =>
        member.deleteCommand === undefined ? [] : [`      ${member.deleteCommand}`],
      ),
    );
  }
  lines.push(`would refuse at send: ${String(audit.wouldRefuse.length)}`);
  for (const refusal of audit.wouldRefuse) {
    lines.push(`  ${refusal.rule} · ${refusal.message.permalink} repeats ${refusal.prior.permalink}`);
  }
  for (const place of audit.unread) {
    lines.push(`UNREAD: ${place}`);
  }
  return lines;
}

/**
 * The audit as one JSON document, keys in a fixed order.
 *
 * @returns the document
 */
export function renderRepeatsJson({ audit }: { audit: RepeatAudit }): string {
  const member = ({ message, verdict, deleteCommand }: AuditMember) => ({
    deleteCommand,
    fileCount: message.fileCount,
    othersReplied: message.othersReplied,
    permalink: message.permalink,
    ts: message.ts,
    verdict,
  });
  return JSON.stringify(
    {
      days: audit.days,
      groups: audit.groups.map((group) => ({
        actor: group.actor,
        channel: group.channel,
        firstLine: group.firstLine,
        members: group.members.map(member),
        rule: group.rule,
        threadTs: group.threadTs,
      })),
      messagesRead: audit.messagesRead,
      placesRead: audit.placesRead,
      unread: audit.unread,
      wouldRefuse: audit.wouldRefuse.map((refusal) => ({
        permalink: refusal.message.permalink,
        prior: refusal.prior.permalink,
        rule: refusal.rule,
      })),
    },
    null,
    2,
  );
}
