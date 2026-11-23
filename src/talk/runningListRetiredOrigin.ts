/**
 * The running list's one stored-value cutover: an item the owner put in the list before the rename carries the
 * pronoun spelling as its origin. This build reads only `owner`, so `./runningList.ts` asks here first and refuses
 * such a file by name, with its repair, rather than as a generic unreadable list (`./runningListErrors.ts`).
 *
 * Pure: no I/O.
 */
import { isRecord } from "#lib/parsers.js";

/** The owner's origin under the pronoun spelling a build before the rename wrote and read as the owner's. */
const RETIRED_OWNER_ORIGIN = /^him$/u;

/**
 * The first stored item carrying the retired owner origin, so the reader can name it and its repair rather than
 * refusing the file as a generic unreadable list.
 *
 * @param value the parsed JSON, of any shape
 * @returns the item's 1-based position and its origin, or `undefined` when no item carries it
 */
export function retiredOriginRow({
  value,
}: {
  value: unknown;
}): { readonly row: number; readonly origin: string } | undefined {
  if (!isRecord(value) || !Array.isArray(value["items"])) {
    return undefined;
  }
  const items: readonly unknown[] = value["items"];
  for (const [index, item] of items.entries()) {
    const origin = isRecord(item) ? item["origin"] : undefined;
    if (typeof origin === "string" && RETIRED_OWNER_ORIGIN.test(origin)) {
      return { origin, row: index + 1 };
    }
  }
  return undefined;
}
