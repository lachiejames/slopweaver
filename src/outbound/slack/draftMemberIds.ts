/**
 * Every Slack member id a set of parked drafts would show a reader, so the list verb can resolve each to a name. Split
 * out of `./draftRegister.ts` along that seam: the register owns the rows, this reads ids off them.
 */
import { parkedPayloadShape, type SlackDraftItem } from "./draftRegister.js";

/**
 * Every Slack member id a set of drafts would show a reader: each author, each DM recipient addressed by member
 * id, each person it tags, and each `user`
 * element in its payload, first-seen order, no repeats. The console names these rather than printing the ids
 * because a raw user ID does not say who it resolves to, so the list verb resolves them.
 *
 * @param items the folded rows a list is about to print
 * @returns the distinct member ids
 */
export function draftMemberIds({ items }: { items: readonly SlackDraftItem[] }): readonly string[] {
  const ids = new Set<string>();
  for (const { draft } of items) {
    addDraftMemberIds({ draft, into: ids });
  }
  return [...ids];
}

/**
 * Add one draft's member ids — its author, the person a direct message is addressed to, the people it tags,
 * and every user its payload mentions. A DM addressed by member id is the commonest parked shape and its
 * recipient is often tagged nowhere in the message, so without the destination the card could only print an id.
 */
function addDraftMemberIds({ into, draft }: { into: Set<string>; draft: SlackDraftItem["draft"] }): void {
  if (draft.authorId !== undefined) {
    into.add(draft.authorId);
  }
  if (MEMBER_ID.test(draft.channel)) {
    into.add(draft.channel);
  }
  for (const mention of draft.mentions) {
    if (mention.kind === "person") {
      into.add(mention.target);
    }
  }
  addDrawnWordIds({ draft, into });
  const shape = parkedPayloadShape({ payload: draft.payload });
  if (shape.kind === "drip" && shape.payload.form === "plain") {
    addMentionedIds({ into, text: shape.payload.text });
    return;
  }
  // A bot card's blocks sit inside its wrapper, so the whole payload is walked rather than one known key.
  collectUserIds({ into, value: shape.payload });
}

/**
 * The ids in the words a card draws around a draft — the thread root's author, and every `<@U…>` the root and the why
 * name, since raw user IDs under the What section do not say who they are.
 */
function addDrawnWordIds({ into, draft }: { into: Set<string>; draft: SlackDraftItem["draft"] }): void {
  if (draft.threadParent !== undefined) {
    if (draft.threadParent.userId !== undefined) {
      into.add(draft.threadParent.userId);
    }
    addMentionedIds({ into, text: draft.threadParent.text });
  }
  addMentionedIds({ into, text: draft.why });
}

/** Every member a piece of mrkdwn text mentions, `<@U…>` with or without its label. */
function addMentionedIds({ into, text }: { into: Set<string>; text: string }): void {
  for (const match of text.matchAll(PLAIN_USER_MENTION)) {
    into.add(match[1]!);
  }
}

/** A member id as a whole destination — a DM addressed by user id rather than by its `D…` conversation id. */
const MEMBER_ID = /^[UW][A-Z0-9]+$/;

/** A user mention in mrkdwn text —`<@U…>` or `<@W…>`, with or without a `|label`. */
const PLAIN_USER_MENTION = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g;

/** Walk a payload for every rich-text `user` element's `user_id`. */
function collectUserIds({ into, value }: { into: Set<string>; value: unknown }): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectUserIds({ into, value: item });
    }
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  const entries = Object.entries(value);
  const isUser = entries.some(([key, field]) => key === "type" && field === "user");
  for (const [key, field] of entries) {
    if (isUser && key === "user_id" && typeof field === "string") {
      into.add(field);
    }
    collectUserIds({ into, value: field });
  }
}
