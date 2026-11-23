/**
 * `action_items` fitted inside the page's tool cap by construction, so the voice can always name and open a card.
 *
 * ## Why it has a budget of its own
 *
 * `action_items` takes no arguments, so the model cannot ask for less of it. Measured: 18 queue items and the departed cards, every free-text field in full and `top` a second copy of the
 * first, crossed the page's tool cap (`components/live/talkSession.ts`'s `TOOL_OUTPUT_MAX`, 24 KiB), the
 * whole answer was swapped for a notice, and the voice told the owner "the live lookup is failing on size" while they
 * asked it to bring up a card on their Queue. Nothing in the answer reached the model, keys included.
 *
 * ## What is kept, in order
 *
 * 1. Every listed card's key and subject, in `itemNames`/`recentlyLeftNames` — what "open the Fathom card" resolves
 *    against. A name is the last thing shed, because without it nothing can be opened.
 * 2. Each long field, visibly shortened past {@link ITEM_FIELD_MAX_BYTES} with an ellipsis.
 * 3. Full detail from the top of the ranking down: the departed cards' details go first, then the queue's from the
 *    lowest-ranked tail, the top blocker's last of all.
 *
 * Every shortening and every shed detail is said in the answer's `cut` line, never done silently.
 */

import type { SpokenLeft } from "./talkActionItems";
import type { SpokenItem } from "./talkActionItemsSpoken";

/**
 * The most one `action_items` answer weighs, in UTF-8 bytes of its serialisation. The page's tool cap counts
 * UTF-16 code units, and no string serialises to fewer UTF-8 bytes than code units, so this sits inside it.
 */
export const ACTION_ITEMS_MAX_BYTES = 20 * 1024;

/** The most one free-text field of a card carries, JSON-escaped, in UTF-8 bytes. */
export const ITEM_FIELD_MAX_BYTES = 600;

/** The most a subject in the key-and-subject index carries, JSON-escaped, in UTF-8 bytes. */
export const NAME_SUBJECT_MAX_BYTES = 200;

/** A card named by what opens it and what it is about — the index the voice resolves a spoken card against. */
export interface SpokenItemName {
  readonly key: string;
  readonly subject: string;
}

/** The answer's fields this module fits; the rest pass through as they are. */
export interface FittableAnswer {
  readonly items: readonly SpokenItem[];
  readonly recentlyLeft: readonly SpokenLeft[];
  readonly top: SpokenItemName | undefined;
  readonly beyondCap: { readonly more: boolean; readonly marked: boolean; readonly parked: boolean };
  readonly recentlyLeftBeyondCap: number;
  readonly cut: string | undefined;
}

/** A string's UTF-8 size once JSON-escaped, without its quotes. */
function escapedBytes({ text }: { text: string }): number {
  return new TextEncoder().encode(JSON.stringify(text)).length - 2;
}

/** A value's UTF-8 size once serialised. */
function serialisedBytes({ value }: { value: unknown }): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * The longest grapheme-whole prefix of a string whose JSON-escaped form fits a byte budget, ellipsis included.
 *
 * Escaped rather than raw, because a control character escapes to six bytes and a quote to two; a raw count lets a
 * field the budget admitted serialise past it.
 *
 * @param text the string to fit
 * @param maxBytes the escaped UTF-8 budget, ellipsis included
 * @returns the string, and whether it was shortened
 */
export function fitJsonString({ text, maxBytes }: { text: string; maxBytes: number }): {
  readonly text: string;
  readonly cut: boolean;
} {
  if (escapedBytes({ text }) <= maxBytes) {
    return { cut: false, text };
  }
  const ellipsis = " …";
  let used = escapedBytes({ text: ellipsis });
  let kept = "";
  for (const { segment } of new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)) {
    const size = escapedBytes({ text: segment });
    if (used + size > maxBytes) {
      break;
    }
    kept += segment;
    used += size;
  }
  return { cut: true, text: `${kept}${ellipsis}` };
}

/**
 * A field fitted to a byte budget, counting a shortening into `shortened`.
 *
 * @param value the field's text
 * @param maxBytes the escaped UTF-8 budget
 * @param shortened the running count of shortened fields, incremented in place
 * @returns the field as it is sent
 */
function fitField({
  value,
  maxBytes,
  shortened,
}: {
  value: string;
  maxBytes: number;
  shortened: { count: number };
}): string {
  const fitted = fitJsonString({ maxBytes, text: value });
  if (fitted.cut) {
    shortened.count += 1;
  }
  return fitted.text;
}

/**
 * An optional field fitted to {@link ITEM_FIELD_MAX_BYTES}, left absent where the register records none.
 *
 * @param value the field, absent where the register records none
 * @param shortened the running count of shortened fields, incremented in place
 * @returns the field as it is sent
 */
function fitOptional({
  value,
  shortened,
}: {
  value: string | undefined;
  shortened: { count: number };
}): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return fitField({ maxBytes: ITEM_FIELD_MAX_BYTES, shortened, value });
}

/**
 * One card with each free-text field fitted to {@link ITEM_FIELD_MAX_BYTES}.
 *
 * @param item the card as flattened
 * @param shortened the running count of shortened fields, incremented in place
 * @returns the card as it is sent
 */
