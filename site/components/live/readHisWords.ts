/**
 * The owner's own words on a board row, as `handover list --json` publishes them (`src/handover/hisWords.ts`).
 *
 * **Row-local, never board-refusing.** `./read.ts` refuses the whole board when a row's identity will not read,
 * because a board missing a workstream must not look complete. A quote is not identity: one malformed quote
 * refusing the board would take every ask card off the queue to protect one. So a present field that will not
 * read becomes THAT row's `defect`, which its card draws as a refusal naming the wire — visible, never silent
 *.
 */
import { type Bag, isBag, str } from "../../lib/bag";

/** Which kind of record the words were read off, as the verb publishes it. */
export type HisWordsWhere = "console-typed" | "console-voice" | "call" | "call-landing" | "session";

/** Where a quote is known to be short of what the owner said, as the verb publishes it. */
export type HisWordsCut = "none" | "start" | "end";

/** The owner's words as a card draws them. */
export interface BoardRowQuote {
  readonly words: string;
  readonly atIso: string;
  readonly where: HisWordsWhere;
  readonly anchor: string;
  /** Where the quote is known to be short of what the owner said — the card draws an ellipsis there, never the store. */
  readonly cut: HisWordsCut;
}

/** What a row carries about the owner's words at its anchor. */
export type BoardRowHisWords =
  | { readonly kind: "absent" }
  | { readonly kind: "held"; readonly quote: BoardRowQuote }
  | { readonly kind: "unread"; readonly why: string }
  | { readonly kind: "defect"; readonly why: string };

const WHERES: readonly HisWordsWhere[] = ["console-typed", "console-voice", "call", "call-landing", "session"];
const CUTS: readonly HisWordsCut[] = ["none", "start", "end"];

/**
 * A published quote object — a board row's, or a steer's in the Alignment page's steers section (`./readSteers.ts`).
 *
 * @returns the quote, or `undefined` when any of its five fields will not read
 */
export function quoteOf({ value }: { value: Bag }): BoardRowQuote | undefined {
  const words = str({ bag: value, key: "words" });
  const atIso = str({ bag: value, key: "atIso" });
  const anchor = str({ bag: value, key: "anchor" });
  const where = WHERES.find((one) => one === value["where"]);
  const cut = CUTS.find((one) => one === value["cut"]);
  if (words === undefined || atIso === undefined || anchor === undefined || where === undefined) {
    return undefined;
  }
  if (cut === undefined || words.length === 0 || Number.isNaN(Date.parse(atIso))) {
    return undefined;
  }
  return { anchor, cut, atIso, where, words };
}

/** One of the owner's further steers on a row, as `handover list --json` publishes it (`src/handover/hisWordsSteers.ts`). */
export type BoardRowSteer =
  | { readonly kind: "held"; readonly index: number; readonly quote: BoardRowQuote }
  | { readonly kind: "unread"; readonly index: number; readonly anchor: string; readonly why: string }
  /** A steer that does not read — on the row, or on the wire; `index` is absent when the wire did not say which. */
  | { readonly kind: "defect"; readonly index: number | undefined; readonly why: string };

/**
 * One published steer, or the defect it is when it does not read. An index the board itself could not have counted
 * exactly — past `Number.isSafeInteger`, negative, or 0 on anything but the board's own oversized-keys defect — does
 * not read, so the card reports it rather than drawing it as one of the owner's steers.
 */
function steerOf({ value }: { value: unknown }): BoardRowSteer {
  const unreadable: BoardRowSteer = {
    index: undefined,
    kind: "defect",
    why: "the board published a steer for this row that does not read",
  };
  if (!isBag(value) || typeof value["index"] !== "number" || !Number.isSafeInteger(value["index"])) {
    return unreadable;
  }
  const index = value["index"];
  const kind = value["kind"];
  const why = str({ bag: value, key: "why" });
  const numbered = index >= 1;
  if (index < 0 || (!numbered && kind !== "defect")) {
    return unreadable;
  }
  if (kind === "held" && isBag(value["quote"])) {
    const quote = quoteOf({ value: value["quote"] });
    if (quote !== undefined) {
      return { index, kind: "held", quote };
    }
  }
  const anchor = str({ bag: value, key: "anchor" });
  if (kind === "unread" && anchor !== undefined && why !== undefined) {
    return { anchor, index, kind: "unread", why };
  }
  if (kind === "defect" && why !== undefined) {
    return { index, kind: "defect", why };
  }
  return { ...unreadable, index };
}

/**
 * Read a row's further steers. Each element is read on its own, so one that will not read is THAT steer's defect and
 * never erases a sibling; a board from before steers were published carries none.
 *
 * @param row the published board row
 * @returns the steers, in the order published
 */
