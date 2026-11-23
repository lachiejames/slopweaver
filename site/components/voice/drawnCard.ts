/**
 * Which card a `read_card` or `open_card` key names on one read of the cards, or the refusal the model hears instead:
 * a key that is blank or longer than any card's, a settled act, or a key no loaded register answers to. Pure, and its
 * own file so `./openCardRun.ts` stays under the line cap; every refusal here speaks the key and the unread sources
 * back inside the tool cap.
 */
import { type CardToolPlan, cardToolPlan } from "../../lib/cardToolPlan";
import type { UnreadSource } from "../../lib/talkActionItems";
import { unreadClause } from "../../lib/unreadFit";
import { withRecordUnread } from "../../lib/voiceRecordQueue";
import { TOOL_OUTPUT_MAX } from "../live/talkSession";
import type { OpenCardRan, VoiceCards } from "./openCardRun";

/**
 * The longest key a card tool reads, in UTF-8 bytes. A key is a kind and a register's own id, and a hand step's id can
 * run to hundreds of characters, so this is generous; a refusal speaking it back beside the unread clause's 2 KiB
 * still sits far inside the 24 KiB tool cap.
 */
const CARD_KEY_MAX_BYTES = 4096;

/**
 * A refusal the call answers with, carrying nothing it opened.
 *
 * @param why the sentence the voice hears
 * @param detail the console window's short line
 * @returns the refusal
 */
function refusalOf({ why, detail }: { why: string; detail: string }): OpenCardRan {
  return { answer: { refused: why }, detail, partialFailures: [], readText: false, refused: true };
}

/**
 * The key a call names, or why it is refused before any card is read: blank, or longer than any card's, since every
 * refusal past this point speaks the key back.
 *
 * @param key the model's `key` argument, as it arrived
 * @returns the key, or the refusal
 */
export function cardKeyOf({ key }: { key: unknown }): { readonly key: string } | { readonly refusal: OpenCardRan } {
  if (typeof key !== "string" || key.trim() === "") {
    const why = "key must be the item's key from action_items or read_page, such as ask:<slug>";
    return { refusal: refusalOf({ detail: "no key", why }) };
  }
  const bytes = new TextEncoder().encode(key).length;
  if (bytes > CARD_KEY_MAX_BYTES) {
    const why = `key is ${String(bytes)} bytes, longer than any card's key; use the key from action_items`;
    return { refusal: refusalOf({ detail: "key too long", why }) };
  }
  return { key };
}

/**
 * The card a key resolves to on one read of the cards, or the refusal naming why none does.
 *
 * @param cards one read of what the voice can see
 * @param key the key the model named
 * @returns the plan, or the refusal
 */
export function drawnCard({
  cards,
  key,
}: {
  cards: VoiceCards;
  key: string;
}): { readonly plan: CardToolPlan } | { readonly refusal: OpenCardRan } {
  const { alignment, rows, recentlyLeft, unread, fromPath } = cards;
  const plan = cardToolPlan({ alignment, fromPath, key, recentlyLeft, rows });
  if (plan !== undefined) {
    return { plan };
  }
  // An act a press in any window settled is withheld, and said to be settled, never absent.
  if (alignment.settled.includes(key)) {
    return { refusal: settledRefusal({ key, unread }) };
  }
  // Unloaded registers could hold it, so the answer says which instead of claiming no such card exists.
  let why = `no card on the owner's Queue or Alignment page, nor recently off it, answers to ${key}`;
  if (unread.length > 0) {
    why = `${key} is not among what has loaded; still unread: ${unreadClause({ unread })}`;
  }
  return { refusal: refusalOf({ detail: `${key} not found`, why }) };
}

/**
 * The answer for a key that names an Alignment act the owner has already settled. The settle rests on the owner's own
 * press, but the record read beside it may still be partial, so every source it could not read is named.
 *
 * @param key the key the model named
 * @param unread every source the tool's card reads could not read
 * @returns the refusal, saying it is settled rather than absent
 */
function settledRefusal({ key, unread }: { key: string; unread: readonly UnreadSource[] }): OpenCardRan {
  return {
    answer: withRecordUnread({ answer: { refused: settledWhy({ key }) }, capBytes: TOOL_OUTPUT_MAX, unread }),
    detail: `${key} settled`,
    partialFailures: [],
    readText: false,
    refused: true,
  };
}

/**
 * Why a settled act is refused, in the words the voice hears.
 *
 * @param key the settled key
 * @returns the sentence
 */
export function settledWhy({ key }: { key: string }): string {
  return `${key} is an Alignment act the owner has already settled, so it is no longer open`;
}
