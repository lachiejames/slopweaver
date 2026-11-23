/**
 * The order a held draft's card draws the conversation it lands in. A re-ask whose card draws
 * the thread's newest messages and only THEN our earlier message, in a box of its own, reads out of time order and
 * the owner cannot tell what was asked when. So a card reads the way the conversation happened — our earlier message
 * at the top, an ellipsis for what was said between, the conversation as it stands today with its latest messages,
 * then the draft against that.
 *
 * Pure, and its own module so the conversation slot (`../components/console/DraftConversation.tsx`) and where the
 * card puts its "Asked before" box (`../components/console/SlackDraft.tsx`) cannot disagree about whether the earlier
 * message is drawn in place.
 */

/** How many of the conversation's latest messages are drawn open; the rest fold (rule 7). */
export const OPEN_MESSAGES = 3;

/**
 * One stretch of the conversation, in the order the card draws it: a message drawn open (the earlier ask is the
 * anchor), a run of messages folded behind one line — `earlier` ones above the first open message, or the ones
 * `between` the earlier ask and the latest — or the note that nothing was said after the earlier ask.
 */
export type ChronologySegment<M extends { readonly ts: string }> =
  | { readonly kind: "message"; readonly message: M; readonly anchor: boolean }
  | { readonly kind: "fold"; readonly place: "earlier" | "between"; readonly messages: readonly M[] }
  | { readonly kind: "quiet-since" };

/** A fold, when it holds anything. */
function foldOf<M extends { readonly ts: string }>({
  messages,
  place,
}: {
  messages: readonly M[];
  place: "earlier" | "between";
}): ChronologySegment<M>[] {
  if (messages.length === 0) {
    return [];
  }
  return [{ kind: "fold", messages, place }];
}

/** Messages drawn open, none of them the anchor. */
function openOf<M extends { readonly ts: string }>({ messages }: { messages: readonly M[] }): ChronologySegment<M>[] {
  return messages.map((message) => ({ anchor: false, kind: "message", message }));
}

/**
 * Whether the earlier ask a draft repeats is one of the messages the conversation read holds — so the card draws it in
 * place rather than in a box of its own.
 *
 * @param anchorTs the earlier ask's own ts, when the draft declared one
 * @returns `true` when a message of the conversation carries that ts
 */
export function priorAskInConversation<M extends { readonly ts: string }>({
  messages,
  anchorTs,
}: {
  messages: readonly M[];
  anchorTs: string | undefined;
}): boolean {
  return anchorTs !== undefined && messages.some((message) => message.ts === anchorTs);
}

/**
 * The conversation as the card draws it, oldest first. With the earlier ask in it: everything before it folded, the
 * ask open, the messages between it and the latest folded behind the ellipsis, then the latest few after it — or a
 * note that nothing was said since. Without it: a thread's root and its latest replies open, a channel's latest
 * messages open, everything between folded.
 *
 * @param messages the conversation, oldest first
 * @param scope a reply's whole `thread`, or a top-level post's `channel` tail
 * @param anchorTs the earlier ask's own ts, when the draft repeats one
 * @returns the segments, in drawing order
 */
export function draftChronology<M extends { readonly ts: string }>({
  messages,
  scope,
  anchorTs,
}: {
  messages: readonly M[];
  scope: "thread" | "channel";
  anchorTs: string | undefined;
}): readonly ChronologySegment<M>[] {
  const at = messages.findIndex((message) => message.ts === anchorTs);
  if (anchorTs !== undefined && at >= 0) {
    const after = messages.slice(at + 1);
    const cut = Math.max(0, after.length - OPEN_MESSAGES);
    const quiet: ChronologySegment<M>[] = after.length === 0 ? [{ kind: "quiet-since" }] : [];
    return [
      ...foldOf({ messages: messages.slice(0, at), place: "earlier" }),
      { anchor: true, kind: "message", message: messages[at] },
      ...foldOf({ messages: after.slice(0, cut), place: "between" }),
      ...openOf({ messages: after.slice(cut) }),
      ...quiet,
    ];
  }
  if (scope === "thread" && messages.length > 0) {
    const replies = messages.slice(1);
    const cut = Math.max(0, replies.length - OPEN_MESSAGES);
    return [
      ...openOf({ messages: messages.slice(0, 1) }),
      ...foldOf({ messages: replies.slice(0, cut), place: "earlier" }),
      ...openOf({ messages: replies.slice(cut) }),
    ];
  }
  const cut = Math.max(0, messages.length - OPEN_MESSAGES);
  return [
    ...foldOf({ messages: messages.slice(0, cut), place: "earlier" }),
    ...openOf({ messages: messages.slice(cut) }),
  ];
}