export function readRowSteers({ row }: { row: Bag }): readonly BoardRowSteer[] {
  const published = row[ownerWordsKey({ field: "Steers", row })];
  if (published === undefined) {
    return [];
  }
  if (!Array.isArray(published)) {
    return [{ index: undefined, kind: "defect", why: "the board published this row's steers as something not a list" }];
  }
  return published.map((value: unknown) => steerOf({ value }));
}

/**
 * The owner's words stored on ANOTHER board row naming a pull request this row names, as `handover list --json` publishes them
 * (`src/handover/prSteers.ts`) — the card about a pull request carries every row of the owner's on it, not only its own.
 */
export type BoardRowPrSteer =
  | { readonly kind: "held"; readonly identity: string; readonly rowSlug: string; readonly quote: BoardRowQuote }
  | { readonly kind: "defect"; readonly why: string };

/**
 * Read a row's pull-request steers. Each element is read on its own, so one that will not read is THAT steer's defect
 * and never erases a sibling; a board from before they were published, or a single-row read, carries none.
 *
 * @param row the published board row
 * @returns the steers, in the order published
 */
export function readRowPrSteers({ row }: { row: Bag }): readonly BoardRowPrSteer[] {
  const published = row["prSteers"];
  if (published === undefined) {
    return [];
  }
  if (!Array.isArray(published)) {
    return [{ kind: "defect", why: "the board published this row's pull-request words as something not a list" }];
  }
  return published.map((value: unknown): BoardRowPrSteer => {
    const unreadable: BoardRowPrSteer = {
      kind: "defect",
      why: "the board published words of yours on this card's pull request that do not read",
    };
    if (!isBag(value) || !isBag(value["quote"])) {
      return unreadable;
    }
    const identity = str({ bag: value, key: "identity" });
    const rowSlug = str({ bag: value, key: "rowSlug" });
    const quote = quoteOf({ value: value["quote"] });
    if (identity === undefined || rowSlug === undefined || quote === undefined) {
      return unreadable;
    }
    return { identity, kind: "held", quote, rowSlug };
  });
}

/** The suffixes of the owner-words fields a row publishes, each after the `ownerWords` prefix. */
type OwnerWordsField = "" | "Defect" | "Unread" | "Steers";

const OWNER_WORDS_FIELDS: readonly OwnerWordsField[] = ["", "Defect", "Unread", "Steers"];

/**
 * The key a row publishes one owner-words field under: `ownerWords<suffix>`, or its pronoun twin (`hisWords<suffix>`)
 * on a board an older checkout published. The spelling is chosen for the whole row, so a row carrying any
 * owner-neutral field reads every field under that spelling and never mixes the two.
 *
 * @param row the published board row
 * @param field the field's suffix
 * @returns the key to read, present on the row or not
 */
function ownerWordsKey({ row, field }: { row: Bag; field: OwnerWordsField }): string {
  const neutral = OWNER_WORDS_FIELDS.some((one) => Object.hasOwn(row, `ownerWords${one}`));
  if (neutral) {
    return `ownerWords${field}`;
  }
  return `hisWords${field}`;
}

/**
 * Read a row's owner-words fields — `ownerWords`, `ownerWordsUnread`, `ownerWordsDefect`, each also under its pronoun
 * spelling — into one state.
 *
 * @param row the published board row
 * @returns the state, a present field that will not read being the row's own defect
 */
export function readRowHisWords({ row }: { row: Bag }): BoardRowHisWords {
  const defect = str({ bag: row, key: ownerWordsKey({ field: "Defect", row }) });
  if (defect !== undefined) {
    return { kind: "defect", why: defect };
  }
  const unreadKey = ownerWordsKey({ field: "Unread", row });
  const unread = str({ bag: row, key: unreadKey });
  const published = row[ownerWordsKey({ field: "", row })];
  const quote = isBag(published) ? quoteOf({ value: published }) : undefined;
  const present = [published !== undefined, unread !== undefined].filter(Boolean).length;
  if (present > 1) {
    return { kind: "defect", why: "the board published both a quote and an unread record for this row" };
  }
  if (published !== undefined && quote === undefined) {
    return { kind: "defect", why: "the board published a quote for this row that does not read" };
  }
  if (quote !== undefined) {
    return { kind: "held", quote };
  }
  if (Object.hasOwn(row, unreadKey) && unread === undefined) {
    return { kind: "defect", why: "the board published an unread record for this row that does not read" };
  }
  if (unread !== undefined) {
    return { kind: "unread", why: unread };
  }
  return { kind: "absent" };
}
