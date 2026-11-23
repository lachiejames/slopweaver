/**
 * The Queue cards a register holding them is the whole fact of — a held reply, a parked post, a parked review — as
 * {@link CurrencyCardCandidate}s. Split from `./currencyCards.ts`, whose header names every kind's floor and facts.
 */
import type { QueueItem } from "../admit/queue.js";
import type { ReviewDraftItem } from "../outbound/github/reviewDraft.js";
import type { SlackDraftItem } from "../outbound/slack/draftRegister.js";
import { type WordsDating, wordsWrittenIso } from "../outbound/slack/draftRevision.js";
import type { CurrencyCardCandidate } from "./currency.js";

/**
 * A card whose register holding it is its whole fact.
 *
 * @param key the card's key
 * @param floorIso the instant that versions it: its park, or a post's current words
 * @param checkedIso when the register was read
 * @param register what held it, in the owner's words
 * @param row the board row that raised it, when its register records one
 * @returns the card
 */
function heldCard({
  key,
  floorIso,
  checkedIso,
  register,
  row,
}: {
  key: string;
  floorIso: string;
  checkedIso: string;
  register: string;
  row: string | undefined;
}): CurrencyCardCandidate {
  return {
    ask: undefined,
    fact: { atIso: checkedIso, by: `${register} still holding it`, kind: "confirmed" },
    floorIso,
    key,
    row,
  };
}

/**
 * Every held reply, as a card.
 *
 * @param items the folded queue
 * @param checkedIso when the queue was read
 * @returns the cards for the rows still held
 */
export function heldReplyCurrencyCards({
  items,
  checkedIso,
}: {
  items: readonly Pick<QueueItem, "id" | "state" | "tsIso">[];
  checkedIso: string;
}): CurrencyCardCandidate[] {
  return items
    .filter((item) => item.state === "held")
    .map((item) =>
      heldCard({
        checkedIso,
        floorIso: item.tsIso,
        key: `draft:${item.id}`,
        register: "the held-reply queue",
        row: undefined,
      }),
    );
}

/**
 * Every post composed as the owner and parked, as a card, carrying the board row that raised it (`--row`) so a
 * ruling on that row bears on it — dropped here, a ruling on its own row would leave the card fresh.
 *
 * @param items the folded draft register
 * @param checkedIso when the register was read
 * @returns the cards for the rows still held
 */
export function slackDraftCurrencyCards({
  items,
  checkedIso,
}: {
  items: readonly (Pick<SlackDraftItem, "id" | "state"> &
    WordsDating & { readonly draft: Pick<SlackDraftItem["draft"], "row"> })[];
  checkedIso: string;
}): CurrencyCardCandidate[] {
  return items
    .filter((item) => item.state === "held")
    .map((item) =>
      heldCard({
        checkedIso,
        floorIso: wordsWrittenIso({ item }),
        key: `post:${item.id}`,
        register: "the draft register",
        row: item.draft.row,
      }),
    );
}

/**
 * Every review parked under the owner's name, as a card.
 *
 * @param items the folded review register
 * @param checkedIso when the register was read
 * @returns the cards for the rows still held
 */
export function reviewDraftCurrencyCards({
  items,
  checkedIso,
}: {
  items: readonly (Pick<ReviewDraftItem, "id" | "state"> & { draft: Pick<ReviewDraftItem["draft"], "tsIso"> })[];
  checkedIso: string;
}): CurrencyCardCandidate[] {
  return items
    .filter((item) => item.state === "held")
    .map((item) =>
      heldCard({
        checkedIso,
        floorIso: item.draft.tsIso,
        key: `review:${item.id}`,
        register: "the review register",
        row: undefined,
      }),
    );
}
