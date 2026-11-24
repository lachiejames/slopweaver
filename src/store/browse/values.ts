/**
 * One stored value turned into the cell a page draws: credentials masked, cut to its display bound, and its full
 * length kept so a cut cell says how much it held.
 *
 * Masking happens HERE, in the CLI, before the value is printed — never in the page, by which time the raw value
 * would already have crossed the process boundary. It reuses the fail-closed masker the console's file views use
 * (`src/talk/fileRedaction.ts`): mask every credential shape and every string on the owner's private denylist, then
 * scan the result again, and withhold the whole cell if anything the gate calls a secret survived. The same mask
 * judges the catalog's own names ({@link catalogWithSafeIdentifiers}), withholding a table rather than a cell.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { redactCredentials, survivingSecrets } from "../../talk/fileRedaction.js";
import type { CatalogTable } from "./catalog.js";
import { type StoreBrowseError, StoreBrowseErrors } from "./errors.js";
import type { StoreCell } from "./types.js";

/**
 * The cell for one value as Postgres returned it: `value` is the text it rendered (already cut to the fetch window),
 * `length` the stored value's full length in characters.
 *
 * @param value the column's text, or `null` for SQL NULL
 * @param length the full length Postgres measured, `null` exactly when the value is
 * @param denylist the owner's private secret strings, masked wherever they appear
 * @param showCharacters how many characters of the masked text the cell shows before it is cut
 * @returns the cell, or `QUERY_FAILED` when the driver handed back something that is not text and a length
 */
export function storeCellOf({
  value,
  length,
  denylist,
  showCharacters,
}: {
  value: unknown;
  length: unknown;
  denylist: readonly string[];
  showCharacters: number;
}): Result<StoreCell, StoreBrowseError> {
  if (value === null && length === null) {
    return ok({ kind: "null" });
  }
  if (typeof value !== "string" || typeof length !== "number") {
    return err(StoreBrowseErrors.queryFailed({ cause: new Error("a value came back that is not text with a length") }));
  }
  const masked = redactCredentials({ denylist, source: false, text: value }).text;
  const survivors = survivingSecrets({ denylist, text: masked });
  if (survivors.length > 0) {
    return ok({
      kind: "withheld",
      why: `withheld: it holds a credential the mask could not remove (${survivors.join(", ")})`,
    });
  }
  const points = Array.from(masked);
  const cut = points.length > showCharacters;
  let text = masked;
  if (cut) {
    text = points.slice(0, showCharacters).join("");
  }
  return ok({ characters: length, kind: "value", text, truncated: cut || Array.from(value).length < length });
}

/**
 * The `QUERY_FAILED` error for something the database threw, its message put through the same mask as a cell. A
 * database error can quote a stored value — a cast or a policy function raising with the value in its text — so its
 * message is masked before it is printed, and withheld whole when a secret survives the mask.
 *
 * @param cause what the driver or the transaction threw
 * @param denylist the owner's private secret strings, masked wherever they appear
 * @returns the error, its message safe to print
 */
export function maskedQueryFailure({
  cause,
  denylist,
}: {
  cause: unknown;
  denylist: readonly string[];
}): StoreBrowseError {
  let raw = String(cause);
  if (cause instanceof Error) {
    raw = cause.message;
  }
  const masked = redactCredentials({ denylist, source: false, text: raw }).text;
  const survivors = survivingSecrets({ denylist, text: masked });
  if (survivors.length > 0) {
    return StoreBrowseErrors.queryFailed({
      cause: new Error(`the database's message was withheld: it holds a credential the mask could not remove`),
    });
  }
  return StoreBrowseErrors.queryFailed({ cause: new Error(masked) });
}

/** Whether one piece of catalog text leaves the mask exactly as it went in, with nothing a rescan calls a secret. */
function catalogTextIsSafe({ text, denylist }: { text: string; denylist: readonly string[] }): boolean {
  const masked = redactCredentials({ denylist, source: false, text }).text;
  if (masked !== text) {
    return false;
  }
  return survivingSecrets({ denylist, text: masked }).length === 0;
}

/** Every piece of text a table's definition prints: its name, its key, and each column's name and formatted type. */
function catalogTextOf({ table }: { table: CatalogTable }): readonly string[] {
  const { definition } = table;
  return [
    definition.name,
    ...definition.primaryKey,
    ...definition.columns.flatMap((column) => [column.name, column.formattedType]),
  ];
}

/**
 * Whether a token prints none of the owner's denylisted strings. The denylist only: a token is the lowercase hex of
 * a name that already passed the whole mask, so it discloses nothing new, and the shape passes would read every
 * 16-byte name's 32-character token as a hex key.
 */
function tokenIsSafe({ token, denylist }: { token: string; denylist: readonly string[] }): boolean {
  return !denylist.some((word) => word.trim().length > 0 && token.includes(word.toLowerCase()));
}

/** Every token a table's definition prints: its own, and each column's. */
function catalogTokensOf({ table }: { table: CatalogTable }): readonly string[] {
  return [table.definition.token, ...table.definition.columns.map((column) => column.token)];
}

/** Whether every piece of text and every token a table's definition prints is safe to print. */
function tableIsSafe({ table, denylist }: { table: CatalogTable; denylist: readonly string[] }): boolean {
  return (
    catalogTextOf({ table }).every((text) => catalogTextIsSafe({ denylist, text })) &&
    catalogTokensOf({ table }).every((token) => tokenIsSafe({ denylist, token }))
  );
}

/**
 * The catalog with every table withheld whose definition would print something the cell mask changes. The mask
 * works on a value; a catalog NAME is printed beside it, and its token is that name's hex, so masking the name alone
 * would still hand it out. A table is therefore kept whole or withheld whole, and fails closed on any one of its
 * name, a column's name, a primary-key entry, or a column's formatted type (which spells a user-defined type's own
 * name, another table's row type included), and on a token that prints a denylisted string.
 *
 * @param denylist the owner's private secret strings, as the cell mask uses them
 * @returns the tables kept, each the same object it was, in catalog order, and how many were withheld
 */
export function catalogWithSafeIdentifiers({
  catalog,
  denylist,
}: {
  catalog: readonly CatalogTable[];
  denylist: readonly string[];
}): { readonly catalog: readonly CatalogTable[]; readonly withheldTables: number } {
  const kept = catalog.filter((table) => tableIsSafe({ denylist, table }));
  return { catalog: kept, withheldTables: catalog.length - kept.length };
}
