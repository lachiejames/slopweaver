/**
 * The one fallible full listing of a Linear reservation ledger directory — every record a `linear` write verb
 * reserved, read back for an audit that must tell "nothing was ever written" from "the inventory could not be read".
 *
 * Each ledger module already has an id lister (`listIssueIds`, `listProjectIds`, …) that answers `[]` on ANY failure.
 * That is right for reconciliation and wrong for an audit: an unreadable ledger directory read as empty would report a
 * door clean that was never swept. So this listing answers `ok` with no records only when the directory is genuinely
 * absent (`#lib/presentFile.js`'s `isAbsentError`, which also refuses a dangling link), and an `err` on every other
 * failure. A file that will not parse, or that names an id other than its own file name, is COUNTED rather than
 * dropped: the row it hides may be the very write the audit came to find.
 *
 * Pure of policy: the caller supplies each ledger's own parser, so one record shape is decided in one place.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isAbsentError } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";

/** One ledger directory's records, and how many files in it could not be read as one. */
export interface LedgerListing<T> {
  /** Every readable record, in file-name order. */
  readonly records: readonly T[];
  /** Files that would not read, would not parse, or named an id other than their own file name. */
  readonly unreadableRows: number;
}

/** The ledger directory exists (or cannot be shown not to) but could not be listed. */
export interface LedgerUnreadableError {
  readonly code: "LEDGER_UNREADABLE";
  readonly message: string;
}

/** Factories for every ledger-listing failure. */
export const LedgerListingErrors = {
  /** @returns a {@link LedgerUnreadableError} with a fixed message — never the path, which names the local user */
  unreadable: (): LedgerUnreadableError => ({
    code: "LEDGER_UNREADABLE",
    message: "the ledger directory could not be listed",
  }),
} as const;

/** One record file, parsed, or undefined when it cannot be read or parsed. */
function readRecordFile<T>({
  path,
  parse,
}: {
  path: string;
  parse: (args: { raw: string }) => T | undefined;
}): T | undefined {
  try {
    return parse({ raw: readFileSync(path, "utf8") });
  } catch {
    return undefined;
  }
}

/**
 * Every record in one ledger directory, or the refusal saying the directory could not be listed.
 *
 * @param directory the ledger sub-directory holding one `<id>.json` per reservation
 * @param parse the ledger's own record parser, answering undefined for a record it cannot read
 * @returns the records and the unreadable-row count; an empty listing when the directory was never created
 */
export function listLedgerRecords<T extends { readonly id: string }>({
  directory,
  parse,
}: {
  directory: string;
  parse: (args: { raw: string }) => T | undefined;
}): Result<LedgerListing<T>, LedgerUnreadableError> {
  let names: readonly string[];
  try {
    names = readdirSync(directory);
  } catch (error: unknown) {
    if (isAbsentError({ error, path: directory })) {
      return ok({ records: [], unreadableRows: 0 });
    }
    return err(LedgerListingErrors.unreadable());
  }
  const records: T[] = [];
  let unreadableRows = 0;
  for (const name of names.filter((entry) => entry.endsWith(".json")).toSorted()) {
    const id = name.slice(0, -".json".length);
    const record = readRecordFile({ parse, path: join(directory, name) });
    // A record filed under another id is not evidence about this one, the posture `readDocumentRecord` takes.
    if (record?.id === id) {
      records.push(record);
    } else {
      unreadableRows += 1;
    }
  }
  return ok({ records, unreadableRows });
}
