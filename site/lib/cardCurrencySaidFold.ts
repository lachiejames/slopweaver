/**
 * The fold of what could bear on a Queue card since its floor — what the owner said, and what changed in their standing
 * rulings, memories and owner profile — which the opened card draws only shut (`./cardCurrency.ts` § `SaidFold`).
 * Pure; the clock reaches it through `ageOf`.
 */
import type { CurrencySaid, CurrencyStandingChange, CurrencyWord, SaidFold, SaidGroup, SaidRow } from "./cardCurrency";

/** One thing since the floor: a word the owner said, or a change to their standing guidance. */
export type SinceItem = CurrencyWord | CurrencyStandingChange;

/**
 * Where each thing was said or changed, as the row's sentence opens — never "chair", which means furniture to a reader, and
 * never a path or a pointer.
 */
const WHERE_SAID: Readonly<Record<SinceItem["source"], string>> = {
  chair: "In the supervisor chat",
  memory: "One of your memories changed",
  profile: "Your owner profile changed",
  relay: "Relayed from a console call",
  ruling: "A ruling of yours was recorded",
  voice: "On a console call",
};

/** How many of the owner's words a row's own line shows before the rest waits behind opening it. */
const LEAD_WORDS = 25;

/**
 * The opening of the owner's words: whole when they run to {@link LEAD_WORDS} or fewer, else that many — an ellipsis
 * wherever words are missing, at the start when the record kept only the end. The whole of them is what opening the row
 * shows.
 *
 * @param said the owner's words and where the record cut them
 * @returns the lead, and whether more sits behind it
 */
function leadOf({ said }: { said: CurrencySaid }): { readonly lead: string; readonly more: boolean } {
  const words = said.text.split(/\s+/).filter((word) => word.length > 0);
  const shortened = words.length > LEAD_WORDS;
  const head = said.cut === "start" ? "… " : "";
  const tail = shortened || said.cut === "end" ? " …" : "";
  return { lead: `${head}${words.slice(0, LEAD_WORDS).join(" ")}${tail}`, more: shortened || said.cut !== "none" };
}

/**
 * One thing since, as a sentence a person can use.
 *
 * @param item the reading's word or standing change
 * @param said the owner's words by pointer, when the reading carries them
 * @returns the row
 */
function saidRowOf({
  item,
  said,
  ageOf,
}: {
  item: SinceItem;
  said: Readonly<Record<string, CurrencySaid>> | undefined;
  ageOf: (args: { iso: string }) => string;
}): SaidRow {
  const text = said?.[item.pointer];
  const where = `${WHERE_SAID[item.source]}, ${ageOf({ iso: item.atIso })}`;
  if (text === undefined) {
    return { atIso: item.atIso, lead: undefined, more: false, said: undefined, where };
  }
  return { atIso: item.atIso, ...leadOf({ said: text }), said: text, where };
}

/**
 * The fold's summary: what the owner said, or — once a standing change is among them — every possible steer, since a
 * memory that changed is not something the owner said.
 *
 * @param items everything in the fold
 * @param here how many are tied to this card
 * @param since what "since" counts from
 * @returns the summary line
 */
function summaryOf({ items, here, since }: { items: readonly SinceItem[]; here: number; since: string }): string {
  const unfiled = items.length - here;
  const count = String(items.length);
  const spoken = items.every((item) => item.source === "chair" || item.source === "voice" || item.source === "relay");
  let things = items.length === 1 ? "1 possible steer" : `${count} possible steers`;
  if (spoken) {
    things = items.length === 1 ? "1 thing you said" : `${count} things you said`;
  }
  let tied = `${String(here)} tied to this card, ${String(unfiled)} not yet tied to any`;
  if (here === 0) {
    tied = "none yet tied to a card";
  } else if (unfiled === 0) {
    tied = "all tied to this card";
  }
  return `${things} since ${since}: ${tied}`;
}

/**
 * Everything since, newest first, the rows tied to this card ahead of the rest — the fold the opened card draws shut,
 * and its count.
 *
 * @param items the reading's words and standing changes for the card
 * @param said the owner's words by pointer, when the reading carries them
 * @param since what "since" counts from — "it was asked", or "it was last re-confirmed"
 * @returns the fold, or `undefined` when there is nothing to list
 */
export function saidFoldOf({
  items,
  said,
  since,
  ageOf,
}: {
  items: readonly SinceItem[];
  said: Readonly<Record<string, CurrencySaid>> | undefined;
  since: string;
  ageOf: (args: { iso: string }) => string;
}): SaidFold | undefined {
  if (items.length === 0) {
    return undefined;
  }
  const newestFirst = items.toSorted((a, b) => b.atIso.localeCompare(a.atIso));
  const here = newestFirst.filter((item) => item.filed === "here");
  const unfiled = newestFirst.filter((item) => item.filed === "unfiled");
  const groups: SaidGroup[] = [];
  if (here.length > 0) {
    groups.push({ heading: "Tied to this card", rows: here.map((item) => saidRowOf({ ageOf, item, said })) });
  }
  if (unfiled.length > 0) {
    groups.push({
      heading: "Not yet tied to any card, so any of these could bear on this one",
      rows: unfiled.map((item) => saidRowOf({ ageOf, item, said })),
    });
  }
  return { groups, summary: summaryOf({ here: here.length, items, since }) };
}
