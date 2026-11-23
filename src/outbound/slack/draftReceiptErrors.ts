/**
 * Typed refusals for `./draftReceipts.ts`'s `receiptsOfRecording`: the three ways a recording may not park over its
 * receipts. Bounded to that one rule, never folded into `./draftErrors.ts`'s wider register union, because a caller
 * branching on "why did the receipts refuse" has exactly these three answers.
 *
 * Every variant carries `lines` as well as `message`: the refusal prints one line per idea, the receipt rule's own
 * sentence first and the shapes and the no-hatch note after it, exactly as the string list it replaced did.
 */

/** The three shapes, named in every refusal that has no receipt so the recorder's next move is on the screen. */
const THREE_SHAPES =
  "Bring the receipt: a link to where the reader can see it, or `--media <file,…>` with a screenshot of it — no " +
  'flag needed for either. If the message itself is the evidence, say why: `--self-evident "<why no receipt is ' +
  'needed>"`. If you could not get it, say what you tried and what stopped it: `--tried "<what and why it failed>"`, ' +
  "which the card shows where the receipt would have been.";

/** Why there is no override, said rather than left for a reader to wonder about. */
const NO_HATCH =
  "There is deliberately NO escape hatch here: every way through is a declaration a recorder can always make.";

/** `--self-evident` was declared on a card that already carries a link or a file. */
export interface DraftReceiptsSelfEvidentWithReceiptsError {
  readonly code: "SELF_EVIDENT_WITH_RECEIPTS";
  readonly message: string;
  readonly lines: readonly string[];
  readonly links: number;
  readonly media: number;
}

/** `--self-evident` was declared on a re-cut of a row the owner sent back for its receipts. */
export interface DraftReceiptsSelfEvidentSentBackError {
  readonly code: "SELF_EVIDENT_SENT_BACK";
  readonly message: string;
  readonly lines: readonly string[];
  readonly sentBackFor: string;
}

/** The card carries no link and no file and declares neither shape. */
export interface DraftReceiptsMissingError {
  readonly code: "RECEIPTS_MISSING";
  readonly message: string;
  readonly lines: readonly string[];
}

/** Every refusal the receipt rule raises. */
export type DraftReceiptsError =
  DraftReceiptsSelfEvidentWithReceiptsError | DraftReceiptsSelfEvidentSentBackError | DraftReceiptsMissingError;

/** The factory the rule calls, so a test built the same way catches a drift. */
export const DraftReceiptsErrors = {
  missing: (): DraftReceiptsMissingError => {
    const first =
      "this card carries no receipt — no link and no file — and does not say why none is needed. A claim made to a " +
      "person brings at least a link to where they can see it and a screenshot of it.";
    return { code: "RECEIPTS_MISSING", lines: [first, THREE_SHAPES, NO_HATCH], message: first };
  },
  selfEvidentSentBack: ({ sentBackFor }: { sentBackFor: string }): DraftReceiptsSelfEvidentSentBackError => {
    const first =
      `this re-cuts ${sentBackFor}, which the owner sent back for its receipts, so it is not self-evident: the owner already ` +
      "said so. Put the link or the screenshot IN the message (a page only the fleet can open is not a receipt the " +
      'reader has), or say what you tried and what stopped it with --tried "<what and why it failed>".';
    return { code: "SELF_EVIDENT_SENT_BACK", lines: [first, NO_HATCH], message: first, sentBackFor };
  },
  selfEvidentWithReceipts: ({
    links,
    media,
  }: {
    links: number;
    media: number;
  }): DraftReceiptsSelfEvidentWithReceiptsError => {
    const first =
      `--self-evident says no receipt is needed, and this card carries ${String(links)} link(s) and ` +
      `${String(media)} file(s): it already brings its receipts. Drop --self-evident.`;
    return { code: "SELF_EVIDENT_WITH_RECEIPTS", lines: [first, NO_HATCH], links, media, message: first };
  },
} as const;
