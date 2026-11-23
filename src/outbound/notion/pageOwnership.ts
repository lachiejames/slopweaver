/**
 * Whether slopweaver may act on a Notion page, answered from the page ledger.
 *
 * The gate over the ledger rather than part of its record-keeping: it reads one record through
 * `readPageRecord` and writes nothing, so every filesystem call stays in `pageLedger.ts`.
 */
import { type PageRecord, readPageRecord } from "./pageLedger.js";

/** Why an update was refused. A named reason, never a bare false. */
export type PageOwnership =
  { readonly owned: true; readonly record: PageRecord } | { readonly owned: false; readonly reason: string };

/** What a caller is about to do to the page, so the refusal can name the actual consequence. */
export type PageOwnershipPurpose = "rewrite" | "move";

/** The consequence clause each purpose owes a reader who is being refused. */
const OWNERSHIP_CONSEQUENCE: Readonly<Record<PageOwnershipPurpose, string>> = {
  move:
    "so it will not move it. A move changes where colleagues find the page and whose permissions it " +
    "inherits, and this ledger is the only evidence the page was ours to relocate.",
  rewrite:
    "so it will not rewrite it. An update REPLACES the page body by deleting its existing blocks, and this " +
    "ledger is the only evidence the page was ours to replace.",
};

/**
 * Whether slopweaver may act on this page.
 *
 * Fails CLOSED on every uncertainty: no record, or a record whose create was never confirmed. Rewriting a
 * page means DELETING its existing blocks, so an unproven claim of ownership here destroys someone's work —
 * and a move relocates work that was never ours, which is a smaller harm but the same missing evidence.
 *
 * @param home the state home
 * @param pageId the Notion page id
 * @param purpose which act is being gated, so the refusal names what it would actually have done
 * @returns ownership, or a named refusal
 */
export function pageOwnershipOf({
  home,
  pageId,
  purpose = "rewrite",
}: {
  home: string;
  pageId: string;
  purpose?: PageOwnershipPurpose;
}): PageOwnership {
  const record = readPageRecord({ home, pageId });
  if (record === undefined) {
    return {
      owned: false,
      reason: `slopweaver has no record of creating page ${pageId}, ${OWNERSHIP_CONSEQUENCE[purpose]}`,
    };
  }
  if (record.confirmedIso === undefined) {
    return {
      owned: false,
      reason: `page ${pageId} was reserved at ${record.reservedIso} but never confirmed, so whether it exists is unknown.`,
    };
  }
  return { owned: true, record };
}
