/**
 * The one fallible full listing of the Notion page ledger's `pages` index — every page slopweaver created or
 * adopted, read back for a reader that has to visit each one (the publication audit), and has to tell "nothing was
 * ever written" from "the inventory could not be read".
 *
 * A missing index is an empty inventory, because no confirmed write ever happened on this home. Any other failure to
 * list it is an `err`, never an empty list: a ledger that cannot be listed is not a ledger that holds nothing. A file
 * whose name is not a valid page id, or whose contents will not parse, is COUNTED rather than dropped, so a caller can
 * say it missed something. The record shape stays `./pageLedger.ts`'s: each file is read through `readPageRecord`.
 */
import { readdirSync } from "node:fs";

import { isAbsentError } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";

import { type PageRecord, pageIndexDir, readPageRecord } from "./pageLedger.js";

/** Every page record the `pages` index holds, and how many of its files would not read as one. */
export interface PageLedgerInventory {
  /** The records that parsed, in filename order. */
  readonly rows: readonly PageRecord[];
  /** Files in the index that are not `<valid page id>.json` or would not parse as a whole record. */
  readonly unreadableRows: number;
}

/** The one failure listing the `pages` index can report: fixed, naming no path and no provider text. */
export interface PageIndexUnlistableError {
  readonly code: "PAGE_INDEX_UNLISTABLE";
  readonly message: string;
}

/** Factories for the page ledger listing's one failure. */
export const PageLedgerListingErrors = {
  /** @returns the fixed listing failure, never the path, which names the local user */
  unlistable: (): PageIndexUnlistableError => ({
    code: "PAGE_INDEX_UNLISTABLE",
    message: "the notion page ledger's pages index could not be listed",
  }),
} as const;

/**
 * Every page record the `pages` index holds, created and adopted pages alike.
 *
 * @param home the state home the ledger lives under
 * @returns the parsed records and the unreadable-file count, or the fixed listing failure
 */
export function listPageRecords({ home }: { home: string }): Result<PageLedgerInventory, PageIndexUnlistableError> {
  const dir = pageIndexDir({ home });
  let names: readonly string[];
  try {
    names = readdirSync(dir);
  } catch (error: unknown) {
    if (isAbsentError({ error, path: dir })) {
      return ok({ rows: [], unreadableRows: 0 });
    }
    return err(PageLedgerListingErrors.unlistable());
  }
  const rows: PageRecord[] = [];
  let unreadableRows = 0;
  for (const name of names.toSorted()) {
    const pageId = name.endsWith(".json") ? name.slice(0, -".json".length) : undefined;
    // `readPageRecord` validates the id before it touches the filesystem, so a malformed name reads as undefined.
    const record = pageId === undefined ? undefined : readPageRecord({ home, pageId });
    if (record === undefined) {
      unreadableRows += 1;
      continue;
    }
    rows.push(record);
  }
  return ok({ rows, unreadableRows });
}
