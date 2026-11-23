/*
 * Who a parked draft's message is drawn as — pure, so the unit lane reads it without loading the component
 * (`./SlackDraft.tsx`) that draws it.
 */
import { personLabel } from "../../lib/slackPeople";
import type { ParkedDraft } from "../live/readSlackDrafts";

/**
 * What a bot row's author reads when member bronze cannot name the bot's user id AND the install's profile declares
 * no `slackBot.selfHandles` — the gap said in the name itself, rather than a generic word passing for a handle.
 */
const UNNAMED_BOT = "Bot (profile.json names no handle)";

/**
 * Who a draft's message is drawn as: the member bronze name when it holds the author, else a bot row's first handle
 * the install's profile declares (or the gap, when it declares none), and "You" on the owner's own row — never their
 * name (the card says you). A bot row's author is the bot's own user id, which member bronze rarely
 * holds, so the handle is what keeps the card off a raw id.
 *
 * @param draft the parked draft
 * @returns the author line's name
 */
export function draftAuthorName({ draft }: { draft: ParkedDraft }): string {
  const named = draft.authorId !== undefined && draft.actor !== "me" && draft.people.has(draft.authorId);
  if (named) {
    return personLabel({ id: draft.authorId, people: draft.people }).text;
  }
  if (draft.actor !== "bot") {
    return "You";
  }
  const handle = draft.botHandles?.find((one) => one.trim() !== "");
  if (handle === undefined) {
    return UNNAMED_BOT;
  }
  return handle;
}