export function fitSpokenItem<T extends SpokenItem>({ item, shortened }: { item: T; shortened: { count: number } }): T {
  const fit = ({ value }: { value: string | undefined }): string | undefined => fitOptional({ shortened, value });
  return {
    ...item,
    ifSilent: fit({ value: item.ifSilent }),
    lean: fit({ value: item.lean }),
    problem: fit({ value: item.problem }),
    question: fitField({ maxBytes: ITEM_FIELD_MAX_BYTES, shortened, value: item.question }),
    refused: fit({ value: item.refused }),
    subject: fitField({ maxBytes: ITEM_FIELD_MAX_BYTES, shortened, value: item.subject }),
    unblocks: fit({ value: item.unblocks }),
    whyYou: fit({ value: item.whyYou }),
    workspaceMark: fit({ value: item.workspaceMark }),
  };
}

/**
 * A departed card with each free-text field fitted, its removal's reason included.
 *
 * @param item the departed card as flattened
 * @param shortened the running count of shortened fields, incremented in place
 * @returns the departed card as it is sent
 */
export function fitSpokenLeft({ item, shortened }: { item: SpokenLeft; shortened: { count: number } }): SpokenLeft {
  const why = fitField({ maxBytes: ITEM_FIELD_MAX_BYTES, shortened, value: item.removed.why });
  return { ...fitSpokenItem({ item, shortened }), removed: { ...item.removed, why } };
}

/**
 * A card's entry in the key-and-subject index, its subject fitted to {@link NAME_SUBJECT_MAX_BYTES}.
 *
 * @param item the card, or anything carrying its key and subject
 * @param shortened the running count of shortened fields, incremented in place
 * @returns the index entry
 */
export function spokenNameOf({
  item,
  shortened,
}: {
  item: { readonly key: string; readonly subject: string };
  shortened: { count: number };
}): SpokenItemName {
  return { key: item.key, subject: fitField({ maxBytes: NAME_SUBJECT_MAX_BYTES, shortened, value: item.subject }) };
}

/**
 * The line saying what the budget cost, or `undefined` when it cost nothing.
 *
 * @param maxBytes the budget
 * @param shortened how many fields were shortened
 * @param shedItems how many queue cards were kept as names only
 * @param shedLeft how many departed cards were kept as names only
 * @returns the line, said whenever the answer is not whole
 */
function cutLine({
  maxBytes,
  shortened,
  shedItems,
  shedLeft,
}: {
  maxBytes: number;
  shortened: number;
  shedItems: number;
  shedLeft: number;
}): string | undefined {
  if (shortened === 0 && shedItems === 0 && shedLeft === 0) {
    return undefined;
  }
  // Which cards were shed, never how many: a number of cards here is one the page never printed.
  const shed: string[] = [];
  if (shedItems > 0) {
    shed.push("queue cards");
  }
  if (shedLeft > 0) {
    shed.push("departed cards");
  }
  let listed = "";
  if (shed.length > 0) {
    listed = `, and some ${shed.join(" and ")} are listed by key and subject only`;
  }
  return `action_items carries ${String(maxBytes)} bytes: ${String(shortened)} long field(s) end in "…"${listed}`;
}

/**
 * The answer inside a byte budget: departed cards' details shed from the tail first, then the queue's from the
 * lowest-ranked tail, the top blocker's last — each shed card folded into its overflow count and still named in the
 * index the caller built, so it can be opened. The budget is measured on the FINAL answer, `cut` line included.
 *
 * What this sheds is the cards. Two things it never cuts carry the bound on their own premises: keys — a cut key
 * opens nothing — which fit for `./cardKey.ts`'s `CARD_KEY` shape, ASCII and at most 160 characters past their
 * kind (the test of this module fills 25 and 10 to the brim); and the fields the page stamps, its counts, context
 * name and `observedAtIso` instant. A value outside those shapes is the way past the budget:
 * the answer is then returned over it, and the page's 24,576-byte tool cap bounds what is sent, refusing past
 * it in one line naming the tool and the cap.
 *
 * @param answer the whole answer, every field already fitted, `cut` not yet said
 * @param shortened how many fields were shortened building it
 * @param maxBytes the budget
 * @returns the answer that is sent
 */
export function fitActionItems<A extends FittableAnswer>({
  answer,
  shortened,
  maxBytes,
}: {
  answer: A;
  shortened: number;
  maxBytes: number;
}): A {
  let items = answer.items;
  let recentlyLeft = answer.recentlyLeft;
  const shed: SpokenItem[] = [];
  let shedLeft = 0;
  const build = (): A => ({
    ...answer,
    beyondCap: {
      marked: answer.beyondCap.marked || shed.some((item) => item.workspaceMark !== undefined),
      more: answer.beyondCap.more || shed.length > 0,
      parked: answer.beyondCap.parked || shed.some((item) => item.parked !== undefined),
    },
    cut: cutLine({ maxBytes, shedItems: shed.length, shedLeft, shortened }),
    items,
    recentlyLeft,
    recentlyLeftBeyondCap: answer.recentlyLeftBeyondCap + shedLeft,
  });
  let fitted = build();
  while (serialisedBytes({ value: fitted }) > maxBytes && recentlyLeft.length > 0) {
    recentlyLeft = recentlyLeft.slice(0, -1);
    shedLeft += 1;
    fitted = build();
  }
  const topKey = answer.top?.key;
  while (serialisedBytes({ value: fitted }) > maxBytes && items.length > 0) {
    let index = items.findLastIndex((item) => item.key !== topKey);
    if (index === -1) {
      index = items.length - 1;
    }
    shed.push(items[index]);
    items = items.filter((_, at) => at !== index);
    fitted = build();
  }
  return fitted;
}
