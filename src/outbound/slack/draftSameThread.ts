/**
 * One thread's replies as the owner wait on their queue as ONE card, never one card per reply.
 *
 * Five replies to one thread parked as five queue cards land in no known order, so they merge into one reply in the
 * owner's voice. So `slack draft record --thread-ts` refuses a reply into a thread that already holds one under the same
 * identity, unless `--supersedes` names every held reply there: the recording session composes ONE reply covering
 * all of them, and parking it drops the rest (`../../cli/commands/slack/draftPark.ts`'s `parkAndReport`).
 *
 * The merge is composed, never concatenated: one reply that sounds like the owner, which only the session holding
 * the drafts can write. Identity is the row's `actor` — the owner, or the bot — because one post cannot go
 * out under both names, and because it is known before any Slack read. Pure: rows in.
 *
 * ## No hatch, and the refusal says so
 *
 * The merged re-cut is always available, and an override would only ever put a second card for the same thread on
 * the owner's queue — the thing the owner's word removes.
 */
import type { SlackDraftItem } from "./draftRegister.js";

/**
 * Every HELD reply already parked in a thread under one identity, oldest first.
 *
 * @param actor whose name the new reply goes out under
 * @param channel the conversation the thread lives in
 * @param threadTs the thread's root `ts`
 * @param items every folded row
 * @returns the held replies a reply into that thread would sit beside
 */
export function heldRepliesInThread({
  actor,
  channel,
  items,
  threadTs,
}: {
  actor: "me" | "bot";
  channel: string;
  items: readonly SlackDraftItem[];
  threadTs: string;
}): readonly SlackDraftItem[] {
  return items
    .filter(
      (item) =>
        item.state === "held" &&
        item.draft.shape === "thread" &&
        item.draft.channel === channel &&
        item.draft.threadTs === threadTs &&
        actorOf({ item }) === actor,
    )
    .toSorted((left, right) => left.draft.tsIso.localeCompare(right.draft.tsIso));
}

/** Whose name a row goes out under: `bot` when recorded `--as bot`, the owner otherwise. */
function actorOf({ item }: { item: SlackDraftItem }): "me" | "bot" {
  if (item.draft.actor === "bot") {
    return "bot";
  }
  return "me";
}

/**
 * Refuse to park a second card for one thread, naming every held reply there and the merged re-cut that takes their
 * place. Returns an EMPTY list for a top-level recording, a thread holding nothing under this identity, or a
 * `--supersedes` naming every held reply, so a caller asks unconditionally.
 *
 * @param actor whose name the new reply goes out under
 * @param channel the conversation the recording names
 * @param threadTs the root the recording replies under, absent for a top-level post
 * @param supersedes the held rows the recording re-cuts
 * @param items every folded row
 * @returns the hold's lines, or nothing when the reply may park
 */
export function sameThreadRefusal({
  actor,
  channel,
  items,
  supersedes,
  threadTs,
}: {
  actor: "me" | "bot";
  channel: string;
  items: readonly SlackDraftItem[];
  supersedes: readonly string[];
  threadTs: string | undefined;
}): readonly string[] {
  if (threadTs === undefined) {
    return [];
  }
  const held = heldRepliesInThread({ actor, channel, items, threadTs });
  const unnamed = held.filter((item) => !supersedes.includes(item.id));
  if (unnamed.length === 0) {
    return [];
  }
  const whose = actor === "bot" ? "as the bot" : "as the owner";
  const all = held.map((item) => item.id);
  return [
    `slack draft record: REFUSING to park another reply ${whose} into thread ${threadTs} in ${channel} — ` +
      `${unnamed.map((item) => item.id).join(", ")} ${unnamed.length === 1 ? "is" : "are"} already held there, and one ` +
      "thread's replies are ONE queue card, merged into a single one.",
    `Compose ONE reply in the owner's voice that covers ${all.length === 1 ? "that draft" : "every one of them"} and this one ` +
      `(read ${all.length === 1 ? "it" : "each"} with \`slopweaver slack draft show <id>\`), then record it with ` +
      `--supersedes ${all.join(",")}, which drops ${all.length === 1 ? "it" : "them"} the moment the merged reply parks.`,
    "There is deliberately NO escape hatch: the merged re-cut is always available, and a second card for one thread " +
      "is the thing the owner's word removes.",
  ];
}
