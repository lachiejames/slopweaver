/**
 * What a parked row's receipts are, and the one line a Queue card leads with about them. A leaf on purpose: it imports
 * nothing, so `site/__tests__/unit/draftReceipts.test.ts` can bind the console's copy to it without `site/`'s
 * typecheck reaching `neverthrow`, which only the root project installs. What a recording may park with is
 * `draftReceipts.ts`.
 *
 * Pure: no network, no clock, no filesystem.
 */

/** A row's receipts, as parked. */
export type ParkedDraftReceipts =
  | {
      readonly kind: "attached";
      /** Every distinct link the rendered message carries, in first-seen order. */
      readonly links: readonly string[];
      /** How many files go under the message. */
      readonly media: number;
      /** What was tried for a receipt the card still lacks, when the recorder said so beside the ones it has. */
      readonly tried?: string | undefined;
    }
  | { readonly kind: "self-evident"; readonly why: string }
  | { readonly kind: "tried"; readonly tried: string };

/**
 * One line a Queue card leads with, saying what receipts the row brings.
 *
 * @param receipts the row's receipts, or `undefined` on a row that named none
 * @param bump whether the row is a bump, which owes none
 * @returns the line
 */
export function receiptsLine({ receipts, bump }: { receipts: ParkedDraftReceipts | undefined; bump: boolean }): string {
  if (receipts === undefined) {
    return bump ? "No receipt owed: a bump" : "No receipts named";
  }
  if (receipts.kind === "self-evident") {
    return `No receipt needed: ${receipts.why}`;
  }
  if (receipts.kind === "tried") {
    return `No receipt. Tried: ${receipts.tried}`;
  }
  const parts = [
    ...(receipts.links.length > 0 ? [counted({ count: receipts.links.length, noun: "link" })] : []),
    ...(receipts.media > 0 ? [counted({ count: receipts.media, noun: "attachment" })] : []),
  ];
  const line = `Receipts: ${parts.join(", ")}`;
  if (receipts.tried === undefined) {
    return line;
  }
  return `${line}. Still missing, tried: ${receipts.tried}`;
}

/** `1 link`, `2 links`. */
function counted({ count, noun }: { count: number; noun: string }): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}
