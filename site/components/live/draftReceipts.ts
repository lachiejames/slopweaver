/**
 * What a parked draft's receipts are, as `slack draft list --json` prints the row's `receipts`
 * (`src/outbound/slack/receiptsLine.ts`), and the one line a Queue card leads with about them. A claim made to a person brings a link to where they can see it and a screenshot of it, and a card that
 * makes one without either says why, or says what was tried.
 */

import { type Bag, isBag, num, str, strings } from "../../lib/bag";

/** A row's receipts: the links and files it brings, why it needs none, or what was tried for one it lacks. */
export type DraftReceipts =
  | {
      readonly kind: "attached";
      readonly links: readonly string[];
      readonly media: number;
      readonly tried: string | undefined;
    }
  | { readonly kind: "self-evident"; readonly why: string }
  | { readonly kind: "tried"; readonly tried: string };

/** Whether a value is a string with something in it. */
function filled(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

/** Whether a bag carries exactly these keys, so a key this reader never learnt refuses rather than vanishing. */
function onlyKeys({ bag, keys }: { bag: Bag; keys: readonly string[] }): boolean {
  return Object.keys(bag).every((key) => keys.includes(key));
}

/**
 * One row's `receipts`. Absent is a row recorded before the field, or a bump that declared none; present and not one
 * of the three shapes is `"malformed"`, which refuses the row rather than drawing a card that claims no receipt.
 *
 * @param draft the row's `draft` bag
 * @returns the receipts, `undefined` when absent, or `"malformed"`
 */
export function draftReceiptsOf({ draft }: { draft: Bag }): DraftReceipts | undefined | "malformed" {
  const receipts = draft["receipts"];
  if (receipts === undefined) {
    return undefined;
  }
  if (!isBag(receipts)) {
    return "malformed";
  }
  const why = str({ bag: receipts, key: "why" });
  const tried = str({ bag: receipts, key: "tried" });
  if (receipts["kind"] === "self-evident" && onlyKeys({ bag: receipts, keys: ["kind", "why"] }) && filled(why)) {
    return { kind: "self-evident", why };
  }
  if (receipts["kind"] === "tried" && onlyKeys({ bag: receipts, keys: ["kind", "tried"] }) && filled(tried)) {
    return { kind: "tried", tried };
  }
  if (receipts["kind"] !== "attached" || !onlyKeys({ bag: receipts, keys: ["kind", "links", "media", "tried"] })) {
    return "malformed";
  }
  const links = strings({ bag: receipts, key: "links" });
  const media = num({ bag: receipts, key: "media" });
  const badTried = receipts["tried"] !== undefined && !filled(tried);
  if (links === undefined || media === undefined || badTried || (links.length === 0 && media === 0)) {
    return "malformed";
  }
  return { kind: "attached", links, media, tried };
}

/**
 * The line a Queue card leads with about a row's receipts — the same words `src/outbound/slack/receiptsLine.ts`'s
 * `receiptsLine` prints, bound to it by `site/__tests__/unit/draftReceipts.test.ts`.
 *
 * @param receipts the row's receipts, or `undefined` on a row that named none
 * @param bump whether the row is a bump, which owes none
 * @returns the line
 */
export function receiptsLine({ receipts, bump }: { receipts: DraftReceipts | undefined; bump: boolean }): string {
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
