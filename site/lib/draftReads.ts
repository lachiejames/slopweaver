/**
 * Whether a parked draft's card reads the conversation it lands in. Only a HELD draft does — a sent or dropped one is
 * history — and never a DM addressed by member id, which has no conversation until it is sent (the same test
 * `slack draft context` refuses on, `DRAFT_CONTEXT_NO_CONVERSATION`).
 *
 * Pure, and its own module so the conversation slot (`../components/console/DraftConversation.tsx`) and the card's
 * thread property (`./cardProperties.ts`) cannot disagree about it.
 */
import type { ParkedDraft } from "../components/live/readSlackDrafts";

/** A DM addressed by member id. */
const MEMBER_DESTINATION = /^[UW][A-Z0-9]+$/u;

/**
 * Whether the card reads the conversation this draft lands in.
 *
 * @returns `true` for a held draft into a channel, a thread or a DM conversation
 */
export function readsConversation({ draft }: { draft: Pick<ParkedDraft, "channel" | "state"> }): boolean {
  return draft.state === "held" && !MEMBER_DESTINATION.test(draft.channel);
}
